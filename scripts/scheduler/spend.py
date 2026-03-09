"""Token spend tracking per work stream.

Runs `npx ccusage session --json --offline` and matches sessions to active
queue items by converting worktree/workspace paths to ccusage sessionId format.
Updates runtime.spend on each matched item.
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
) -> dict[str, dict]:
    """Find ccusage sessions matching a queue item.

    Returns {sessionId: {"cost": float, "role": "worker"|"delegator"}}.
    A session is classified as "delegator" if its sessionId path contains
    "delegators"; everything else is "worker".
    """
    matches: dict[str, dict] = {}

    # Build list of path prefixes to match against
    paths_to_match: list[str] = []

    env = item.get("environment") or {}
    worktree = env.get("worktree_path")
    if worktree:
        paths_to_match.append(_path_to_session_id(worktree))

    # Also match orchestrator workspace and delegator paths
    item_id = item.get("id", "")
    workspace_path = os.path.expanduser(f"~/.claude/orchestrator/workspaces/{item_id}")
    paths_to_match.append(_path_to_session_id(workspace_path))

    delegator_path = os.path.expanduser(f"~/.claude/orchestrator/delegators/{item_id}")
    delegator_prefix = _path_to_session_id(delegator_path)
    paths_to_match.append(delegator_prefix)

    # Match repo path for non-worktree items (self-targeting items)
    if not env.get("use_worktree") and env.get("repo"):
        paths_to_match.append(_path_to_session_id(os.path.expanduser(env["repo"])))

    for session in all_sessions:
        sid = session.get("sessionId", "")
        cost = session.get("totalCost", 0.0)
        if cost <= 0:
            continue
        for prefix in paths_to_match:
            if sid.startswith(prefix):
                role = "delegator" if "delegators" in sid else "worker"
                matches[sid] = {"cost": cost, "role": role}
                break

    return matches


def update_spend(cfg: Config) -> None:
    """Update spend metadata for non-completed queue items."""
    _TRACKABLE_STATUSES = {"active", "review", "planning"}

    with locked_queue() as ctx:
        data = ctx["data"]
        active_items = [
            i for i in data["items"]
            if i["status"] in _TRACKABLE_STATUSES
            and (
                (i.get("environment") or {}).get("worktree_path")
                or (i.get("environment") or {}).get("session_id")
                or (i.get("environment") or {}).get("repo")
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

        worker_usd = round(
            sum(v["cost"] for v in matched.values() if v["role"] == "worker"), 4
        )
        delegator_usd = round(
            sum(v["cost"] for v in matched.values() if v["role"] == "delegator"), 4
        )
        total_usd = round(worker_usd + delegator_usd, 4)

        # Flatten sessions to {sessionId: cost} for backward compatibility
        flat_sessions = {sid: v["cost"] for sid, v in matched.items()}

        spend = {
            "total_usd": total_usd,
            "worker_usd": worker_usd,
            "delegator_usd": delegator_usd,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "sessions": flat_sessions,
        }

        # Only update if value actually changed
        existing = (item.get("runtime") or {}).get("spend", {})
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
                if "runtime" not in item or not isinstance(item.get("runtime"), dict):
                    item["runtime"] = {}
                item["runtime"]["spend"] = updates[item["id"]]
                ctx["modified"] = True

    updated_ids = list(updates.keys())
    print(f"[spend] Updated spend for {len(updated_ids)} items: {', '.join(updated_ids)}")
