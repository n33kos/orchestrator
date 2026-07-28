#!/usr/bin/env python3
"""Check that everything touching a work item agrees with the schema.

Schema drift has been a recurring source of bugs: a field written in one place and
forbidden by the schema blocks every later write, and a status or field list copied
by hand in a second language silently falls behind. This asserts the invariants that
keep that from happening, so drift fails a check rather than surfacing as a bug.

Usage:
    python3 scripts/check-schema-conformance.py
"""

import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib.validate_queue import load_schema, validate_item  # noqa: E402

failures: list[str] = []
notes: list[str] = []


def check(label: str, problems: list[str]) -> None:
    if problems:
        failures.append(label)
        print(f"FAIL  {label}")
        for problem in problems[:10]:
            print(f"        {problem}")
    else:
        print(f"ok    {label}")


def live_queue_conforms(schema: dict) -> list[str]:
    queue_path = Path.home() / ".claude" / "orchestrator" / "queue.json"
    if not queue_path.exists():
        notes.append("no live queue to check")
        return []
    items = json.loads(queue_path.read_text()).get("items", [])
    return [v for item in items for v in validate_item(item, schema)]


def status_enum_matches_typescript(schema: dict) -> list[str]:
    """The dashboard's status union must list exactly the schema's statuses."""
    types_file = PROJECT_ROOT / "dashboard" / "src" / "types.ts"
    if not types_file.exists():
        return []

    match = re.search(r"export type WorkItemStatus\s*=\s*([^\n]+)", types_file.read_text())
    if not match:
        return ["types.ts does not declare WorkItemStatus"]

    declared = set(re.findall(r"'([a-z_]+)'", match.group(1)))
    expected = set(schema["properties"]["status"]["enum"])

    problems = []
    for missing in sorted(expected - declared):
        problems.append(f"types.ts WorkItemStatus is missing '{missing}'")
    for extra in sorted(declared - expected):
        problems.append(f"types.ts WorkItemStatus has '{extra}', which the schema rejects")
    return problems


def commit_strategy_enum_matches_typescript(schema: dict) -> list[str]:
    types_file = PROJECT_ROOT / "dashboard" / "src" / "types.ts"
    if not types_file.exists():
        return []
    text = types_file.read_text()
    match = re.search(r"commit_strategy\s*:\s*([^\n]+)", text)
    if not match or "'" not in match.group(1):
        return []

    declared = set(re.findall(r"'([a-z_]+)'", match.group(1)))
    expected = set(schema["properties"]["worker"]["properties"]["commit_strategy"]["enum"])
    return [
        f"types.ts commit_strategy disagrees with the schema: {sorted(declared)} vs {sorted(expected)}"
    ] if declared != expected else []


def no_hand_copied_status_unions() -> list[str]:
    """A status union spelled out anywhere but types.ts is a copy that will drift."""
    problems = []
    pattern = re.compile(r"'(?:queued|planning|active|review|completed)'\s*\|\s*'")
    for path in (PROJECT_ROOT / "dashboard" / "src").rglob("*.ts*"):
        if path.name in ("types.ts", "status-transitions.ts") or "node_modules" in str(path):
            continue
        for number, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
            if pattern.search(line):
                rel = path.relative_to(PROJECT_ROOT)
                problems.append(f"{rel}:{number} spells out a status union; import WorkItemStatus instead")
    return problems


def no_unvalidated_queue_writes() -> list[str]:
    """Every write must go through the locking, validating helper."""
    problems = []

    helpers = PROJECT_ROOT / "dashboard" / "src" / "api" / "helpers.ts"
    if helpers.exists() and "lib.queue" not in helpers.read_text():
        problems.append("dashboard writeQueue no longer routes through lib.queue")

    for path in list((PROJECT_ROOT / "dashboard" / "src").rglob("*.ts*")):
        if "node_modules" in str(path) or path.name == "helpers.ts":
            continue
        text = path.read_text(errors="ignore")
        if "writeFileSync(queuePath" in text:
            problems.append(f"{path.relative_to(PROJECT_ROOT)} writes queue.json directly")

    for path in list((PROJECT_ROOT / "scripts").rglob("*.py")):
        if path.name in ("queue.py", "migrate-queue-schema.py"):
            continue
        text = path.read_text(errors="ignore")
        if re.search(r"queue_path\.write_text|open\(\s*QUEUE_PATH\s*,\s*[\"']w", text):
            problems.append(f"{path.relative_to(PROJECT_ROOT)} writes the queue without the lock")

    return problems


def no_stale_item_fields(schema: dict) -> list[str]:
    """Fields removed from the schema must not linger in readers or writers."""
    retired = ["description", "metadata", "delegator_id"]
    problems = []
    roots = [PROJECT_ROOT / "scripts", PROJECT_ROOT / "dashboard" / "src", PROJECT_ROOT / "skills"]
    # clipboard-import reads rows a user pasted from elsewhere, where a description
    # column is legitimate external data. It maps that text to planBody rather than
    # onto the item, so it is not a stale item-field read.
    exempt = {"clipboard-import.ts"}
    pattern = re.compile(r"\bitem\.(%s)\b|\bitem\[[\"'](%s)[\"']\]|\bi\.(%s)\b" % tuple(["|".join(retired)] * 3))
    for root in roots:
        for path in root.rglob("*"):
            if path.is_dir() or "node_modules" in str(path) or path.suffix not in (".py", ".sh", ".ts", ".tsx", ".md"):
                continue
            if path.name in exempt:
                continue
            for number, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
                if pattern.search(line):
                    rel = path.relative_to(PROJECT_ROOT)
                    problems.append(f"{rel}:{number} reads a retired item field")
    return problems


def main() -> None:
    schema = load_schema()

    check("live queue matches the schema", live_queue_conforms(schema))
    check("status enum matches dashboard types", status_enum_matches_typescript(schema))
    check("commit_strategy enum matches dashboard types", commit_strategy_enum_matches_typescript(schema))
    check("no hand-copied status unions", no_hand_copied_status_unions())
    check("all queue writes go through the validating helper", no_unvalidated_queue_writes())
    check("no retired item fields referenced", no_stale_item_fields(schema))

    for note in notes:
        print(f"note  {note}")

    if failures:
        print(f"\n{len(failures)} check(s) failed")
        sys.exit(1)
    print("\nAll schema conformance checks passed.")


if __name__ == "__main__":
    main()
