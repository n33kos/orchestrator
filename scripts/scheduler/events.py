"""Event emission for the scheduler.

Mirrors emit-event.sh — appends structured JSON events to events.jsonl.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path


EVENTS_FILE = os.environ.get(
    "EVENTS_FILE",
    os.path.expanduser("~/.claude/orchestrator/events.jsonl"),
)


def emit_event(
    event_type: str,
    message: str,
    *,
    item_id: str = "",
    session_id: str = "",
    severity: str = "info",
    extra: str = "",
) -> None:
    """Append a structured event to the orchestrator event log."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    Path(EVENTS_FILE).parent.mkdir(parents=True, exist_ok=True)

    event: dict = {
        "timestamp": timestamp,
        "type": event_type,
        "message": message,
        "severity": severity,
    }
    if item_id:
        event["item_id"] = item_id
    if session_id:
        event["session_id"] = session_id
    if extra:
        event["extra"] = extra

    try:
        with open(EVENTS_FILE, "a") as f:
            f.write(json.dumps(event) + "\n")
    except OSError:
        pass
