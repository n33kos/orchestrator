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
            if not stripped or stripped.startswith("#"):
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
                    "type": infer_work_type(title),
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
                        "type": infer_work_type(title),
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


def infer_work_type(title: str) -> str:
    """Infer whether a work item is a project or quick fix."""
    lower = title.lower()
    quick_indicators = ["fix", "typo", "tweak", "config", "bump", "minor", "small"]
    if any(ind in lower for ind in quick_indicators):
        return "quick_fix"
    return "project"


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
    """Remove items that already exist in the queue (by title similarity)."""
    existing_titles = {item["title"].lower().strip() for item in existing_items}
    unique = []
    for item in new_items:
        if item["title"].lower().strip() not in existing_titles:
            unique.append(item)
    return unique


def generate_id(existing_items: list[dict]) -> str:
    """Generate the next sequential work item ID."""
    max_id = 0
    for item in existing_items:
        match = re.match(r"ws-(\d+)", item.get("id", ""))
        if match:
            max_id = max(max_id, int(match.group(1)))
    return f"ws-{str(max_id + 1).padStart(3, '0')}" if hasattr(str, 'padStart') else f"ws-{max_id + 1:03d}"


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Discover work items from sources")
    parser.add_argument("--dry-run", action="store_true", help="Show discoveries without adding")
    parser.add_argument("--source", type=str, help="Only poll a specific source")
    args = parser.parse_args()

    project_root = Path(__file__).parent.parent
    sources_config = load_yaml_simple(project_root / "config" / "sources.yml")
    env_config = load_yaml_simple(project_root / "config" / "environment.yml")

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
            print(f"  Jira adapter not yet implemented")

        elif source_type == "github":
            print(f"  GitHub adapter not yet implemented")

        else:
            print(f"  Unknown source type: {source_type}")

    # Deduplicate
    unique = deduplicate(all_new, queue["items"])
    print(f"\nTotal discovered: {len(all_new)}")
    print(f"New (after dedup): {len(unique)}")

    if not unique:
        print("No new items to add.")
        return

    if args.dry_run:
        print("\n--- NEW ITEMS (dry run) ---")
        for item in unique:
            print(f"  [{item['type']}] p{item['priority']} {item['title']}")
            if item.get("description"):
                print(f"    {item['description']}")
        return

    # Add new items to queue
    for item in unique:
        item_id = generate_id(queue["items"])
        queue_item = {
            "id": item_id,
            "source": item.get("source", "discovery"),
            "title": item["title"],
            "description": item.get("description", ""),
            "type": item["type"],
            "priority": item["priority"],
            "status": "queued",
            "branch": "",
            "worktree_path": None,
            "session_id": None,
            "delegator_id": None,
            "delegator_enabled": item["type"] == "project",
            "blockers": [],
            "created_at": datetime.now().isoformat(),
            "activated_at": None,
            "completed_at": None,
            "metadata": {"source_ref": item.get("source_ref", "")},
        }
        queue["items"].append(queue_item)
        print(f"  Added: {item_id} — {item['title']}")

    queue_path.write_text(json.dumps(queue, indent=2) + "\n")
    print(f"\nQueue updated: {len(unique)} new items added.")


if __name__ == "__main__":
    main()
