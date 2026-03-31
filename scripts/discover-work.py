#!/usr/bin/env python3
"""
Discover new work items from configured sources.

Reads config/sources.yml, polls each source adapter, deduplicates against
the existing queue, and adds new items.

Usage:
    python3 scripts/discover-work.py [--dry-run] [--source NAME]
"""

import json
import re
import sys
from pathlib import Path
from datetime import datetime


def load_yaml_simple(path: Path) -> dict:
    """Minimal YAML parser for our simple config format."""
    result = {}
    current_section = None
    current_item = None
    current_item_name = None

    with open(path) as f:
        for line in f:
            stripped = line.rstrip()
            if not stripped or stripped.lstrip().startswith("#"):
                continue

            indent = len(line) - len(line.lstrip())

            if indent == 0 and stripped.endswith(":"):
                current_section = stripped[:-1]
                result[current_section] = {}
                current_item = None
                continue

            if current_section and indent == 2:
                if stripped.rstrip().endswith(":"):
                    current_item_name = stripped.strip()[:-1]
                    result[current_section][current_item_name] = {}
                    current_item = result[current_section][current_item_name]
                else:
                    key, _, val = stripped.strip().partition(":")
                    result[current_section][key.strip()] = val.strip()

            elif current_item is not None and indent >= 4:
                key, _, val = stripped.strip().partition(":")
                current_item[key.strip()] = val.strip()

    return result


def deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base. Override values win."""
    merged = dict(base)
    for key, val in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(val, dict):
            merged[key] = deep_merge(merged[key], val)
        else:
            merged[key] = val
    return merged


def load_yaml_with_local(path: Path) -> dict:
    """Load a YAML config, merging a .local.yml override if it exists."""
    config = load_yaml_simple(path)
    local_path = path.with_suffix("").with_suffix(".local.yml")
    if local_path.exists():
        local_config = load_yaml_simple(local_path)
        config = deep_merge(config, local_config)
    return config


def parse_markdown_source(path: Path) -> list[dict]:
    """Parse a markdown plan file for actionable work items.

    Looks for structured sections with task-like headings:
    - ## or ### headings that look like tasks
    - Checkbox items (- [ ] or - [x])
    - Numbered items under task sections
    """
    if not path.exists():
        print(f"  Warning: {path} not found, skipping", file=sys.stderr)
        return []

    items = []
    content = path.read_text()
    current_section = ""

    for line in content.split("\n"):
        # Track section context
        heading_match = re.match(r"^(#{2,3})\s+(.+)", line)
        if heading_match:
            current_section = heading_match.group(2).strip()
            continue

        # Look for unchecked task items
        task_match = re.match(r"^[-*]\s+\[\s\]\s+(.+)", line)
        if task_match:
            title = task_match.group(1).strip()
            items.append(
                {
                    "title": title,
                    "description": f"From: {current_section}" if current_section else "",
                    "source_ref": f"{path.name}:{current_section}",

                    "priority": infer_priority(title),
                }
            )

        # Look for numbered items that look like tasks
        numbered_match = re.match(r"^\d+\.\s+(.+)", line)
        if numbered_match and current_section:
            title = numbered_match.group(1).strip()
            # Skip items that are just descriptions (too long or no verb)
            if len(title) < 100 and has_action_verb(title):
                items.append(
                    {
                        "title": title,
                        "description": f"From: {current_section}",
                        "source_ref": f"{path.name}:{current_section}",
    
                        "priority": infer_priority(title),
                    }
                )

    return items


def has_action_verb(text: str) -> bool:
    """Check if text starts with or contains an action verb."""
    action_verbs = [
        "add",
        "fix",
        "update",
        "remove",
        "migrate",
        "convert",
        "replace",
        "refactor",
        "implement",
        "create",
        "build",
        "move",
        "rename",
        "delete",
        "extract",
        "split",
        "merge",
        "upgrade",
        "audit",
        "test",
    ]
    lower = text.lower()
    return any(lower.startswith(v) or f" {v} " in lower for v in action_verbs)



def infer_priority(title: str) -> int:
    """Infer priority from title keywords."""
    lower = title.lower()
    if any(w in lower for w in ["critical", "urgent", "blocker", "p0"]):
        return 1
    if any(w in lower for w in ["important", "high", "p1"]):
        return 2
    if any(w in lower for w in ["low", "minor", "nice to have", "p3"]):
        return 4
    return 3  # Default medium


def load_queue(queue_path: Path) -> dict:
    """Load the current queue."""
    if queue_path.exists():
        return json.loads(queue_path.read_text())
    return {"version": 1, "items": []}


def deduplicate(new_items: list[dict], existing_items: list[dict]) -> list[dict]:
    """Remove items that already exist in the queue (by source_ref or title)."""
    existing_titles = {item["title"].lower().strip() for item in existing_items}
    existing_refs = set()
    for item in existing_items:
        ref = item.get("source_ref", "")
        if ref:
            existing_refs.add(ref.strip())

    unique = []
    for item in new_items:
        source_ref = item.get("source_ref", "").strip()
        # Skip if source_ref matches an existing item
        if source_ref and source_ref in existing_refs:
            continue
        # Skip if exact title match
        if item["title"].lower().strip() in existing_titles:
            continue
        unique.append(item)
    return unique


def generate_id() -> str:
    """Generate the next sequential work item ID using the shared counter."""
    import subprocess

    script = Path(__file__).parent / "next-ws-id.sh"
    result = subprocess.run([str(script)], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Error generating ID: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def poll_github_issues(source_name: str, config: dict) -> list[dict]:
    """Poll GitHub Issues using the gh CLI.

    Config keys:
        repo: owner/repo (required)
        labels: comma-separated labels to filter by
        assignee: filter by assignee (default: @me)
        state: issue state (default: open)
        limit: max issues to fetch (default: 20)
    """
    import subprocess

    repo = config.get("repo", "")
    if not repo:
        print("  Error: github source missing 'repo'", file=sys.stderr)
        return []

    cmd = [
        "gh", "issue", "list",
        "--repo", repo,
        "--state", config.get("state", "open"),
        "--limit", config.get("limit", "20"),
        "--json", "number,title,body,labels,assignees,createdAt,url",
    ]

    assignee = config.get("assignee", "@me")
    if assignee:
        cmd.extend(["--assignee", assignee])

    labels = config.get("labels", "")
    if labels:
        # Handle both "label1,label2" and "['label1', 'label2']" formats
        cleaned = labels.strip("[]\"' ")
        for label in cleaned.split(","):
            label = label.strip("\"' ")
            if label:
                cmd.extend(["--label", label])

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            print(f"  gh CLI error: {result.stderr.strip()}", file=sys.stderr)
            return []

        issues = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError) as e:
        print(f"  Error polling GitHub: {e}", file=sys.stderr)
        return []

    # Map priority from labels
    priority_mapping = {}
    for key, val in config.items():
        if key.startswith("priority_mapping"):
            # Simple key:value pairs under priority_mapping aren't parsed well
            # by our minimal YAML parser, so also check label names
            pass

    priority_labels = {"p0": 1, "p1": 2, "p2": 3, "p3": 4, "critical": 1, "urgent": 1, "high": 2, "low": 4}

    items = []
    for issue in issues:
        title = issue.get("title", "")
        body = issue.get("body", "") or ""
        labels_list = [l.get("name", "") for l in issue.get("labels", [])]
        issue_number = issue.get("number", 0)
        issue_url = issue.get("url", "")

        # Determine priority from labels
        priority = 3  # default medium
        for label in labels_list:
            label_lower = label.lower().strip()
            if label_lower in priority_labels:
                priority = min(priority, priority_labels[label_lower])

        # Truncate body for description
        description = body[:500].strip()
        if len(body) > 500:
            description += "..."

        items.append({
            "title": f"#{issue_number}: {title}",
            "description": description,
            "source": source_name,
            "source_ref": issue_url,
            "priority": priority,
        })

    return items


def poll_jira_issues(source_name: str, config: dict) -> list[dict]:
    """Poll Jira issues using the Jira REST API via curl.

    Config keys:
        domain: Jira domain (e.g. mycompany.atlassian.net) — required
        board: board/project key to filter (e.g. CONSUMER) — required
        filter: JQL filter string (default: assignee = currentUser() AND status != Done)
        limit: max issues to fetch (default: 20)

    Environment:
        JIRA_EMAIL — Jira account email
        JIRA_API_TOKEN — Jira API token (from https://id.atlassian.com/manage-profile/security/api-tokens)
    """
    import subprocess
    import os

    domain = config.get("domain", "")
    board = config.get("board", "")
    if not domain or not board:
        print("  Error: jira source requires 'domain' and 'board'", file=sys.stderr)
        return []

    email = os.environ.get("JIRA_EMAIL", "")
    token = os.environ.get("JIRA_API_TOKEN", "")
    if not email or not token:
        print("  Skipping Jira: JIRA_EMAIL and JIRA_API_TOKEN env vars required", file=sys.stderr)
        return []

    jql = config.get("filter", f"project = {board} AND assignee = currentUser() AND status != Done")
    limit = config.get("limit", "20")

    url = f"https://{domain}/rest/api/3/search?jql={jql}&maxResults={limit}&fields=summary,description,priority,labels,status,issuetype,assignee,created"

    try:
        result = subprocess.run(
            [
                "curl", "-s", "-u", f"{email}:{token}",
                "-H", "Accept: application/json",
                url,
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"  Jira API error: {result.stderr.strip()}", file=sys.stderr)
            return []

        data = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        print(f"  Error polling Jira: {e}", file=sys.stderr)
        return []

    if "errorMessages" in data:
        print(f"  Jira error: {data['errorMessages']}", file=sys.stderr)
        return []

    priority_mapping = {"highest": 1, "high": 2, "medium": 3, "low": 4, "lowest": 4}

    items = []
    for issue in data.get("issues", []):
        key = issue.get("key", "")
        fields = issue.get("fields", {})
        summary = fields.get("summary", "")
        description_doc = fields.get("description")

        # Extract plain text from Atlassian Document Format
        description = ""
        if description_doc and isinstance(description_doc, dict):
            for block in description_doc.get("content", []):
                for inline in block.get("content", []):
                    if inline.get("type") == "text":
                        description += inline.get("text", "")
                description += "\n"
            description = description[:500].strip()
            if len(description) >= 500:
                description += "..."

        # Map priority
        priority_name = (fields.get("priority") or {}).get("name", "").lower()
        priority = priority_mapping.get(priority_name, 3)

        items.append({
            "title": f"{key}: {summary}",
            "description": description,
            "source": source_name,
            "source_ref": f"https://{domain}/browse/{key}",
            "priority": priority,
        })

    return items


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Discover work items from sources")
    parser.add_argument("--dry-run", action="store_true", help="Show discoveries without adding")
    parser.add_argument("--output-json", action="store_true", help="Output discovered items as JSON (implies --dry-run)")
    parser.add_argument("--source", type=str, help="Only poll a specific source")
    args = parser.parse_args()

    project_root = Path(__file__).parent.parent
    sources_config = load_yaml_with_local(project_root / "config" / "sources.yml")
    env_config = load_yaml_with_local(project_root / "config" / "environment.yml")

    queue_path = Path(
        env_config.get("state", {}).get("queue_file", "~/.claude/orchestrator/queue.json").replace(
            "~", str(Path.home())
        )
    )
    queue = load_queue(queue_path)

    sources = sources_config.get("sources", {})
    if args.source:
        sources = {k: v for k, v in sources.items() if k == args.source}

    all_new = []

    for name, config in sources.items():
        source_type = config.get("type", "unknown")
        print(f"Polling source: {name} (type: {source_type})")

        if source_type == "markdown":
            path = Path(config.get("path", "").replace("~", str(Path.home())))
            items = parse_markdown_source(path)
            for item in items:
                item["source"] = name
            all_new.extend(items)
            print(f"  Found {len(items)} items")

        elif source_type == "jira":
            items = poll_jira_issues(name, config)
            all_new.extend(items)
            print(f"  Found {len(items)} items")

        elif source_type == "github":
            items = poll_github_issues(name, config)
            all_new.extend(items)
            print(f"  Found {len(items)} items")

        else:
            print(f"  Unknown source type: {source_type}")

    # Deduplicate
    unique = deduplicate(all_new, queue["items"])
    print(f"\nTotal discovered: {len(all_new)}")
    print(f"New (after dedup): {len(unique)}")

    if not unique:
        print("No new items to add.")
        return

    if args.output_json or args.dry_run:
        if args.output_json:
            print(json.dumps([{
                "title": item["title"],
                "description": item.get("description", ""),
                "priority": item["priority"],
                "source": item.get("source", "discovery"),
                "source_ref": item.get("source_ref", ""),
            } for item in unique]))
        else:
            print("\n--- NEW ITEMS (dry run) ---")
            for item in unique:
                print(f"  p{item['priority']} {item['title']}")
                if item.get("description"):
                    print(f"    {item['description']}")
        return

    # Add new items to queue
    for item in unique:
        item_id = generate_id()
        queue_item = {
            "id": item_id,
            "source": item.get("source", "discovery"),
            "source_ref": item.get("source_ref", ""),
            "title": item["title"],
            "description": item.get("description", ""),
            "priority": item["priority"],
            "status": "queued",
            "blocked_by": [],
            "created_at": datetime.now().isoformat(),
            "activated_at": None,
            "completed_at": None,
            "environment": {
                "repo": None,
                "use_worktree": True,
                "branch": None,
                "worktree_path": None,
                "session_id": None,
            },
            "worker": {
                "commit_strategy": "branch_and_pr",
                "delegator_enabled": True,
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
        queue["items"].append(queue_item)
        print(f"  Added: {item_id} — {item['title']}")

    queue_path.write_text(json.dumps(queue, indent=2) + "\n")
    print(f"\nQueue updated: {len(unique)} new items added.")


if __name__ == "__main__":
    main()
