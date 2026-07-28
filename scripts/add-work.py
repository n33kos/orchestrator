#!/usr/bin/env python3
"""Add a work item to the queue.

Writes through the locking, schema-validating queue helper, so a malformed item
can never be persisted. Ticket content belongs in the plan file, not the item.

Usage:
    python3 scripts/add-work.py --title TITLE [options]

Options:
    --priority N          1 (critical) to 5 (low). Default 3.
    --repo-key KEY        Repository key from config/environment.yml.
    --repo-path PATH      Explicit repo path, overriding the repo key's path.
    --branch NAME         Git branch for the work.
    --commit-strategy S   branch_and_pr (default), graphite_stack, commit_to_main.
    --no-worktree         Use the repo directory directly instead of a worktree.
    --no-delegator        Disable delegator monitoring for this item.
    --plan-file PATH      Path to an existing plan file.
    --blocked-by IDS      Comma-separated item ids that must complete first.
    --status STATUS       planning (default) or queued.
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib.queue import locked_queue  # noqa: E402


def next_item_id() -> str:
    result = subprocess.run(
        [str(SCRIPT_DIR / "next-ws-id.sh")], capture_output=True, text=True
    )
    if result.returncode != 0:
        sys.exit(f"Failed to allocate an item id: {result.stderr.strip()}")
    return result.stdout.strip()


def directive_slots() -> dict:
    """Pending runtime state for every configured delegator directive."""
    sys.path.insert(0, str(PROJECT_ROOT))
    try:
        from scripts.scheduler.directives import load_directives
    except ImportError:
        return {}

    names = {
        directive["name"]
        for status_directives in load_directives(str(PROJECT_ROOT)).values()
        for directive in status_directives
    }
    return {
        name: {"status": "pending", "retries": 0, "last_run": None, "output_path": None}
        for name in sorted(names)
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Add a work item to the queue")
    parser.add_argument("--title", required=True)
    parser.add_argument("--priority", type=int, default=3)
    parser.add_argument("--repo-key", default="")
    parser.add_argument("--repo-path", default="")
    parser.add_argument("--branch", default="")
    parser.add_argument(
        "--commit-strategy",
        default="branch_and_pr",
        choices=["branch_and_pr", "graphite_stack", "commit_to_main"],
    )
    parser.add_argument("--no-worktree", action="store_true")
    parser.add_argument("--no-delegator", action="store_true")
    parser.add_argument("--plan-file", default="")
    parser.add_argument("--blocked-by", default="")
    parser.add_argument("--status", default="planning", choices=["planning", "queued"])
    args = parser.parse_args()

    item_id = next_item_id()
    item = {
        "id": item_id,
        "source": "manual",
        "source_ref": "CLI manual entry",
        "repo_key": args.repo_key or None,
        "title": args.title,
        "priority": args.priority,
        "status": args.status,
        "blocked_by": [part.strip() for part in args.blocked_by.split(",") if part.strip()],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "activated_at": None,
        "completed_at": None,
        "environment": {
            "repo": args.repo_path or None,
            "use_worktree": not args.no_worktree,
            "branch": args.branch or None,
            "worktree_path": None,
            "session_id": None,
        },
        "worker": {
            "commit_strategy": args.commit_strategy,
            "delegator_enabled": not args.no_delegator,
            "directives_enabled": True,
            "directive_overrides": {},
        },
        "plan": {
            "file": args.plan_file or None,
            "summary": None,
            "approved": False,
            "approved_at": None,
        },
        "runtime": {
            "delegator_status": None,
            "spend": None,
            "last_activity": None,
            "pr_url": None,
            "stack_prs": None,
            "completion_message": None,
            "directives": directive_slots(),
        },
    }

    with locked_queue(write=True) as ctx:
        ctx["data"]["items"].append(item)
        ctx["modified"] = True

    print(json.dumps({"id": item_id, "title": args.title, "status": args.status}))


if __name__ == "__main__":
    main()
