"""Reconciliation and activation functions for the scheduler.

Ports: check_and_activate, generate_plans, check_planning_timeouts,
       process_worker_completions, reconcile_state from scheduler.sh.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from scripts.lib.queue import locked_queue
from scripts.scheduler.config import Config
from scripts.scheduler.events import emit_event

PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")
EXEC_ENV = {**os.environ, "HOME": os.path.expanduser("~")}

# Bug 3 fix: track when workers were first seen missing to require
# 2 consecutive cycles before respawning (prevents cascade kills
# during delegator respawn churn).
_worker_missing_since: dict[str, datetime] = {}
_WORKER_GRACE_PERIOD_SECS = 180  # 3 minutes grace before respawning


def _normalize_session_id(raw_id: str) -> str:
    """Extract the hex session ID from vmux's named session format.

    vmux sessions can report IDs in two formats:
      - Plain hex:  "1bd9b93adf90"
      - Named:      "ws-026-graphite-stack-suppo (1bd9b93adf90)"

    activate-stream.sh stores the full named format, but reconcile_state
    parses only the hex ID from vmux output. This mismatch caused the
    reconciler to think workers were always missing, triggering respawns
    that killed active sessions mid-conversation.
    """
    raw_id = raw_id.strip()
    if "(" in raw_id and raw_id.endswith(")"):
        return raw_id[raw_id.rindex("(") + 1:-1].strip()
    return raw_id


def check_and_activate(cfg: Config, dry_run: bool) -> None:
    """Check for available slots and auto-activate highest priority items."""
    pause_file = os.path.expanduser("~/.claude/orchestrator/paused")
    if os.path.isfile(pause_file):
        print("[scheduler] Orchestrator is paused — skipping activation")
        return

    if not cfg.auto_activate:
        print("[scheduler] auto_activate is disabled in config")
        return

    with locked_queue() as ctx:
        data = ctx["data"]

    active_items = [i for i in data["items"] if i["status"] == "active"]

    ready = []
    for i in data["items"]:
        if i["status"] not in ("queued", "planning"):
            continue
        env = i.get("environment") or {}
        has_branch = bool(env.get("branch"))
        has_repo = bool(env.get("repo"))
        if not (has_branch or has_repo):
            continue
        # Skip if any blocked_by dependency is not completed
        blocked_by = i.get("blocked_by", [])
        if blocked_by:
            all_items_by_id = {item["id"]: item for item in data["items"]}
            if any(all_items_by_id.get(dep_id, {}).get("status") != "completed" for dep_id in blocked_by):
                continue
        if cfg.require_approved_plan:
            plan = i.get("plan") or {}
            plan_approved = plan.get("approved", False) if isinstance(plan, dict) else False
            if not plan_approved:
                continue
        ready.append(i)

    ready.sort(key=lambda x: x["priority"])
    slots = max(0, cfg.max_active - len(active_items))

    print(
        f"[scheduler] Active: {len(active_items)}/{cfg.max_active} | "
        f"Ready: {len(ready)} | Slots: {slots}"
    )

    if not ready:
        print("[scheduler] No items ready for activation")
        return

    for item in ready:
        item_id, item_title = item["id"], item["title"]
        if slots <= 0:
            print(f"[scheduler] Skipping {item_id}: {item_title} (no slots)")
            break
        slots -= 1

        if dry_run:
            print(f"[scheduler] Would activate: {item_id} — {item_title}")
        else:
            print(f"[scheduler] Activating (non-blocking): {item_id} — {item_title}")
            emit_event("scheduler.activating", f"Auto-activating: {item_title}", item_id=item_id)
            try:
                _activate_nonblocking(cfg, item)
            except Exception as e:
                print(f"[scheduler] ERROR: Failed to activate {item_id}: {e}", file=sys.stderr)
                emit_event("scheduler.error", f"Failed to activate {item_id}", item_id=item_id, severity="error")
                subprocess.run(
                    ["python3", "-m", "lib.queue", "update", item_id,
                     "status=queued", "activated_at=NULL", "environment.worktree_path=NULL"],
                    cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                )
                print(f"[scheduler] Rolled back {item_id} to queued")


def _resolve_item_repo(cfg: Config, item: dict) -> "RepoConfig":
    """Resolve the effective repo config for a queue item.

    Priority: per-item fields > repo_key config > _defaults.
    """
    from scripts.scheduler.config import RepoConfig

    repo_key = item.get("repo_key")
    rc = cfg.resolve_repo(repo_key)

    # Per-item overrides take precedence
    env = item.get("environment") or {}
    worker = item.get("worker") or {}

    result = RepoConfig()
    result.path = os.path.expanduser(env.get("repo") or "") or rc.path
    result.worktree_prefix = rc.worktree_prefix
    result.use_worktree = env.get("use_worktree") if "use_worktree" in env else rc.use_worktree
    result.commit_strategy = worker.get("commit_strategy") or rc.commit_strategy
    result.branching_pattern = rc.branching_pattern
    result.worktree_setup = rc.worktree_setup
    result.worktree_setup_quick = rc.worktree_setup_quick
    result.worktree_teardown = rc.worktree_teardown
    result.worktree_list = rc.worktree_list
    result.worktree_dev = rc.worktree_dev
    return result


def _activate_nonblocking(cfg: Config, item: dict) -> None:
    """Activate an item without blocking on worktree creation.

    Sets status to active immediately, then determines setup needs:
    - non-worktree items: mkdir or use existing repo directly
    - worktree items: kick off worktree setup in the background; reconcile_state()
      will discover the worktree and spawn the session once it's ready.
    """
    item_id = item["id"]
    env = item.get("environment") or {}
    worker = item.get("worker") or {}
    rc = _resolve_item_repo(cfg, item)
    use_worktree = rc.use_worktree
    repo = rc.path
    branch = env.get("branch", "") or ""

    # 1. Set status to active immediately
    update_args = ["python3", "-m", "lib.queue", "update", item_id,
                   "status=active", "activated_at=NOW"]

    if not use_worktree:
        # Non-worktree items — use repo path directly
        expanded = os.path.expanduser(repo) if repo else ""
        if expanded:
            os.makedirs(expanded, exist_ok=True)
            update_args.append(f"environment.worktree_path={expanded}")
            subprocess.run(update_args, cwd=SCRIPTS_DIR, capture_output=True, timeout=10)
            print(f"[scheduler] Activated {item_id} with repo: {expanded}")
        else:
            raise RuntimeError(f"Item {item_id} has use_worktree=false but no repo path")

    elif branch:
        # Worktree items — needs worktree setup (background)
        subprocess.run(update_args, cwd=SCRIPTS_DIR, capture_output=True, timeout=10)
        _start_worktree_setup(cfg, item, branch, rc)
    else:
        raise RuntimeError(f"Item {item_id} has use_worktree=true but no branch")


def _start_worktree_setup(cfg: Config, item: dict, branch: str, rc: "RepoConfig | None" = None) -> None:
    """Kick off worktree creation in the background using the configured setup command.

    If a worktree already exists for this branch, sets worktree_path immediately.
    Otherwise, launches the worktree setup command as a background subprocess —
    reconcile_state() will discover the worktree once it's ready and spawn the session.
    """
    item_id = item if isinstance(item, str) else item["id"]
    if rc is None:
        rc = _resolve_item_repo(cfg, item) if isinstance(item, dict) else cfg.resolve_repo(None)
    main_repo = rc.path
    worktree_prefix = rc.worktree_prefix

    # Check if worktree already exists
    existing = _find_worktree_by_branch(main_repo, branch)
    if existing:
        subprocess.run(
            ["python3", "-m", "lib.queue", "update", item_id,
             f"environment.worktree_path={existing}"],
            cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
        )
        print(f"[scheduler] Worktree already exists for {item_id}: {existing}")
        return

    # Launch worktree setup in background
    log_dir = Path.home() / ".claude" / "orchestrator" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"worktree-setup-{item_id}.log"

    worktree_path = f"{worktree_prefix}{branch}"
    setup_cmd = rc.worktree_setup.format(
        branch=branch, path=worktree_path, repo_path=main_repo,
    )

    print(f"[scheduler] Starting background worktree setup for {item_id} (branch: {branch})")
    with open(log_file, "w") as lf:
        subprocess.Popen(
            setup_cmd, shell=True,
            stdout=lf, stderr=subprocess.STDOUT,
            cwd=main_repo, env=EXEC_ENV,
        )


def _find_worktree_by_branch(repo_path: str, branch: str) -> str | None:
    """Find an existing worktree by its branch name."""
    try:
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            capture_output=True, text=True, timeout=10, cwd=repo_path,
        )
        if result.returncode != 0:
            return None
        current_wt = None
        for line in result.stdout.split("\n"):
            if line.startswith("worktree "):
                current_wt = line[9:]
            elif line.startswith("branch refs/heads/") and current_wt:
                if line[18:] == branch:
                    if os.path.isdir(current_wt):
                        return current_wt
                current_wt = None
    except Exception:
        pass
    return None


def _set_session_hue(item_id: str, session_id: str) -> None:
    """Set deterministic hue for a work item's session via the relay API."""
    try:
        hue = int(hashlib.md5(item_id.encode()).hexdigest()[:4], 16) % 360
        secret_path = Path.home() / ".claude" / "voice-multiplexer" / "daemon.secret"
        if not secret_path.exists():
            return
        secret = secret_path.read_text().strip()
        url = f"http://localhost:3100/api/session-metadata/{session_id}"
        data = json.dumps({"hue_override": hue}).encode()
        req = urllib.request.Request(
            url, data=data, method="PUT",
            headers={"Content-Type": "application/json", "X-Daemon-Secret": secret},
        )
        urllib.request.urlopen(req, timeout=5)
        print(f"[reconcile] Set hue {hue} for session {session_id}")
    except Exception:
        pass  # Non-critical — don't fail activation over cosmetic hue


