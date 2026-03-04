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

    active_projects = [i for i in data["items"] if i["status"] == "active" and i["type"] == "project"]
    active_qf = [i for i in data["items"] if i["status"] == "active" and i["type"] == "quick_fix"]

    ready = []
    for i in data["items"]:
        if i["status"] not in ("queued", "planning"):
            continue
        has_branch = bool(i.get("branch"))
        has_local_dir = bool(i.get("metadata", {}).get("local_directory"))
        has_repo_path = bool(i.get("metadata", {}).get("repo_path"))
        if i["type"] == "project" and not (has_branch or has_local_dir or has_repo_path):
            continue
        if any(not b.get("resolved") for b in i.get("blockers", [])):
            continue
        if cfg.require_approved_plan:
            plan = i.get("metadata", {}).get("plan", {})
            plan_approved = plan.get("approved", False) if isinstance(plan, dict) else False
            file_approved = i.get("metadata", {}).get("plan_approved", False)
            if not plan_approved and not file_approved:
                continue
        ready.append(i)

    ready.sort(key=lambda x: x["priority"])
    slots = max(0, cfg.max_active_projects - len(active_projects))
    qf_slots = max(0, cfg.quick_fix_limit - len(active_qf))

    print(
        f"[scheduler] Projects: {len(active_projects)}/{cfg.max_active_projects} | "
        f"Quick fixes: {len(active_qf)}/{cfg.quick_fix_limit} | "
        f"Ready: {len(ready)} | Slots: {slots}"
    )

    if not ready:
        print("[scheduler] No items ready for activation")
        return

    for item in ready:
        item_id, item_type, item_title = item["id"], item["type"], item["title"]
        if item_type == "project":
            if slots <= 0:
                print(f"[scheduler] Skipping {item_id}: {item_title} (no project slots)")
                continue
            slots -= 1
        elif item_type == "quick_fix":
            if qf_slots <= 0:
                print(f"[scheduler] Skipping {item_id}: {item_title} (no quick fix slots)")
                continue
            qf_slots -= 1

        if dry_run:
            print(f"[scheduler] Would activate: {item_id} — {item_title} ({item_type})")
        else:
            print(f"[scheduler] Activating: {item_id} — {item_title} ({item_type})")
            emit_event("scheduler.activating", f"Auto-activating: {item_title}", item_id=item_id)
            try:
                result = subprocess.run(
                    ["bash", os.path.join(SCRIPTS_DIR, "activate-stream.sh"), item_id],
                    capture_output=True, text=True, timeout=120, env=EXEC_ENV,
                )
                if result.stdout:
                    for line in result.stdout.strip().split("\n"):
                        print(f"  {line}")
                if result.returncode != 0:
                    print(f"[scheduler] ERROR: Failed to activate {item_id}", file=sys.stderr)
                    emit_event("scheduler.error", f"Failed to activate {item_id}", item_id=item_id, severity="error")
                    subprocess.run(
                        ["python3", "-m", "lib.queue", "update", item_id,
                         "status=queued", "activated_at=NULL", "worktree_path=NULL"],
                        cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                    )
                    print(f"[scheduler] Rolled back {item_id} to queued")
            except subprocess.TimeoutExpired:
                print(f"[scheduler] ERROR: Activation timed out for {item_id}", file=sys.stderr)


def generate_plans(cfg: Config, dry_run: bool) -> None:
    """Auto-generate plans for queued projects that don't have one."""
    if not cfg.auto_activate:
        return

    with locked_queue() as ctx:
        data = ctx["data"]

    for item in data["items"]:
        if item["status"] == "queued" and item["type"] == "project":
            if not item.get("metadata", {}).get("plan"):
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
            plan = item.get("metadata", {}).get("plan") or {}
            if isinstance(plan, dict) and plan.get("steps"):
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
                    if item.get("metadata"):
                        item["metadata"]["plan"] = None
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

        if item["status"] == "completed" and (item.get("session_id") or item.get("worktree_path")):
            if dry_run:
                print(f"[scheduler] Would teardown (worker-completed): {item_id} — {item_title}")
            else:
                print(f"[scheduler] Worker reported done — tearing down: {item_id} — {item_title}")
                emit_event("scheduler.worker_teardown", f"Auto-teardown after worker completion: {item_title}", item_id=item_id)
                _run_script("teardown-stream.sh", [item_id], timeout=60)

        elif item["status"] == "review" and (item.get("session_id") or item.get("delegator_id")):
            if dry_run:
                print(f"[scheduler] Would suspend (review with active sessions): {item_id} — {item_title}")
            else:
                print(f"[scheduler] Safety net: suspending review item with active sessions: {item_id} — {item_title}")
                emit_event("scheduler.safety_suspend", f"Suspending review item with lingering sessions: {item_title}", item_id=item_id, severity="warn")
                _run_script("suspend-stream.sh", [item_id], timeout=30)

        elif item["status"] == "review" and item.get("metadata", {}).get("completion_message"):
            msg = item["metadata"]["completion_message"]
            print(f"[scheduler] Worker moved to review: {item_id} — {item_title} ({msg})")


