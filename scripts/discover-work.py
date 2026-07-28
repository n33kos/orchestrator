#!/usr/bin/env python3
"""Discover work items from configured adapters.

Reads adapters from config/sources.json, polls each one, deduplicates against
the queue, and adds what is new. Imported items land as `queued` with no plan,
so the scheduler's plan generation picks them up and the normal approve-then-
activate flow applies. The issue body and discussion are written to a context
file that plan generation reads.

Usage:
    python3 scripts/discover-work.py [--dry-run] [--output-json] [--source NAME]
    python3 scripts/discover-work.py --describe-adapters
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib import linear_api, secrets, sources  # noqa: E402
from lib.queue import locked_queue  # noqa: E402


CONTEXT_DIR = Path.home() / ".claude" / "orchestrator" / "context"


# --- Adapters -------------------------------------------------------------
#
# Each adapter returns a list of discovered items. A discovered item carries a
# title, a priority, a source_ref used for deduplication, an optional context
# markdown body, and optional provider identifiers for status writeback.


def poll_markdown(config: dict) -> list[dict]:
    """Parse checkbox and numbered task items out of a local markdown file."""
    path = Path(str(config.get("path", "")).replace("~", str(Path.home())))
    if not path.exists():
        print(f"  Warning: {path} not found, skipping", file=sys.stderr)
        return []

    items = []
    current_section = ""

    for line in path.read_text().split("\n"):
        heading = re.match(r"^(#{2,3})\s+(.+)", line)
        if heading:
            current_section = heading.group(2).strip()
            continue

        title = ""
        checkbox = re.match(r"^[-*]\s+\[\s\]\s+(.+)", line)
        if checkbox:
            title = checkbox.group(1).strip()
        else:
            numbered = re.match(r"^\d+\.\s+(.+)", line)
            if numbered and current_section:
                candidate = numbered.group(1).strip()
                if len(candidate) < 100 and has_action_verb(candidate):
                    title = candidate

        if title:
            items.append(
                {
                    "title": title,
                    "context": f"From: {current_section}" if current_section else "",
                    "source_ref": f"{path.name}:{current_section}:{title}",
                    "priority": infer_priority(title),
                }
            )

    return items


def poll_github(config: dict) -> list[dict]:
    """Poll GitHub Issues using the gh CLI."""
    repo = str(config.get("repo", "")).strip()
    if not repo:
        print("  Error: github adapter missing 'repo'", file=sys.stderr)
        return []

    cmd = [
        "gh", "issue", "list",
        "--repo", repo,
        "--state", str(config.get("state", "open")),
        "--limit", str(config.get("limit", 20)),
        "--json", "number,title,body,labels,assignees,createdAt,url",
    ]

    assignee = str(config.get("assignee", "")).strip()
    if assignee:
        cmd.extend(["--assignee", assignee])

    for label in as_list(config.get("labels")):
        cmd.extend(["--label", label])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            print(f"  gh CLI error: {result.stderr.strip()}", file=sys.stderr)
            return []
        issues = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError) as err:
        print(f"  Error polling GitHub: {err}", file=sys.stderr)
        return []

    label_priorities = {
        "p0": 1, "p1": 2, "p2": 3, "p3": 4,
        "critical": 1, "urgent": 1, "high": 2, "low": 4,
    }

    items = []
    for issue in issues:
        priority = 3
        for label in issue.get("labels", []):
            mapped = label_priorities.get(label.get("name", "").lower().strip())
            if mapped:
                priority = min(priority, mapped)

        items.append({
            "title": f"#{issue.get('number', 0)}: {issue.get('title', '')}",
            "context": (issue.get("body") or "").strip(),
            "source_ref": issue.get("url", ""),
            "priority": priority,
            "issue_id": str(issue.get("number", "")),
            "identifier": f"#{issue.get('number', '')}",
            "url": issue.get("url", ""),
        })

    return items


def poll_jira(config: dict) -> list[dict]:
    """Poll Jira issues through the REST API."""
    domain = str(config.get("domain", "")).strip()
    board = str(config.get("board", "")).strip()
    if not domain or not board:
        print("  Error: jira adapter requires 'domain' and 'board'", file=sys.stderr)
        return []

    email = secrets.get("JIRA_EMAIL")
    token = secrets.get("JIRA_API_TOKEN")
    if not email or not token:
        print("  Skipping Jira: JIRA_EMAIL and JIRA_API_TOKEN required", file=sys.stderr)
        return []

    jql = str(config.get("filter") or "").strip() or (
        f"project = {board} AND assignee = currentUser() AND status != Done"
    )
    url = (
        f"https://{domain}/rest/api/3/search?jql={jql}"
        f"&maxResults={config.get('limit', 20)}"
        "&fields=summary,description,priority,labels,status,issuetype,assignee,created"
    )

    try:
        result = subprocess.run(
            ["curl", "-s", "-u", f"{email}:{token}", "-H", "Accept: application/json", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"  Jira API error: {result.stderr.strip()}", file=sys.stderr)
            return []
        data = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as err:
        print(f"  Error polling Jira: {err}", file=sys.stderr)
        return []

    if "errorMessages" in data:
        print(f"  Jira error: {data['errorMessages']}", file=sys.stderr)
        return []

    priorities = {"highest": 1, "high": 2, "medium": 3, "low": 4, "lowest": 4}

    items = []
    for issue in data.get("issues", []):
        key = issue.get("key", "")
        fields = issue.get("fields", {})
        items.append({
            "title": f"{key}: {fields.get('summary', '')}",
            "context": flatten_adf(fields.get("description")),
            "source_ref": f"https://{domain}/browse/{key}",
            "priority": priorities.get((fields.get("priority") or {}).get("name", "").lower(), 3),
            "issue_id": issue.get("id", ""),
            "identifier": key,
            "url": f"https://{domain}/browse/{key}",
        })

    return items


def poll_linear(config: dict) -> list[dict]:
    """Poll Linear issues through the GraphQL API."""
    if not linear_api.api_key():
        print("  Skipping Linear: LINEAR_API_KEY required", file=sys.stderr)
        return []

    try:
        issues = linear_api.fetch_issues(config)
    except linear_api.LinearError as err:
        print(f"  Linear API error: {err}", file=sys.stderr)
        return []

    items = []
    for issue in issues:
        identifier = issue.get("identifier", "")
        items.append({
            "title": f"{identifier}: {issue.get('title', '')}",
            "context": render_linear_context(issue),
            "source_ref": issue.get("url", "") or f"linear:{identifier}",
            "priority": linear_priority_to_queue(issue.get("priority")),
            "issue_id": issue.get("id", ""),
            "identifier": identifier,
            "url": issue.get("url", ""),
            "labels": [n.get("name", "") for n in ((issue.get("labels") or {}).get("nodes") or [])],
            "repo_key": resolve_repo_key(config, issue),
            "blocked_by_refs": linear_blockers(issue),
        })

    return items


ADAPTERS = {
    "markdown": poll_markdown,
    "github": poll_github,
    "jira": poll_jira,
    "linear": poll_linear,
}


# --- Helpers --------------------------------------------------------------


def render_linear_context(issue: dict) -> str:
    """Build the markdown context body handed to plan generation."""
    lines = []
    state = (issue.get("state") or {}).get("name")
    project = (issue.get("project") or {}).get("name")
    labels = [n.get("name", "") for n in ((issue.get("labels") or {}).get("nodes") or [])]

    meta = []
    if state:
        meta.append(f"Status: {state}")
    if project:
        meta.append(f"Project: {project}")
    if labels:
        meta.append(f"Labels: {', '.join(labels)}")
    if meta:
        lines.append(" | ".join(meta))
        lines.append("")

    description = (issue.get("description") or "").strip()
    lines.append("## Description")
    lines.append("")
    lines.append(description or "_(no description on the issue)_")

    comments = ((issue.get("comments") or {}).get("nodes")) or []
    if comments:
        lines.append("")
        lines.append("## Discussion")
        for comment in comments:
            author = (comment.get("user") or {}).get("displayName", "unknown")
            body = (comment.get("body") or "").strip()
            if not body:
                continue
            lines.append("")
            lines.append(f"**{author}**")
            lines.append("")
            lines.append(body)

    return "\n".join(lines).strip()


def linear_blockers(issue: dict) -> list[str]:
    """Identifiers of the issues that block this one.

    Linear models blocking on the blocking issue, so an issue's own blockers are
    found on its inverse relations. Blockers that are already done or cancelled
    are not blockers.
    """
    blockers = []
    for relation in ((issue.get("inverseRelations") or {}).get("nodes") or []):
        if relation.get("type") != "blocks":
            continue
        blocker = relation.get("issue") or {}
        if (blocker.get("state") or {}).get("type") in ("completed", "canceled"):
            continue
        identifier = blocker.get("identifier")
        if identifier:
            blockers.append(identifier)
    return blockers


def resolve_repo_key(config: dict, issue: dict) -> str:
    """Route an issue to a repo by label.

    Returns an empty string when no label matches, which leaves the item
    deliberately unrouted rather than guessing a repository.
    """
    labels = {
        str(n.get("name", "")).strip().lower()
        for n in ((issue.get("labels") or {}).get("nodes") or [])
    }

    for entry in as_list(config.get("repo_label_map")):
        label, _, repo_key = entry.partition("=")
        if not repo_key.strip():
            continue
        if label.strip().lower() in labels:
            return repo_key.strip()

    return ""


def linear_priority_to_queue(priority) -> int:
    """Linear uses 0=None, 1=Urgent..4=Low. The queue uses 1=highest."""
    mapping = {1: 1, 2: 2, 3: 3, 4: 4}
    try:
        return mapping.get(int(priority), 3)
    except (TypeError, ValueError):
        return 3


def flatten_adf(document) -> str:
    """Extract plain text from an Atlassian Document Format body."""
    if not isinstance(document, dict):
        return ""
    parts = []
    for block in document.get("content", []):
        text = "".join(
            inline.get("text", "")
            for inline in block.get("content", [])
            if inline.get("type") == "text"
        )
        parts.append(text)
    return "\n".join(parts).strip()


def as_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def has_action_verb(text: str) -> bool:
    verbs = [
        "add", "fix", "update", "remove", "migrate", "convert", "replace",
        "refactor", "implement", "create", "build", "move", "rename",
        "delete", "extract", "split", "merge", "upgrade", "audit", "test",
    ]
    lower = text.lower()
    return any(lower.startswith(v) or f" {v} " in lower for v in verbs)


def infer_priority(title: str) -> int:
    lower = title.lower()
    if any(w in lower for w in ["critical", "urgent", "blocker", "p0"]):
        return 1
    if any(w in lower for w in ["important", "high", "p1"]):
        return 2
    if any(w in lower for w in ["low", "minor", "nice to have", "p3"]):
        return 4
    return 3


def deduplicate(new_items: list[dict], existing_items: list[dict]) -> list[dict]:
    """Drop items already represented in the queue, by source_ref then title."""
    existing_titles = {item.get("title", "").lower().strip() for item in existing_items}
    existing_refs = {
        str(item.get("source_ref") or "").strip()
        for item in existing_items
        if item.get("source_ref")
    }

    unique = []
    for item in new_items:
        ref = str(item.get("source_ref") or "").strip()
        if ref and ref in existing_refs:
            continue
        if item["title"].lower().strip() in existing_titles:
            continue
        unique.append(item)
        if ref:
            existing_refs.add(ref)
    return unique


def generate_id() -> str:
    result = subprocess.run([str(SCRIPT_DIR / "next-ws-id.sh")], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Error generating ID: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def poll_adapter(adapter: dict) -> list[dict]:
    """Poll one adapter and stamp its provenance onto every item."""
    poll = ADAPTERS.get(adapter["type"])
    if poll is None:
        print(f"  Unknown adapter type: {adapter['type']}")
        return []

    problems = sources.validate_adapter(adapter)
    if problems:
        print(f"  Misconfigured: {'; '.join(problems)}", file=sys.stderr)
        return []

    items = poll(adapter["config"])
    defaults = adapter["defaults"]

    for item in items:
        item["adapter"] = adapter["name"]
        item["provider"] = adapter["type"]
        item["defaults"] = defaults
        if not item.get("repo_key"):
            item["repo_key"] = str(defaults.get("repo_key") or "")
        if defaults.get("priority") and item.get("priority") == 3:
            item["priority"] = int(defaults["priority"])

    return items


def write_context(item_id: str, body: str) -> str | None:
    if not body.strip():
        return None
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    path = CONTEXT_DIR / f"{item_id}.md"
    path.write_text(body.rstrip() + "\n")
    return str(path)


def build_queue_item(item_id: str, discovered: dict) -> dict:
    defaults = discovered.get("defaults") or {}
    context_file = write_context(item_id, discovered.get("context", ""))

    return {
        "id": item_id,
        "source": discovered.get("adapter", "discovery"),
        "source_ref": discovered.get("source_ref", ""),
        "repo_key": discovered.get("repo_key") or None,
        "title": discovered["title"],
        "priority": discovered["priority"],
        "status": "planning",
        "blocked_by": list(discovered.get("blocked_by_refs") or []),
        "created_at": datetime.now().isoformat(),
        "activated_at": None,
        "completed_at": None,
        "integration": {
            "adapter": discovered.get("adapter", ""),
            "provider": discovered.get("provider", ""),
            "issue_id": discovered.get("issue_id") or None,
            "identifier": discovered.get("identifier") or None,
            "url": discovered.get("url") or None,
            "context_file": context_file,
            "blocked_by_refs": list(discovered.get("blocked_by_refs") or []),
            "synced_status": None,
            "synced_at": None,
        },
        "environment": {
            "repo": None,
            "use_worktree": True,
            "branch": None,
            "worktree_path": None,
            "session_id": None,
        },
        "worker": {
            "commit_strategy": defaults.get("commit_strategy") or "branch_and_pr",
            "delegator_enabled": bool(defaults.get("delegator_enabled", True)),
        },
        "plan": {
            "file": None,
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
        },
    }


def main() -> None:
    import argparse
    import functools

    parser = argparse.ArgumentParser(description="Discover work items from adapters")
    parser.add_argument("--dry-run", action="store_true", help="Show discoveries without adding")
    parser.add_argument("--output-json", action="store_true", help="Emit discoveries as JSON (implies dry run)")
    parser.add_argument("--source", type=str, default="", help="Only poll one adapter by name")
    parser.add_argument("--describe-adapters", action="store_true", help="Emit adapter field specs as JSON")
    args = parser.parse_args()

    if args.describe_adapters:
        print(json.dumps(sources.describe_adapters()))
        return

    # With --output-json, stdout carries only the JSON payload.
    log = functools.partial(print, file=sys.stderr) if args.output_json else print

    with locked_queue() as ctx:
        existing_items = list(ctx["data"].get("items", []))

    adapters = sources.enabled_adapters(PROJECT_ROOT, args.source)
    if not adapters:
        log("No enabled adapters configured.")
        return

    discovered: list[dict] = []
    for adapter in adapters:
        log(f"Polling adapter: {adapter['name']} (type: {adapter['type']})")
        items = poll_adapter(adapter)
        discovered.extend(items)
        log(f"  Found {len(items)} items")

    unique = deduplicate(discovered, existing_items)
    log(f"\nTotal discovered: {len(discovered)}")
    log(f"New (after dedup): {len(unique)}")

    if args.output_json:
        # Report everything the filter matched, flagging what is already queued, so
        # a preview never reads as "nothing matched" when the truth is "already here".
        new_refs = {str(item.get("source_ref") or "") for item in unique}
        print(json.dumps([{
            "title": item["title"],
            "priority": item["priority"],
            "source": item.get("adapter", "discovery"),
            "source_ref": item.get("source_ref", ""),
            "repo_key": item.get("repo_key", ""),
            "new": str(item.get("source_ref") or "") in new_refs,
        } for item in discovered]))
        return

    if not unique:
        print("No new items to add.")
        return

    if args.dry_run:
        print("\n--- NEW ITEMS (dry run) ---")
        for item in unique:
            print(f"  p{item['priority']} {item['title']}")
        return

    added = []
    with locked_queue(write=True) as ctx:
        # Re-check inside the lock so a concurrent writer cannot produce a duplicate.
        fresh = deduplicate(unique, ctx["data"].get("items", []))
        for item in fresh:
            item_id = generate_id()
            ctx["data"]["items"].append(build_queue_item(item_id, item))
            added.append((item_id, item["title"]))
            ctx["modified"] = True

    for item_id, title in added:
        print(f"  Added: {item_id} — {title}")
    print(f"\nQueue updated: {len(added)} new items added.")


if __name__ == "__main__":
    main()