def generate_plans(cfg: Config, dry_run: bool) -> None:
    """Auto-generate plans for queued projects that don't have one."""
    if not cfg.auto_activate:
        return

    with locked_queue() as ctx:
        data = ctx["data"]

    for item in data["items"]:
        plan = item.get("plan") or {}
        has_plan = isinstance(plan, dict) and (plan.get("summary") or plan.get("file"))
        if item["status"] == "queued" and not has_plan:
            item_id, item_title = item["id"], item["title"]
            if dry_run:
                print(f"[scheduler] Would generate plan for: {item_id} — {item_title}")
            else:
                print(f"[scheduler] Generating plan for: {item_id} — {item_title}")
                args = ["bash", os.path.join(SCRIPTS_DIR, "generate-plan.sh"), item_id]
                if cfg.auto_approve_plans:
                    args.append("--auto-approve")
                try:
                    result = subprocess.run(args, capture_output=True, text=True, timeout=60, env=EXEC_ENV)
                    if result.stdout:
                        for line in result.stdout.strip().split("\n"):
                            print(f"  {line}")
                    if result.returncode != 0:
                        print(f"[scheduler] ERROR: Failed to generate plan for {item_id}", file=sys.stderr)
                        emit_event("scheduler.error", f"Failed to generate plan for {item_id}", item_id=item_id, severity="error")
                except subprocess.TimeoutExpired:
                    pass


