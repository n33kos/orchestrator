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


def _parse_pr_url(pr_url: str) -> tuple[str, str, str] | None:
    """Extract (owner, repo, number) from a GitHub PR URL."""
    match = re.search(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)", pr_url)
    return match.groups() if match else None


def _check_pr_state(pr_url: str) -> str | None:
    """Check the state of a single GitHub PR (fallback for when batch fails)."""
    parsed = _parse_pr_url(pr_url)
    if not parsed:
        return None
    owner, repo, number = parsed
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


def _batch_pr_states(pr_urls: list[str]) -> dict[str, dict] | None:
    """Fetch state+merged for multiple PRs in a single GraphQL request.

    Returns dict mapping "owner/repo#number" -> {"state": str, "merged": bool},
    or None if the batch call fails (caller should fall back to individual checks).
    """
    # Group PRs by repo
    repos: dict[str, list[str]] = {}
    for url in pr_urls:
        parsed = _parse_pr_url(url)
        if not parsed:
            continue
        owner, repo, number = parsed
        key = f"{owner}/{repo}"
        repos.setdefault(key, []).append(number)

    if not repos:
        return None

    # Build GraphQL query with aliased repositories and PRs
    fragments = []
    for i, (repo_key, numbers) in enumerate(repos.items()):
        owner, repo = repo_key.split("/")
        pr_fragments = []
        for number in numbers:
            pr_fragments.append(f'pr{number}: pullRequest(number: {number}) {{ state merged }}')
        fragments.append(
            f'repo{i}: repository(owner: "{owner}", name: "{repo}") {{ {" ".join(pr_fragments)} }}'
        )
    query = "query { " + " ".join(fragments) + " }"

    try:
        result = subprocess.run(
            ["gh", "api", "graphql", "-f", f"query={query}"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            print(f"[pr-check] GraphQL batch failed, falling back to individual checks")
            return None

        data = json.loads(result.stdout).get("data", {})
        states = {}
        for i, (repo_key, numbers) in enumerate(repos.items()):
            repo_data = data.get(f"repo{i}", {})
            for number in numbers:
                pr_data = repo_data.get(f"pr{number}", {})
                states[f"{repo_key}#{number}"] = {
                    "state": pr_data.get("state", ""),
                    "merged": pr_data.get("merged", False),
                }
        return states
    except Exception:
        return None


def check_review_prs_merged(cfg: Config) -> list[dict]:
    """Check review-status items with PR URLs — return list of merged items.

    Only examines items in 'review' status (not active) to avoid unnecessary
    API calls. Uses batched GraphQL when possible for efficiency.

    Returns list of dicts with 'id' and 'title' for merged items.
    """
    with locked_queue() as ctx:
        data = ctx["data"]

    review_with_pr = [
        i for i in data["items"]
        if i["status"] == "review" and i.get("pr_url")
    ]

    if not review_with_pr:
        return []

    # Collect all PR URLs for batching
    all_urls = []
    for item in review_with_pr:
        all_urls.append(item["pr_url"])
    batch_states = _batch_pr_states(all_urls)

    merged = []

    for item in review_with_pr:
        pr_url = item["pr_url"]
        item_id = item["id"]
        item_title = item.get("title", "")
        is_stack = item.get("metadata", {}).get("pr_type") == "graphite_stack"

        if is_stack:
            parsed = _parse_pr_url(pr_url)
            if not parsed:
                continue
            owner, repo, _ = parsed
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
                    # Fall back to single PR check
                    key = f"{owner}/{repo}#{parsed[2]}"
                    if batch_states and key in batch_states:
                        if batch_states[key]["state"] == "MERGED":
                            merged.append({"id": item_id, "title": item_title})
                    else:
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
            # Use batch result if available, otherwise fall back
            parsed = _parse_pr_url(pr_url)
            if parsed and batch_states:
                key = f"{parsed[0]}/{parsed[1]}#{parsed[2]}"
                if key in batch_states and batch_states[key]["state"] == "MERGED":
                    merged.append({"id": item_id, "title": item_title})
                    continue
            # Fallback to individual check
            state = _check_pr_state(pr_url)
            if state == "MERGED":
                merged.append({"id": item_id, "title": item_title})

    return merged


def teardown_merged(cfg: Config, dry_run: bool) -> None:
    """Check for merged PRs in review items and tear down their work streams."""
    merged_items = check_review_prs_merged(cfg)

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
