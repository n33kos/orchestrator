"""PR merge detection and auto-teardown for the scheduler.

Ports: check_merged_prs, teardown_merged from scheduler.sh.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from scripts.lib.queue import locked_queue
from scripts.scheduler.config import Config
from scripts.scheduler.events import emit_event

PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")
EXEC_ENV = {**os.environ, "HOME": os.path.expanduser("~")}


def _check_pr_state(pr_url: str) -> str | None:
    """Check the state of a single GitHub PR."""
    match = re.search(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)", pr_url)
    if not match:
        return None
    owner, repo, number = match.groups()
    try:
        result = subprocess.run(
            ["gh", "pr", "view", number, "--repo", f"{owner}/{repo}", "--json", "state"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return None
        return json.loads(result.stdout).get("state", "")
    except Exception:
        return None


def check_merged_prs(cfg: Config) -> list[dict]:
    """Check active items with PR URLs — return list of merged items.

    Returns list of dicts with 'id' and 'title' for merged items.
    """
    with locked_queue() as ctx:
        data = ctx["data"]

    active_with_pr = [
        i for i in data["items"]
        if i["status"] == "active" and i.get("pr_url")
    ]

    if not active_with_pr:
        print("[pr-check] No active items with PR URLs")
        return []

    merged = []

    for item in active_with_pr:
        pr_url = item["pr_url"]
        item_id = item["id"]
        item_title = item.get("title", "")
        is_stack = item.get("metadata", {}).get("pr_type") == "graphite_stack"

        if is_stack:
            match = re.search(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)", pr_url)
            if not match:
                continue
            owner, repo, _ = match.groups()
            branch = item.get("branch", "")
            if not branch:
                continue
            try:
                result = subprocess.run(
                    ["gh", "pr", "list", "--repo", f"{owner}/{repo}",
                     "--json", "number,state,headRefName", "--limit", "20"],
                    capture_output=True, text=True, timeout=15,
                )
                if result.returncode != 0:
                    continue
                all_prs = json.loads(result.stdout)
                branch_prefix = "/".join(branch.split("/")[:3])
                stack_prs = [p for p in all_prs if p["headRefName"].startswith(branch_prefix)]
                if not stack_prs:
                    state = _check_pr_state(pr_url)
                    if state == "MERGED":
                        merged.append({"id": item_id, "title": item_title})
                    continue
                all_merged = all(p["state"] == "MERGED" for p in stack_prs)
                merged_count = sum(1 for p in stack_prs if p["state"] == "MERGED")
                total = len(stack_prs)
                if all_merged:
                    merged.append({"id": item_id, "title": item_title})
                else:
                    print(f"[pr-check] Stack {item_id}: {merged_count}/{total} PRs merged")
            except Exception:
                continue
        else:
            state = _check_pr_state(pr_url)
            if state == "MERGED":
                merged.append({"id": item_id, "title": item_title})

    return merged


def teardown_merged(cfg: Config, dry_run: bool) -> None:
    """Check for merged PRs and tear down their work streams."""
    merged_items = check_merged_prs(cfg)

    for item in merged_items:
        item_id = item["id"]
        item_title = item["title"]

        if dry_run:
            print(f"[scheduler] Would auto-complete (PR merged): {item_id} — {item_title}")
        else:
            print(f"[scheduler] PR merged — auto-completing: {item_id} — {item_title}")
            emit_event("pr.merged", f"PR merged, auto-completing: {item_title}", item_id=item_id)
            try:
                result = subprocess.run(
                    ["bash", os.path.join(SCRIPTS_DIR, "teardown-stream.sh"), item_id],
                    capture_output=True, text=True, timeout=60, env=EXEC_ENV,
                )
                if result.stdout:
                    for line in result.stdout.strip().split("\n"):
                        print(f"  {line}")
                if result.returncode != 0:
                    print(f"[scheduler] ERROR: Failed to teardown {item_id}", file=sys.stderr)
                    emit_event("scheduler.error", f"Failed to teardown {item_id} after PR merge", item_id=item_id, severity="error")
            except subprocess.TimeoutExpired:
                print(f"[scheduler] ERROR: Teardown timed out for {item_id}", file=sys.stderr)