def check_planning_timeouts(cfg: Config) -> None:
    """Revert items stuck in 'planning' without a completed plan back to 'queued'."""
    now = datetime.now(timezone.utc)
    timeout = timedelta(minutes=10)

    with locked_queue(write=True) as ctx:
        data = ctx["data"]
        for item in data["items"]:
            if item["status"] != "planning":
                continue
            plan = item.get("plan") or {}
            if isinstance(plan, dict) and plan.get("summary"):
                continue
            activated = item.get("activated_at") or item.get("created_at")
            if not activated:
                continue
            try:
                activated_dt = datetime.fromisoformat(activated.replace("Z", "+00:00"))
                if activated_dt.tzinfo is None:
                    activated_dt = activated_dt.replace(tzinfo=timezone.utc)
                if now - activated_dt > timeout:
                    item_id, item_title = item["id"], item["title"]
                    print(f"[scheduler] Planning timeout: {item_id} ({item_title}) — reverting to queued")
                    emit_event("scheduler.planning_timeout", f"Plan timed out for {item_title}", item_id=item_id, severity="warn")
                    item["status"] = "queued"
                    item["plan"] = {"file": None, "summary": None, "approved": False, "approved_at": None}
                    ctx["modified"] = True
            except (ValueError, TypeError):
                continue


