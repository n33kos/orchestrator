"""Deterministic, dependency-free validator for queue items.

Validates a queue item against config/queue-item.schema.json — a small subset
of JSON Schema (type, enum, required, properties, additionalProperties). This is
the single source of truth for what a valid work item looks like; the queue
write boundary (lib.queue) calls validate_item() so an invalid status, an
unknown structured key, or a wrong-typed field can never be persisted.

CLI:
    python3 -m lib.validate_queue [<item-id>]      # validate one item, or all
    python3 -m lib.validate_queue --file <path>    # validate against a queue file
Exits non-zero if any item is invalid.
"""

import json
import os
import sys
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "queue-item.schema.json"

_TYPE_CHECKS = {
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "null": lambda v: v is None,
}

_schema_cache = None


def load_schema() -> dict:
    global _schema_cache
    if _schema_cache is None:
        with open(SCHEMA_PATH) as f:
            _schema_cache = json.load(f)
    return _schema_cache


def _type_ok(value, type_spec) -> bool:
    types = type_spec if isinstance(type_spec, list) else [type_spec]
    return any(_TYPE_CHECKS.get(t, lambda _v: False)(value) for t in types)


def _validate(value, schema: dict, path: str, errors: list) -> None:
    type_spec = schema.get("type")
    if type_spec is not None and not _type_ok(value, type_spec):
        errors.append(f"{path or '(root)'}: expected type {type_spec}, got {type(value).__name__}")
        return

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path or '(root)'}: {value!r} is not one of {schema['enum']}")

    if isinstance(value, dict) and (schema.get("type") == "object" or "properties" in schema):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value:
                errors.append(f"{path or '(root)'}: missing required key {req!r}")
        allow_additional = schema.get("additionalProperties", True)
        for key, sub_value in value.items():
            sub_path = f"{path}.{key}" if path else key
            if key in props:
                _validate(sub_value, props[key], sub_path, errors)
            elif allow_additional is False:
                errors.append(f"{sub_path}: unknown key not allowed by schema")


def validate_item(item: dict, schema: dict | None = None) -> list:
    """Return a list of error strings for an item (empty list == valid)."""
    errors: list = []
    _validate(item, schema or load_schema(), f"item[{item.get('id', '?')}]", errors)
    return errors


def _queue_path() -> str:
    return os.environ.get(
        "ORCHESTRATOR_QUEUE_FILE",
        os.path.expanduser("~/.claude/orchestrator/queue.json"),
    )


def main() -> None:
    args = sys.argv[1:]
    queue_path = _queue_path()
    only_id = None
    i = 0
    while i < len(args):
        if args[i] == "--file":
            queue_path = args[i + 1]
            i += 2
        else:
            only_id = args[i]
            i += 1

    with open(queue_path) as f:
        data = json.load(f)
    schema = load_schema()

    items = [it for it in data["items"] if only_id is None or it.get("id") == only_id]
    if only_id is not None and not items:
        print(f"ERROR: item {only_id} not found", file=sys.stderr)
        sys.exit(2)

    total_errors = 0
    for it in items:
        errs = validate_item(it, schema)
        if errs:
            total_errors += len(errs)
            for e in errs:
                print(f"  ✗ {e}", file=sys.stderr)
        else:
            print(f"  ✓ {it.get('id')} valid")

    if total_errors:
        print(f"\nFAIL: {total_errors} schema violation(s) across {len(items)} item(s)", file=sys.stderr)
        sys.exit(1)
    print(f"\nPASS: all {len(items)} item(s) valid")


if __name__ == "__main__":
    main()
