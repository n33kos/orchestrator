#!/usr/bin/env bash
# verify-ticket.sh — end-to-end readiness check for a queue item.
#
# Usage:
#   ./scripts/verify-ticket.sh <item-id>
#
# Exits 0 if every check passes, non-zero if anything is wrong.
# Every check prints a green check (✓) or a red X (✗) plus a short message.
#
# This is the single source of truth for "is this ticket actually ready?".
# Any agent that creates or modifies a ticket MUST run this before declaring
# the work done.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ITEM_ID="${1:?Usage: verify-ticket.sh <item-id>}"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

VMUX="$CONFIG_TOOL_VMUX"

cd "$SCRIPT_DIR"
exec python3 - "$ITEM_ID" "$CONFIG_REPOSITORIES_JSON" "$VMUX" <<'PYEOF'
import json
import os
import subprocess
import sys
from pathlib import Path

from lib.queue import find_item, locked_queue

GREEN = "\033[32m"
RED = "\033[31m"
DIM = "\033[2m"
RESET = "\033[0m"
CHECK = f"{GREEN}✓{RESET}"
CROSS = f"{RED}✗{RESET}"


def expand(path: str) -> str:
    return os.path.expanduser(path) if path else path


def main() -> int:
    item_id = sys.argv[1]
    repos_json = sys.argv[2] or "{}"
    vmux = sys.argv[3]

    try:
        repos = json.loads(repos_json)
    except json.JSONDecodeError:
        repos = {}

    with locked_queue() as ctx:
        data = ctx["data"]
        item = find_item(data, item_id)

    failures: list[str] = []

    # Schema drift breaks every writer at once, not just this ticket, so it is
    # checked here rather than left to be discovered as a downstream bug.
    conformance = subprocess.run(
        ["python3", str(Path(__file__).resolve().parent / "check-schema-conformance.py")],
        capture_output=True, text=True,
    )
    if conformance.returncode != 0:
        failures.append("schema conformance")
        print(f"  {CROSS} schema conformance check failed")
        for line in conformance.stdout.strip().splitlines():
            if line.startswith("FAIL") or line.startswith("  "):
                print(f"      {line.strip()}")
    else:
        print(f"  {CHECK} schema conformance")

    def ok(msg: str) -> None:
        print(f"  {CHECK} {msg}")

    def fail(msg: str) -> None:
        print(f"  {CROSS} {msg}")
        failures.append(msg)

    # --- 1. Item exists ---
    print(f"Verifying ticket: {item_id}")
    if not item:
        fail(f"Item {item_id} not found in queue.json")
        return 1
    ok(f"Item exists ({item.get('title', '(no title)')!r})")

    status = item.get("status", "")
    print(f"{DIM}  Status: {status}{RESET}")

    plan = item.get("plan") or {}
    env = item.get("environment") or {}
    worker = item.get("worker") or {}

    # --- 2. plan.file is set, file exists, non-empty ---
    plan_file = plan.get("file") or ""
    if not plan_file:
        fail("plan.file is empty — no plan file pointer")
    else:
        resolved = expand(plan_file)
        if not os.path.isabs(resolved):
            artifacts_dir = expand("~/.claude/orchestrator/plans")
            resolved = os.path.join(artifacts_dir, resolved)
        if not os.path.isfile(resolved):
            fail(f"plan.file points to non-existent path: {resolved}")
        elif os.path.getsize(resolved) == 0:
            fail(f"plan.file exists but is empty: {resolved}")
        else:
            ok(f"plan.file exists and is non-empty ({resolved})")

    # --- 3. plan.approved ---
    if plan.get("approved") is True:
        ok("plan.approved=true")
    else:
        fail(f"plan.approved is {plan.get('approved')!r} — must be true")

    # --- 4. repo resolution ---
    repo_key = item.get("repo_key") or ""
    env_repo = env.get("repo") or ""
    repo_path = ""
    if env_repo:
        repo_path = expand(env_repo)
        if not os.path.isdir(repo_path):
            fail(f"environment.repo set but path does not exist: {repo_path}")
        else:
            ok(f"environment.repo path exists: {repo_path}")
    elif repo_key:
        repo_cfg = repos.get(repo_key) or {}
        if not repo_cfg:
            fail(f"repo_key={repo_key!r} but no matching entry in repositories config")
        else:
            repo_path = expand(repo_cfg.get("path", ""))
            if not repo_path or not os.path.isdir(repo_path):
                fail(f"repo_key={repo_key!r} resolves to missing path: {repo_path}")
            else:
                ok(f"repo_key={repo_key!r} resolves to {repo_path}")
    else:
        fail("Neither repo_key nor environment.repo is set")

    # --- 5. use_worktree=false items need a real path ---
    use_worktree = env.get("use_worktree")
    if use_worktree is False and env_repo:
        resolved = expand(env_repo)
        if not os.path.isdir(resolved):
            fail(f"use_worktree=false but environment.repo path missing: {resolved}")
        else:
            ok("use_worktree=false and environment.repo path exists")

    # --- 6. commit_strategy ---
    KNOWN_STRATEGIES = {"branch_and_pr", "graphite_stack", "commit_to_main"}
    strategy = worker.get("commit_strategy") or ""
    if not strategy and repo_key:
        # Inherit from repo_key
        strategy = (repos.get(repo_key) or {}).get("commit_strategy", "")
    if strategy in KNOWN_STRATEGIES:
        ok(f"worker.commit_strategy={strategy}")
    else:
        fail(f"worker.commit_strategy={strategy!r} not in {sorted(KNOWN_STRATEGIES)}")

    # --- 7. Active-item-specific checks ---
    if status == "active":
        session_id = env.get("session_id") or ""
        if not session_id:
            fail("status=active but environment.session_id is empty")
        else:
            ok(f"environment.session_id is set ({session_id})")

            # vmux must see the session
            try:
                result = subprocess.run(
                    [vmux, "sessions"], capture_output=True, text=True, timeout=10
                )
                vmux_output = result.stdout if result.returncode == 0 else ""
            except (subprocess.TimeoutExpired, FileNotFoundError) as e:
                vmux_output = ""
                fail(f"vmux sessions invocation failed: {e}")

            found = False
            for line in vmux_output.splitlines():
                line = line.strip()
                if line.startswith("[") and "]" in line:
                    bracket_end = line.index("]")
                    raw_id = line[bracket_end + 1 :].strip()
                    hex_id = raw_id
                    if "(" in raw_id and raw_id.endswith(")"):
                        hex_id = raw_id[raw_id.rindex("(") + 1 : -1].strip()
                    # session_id may be stored as either format — match both
                    if hex_id == session_id or raw_id == session_id or session_id in raw_id:
                        found = True
                        break
                    # Also match by name prefix (session names start with item-id)
                    if raw_id.startswith(item_id):
                        found = True
                        break
            if found:
                ok(f"vmux sees session for {item_id}")
            elif vmux_output:
                fail(f"vmux does NOT see a session matching {session_id} or item-id {item_id}")
            # else already reported

        if env.get("task_instructions_delivered") is True:
            ok("environment.task_instructions_delivered=true")
        else:
            fail(
                "environment.task_instructions_delivered is "
                f"{env.get('task_instructions_delivered')!r} — must be true for active items"
            )

    # --- 8. Queued items: report readiness ---
    if status == "queued":
        if not failures:
            print(f"  {CHECK} status=queued and all checks pass — ready to activate")

    # --- Summary ---
    print()
    if failures:
        print(f"{RED}FAIL{RESET}: {len(failures)} check(s) failed")
        return 1
    print(f"{GREEN}PASS{RESET}: ticket is end-to-end ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
PYEOF
