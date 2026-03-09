#!/usr/bin/env python3
"""Shared queue operations with file-locking for the orchestrator.

All queue.json reads and writes go through this module to prevent
concurrent access corruption. Uses fcntl.flock for advisory locking.

Usage from shell scripts:
    # Get a single field
    python3 -m lib.queue get <item-id> status
    python3 -m lib.queue get <item-id> title environment.branch status

    # Get full item as JSON
    python3 -m lib.queue get-item <item-id>

    # Update fields on an item
    python3 -m lib.queue update <item-id> status=active environment.session_id=abc123

    # Update nested fields
    python3 -m lib.queue update <item-id> runtime.delegator_status=monitoring

    # Count items matching a status
    python3 -m lib.queue count --status active --type project

    # List item IDs matching criteria
    python3 -m lib.queue list --status queued --sort priority

    # Atomic read-modify-write (for complex updates)
    python3 -m lib.queue update <item-id> status=active activated_at=NOW environment.session_id=abc123 environment.worktree_path=/path

All operations acquire an exclusive lock on queue.json.lock before
reading or writing, preventing race conditions between scheduler,
activate-stream, health-check, and other concurrent scripts.
"""

import fcntl
import json
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _default_queue_path() -> str:
    return os.environ.get(
        "ORCHESTRATOR_QUEUE_FILE",
        os.path.expanduser("~/.claude/orchestrator/queue.json"),
    )


@contextmanager
def locked_queue(queue_path: Optional[str] = None, write: bool = False):
    """Context manager that yields (data, path) with an advisory file lock.

    If write=True, the modified data dict will be written back on exit.
    """
    path = queue_path or _default_queue_path()
    lock_path = path + ".lock"

    # Ensure lock file exists
    Path(lock_path).touch(exist_ok=True)

    lock_fd = open(lock_path, "r+")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        with open(path) as f:
            data = json.load(f)

        result = {"data": data, "modified": False}
        yield result

        if write and result.get("modified", False):
            with open(path, "w") as f:
                json.dump(result["data"], f, indent=2)
                f.write("\n")
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def find_item(data: dict, item_id: str) -> Optional[dict]:
    """Find an item by ID in the queue data."""
    return next((i for i in data["items"] if i["id"] == item_id), None)


def get_fields(item: dict, fields: list[str]) -> list[str]:
    """Extract fields from an item, supporting dotted paths like environment.branch or plan.file."""
    values = []
    for field in fields:
        obj = item
        for part in field.split("."):
            if isinstance(obj, dict):
                obj = obj.get(part, "")
            else:
                obj = ""
                break
        if obj is None:
            obj = ""
        values.append(str(obj))
    return values


def set_fields(item: dict, updates: dict[str, Any]) -> None:
    """Set fields on an item, supporting dotted paths and special values.

    Special values:
        "NOW" -> current UTC ISO timestamp
        "NULL" -> None
        "TRUE" / "FALSE" -> boolean
        Numeric strings -> int or float
    """
    for key, value in updates.items():
        value = _coerce_value(value)
        parts = key.split(".")
        obj = item
        for part in parts[:-1]:
            if part not in obj or not isinstance(obj[part], dict):
                obj[part] = {}
            obj = obj[part]
        obj[parts[-1]] = value


def _coerce_value(value: str) -> Any:
    """Convert string values to appropriate Python types."""
    if value == "NOW":
        return datetime.now(timezone.utc).isoformat()
    if value == "NULL":
        return None
    if value.upper() == "TRUE":
        return True
    if value.upper() == "FALSE":
        return False
    # Try int
    try:
        return int(value)
    except (ValueError, TypeError):
        pass
    # Try float
    try:
        return float(value)
    except (ValueError, TypeError):
        pass
    return value


def count_items(
    data: dict,
    status: Optional[str] = None,
    item_type: Optional[str] = None,
) -> int:
    """Count items matching optional status and type filters."""
    count = 0
    for item in data["items"]:
        if status and item.get("status") != status:
            continue
        if item_type and item.get("type") != item_type:
            continue
        count += 1
    return count


def list_items(
    data: dict,
    status: Optional[str] = None,
    item_type: Optional[str] = None,
    sort_by: Optional[str] = None,
) -> list[dict]:
    """List items matching optional filters, optionally sorted."""
    items = data["items"]
    if status:
        items = [i for i in items if i.get("status") == status]
    if item_type:
        items = [i for i in items if i.get("type") == item_type]
    if sort_by:
        items = sorted(items, key=lambda i: i.get(sort_by, 0))
    return items


