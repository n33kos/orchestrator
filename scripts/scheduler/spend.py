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


_PRICING_STAMP = os.path.expanduser("~/.claude/orchestrator/.ccusage-last-online")
_PRICING_REFRESH_SECONDS = 86400  # 24 hours


def _needs_pricing_refresh() -> bool:
    """Check if we should run ccusage without --offline to refresh pricing."""
    try:
        mtime = os.path.getmtime(_PRICING_STAMP)
        age = datetime.now(timezone.utc).timestamp() - mtime
        return age >= _PRICING_REFRESH_SECONDS
    except FileNotFoundError:
        return True


def _mark_pricing_refreshed() -> None:
    """Touch the stamp file to record a successful pricing refresh."""
    os.makedirs(os.path.dirname(_PRICING_STAMP), exist_ok=True)
    with open(_PRICING_STAMP, "w") as f:
        f.write(datetime.now(timezone.utc).isoformat())


def _fetch_ccusage_sessions() -> list[dict]:
    """Run ccusage and return list of session objects.

    Uses --offline by default. Once per day, runs without --offline to
    refresh the pricing cache from the network.
    """
    use_offline = not _needs_pricing_refresh()
    cmd = ["npx", "ccusage", "session", "--json"]
    if use_offline:
        cmd.append("--offline")
    else:
        print("[spend] Refreshing pricing data (daily online fetch)")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=60 if not use_offline else 30,
            env={**os.environ, "HOME": os.path.expanduser("~")},
        )
        if result.returncode != 0:
            print(f"[spend] ccusage failed (rc={result.returncode}): {result.stderr[:200]}")
            return []
        data = json.loads(result.stdout)

        # Mark pricing refreshed on successful online fetch
        if not use_offline:
            _mark_pricing_refreshed()

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

    # Exact-match paths: session ID must match exactly (no prefix matching)
    # This prevents a worktree at /repo from matching /repo-branch-name sessions.
    exact_ids: set[str] = set()

    worktree = item.get("worktree_path")
    if worktree:
        exact_ids.add(_path_to_session_id(worktree))

    local_dir = (item.get("metadata") or {}).get("local_directory")
    if local_dir:
        exact_ids.add(_path_to_session_id(os.path.expanduser(local_dir)))

    # Prefix-match paths: orchestrator workspace and delegator dirs may have
    # sub-sessions (e.g. delegator one-shot invocations under the delegator dir).
    prefix_ids: list[str] = []
    item_id = item.get("id", "")
    workspace_path = os.path.expanduser(f"~/.claude/orchestrator/workspaces/{item_id}")
    prefix_ids.append(_path_to_session_id(workspace_path))

    delegator_path = os.path.expanduser(f"~/.claude/orchestrator/delegators/{item_id}")
    prefix_ids.append(_path_to_session_id(delegator_path))

    for session in all_sessions:
        sid = session.get("sessionId", "")
        cost = session.get("totalCost", 0.0)
        if cost <= 0:
            continue
        if sid in exact_ids:
            matches[sid] = cost
            continue
        for prefix in prefix_ids:
            if sid.startswith(prefix):
                matches[sid] = cost
                break

    return matches


def update_spend(cfg: Config) -> None:
    """Update spend metadata for non-completed queue items."""
    _TRACKABLE_STATUSES = {"active", "review", "paused", "planning"}

    with locked_queue() as ctx:
        data = ctx["data"]
        active_items = [
            i for i in data["items"]
            if i["status"] in _TRACKABLE_STATUSES
            and (
                i.get("worktree_path")
                or i.get("session_id")
                or i.get("delegator_id")
                or (i.get("metadata") or {}).get("local_directory")
            )
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