def process_worker_completions(cfg: Config, dry_run: bool) -> None:
    """Handle items completed by workers that still have active sessions."""
    with locked_queue() as ctx:
        data = ctx["data"]

    for item in data["items"]:
        item_id = item["id"]
        item_title = item.get("title", "")
        env = item.get("environment") or {}

        if item["status"] == "completed" and (env.get("session_id") or env.get("worktree_path")):
            if dry_run:
                print(f"[scheduler] Would teardown (worker-completed): {item_id} — {item_title}")
            else:
                print(f"[scheduler] Worker reported done — tearing down: {item_id} — {item_title}")
                emit_event("scheduler.worker_teardown", f"Auto-teardown after worker completion: {item_title}", item_id=item_id)
                _run_script("teardown-stream.sh", [item_id], timeout=60)

        elif item["status"] == "review":
            runtime = item.get("runtime") or {}
            if runtime.get("completion_message"):
                msg = runtime["completion_message"]
                print(f"[scheduler] Item in review: {item_id} — {item_title} ({msg})")


def reconcile_state(cfg: Config, dry_run: bool) -> None:
    """Enforce desired state — active and review items keep sessions alive, completed items do not."""
    pause_file = os.path.expanduser("~/.claude/orchestrator/paused")
    is_paused = os.path.isfile(pause_file)

    with locked_queue() as ctx:
        data = ctx["data"]

    # Get live sessions from vmux
    try:
        result = subprocess.run([cfg.tool_vmux, "sessions"], capture_output=True, text=True, timeout=10)
        sessions_output = result.stdout if result.returncode == 0 else ""
    except Exception:
        sessions_output = ""

    live_sessions: set[str] = set()
    zombie_sessions: set[str] = set()
    for line in sessions_output.split("\n"):
        line = line.strip()
        if line.startswith("[") and "]" in line:
            bracket_end = line.index("]")
            state = line[1:bracket_end]
            raw_id = line[bracket_end + 1:].strip()
            # Named sessions: "session-name (actual-id)" — extract the ID in parens
            if "(" in raw_id and raw_id.endswith(")"):
                session_id = raw_id[raw_id.rindex("(") + 1:-1].strip()
            else:
                session_id = raw_id
            if session_id:
                if state == "zombie":
                    zombie_sessions.add(session_id)
                else:
                    live_sessions.add(session_id)

    now = datetime.now(timezone.utc)
    seen_items: set[str] = set()

    for item in data["items"]:
        item_id = item["id"]
        status = item["status"]

        if status in ("active", "review"):
            seen_items.add(item_id)
            env = item.get("environment") or {}
            session_id = env.get("session_id") or ""
            worktree_path = env.get("worktree_path") or ""
            title = item.get("title", "")
            use_worktree = env.get("use_worktree", True)

            # Non-worktree items use their repo path directly
            if not use_worktree and not worktree_path:
                repo = env.get("repo", "")
                if repo:
                    expanded_repo = os.path.expanduser(repo)
                    # Create workspace directory if it doesn't exist (handles manual activation)
                    os.makedirs(expanded_repo, exist_ok=True)
                    worktree_path = expanded_repo
                    update_fields = [f"environment.worktree_path={worktree_path}"]
                    # Also set activated_at if missing (manual activation case)
                    if not item.get("activated_at"):
                        update_fields.append("activated_at=NOW")
                    subprocess.run(
                        ["python3", "-m", "lib.queue", "update", item_id] + update_fields,
                        cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                    )

            # Worktree discovery: active items without a worktree_path may be
            # waiting for a background worktree setup to complete.
            if not worktree_path and use_worktree:
                branch = env.get("branch", "")
                if branch:
                    rc = _resolve_item_repo(cfg, item)
                    main_repo = rc.path
                    discovered = _find_worktree_by_branch(main_repo, branch)
                    if discovered:
                        worktree_path = discovered
                        subprocess.run(
                            ["python3", "-m", "lib.queue", "update", item_id,
                             f"environment.worktree_path={worktree_path}"],
                            cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                        )
                        print(f"[reconcile] Discovered worktree for {item_id}: {worktree_path}")
                    else:
                        print(f"[reconcile] Worktree for {item_id} not ready yet (branch: {branch})")
                        continue  # Skip session/delegator checks — worktree still building

            # Guard: spawning a worker at the orchestrator's own directory would
            # take over the orchestrator's vmux session.
            if worktree_path and os.path.realpath(worktree_path) == os.path.realpath(PROJECT_ROOT):
                print(f"[reconcile] REFUSING to spawn worker for {item_id} at orchestrator root ({worktree_path})")
                continue

            worker_cfg = item.get("worker") or {}
            delegator_enabled = worker_cfg.get("delegator_enabled")
            if delegator_enabled is None:
                delegator_enabled = cfg.delegator_enabled
            else:
                delegator_enabled = str(delegator_enabled).lower() in ("true",)

            words = [w for w in title.split() if len(w) > 2][:3]
            short = "-".join(w.lower() for w in words) if words else "worker"
            short = re.sub(r"[^a-z0-9_-]", "", short)[:20]
            session_name = f"{item_id}-{short}"

            needs_spawn = False
            needs_respawn = False
            old_session_id = ""

            normalized_id = _normalize_session_id(session_id) if session_id else ""

            if not session_id:
                if worktree_path:
                    needs_spawn = True
            elif normalized_id in zombie_sessions:
                needs_respawn = True
                old_session_id = normalized_id
            elif normalized_id not in live_sessions:
                if worktree_path:
                    needs_spawn = True

            if (needs_spawn or needs_respawn) and not is_paused:
                delegator_state_file = (
                    Path.home() / ".claude" / "orchestrator" / "delegators" / item_id / "state.json"
                )
                skip_for_delegator_churn = False
                if (needs_spawn or needs_respawn) and delegator_state_file.exists():
                    try:
                        with open(delegator_state_file) as f:
                            dstate = json.load(f)
                        last_respawn = (dstate.get("respawn") or {}).get("last_at")
                        if last_respawn:
                            rts = datetime.fromisoformat(last_respawn.replace("Z", "+00:00"))
                            if rts.tzinfo is None:
                                rts = rts.replace(tzinfo=timezone.utc)
                            if (now - rts).total_seconds() < _WORKER_GRACE_PERIOD_SECS:
                                skip_for_delegator_churn = True
                    except Exception:
                        pass

                if (needs_spawn or needs_respawn) and session_id and item_id not in _worker_missing_since:
                    _worker_missing_since[item_id] = now
                    skip_for_delegator_churn = True
                    print(f"[reconcile] Worker for {item_id} missing — will respawn next cycle if still gone")
                elif (needs_spawn or needs_respawn) and session_id and item_id in _worker_missing_since:
                    elapsed = (now - _worker_missing_since[item_id]).total_seconds()
                    if elapsed < _WORKER_GRACE_PERIOD_SECS:
                        skip_for_delegator_churn = True
                        print(f"[reconcile] Worker for {item_id} still missing ({int(elapsed)}s) — waiting for grace period")

                if skip_for_delegator_churn:
                    pass
                elif needs_spawn:
                    existing = _find_session_by_cwd(cfg, worktree_path)
                    if existing:
                        _worker_missing_since.pop(item_id, None)
                        print(f"[reconcile] Found existing session {existing} at {worktree_path} — updating stored ID for {item_id}")
                        subprocess.run(
                            ["python3", "-m", "lib.queue", "update", item_id, f"environment.session_id={existing}"],
                            cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                        )
                    elif dry_run:
                        print(f"[reconcile] Would spawn worker for {item_id} at {worktree_path}")
                    else:
                        _worker_missing_since.pop(item_id, None)
                        print(f"[reconcile] Spawning missing worker session for {item_id} at {worktree_path}")
                        emit_event("reconcile.spawn_worker", f"Spawning missing worker for {item_id}", item_id=item_id, severity="warn")
                        _spawn_worker(cfg, item_id, worktree_path, session_name)
                elif needs_respawn:
                    _worker_missing_since.pop(item_id, None)
                    if dry_run:
                        print(f"[reconcile] Would respawn zombie worker for {item_id} ({old_session_id})")
                    else:
                        print(f"[reconcile] Respawning zombie worker for {item_id} ({old_session_id})")
                        emit_event("reconcile.respawn_worker", f"Respawning zombie worker {old_session_id} for {item_id}", item_id=item_id, severity="warn")
                        try:
                            subprocess.run([cfg.tool_vmux, "kill", old_session_id], capture_output=True, timeout=10)
                        except Exception:
                            pass
                        time.sleep(2)
                        _spawn_worker(cfg, item_id, worktree_path, session_name)
            else:
                _worker_missing_since.pop(item_id, None)

            if delegator_enabled and not is_paused:
                delegator_dir = Path.home() / ".claude" / "orchestrator" / "delegators" / item_id
                if not (delegator_dir / "state.json").exists():
                    if dry_run:
                        print(f"[reconcile] Would initialize delegator for {item_id}")
                    else:
                        print(f"[reconcile] Initializing delegator state for {item_id}")
                        _run_script("spawn-delegator.sh", [item_id], timeout=60)

    # Clean up tracking for items that are no longer active
    stale = [k for k in _worker_missing_since if k not in seen_items]
    for k in stale:
        del _worker_missing_since[k]