# --- CLI interface ---


def _cli_get(args: list[str], queue_path: str) -> None:
    """get <item-id> <field> [field2 ...]"""
    if len(args) < 2:
        print("Usage: get <item-id> <field> [field2 ...]", file=sys.stderr)
        sys.exit(1)

    item_id = args[0]
    fields = args[1:]

    with locked_queue(queue_path) as ctx:
        item = find_item(ctx["data"], item_id)
        if not item:
            print(f"ERROR: Item {item_id} not found", file=sys.stderr)
            sys.exit(1)
        values = get_fields(item, fields)
        # Use unit separator (ASCII 31) instead of tab — bash's read treats
        # consecutive tabs as a single delimiter, dropping empty fields.
        print("\x1f".join(values))


def _cli_get_item(args: list[str], queue_path: str) -> None:
    """get-item <item-id>"""
    if len(args) < 1:
        print("Usage: get-item <item-id>", file=sys.stderr)
        sys.exit(1)

    item_id = args[0]

    with locked_queue(queue_path) as ctx:
        item = find_item(ctx["data"], item_id)
        if not item:
            print(f"ERROR: Item {item_id} not found", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(item))


def _cli_update(args: list[str], queue_path: str) -> None:
    """update <item-id> key=value [key2=value2 ...]"""
    if len(args) < 2:
        print("Usage: update <item-id> key=value [key2=value2 ...]", file=sys.stderr)
        sys.exit(1)

    item_id = args[0]
    updates = {}
    for arg in args[1:]:
        if "=" not in arg:
            print(f"ERROR: Invalid key=value pair: {arg}", file=sys.stderr)
            sys.exit(1)
        key, value = arg.split("=", 1)
        updates[key] = value

    with locked_queue(queue_path, write=True) as ctx:
        item = find_item(ctx["data"], item_id)
        if not item:
            print(f"ERROR: Item {item_id} not found", file=sys.stderr)
            sys.exit(1)
        set_fields(item, updates)
        ctx["modified"] = True


def _cli_count(args: list[str], queue_path: str) -> None:
    """count [--status STATUS] [--type TYPE]"""
    status = None
    item_type = None
    i = 0
    while i < len(args):
        if args[i] == "--status" and i + 1 < len(args):
            status = args[i + 1]
            i += 2
        elif args[i] == "--type" and i + 1 < len(args):
            item_type = args[i + 1]
            i += 2
        else:
            i += 1

    with locked_queue(queue_path) as ctx:
        print(count_items(ctx["data"], status=status, item_type=item_type))


def _cli_list(args: list[str], queue_path: str) -> None:
    """list [--status STATUS] [--type TYPE] [--sort FIELD] [--field FIELD ...]"""
    status = None
    item_type = None
    sort_by = None
    fields = ["id"]
    i = 0
    while i < len(args):
        if args[i] == "--status" and i + 1 < len(args):
            status = args[i + 1]
            i += 2
        elif args[i] == "--type" and i + 1 < len(args):
            item_type = args[i + 1]
            i += 2
        elif args[i] == "--sort" and i + 1 < len(args):
            sort_by = args[i + 1]
            i += 2
        elif args[i] == "--field" and i + 1 < len(args):
            if fields == ["id"]:
                fields = []
            fields.append(args[i + 1])
            i += 2
        else:
            i += 1

    with locked_queue(queue_path) as ctx:
        items = list_items(ctx["data"], status=status, item_type=item_type, sort_by=sort_by)
        for item in items:
            values = get_fields(item, fields)
            print("\t".join(values))


def main() -> None:
    queue_path = os.environ.get("ORCHESTRATOR_QUEUE_FILE") or _default_queue_path()

    if len(sys.argv) < 2:
        print("Usage: python3 -m lib.queue <command> [args...]", file=sys.stderr)
        print("Commands: get, get-item, update, count, list", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]

    commands = {
        "get": _cli_get,
        "get-item": _cli_get_item,
        "update": _cli_update,
        "count": _cli_count,
        "list": _cli_list,
    }

    if command not in commands:
        print(f"Unknown command: {command}", file=sys.stderr)
        print(f"Available: {', '.join(commands)}", file=sys.stderr)
        sys.exit(1)

    commands[command](args, queue_path)


if __name__ == "__main__":
    main()
