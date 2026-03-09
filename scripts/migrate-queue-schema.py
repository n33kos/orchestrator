#!/usr/bin/env python3
"""One-time migration script: flat queue schema → nested schema.

Reads queue.json, transforms every item to the new nested structure
(environment, worker, plan, runtime), and writes back.

Usage:
    python3 scripts/migrate-queue-schema.py [--dry-run]
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

QUEUE_PATH = os.path.expanduser("~/.claude/orchestrator/queue.json")
BACKUP_PATH = QUEUE_PATH + f".backup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"

# The main configured repo path (used to determine use_worktree)
MAIN_REPO = os.path.expanduser("~/babylist-web")


def migrate_item(item: dict) -> dict:
    """Transform a single queue item from old schema to new schema."""
    meta = item.get("metadata") or {}

    # --- environment ---
    local_dir = meta.get("local_directory", "") or ""
    repo_path = meta.get("repo_path", "") or ""
    old_branch = item.get("branch", "") or ""
    old_pr_type = meta.get("pr_type", "") or ""

    # Determine use_worktree and repo
    if local_dir:
        use_worktree = False
        env_repo = local_dir
    elif repo_path:
        expanded_repo = os.path.expanduser(repo_path)
        expanded_main = os.path.expanduser(MAIN_REPO)
        try:
            same_repo = os.path.realpath(expanded_repo) == os.path.realpath(expanded_main)
        except Exception:
            same_repo = expanded_repo == expanded_main
        use_worktree = same_repo
        env_repo = repo_path
    elif old_branch:
        use_worktree = True
        env_repo = MAIN_REPO
    else:
        use_worktree = False
        env_repo = ""

    environment = {
        "repo": env_repo if env_repo else None,
        "use_worktree": use_worktree,
        "branch": old_branch if old_branch else None,
        "worktree_path": item.get("worktree_path"),
        "session_id": item.get("session_id"),
    }

    # --- worker ---
    old_commit_strategy = meta.get("commit_strategy", "") or ""
    old_no_branch = meta.get("no_branch", False)

    if old_pr_type == "graphite_stack":
        commit_strategy = "graphite_stack"
    elif old_no_branch or old_commit_strategy == "single_commit_to_main":
        commit_strategy = "commit_to_main"
    else:
        commit_strategy = "branch_and_pr"

    worker = {
        "commit_strategy": commit_strategy,
        "delegator_enabled": item.get("delegator_enabled", True),
    }

    # Carry over stack_steps if present
    stack_steps = meta.get("stack_steps")
    if stack_steps:
        worker["stack_steps"] = stack_steps

    # --- plan ---
    old_plan = meta.get("plan") or {}
    if not isinstance(old_plan, dict):
        old_plan = {}

    plan = {
        "file": meta.get("plan_file") or None,
        "summary": old_plan.get("summary") or None,
        "approved": old_plan.get("approved", False),
        "approved_at": old_plan.get("approved_at") or None,
    }

    # --- runtime ---
    runtime = {
        "delegator_status": meta.get("delegator_status") or None,
        "spend": meta.get("spend") or None,
        "last_activity": meta.get("last_activity") or None,
        "pr_url": item.get("pr_url") or None,
        "stack_prs": meta.get("stack_prs") or None,
        "completion_message": meta.get("completion_message") or None,
    }

    # --- Build new item ---
    new_item = {
        "id": item["id"],
        "title": item.get("title", ""),
        "description": item.get("description", ""),
        "source": item.get("source", "manual"),
        "priority": item.get("priority", 99),
        "status": item.get("status", "queued"),
        "blocked_by": item.get("blocked_by", []),
        "created_at": item.get("created_at"),
        "activated_at": item.get("activated_at"),
        "completed_at": item.get("completed_at"),
        "environment": environment,
        "worker": worker,
        "plan": plan,
        "runtime": runtime,
    }

    # Carry over source_ref at top level if it existed in metadata
    source_ref = meta.get("source_ref")
    if source_ref:
        new_item["source_ref"] = source_ref

    return new_item


def main():
    dry_run = "--dry-run" in sys.argv

    if not os.path.isfile(QUEUE_PATH):
        print(f"ERROR: Queue file not found: {QUEUE_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(QUEUE_PATH) as f:
        data = json.load(f)

    # Backup
    if not dry_run:
        with open(BACKUP_PATH, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"Backup written to: {BACKUP_PATH}")

    migrated_items = []
    for item in data["items"]:
        new_item = migrate_item(item)
        migrated_items.append(new_item)
        if dry_run:
            print(f"  {item['id']}: migrated")
            print(f"    environment.repo={new_item['environment']['repo']}")
            print(f"    environment.use_worktree={new_item['environment']['use_worktree']}")
            print(f"    worker.commit_strategy={new_item['worker']['commit_strategy']}")
            print(f"    plan.approved={new_item['plan']['approved']}")
            print(f"    runtime.pr_url={new_item['runtime']['pr_url']}")

    data["items"] = migrated_items

    if dry_run:
        print(f"\n[dry-run] Would migrate {len(migrated_items)} items")
    else:
        with open(QUEUE_PATH, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"Migrated {len(migrated_items)} items")

    # Verify
    if not dry_run:
        with open(QUEUE_PATH) as f:
            verify = json.load(f)
        for item in verify["items"]:
            assert "environment" in item, f"{item['id']} missing environment"
            assert "worker" in item, f"{item['id']} missing worker"
            assert "plan" in item, f"{item['id']} missing plan"
            assert "runtime" in item, f"{item['id']} missing runtime"
            assert "metadata" not in item, f"{item['id']} still has metadata"
            assert "branch" not in item, f"{item['id']} still has top-level branch"
            assert "worktree_path" not in item, f"{item['id']} still has top-level worktree_path"
            assert "session_id" not in item, f"{item['id']} still has top-level session_id"
            assert "pr_url" not in item, f"{item['id']} still has top-level pr_url"
            assert "delegator_enabled" not in item, f"{item['id']} still has top-level delegator_enabled"
            assert "delegator_id" not in item, f"{item['id']} still has top-level delegator_id"
        print("Verification passed: all items have new schema, no old fields remain")


if __name__ == "__main__":
    main()
