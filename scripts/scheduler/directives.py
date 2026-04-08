"""Load delegator directives from markdown files with YAML frontmatter.

Directives live in delegator/directives/<status>/*.md. Each file has:
  - YAML frontmatter (between --- delimiters): name, required, max_retries
  - Markdown body: natural language instructions for the delegator

Example file (delegator/directives/active/council-review.md):

    ---
    name: council-review
    required: true
    max_retries: 3
    ---
    Once the worker has created a PR and signals completion, run Council review...
"""

import os
import re
from pathlib import Path
from typing import Optional


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter and body from a markdown file.

    Returns (frontmatter_dict, body_text).
    """
    frontmatter: dict = {}
    body = content

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", content, re.DOTALL)
    if match:
        fm_text = match.group(1)
        body = match.group(2).strip()

        # Simple YAML key: value parsing (no nested structures needed)
        for line in fm_text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            kv = line.split(":", 1)
            if len(kv) == 2:
                key = kv[0].strip()
                val = kv[1].strip()
                # Type coercion
                if val.lower() in ("true", "yes"):
                    frontmatter[key] = True
                elif val.lower() in ("false", "no"):
                    frontmatter[key] = False
                else:
                    try:
                        frontmatter[key] = int(val)
                    except ValueError:
                        frontmatter[key] = val

    return frontmatter, body


def load_directives(project_root: Optional[str] = None) -> dict[str, list[dict]]:
    """Load delegator directives from delegator/directives/<status>/*.md files.

    Args:
        project_root: Path to the orchestrator project root. If None,
                      derived from this file's location (../../).

    Returns:
        Dict mapping status names to lists of directive dicts.
        Each directive has: name, required, max_retries, instructions.
    """
    if project_root is None:
        project_root = str(Path(__file__).resolve().parent.parent.parent)

    directives_root = os.path.join(project_root, "delegator", "directives")
    result: dict[str, list[dict]] = {}

    if not os.path.isdir(directives_root):
        return result

    for status_dir in sorted(os.listdir(directives_root)):
        status_path = os.path.join(directives_root, status_dir)
        if not os.path.isdir(status_path):
            continue

        directives = []
        for filename in sorted(os.listdir(status_path)):
            if not filename.endswith(".md"):
                continue

            filepath = os.path.join(status_path, filename)
            try:
                with open(filepath) as f:
                    content = f.read()
            except OSError:
                continue

            frontmatter, body = _parse_frontmatter(content)

            if not body.strip():
                continue

            directive = {
                "name": frontmatter.get("name", filename.removesuffix(".md")),
                "required": frontmatter.get("required", False),
                "max_retries": frontmatter.get("max_retries", 0),
                "instructions": body,
                "source_file": filepath,
            }
            directives.append(directive)

        if directives:
            result[status_dir] = directives

    return result


def format_directives_for_prompt(directives: list[dict]) -> str:
    """Format a list of directives into a section suitable for injection into a delegator prompt.

    Args:
        directives: List of directive dicts for a specific status.

    Returns:
        Formatted markdown string, or empty string if no directives.
    """
    if not directives:
        return ""

    lines = [
        "## Active Directives",
        "",
        "The following directives apply to this item's current status. "
        "Evaluate each directive during this monitoring cycle and report on their status.",
        "",
    ]

    for d in directives:
        required_tag = " **(required)**" if d.get("required") else ""
        retry_info = ""
        if d.get("max_retries", 0) > 0:
            retry_info = f" (max {d['max_retries']} retries)"

        lines.append(f"### Directive: {d['name']}{required_tag}{retry_info}")
        lines.append("")
        lines.append(d["instructions"])
        lines.append("")

    return "\n".join(lines)