def discover_pr_urls(cfg: Config, dry_run: bool) -> None:
    """Auto-discover PR URLs for active items that have no pr_url set."""
    with locked_queue() as ctx:
        data = ctx["data"]

    candidates = [
        i for i in data["items"]
        if i["status"] == "active" and not (i.get("runtime") or {}).get("pr_url")
    ]

    if not candidates:
        return

    for item in candidates:
        item_id = item["id"]
        env = item.get("environment") or {}
        branch = env.get("branch", "")
        if not branch:
            continue

        # Determine the repo path to run gh commands in
        repo_path = env.get("repo", "")
        if repo_path:
            repo_path = os.path.expanduser(repo_path)
        if not repo_path:
            repo_path = env.get("worktree_path", "")

        if not repo_path or not os.path.isdir(repo_path):
            continue

        worker_cfg = item.get("worker") or {}
        is_graphite_stack = worker_cfg.get("commit_strategy") == "graphite_stack"

        try:
            if is_graphite_stack:
                result = subprocess.run(
                    ["gh", "pr", "list", "--search", f"head:{branch}",
                     "--state", "all", "--json", "number,url,isDraft",
                     "--limit", "20"],
                    capture_output=True, text=True, timeout=15,
                    cwd=repo_path, env=EXEC_ENV,
                )
            else:
                result = subprocess.run(
                    ["gh", "pr", "list", "--head", branch,
                     "--state", "all", "--json", "number,url,isDraft",
                     "--limit", "1"],
                    capture_output=True, text=True, timeout=15,
                    cwd=repo_path, env=EXEC_ENV,
                )

            if result.returncode != 0:
                continue

            prs = json.loads(result.stdout) if result.stdout.strip() else []
            if not prs:
                continue

            prs.sort(key=lambda p: p.get("number", 0))
            first_url = prs[0].get("url", "")

            if not first_url:
                continue

            update_args = [
                "python3", "-m", "lib.queue", "update", item_id,
                f"runtime.pr_url={first_url}",
            ]

            if is_graphite_stack:
                stack_urls = [p.get("url", "") for p in prs if p.get("url")]
                update_args.append(f"runtime.stack_prs={json.dumps(stack_urls)}")

            if dry_run:
                print(f"[reconcile] Would set pr_url for {item_id}: {first_url}")
                if is_graphite_stack:
                    print(f"[reconcile]   Stack has {len(prs)} PRs")
            else:
                subprocess.run(
                    update_args,
                    cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                )
                print(f"[reconcile] Auto-discovered pr_url for {item_id}: {first_url}")
                if is_graphite_stack:
                    print(f"[reconcile]   Stack has {len(prs)} PRs")
                emit_event("reconcile.pr_discovered", f"Auto-discovered PR for {item_id}: {first_url}", item_id=item_id)

        except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
            print(f"[reconcile] WARNING: PR discovery failed for {item_id}: {e}", file=sys.stderr)


