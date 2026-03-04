"""Token spend tracking per work stream.

Runs `npx ccusage session --json --offline` and matches sessions to active
queue items by converting worktree/workspace paths to ccusage sessionId format.
Updates metadata.spend on each matched item.
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from typing import Optional

from scripts.lib.queue import locked_queue
from scripts.scheduler.config import Config


def _path_to_session_id(path: str) -> str:
    """Convert a filesystem path to ccusage's sessionId format.

    ccusage replaces `/` with `-` and strips the leading `-`.
    e.g. /Users/nicholassuski/babylist-web -> Users-nicholassuski-babylist-web
    """
    expanded = os.path.expanduser(path)
    # ccusage replaces both `/` and `.` with `-`
    return expanded.replace("/", "-").replace(".", "-")


def _fetch_ccusage_sessions() -> list[dict]:
    """Run ccusage and return list of session objects."""
    try:
        result = subprocess.run(
            ["npx", "ccusage", "session", "--json", "--offline"],
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "HOME": os.path.expanduser("~")},
        )
        if result.returncode != 0:
            print(f"[spend] ccusage failed (rc={result.returncode}): {result.stderr[:200]}")
            return []
        data = json.loads(result.stdout)
        return data.get("sessions", [])
    except subprocess.TimeoutExpired:
        print("[spend] ccusage timed out")
        return []
    except (json.JSONDecodeError, Exception) as e:
        print(f"[spend] ccusage parse error: {e}")
        return []


def _match_sessions(
    item: dict,
    all_sessions: list[dict],
) -> dict[str, float]:
    """Find ccusage sessions matching a queue item. Returns {sessionId: cost}."""
    matches: dict[str, float] = {}

    # Build list of path prefixes to match against
    paths_to_match: list[str] = []

    worktree = item.get("worktree_path")
    if worktree:
        paths_to_match.append(_path_to_session_id(worktree))

    # Also match orchestrator workspace and delegator paths
    item_id = item.get("id", "")
    workspace_path = os.path.expanduser(f"~/.claude/orchestrator/workspaces/{item_id}")
    paths_to_match.append(_path_to_session_id(workspace_path))

    delegator_path = os.path.expanduser(f"~/.claude/orchestrator/delegators/{item_id}")
    paths_to_match.append(_path_to_session_id(delegator_path))

    # Match local_directory if set (used by self-targeting items)
    local_dir = (item.get("metadata") or {}).get("local_directory")
    if local_dir:
        paths_to_match.append(_path_to_session_id(os.path.expanduser(local_dir)))

    for session in all_sessions:
        sid = session.get("sessionId", "")
        cost = session.get("totalCost", 0.0)
        if cost <= 0:
            continue
        for prefix in paths_to_match:
            if sid.startswith(prefix):
                matches[sid] = cost
                break

    return matches


def update_spend(cfg: Config) -> None:
    """Update spend metadata for all active queue items."""
    # Read queue (non-write lock) to check if there are active items
    with locked_queue() as ctx:
        data = ctx["data"]
        active_items = [
            i for i in data["items"]
            if i["status"] == "active"
            and (i.get("worktree_path") or i.get("session_id") or i.get("delegator_id"))
        ]

    if not active_items:
        return

    sessions = _fetch_ccusage_sessions()
    if not sessions:
        return

    # Calculate spend for each active item
    updates: dict[str, dict] = {}  # item_id -> spend dict
    for item in active_items:
        matched = _match_sessions(item, sessions)
        if not matched:
            continue
        total_usd = round(sum(matched.values()), 4)
        spend = {
            "total_usd": total_usd,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "sessions": matched,
        }

        # Only update if value actually changed
        existing = (item.get("metadata") or {}).get("spend", {})
        if isinstance(existing, dict) and abs(existing.get("total_usd", 0) - total_usd) < 0.001:
            continue

        updates[item["id"]] = spend

    if not updates:
        return

    # Write updates with lock
    with locked_queue(write=True) as ctx:
        data = ctx["data"]
        for item in data["items"]:
            if item["id"] in updates:
                if "metadata" not in item or not isinstance(item.get("metadata"), dict):
                    item["metadata"] = {}
                item["metadata"]["spend"] = updates[item["id"]]
                ctx["modified"] = True

    updated_ids = list(updates.keys())
    print(f"[spend] Updated spend for {len(updated_ids)} items: {', '.join(updated_ids)}")
