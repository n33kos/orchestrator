#!/usr/bin/env python3
"""Inspect and stop directive runs.

The worker session, the dashboard, and a human at a terminal all reach a
directive run through this one command, so every stop is recorded the same way.

Usage:
    directive-control.py list <item-id> [--json]
    directive-control.py status <item-id> <directive>
    directive-control.py stop <item-id> <directive> [reason ...]
    directive-control.py tail <item-id> <directive> [lines]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.scheduler.directive_runs import (  # noqa: E402
    describe_run,
    list_runs,
    read_status,
    stop_run,
)


def cmd_list(item_id: str, as_json: bool = False) -> int:
    runs = list_runs(item_id)
    if as_json:
        print(json.dumps({"runs": [describe_run(r) for r in runs]}, indent=2))
        return 0
    if not runs:
        print(f"No directive runs recorded for {item_id}")
        return 0
    for status in runs:
        s = describe_run(status)
        live = "LIVE" if s["alive"] else s["status"].upper()
        print(
            f"{s['directive']:<24} {live:<12} "
            f"{s['runtime_minutes']:>6} min  "
            f"{s['output_bytes']:>9} bytes  {s['output_path']}"
        )
        if s.get("stopped_reason"):
            print(f"{'':<24} stopped: {s['stopped_reason']}")
    return 0


def cmd_status(item_id: str, directive: str) -> int:
    status = read_status(item_id, directive)
    if not status:
        print(f"No status file for {item_id}/{directive}", file=sys.stderr)
        return 1
    print(json.dumps(describe_run(status), indent=2))
    return 0


def cmd_stop(item_id: str, directive: str, reason: str) -> int:
    result = stop_run(item_id, directive, reason)
    print(json.dumps(result, indent=2))
    return 0 if result.get("stopped") or result.get("reason") == "already_finished" else 1


def cmd_tail(item_id: str, directive: str, lines: int) -> int:
    status = read_status(item_id, directive)
    if not status:
        print(f"No status file for {item_id}/{directive}", file=sys.stderr)
        return 1
    path = status.get("output_path")
    if not path or not Path(path).exists():
        print(f"No output file yet for {item_id}/{directive}")
        return 0
    with open(path) as f:
        content = f.read().splitlines()
    for line in content[-lines:]:
        print(line)
    return 0


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2

    action = sys.argv[1]
    item_id = sys.argv[2]

    if action == "list":
        return cmd_list(item_id, as_json="--json" in sys.argv[3:])

    if len(sys.argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    directive = sys.argv[3]

    if action == "status":
        return cmd_status(item_id, directive)
    if action == "stop":
        reason = " ".join(sys.argv[4:]) or "stopped by hand"
        return cmd_stop(item_id, directive, reason)
    if action == "tail":
        lines = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 40
        return cmd_tail(item_id, directive, lines)

    print(f"Unknown action: {action}", file=sys.stderr)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
