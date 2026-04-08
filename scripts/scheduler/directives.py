"""Load delegator directives from markdown files with YAML frontmatter.

Directives are loaded from two directories:
  1. delegator/directives/<status>/*.md  — committed, shared defaults
  2. delegator/directives.local/<status>/*.md  — gitignored, machine-specific

Local directives override same-name committed ones; new names are appended.

Each file has:
  - YAML frontmatter (between --- delimiters): name, required, max_retries, depends_on
  - Markdown body: natural language instructions for the delegator

Example file (delegator/directives/active/council-review.md):

    ---
    name: council-review
    required: true
    max_retries: 3
    depends_on: some-other-directive
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


def _load_directives_from_dir(directives_root: str) -> dict[str, list[dict]]:
    """Load directives from a single directives directory.

    Returns dict mapping status names to lists of directive dicts.
    """
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
                "depends_on": frontmatter.get("depends_on", None),
                "instructions": body,
                "source_file": filepath,
            }
            directives.append(directive)

        if directives:
            result[status_dir] = directives

    return result


def load_directives(project_root: Optional[str] = None) -> dict[str, list[dict]]:
    """Load delegator directives from committed and local directories.

    Loads from:
      1. delegator/directives/<status>/*.md (committed defaults)
      2. delegator/directives.local/<status>/*.md (local overrides)

    Local directives with the same name as committed ones replace them.
    New local directives are appended.

    Args:
        project_root: Path to the orchestrator project root. If None,
                      derived from this file's location (../../).

    Returns:
        Dict mapping status names to lists of directive dicts.
        Each directive has: name, required, max_retries, depends_on, instructions.
    """
    if project_root is None:
        project_root = str(Path(__file__).resolve().parent.parent.parent)

    committed_root = os.path.join(project_root, "delegator", "directives")
    local_root = os.path.join(project_root, "delegator", "directives.local")

    committed = _load_directives_from_dir(committed_root)
    local = _load_directives_from_dir(local_root)

    # Merge: local overrides committed by name, new names appended
    all_statuses = set(committed.keys()) | set(local.keys())
    result: dict[str, list[dict]] = {}

    for status in sorted(all_statuses):
        committed_list = committed.get(status, [])
        local_list = local.get(status, [])

        # Index committed directives by name
        merged: dict[str, dict] = {}
        for d in committed_list:
            merged[d["name"]] = d

        # Local overrides same-name, appends new
        for d in local_list:
            merged[d["name"]] = d

        if merged:
            result[status] = list(merged.values())

    return result


def init_runtime_directives(directives: list[dict]) -> dict:
    """Initialize runtime.directives tracking state for a list of directives.

    Returns a dict keyed by directive name with initial tracking state.
    """
    runtime = {}
    for d in directives:
        runtime[d["name"]] = {
            "status": "pending",
            "retries": 0,
            "last_run": None,
            "output_path": None,
        }
    return runtime


def merge_runtime_directives(
    existing_runtime: dict, directives: list[dict]
) -> dict:
    """Merge directive definitions with existing runtime state.

    Preserves state for directives that already have tracking.
    Initializes state for new directives.
    Removes state for directives no longer defined.

    Args:
        existing_runtime: Current runtime.directives from the queue item.
        directives: Current directive definitions for the item's status.

    Returns:
        Updated runtime directives dict.
    """
    defined_names = {d["name"] for d in directives}
    result = {}

    for d in directives:
        name = d["name"]
        if name in existing_runtime:
            result[name] = existing_runtime[name]
        else:
            result[name] = {
                "status": "pending",
                "retries": 0,
                "last_run": None,
                "output_path": None,
            }

    return result


def format_directives_for_prompt(
    directives: list[dict],
    runtime_state: Optional[dict] = None,
) -> str:
    """Format directives into a section for injection into a delegator prompt.

    Includes runtime state (status, retries) when available, and indicates
    dependency relationships and which directive to work on next.

    Args:
        directives: List of directive dicts for a specific status.
        runtime_state: Optional runtime.directives dict from the queue item.

    Returns:
        Formatted markdown string, or empty string if no directives.
    """
    if not directives:
        return ""

    lines = [
        "## Active Directives",
        "",
        "The following directives apply to this item's current status. "
        "Evaluate each directive during this monitoring cycle and update their status.",
        "",
    ]

    # Determine which directive to work on next
    next_directive = _next_actionable_directive(directives, runtime_state)

    for d in directives:
        name = d["name"]
        required_tag = " **(required)**" if d.get("required") else ""
        retry_info = ""
        if d.get("max_retries", 0) > 0:
            retry_info = f" (max {d['max_retries']} retries)"

        depends_info = ""
        if d.get("depends_on"):
            depends_info = f" (depends on: {d['depends_on']})"

        lines.append(
            f"### Directive: {name}{required_tag}{retry_info}{depends_info}"
        )

        # Include runtime state if available
        if runtime_state and name in runtime_state:
            rs = runtime_state[name]
            status = rs.get("status", "pending")
            retries = rs.get("retries", 0)
            last_run = rs.get("last_run")
            output_path = rs.get("output_path")

            lines.append("")
            lines.append(f"**Current state:** {status}")
            if retries > 0:
                lines.append(f"**Retries used:** {retries}/{d.get('max_retries', 0)}")
            if last_run:
                lines.append(f"**Last run:** {last_run}")
            if output_path:
                lines.append(f"**Output:** {output_path}")

        if next_directive and next_directive == name:
            lines.append("")
            lines.append("**>>> NEXT: This is the directive to evaluate this cycle. <<<**")

        lines.append("")
        lines.append(d["instructions"])
        lines.append("")

    # Summary of blocking state
    blocking = _blocking_directives(directives, runtime_state)
    if blocking:
        lines.append("### Blocking Directives")
        lines.append("")
        lines.append(
            "The following required directives have NOT completed. "
            "Do NOT trigger status transitions until all required directives pass."
        )
        lines.append("")
        for name in blocking:
            lines.append(f"- **{name}**")
        lines.append("")

    return "\n".join(lines)


def _next_actionable_directive(
    directives: list[dict],
    runtime_state: Optional[dict],
) -> Optional[str]:
    """Determine which directive should be worked on next.

    Priority:
      1. First pending directive whose dependencies are met
      2. First failed directive that hasn't exceeded max_retries, whose dependencies are met

    Returns the directive name, or None if nothing is actionable.
    """
    if not runtime_state:
        # No runtime state yet — first directive is next
        return directives[0]["name"] if directives else None

    completed_names = {
        name for name, rs in runtime_state.items() if rs.get("status") == "completed"
    }

    # First pass: find a pending directive with met dependencies
    for d in directives:
        name = d["name"]
        rs = runtime_state.get(name, {})
        status = rs.get("status", "pending")
        dep = d.get("depends_on")

        if status != "pending":
            continue
        if dep and dep not in completed_names:
            continue
        return name

    # Second pass: find a failed directive eligible for retry
    for d in directives:
        name = d["name"]
        rs = runtime_state.get(name, {})
        status = rs.get("status", "pending")
        dep = d.get("depends_on")
        retries = rs.get("retries", 0)
        max_retries = d.get("max_retries", 0)

        if status != "failed":
            continue
        if max_retries > 0 and retries >= max_retries:
            continue
        if dep and dep not in completed_names:
            continue
        return name

    return None


def _blocking_directives(
    directives: list[dict],
    runtime_state: Optional[dict],
) -> list[str]:
    """Return names of required directives that haven't completed."""
    if not runtime_state:
        return [d["name"] for d in directives if d.get("required")]

    blocking = []
    for d in directives:
        if not d.get("required"):
            continue
        name = d["name"]
        rs = runtime_state.get(name, {})
        if rs.get("status") != "completed":
            blocking.append(name)
    return blocking
