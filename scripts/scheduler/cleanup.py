"""Cleanup functions for the scheduler.

Ports: cleanup_completed, rotate_event_log from scheduler.sh.
"""

import gzip
import json
import os
import shutil
from datetime import datetime, timezone, timedelta
from pathlib import Path

from scripts.lib.queue import locked_queue
from scripts.scheduler.config import Config


def cleanup_completed(cfg: Config) -> None:
    """Archive completed items older than configured days."""
    queue_dir = os.path.dirname(cfg.queue_file)
    archive_dir = os.path.join(queue_dir, "archive")
    os.makedirs(archive_dir, exist_ok=True)

    cutoff = datetime.now(timezone.utc) - timedelta(days=cfg.archive_after_days)

    with locked_queue(write=True) as ctx:
        data = ctx["data"]
        keep = []
        archive = []

        for item in data["items"]:
            if item["status"] == "completed" and item.get("completed_at"):
                try:
                    completed = datetime.fromisoformat(
                        item["completed_at"].replace("Z", "+00:00")
                    )
                    if completed.tzinfo is None:
                        completed = completed.replace(tzinfo=timezone.utc)
                    if completed < cutoff:
                        archive.append(item)
                        continue
                except (ValueError, TypeError):
                    pass
            keep.append(item)

        if not archive:
            print(f"[cleanup] No completed items older than {cfg.archive_after_days} days")
            return

        # Write archive first — only update queue if archive succeeds
        archive_file = os.path.join(
            archive_dir, f"archived-{datetime.now().strftime('%Y-%m-%d')}.json"
        )
        try:
            existing = []
            if os.path.isfile(archive_file):
                try:
                    with open(archive_file) as f:
                        existing = json.load(f)
                except (json.JSONDecodeError, OSError):
                    existing = []
            existing.extend(archive)
            with open(archive_file, "w") as f:
                json.dump(existing, f, indent=2)
                f.write("\n")
        except OSError as e:
            print(f"[cleanup] ERROR: Failed to write archive: {e}")
            print("[cleanup] Queue NOT modified — items preserved")
            return

        # Archive write succeeded — safe to remove from queue
        data["items"] = keep
        ctx["modified"] = True
        print(f"[cleanup] Archived {len(archive)} completed item(s) to {archive_file}")
        print(f"[cleanup] Queue now has {len(keep)} items")


def rotate_event_log(cfg: Config) -> None:
    """Rotate events.jsonl when it exceeds 10000 lines."""
    queue_dir = os.path.dirname(cfg.queue_file)
    events_file = os.path.join(queue_dir, "events.jsonl")

    if not os.path.isfile(events_file):
        return

    with open(events_file) as f:
        lines = f.readlines()

    line_count = len(lines)
    if line_count <= 10000:
        return

    archive_dir = os.path.join(queue_dir, "archive")
    os.makedirs(archive_dir, exist_ok=True)

    rotated = os.path.join(
        archive_dir,
        f"events-{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.jsonl",
    )

    # Keep last 2000 lines, archive the rest
    archive_count = line_count - 2000
    with open(rotated, "w") as f:
        f.writelines(lines[:archive_count])
    with open(events_file, "w") as f:
        f.writelines(lines[archive_count:])

    print(f"[cleanup] Rotated event log: archived {archive_count} entries to {rotated}")

    # Compress old archives (older than 7 days)
    now = datetime.now()
    for path in Path(archive_dir).glob("events-*.jsonl"):
        if path.suffix == ".gz":
            continue
        age_days = (now.timestamp() - path.stat().st_mtime) / 86400
        if age_days > 7:
            with open(path, "rb") as f_in:
                with gzip.open(str(path) + ".gz", "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)
            path.unlink()

    # Delete compressed archives older than 30 days
    for path in Path(archive_dir).glob("events-*.jsonl.gz"):
        age_days = (now.timestamp() - path.stat().st_mtime) / 86400
        if age_days > 30:
            path.unlink()