def reconcile_state(cfg: Config, dry_run: bool) -> None:
    """Enforce desired state — active items have sessions, review items do not."""
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

        if status == "active":
            seen_items.add(item_id)
            session_id = item.get("session_id") or ""
            worktree_path = item.get("worktree_path") or ""
            title = item.get("title", "")
            delegator_enabled = item.get("delegator_enabled")
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

            if not session_id:
                if worktree_path:
                    needs_spawn = True
            elif session_id in zombie_sessions:
                needs_respawn = True
                old_session_id = session_id
            elif session_id not in live_sessions:
                if worktree_path:
                    needs_spawn = True

            # Bug 3 fix: require grace period before respawning workers.
            # A worker transiently missing from vmux sessions during
            # delegator respawn churn should not trigger a cascade kill.
            if (needs_spawn or needs_respawn) and not is_paused:
                # Check if delegator was recently respawned for this item
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

                # Also enforce a "missing for 2 cycles" rule (applies to both spawn and respawn)
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
                    pass  # Skip this cycle
                elif needs_spawn:
                    # Worker confirmed missing past grace period
                    _worker_missing_since.pop(item_id, None)
                    if dry_run:
                        print(f"[reconcile] Would spawn worker for {item_id} at {worktree_path}")
                    else:
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
                # Worker is healthy — clear any missing tracking
                _worker_missing_since.pop(item_id, None)

            if delegator_enabled and not is_paused:
                delegator_dir = Path.home() / ".claude" / "orchestrator" / "delegators" / item_id
                if not (delegator_dir / "state.json").exists():
                    if dry_run:
                        print(f"[reconcile] Would initialize delegator for {item_id}")
                    else:
                        print(f"[reconcile] Initializing delegator state for {item_id}")
                        _run_script("spawn-delegator.sh", [item_id], timeout=60)

        elif status == "review":
            if item.get("session_id") or item.get("delegator_id"):
                if dry_run:
                    print(f"[reconcile] Would suspend review item {item_id} (has active sessions)")
                else:
                    print(f"[reconcile] Suspending review item {item_id} (has lingering sessions)")
                    emit_event("reconcile.suspend_review", f"Suspending review item with active sessions: {item_id}", item_id=item_id, severity="warn")
                    _run_script("suspend-stream.sh", [item_id], timeout=30)

    # Clean up tracking for items that are no longer active
    stale = [k for k in _worker_missing_since if k not in seen_items]
    for k in stale:
        del _worker_missing_since[k]


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


def _spawn_worker(cfg: Config, item_id: str, worktree_path: str, session_name: str) -> None:
    """Spawn a vmux worker session and update queue."""
    try:
        spawn_args = [cfg.tool_vmux, "spawn", worktree_path]
        if session_name:
            spawn_args.extend(["--name", session_name])
        result = subprocess.run(spawn_args, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            print(f"[reconcile] WARNING: vmux spawn failed for {item_id}: {result.stderr}", file=sys.stderr)
            return
        # Parse actual session ID from vmux output (format: "session_id:   <id>")
        new_id = None
        for line in (result.stdout or "").split("\n"):
            if "session_id:" in line:
                new_id = line.split("session_id:")[-1].strip()
                break
        if not new_id:
            # Fallback to session_name if vmux output didn't include session_id
            new_id = session_name or hashlib.sha256(worktree_path.encode()).hexdigest()[:12]
        subprocess.run(
            ["python3", "-m", "lib.queue", "update", item_id, f"session_id={new_id}"],
            cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
        )
        print(f"[reconcile] Worker spawned for {item_id} (session: {new_id})")
    except Exception as e:
        print(f"[reconcile] WARNING: Failed to spawn worker for {item_id}: {e}", file=sys.stderr)