def _run_script(script_name: str, args: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    """Run a script from the scripts/ directory."""
    try:
        result = subprocess.run(
            ["bash", os.path.join(SCRIPTS_DIR, script_name)] + args,
            capture_output=True, text=True, timeout=timeout, env=EXEC_ENV,
        )
        if result.stdout:
            for line in result.stdout.strip().split("\n"):
                print(f"  {line}")
        if result.returncode != 0 and result.stderr:
            print(f"  ERROR: {result.stderr.strip()}", file=sys.stderr)
        return result
    except subprocess.TimeoutExpired:
        print(f"  ERROR: {script_name} timed out", file=sys.stderr)
        return subprocess.CompletedProcess(args=[], returncode=1)


def _find_session_by_cwd(cfg: Config, worktree_path: str) -> str | None:
    """Find a vmux session ID by its working directory."""
    try:
        result = subprocess.run(
            [cfg.tool_vmux, "sessions"], capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return None
        current_id = None
        for line in result.stdout.split("\n"):
            line = line.strip()
            if line.startswith("[") and "]" in line:
                bracket_end = line.index("]")
                raw_id = line[bracket_end + 1:].strip()
                current_id = _normalize_session_id(raw_id)
            elif "cwd:" in line and worktree_path in line and current_id:
                return current_id
    except Exception:
        pass
    return None


def _spawn_worker(cfg: Config, item_id: str, worktree_path: str, session_name: str) -> None:
    """Spawn a vmux worker session, send task instructions, and update queue."""
    if os.path.realpath(worktree_path) == os.path.realpath(PROJECT_ROOT):
        print(f"[reconcile] REFUSING to spawn worker for {item_id} at orchestrator root ({worktree_path})", file=sys.stderr)
        return
    try:
        spawn_args = [cfg.tool_vmux, "spawn", worktree_path]
        if session_name:
            spawn_args.extend(["--name", session_name])
        result = subprocess.run(spawn_args, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            print(f"[reconcile] WARNING: vmux spawn failed for {item_id}: {result.stderr}", file=sys.stderr)
            return

        time.sleep(2)
        new_id = _find_session_by_cwd(cfg, worktree_path)
        if not new_id:
            new_id = hashlib.sha256(worktree_path.encode()).hexdigest()[:12]
            print(f"[reconcile] WARNING: Could not find session by CWD, using computed ID {new_id}", file=sys.stderr)

        subprocess.run(
            ["python3", "-m", "lib.queue", "update", item_id, f"environment.session_id={new_id}"],
            cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
        )
        print(f"[reconcile] Worker spawned for {item_id} (session: {new_id})")

        _send_task_instructions(cfg, item_id, new_id)
        _set_session_hue(item_id, new_id)
    except Exception as e:
        print(f"[reconcile] WARNING: Failed to spawn worker for {item_id}: {e}", file=sys.stderr)


def _send_task_instructions(cfg: Config, item_id: str, session_id: str) -> None:
    """Send task instructions to a worker session (retry until standby)."""
    try:
        result = subprocess.run(
            ["python3", "-m", "lib.queue", "get", item_id, "title", "environment.branch", "plan.file"],
            cwd=SCRIPTS_DIR, capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            print(f"[reconcile] WARNING: Could not read queue item {item_id} for task message", file=sys.stderr)
            return
        parts = result.stdout.strip().split("\x1f")
        title = parts[0] if len(parts) > 0 else ""
        branch = parts[1] if len(parts) > 1 else ""
        plan_file = parts[2] if len(parts) > 2 else ""

        if not plan_file or plan_file == "None":
            plan_file = os.path.expanduser(f"~/.claude/orchestrator/plans/{item_id}.md")
        elif not os.path.isabs(plan_file) and not plan_file.startswith("~"):
            # Relative filename — resolve against configured plans directory
            plan_file = os.path.join(os.path.expanduser(cfg.plans_dir), plan_file)
        else:
            plan_file = os.path.expanduser(plan_file)

        branch_line = f"Branch: {branch}" if branch and branch != "None" else "Branch: (none — direct commit to main)"
        task_message = (
            f"[Task Assignment] {title}\n\n"
            f"Read your full implementation plan and task context at: {plan_file}\n\n"
            f"{branch_line}\n"
            f"Status: Activating now — follow the plan steps in order."
        )

        for attempt in range(1, 4):
            try:
                send_result = subprocess.run(
                    [cfg.tool_vmux, "send", session_id, task_message],
                    capture_output=True, text=True, timeout=10,
                )
                if send_result.returncode == 0:
                    print(f"[reconcile] Task instructions sent to {item_id} (session: {session_id})")
                    return
            except Exception:
                pass
            if attempt < 3:
                time.sleep(5)

        print(f"[reconcile] WARNING: Could not send task instructions to {item_id} after 15s (will retry next cycle)", file=sys.stderr)
    except Exception as e:
        print(f"[reconcile] WARNING: Failed to send task instructions to {item_id}: {e}", file=sys.stderr)
