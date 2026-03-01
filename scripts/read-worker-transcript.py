#!/usr/bin/env python3
"""Read and summarize a Claude Code worker session transcript.

Given a worktree path, finds the most recent session transcript (JSONL)
and extracts a summary of recent activity. Used by delegators to understand
what a worker is doing without relying on message passing.

Usage:
    python3 scripts/read-worker-transcript.py <worktree_path> [--lines N] [--format summary|raw|idle-check]

Output formats:
  summary    - Human-readable summary of recent activity (default)
  raw        - Raw JSON of recent entries
  idle-check - Just output IDLE or ACTIVE with reason
"""

import json
import sys
import os
import glob
from datetime import datetime, timezone
from pathlib import Path
from collections import Counter

def find_transcript(worktree_path: str) -> str | None:
    """Find the most recent transcript JSONL file for a worktree."""
    # Claude stores projects in ~/.claude/projects/ with path-derived names
    # /Users/foo/bar-baz -> -Users-foo-bar-baz
    normalized = worktree_path.rstrip("/").replace("/", "-")
    projects_dir = Path.home() / ".claude" / "projects" / normalized

    if not projects_dir.exists():
        return None

    # Find the most recently modified JSONL file
    jsonl_files = sorted(
        projects_dir.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    return str(jsonl_files[0]) if jsonl_files else None


def read_tail(filepath: str, n_lines: int = 200) -> list[dict]:
    """Read the last N lines of a JSONL file efficiently."""
    entries = []
    try:
        with open(filepath, "rb") as f:
            # Seek to end and work backwards
            f.seek(0, 2)
            file_size = f.tell()
            # Read in chunks from the end
            chunk_size = min(file_size, n_lines * 5000)  # ~5KB per entry estimate
            f.seek(max(0, file_size - chunk_size))
            data = f.read().decode("utf-8", errors="replace")

        lines = data.strip().split("\n")
        # Take last N lines
        for line in lines[-n_lines:]:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    except (OSError, IOError):
        pass

    return entries


def summarize_entries(entries: list[dict]) -> dict:
    """Analyze transcript entries and produce a summary."""
    tool_calls = Counter()
    recent_text = []
    recent_user_msgs = []
    timestamps = []
    is_in_standby = False
    last_productive_ts = None
    total_entries = len(entries)

    for entry in entries:
        ts = entry.get("timestamp")
        if ts:
            timestamps.append(ts)

        msg = entry.get("message", {})
        if not isinstance(msg, dict):
            continue

        role = msg.get("role", "")
        content = msg.get("content", [])

        if not isinstance(content, list):
            continue

        for block in content:
            if not isinstance(block, dict):
                continue

            if block.get("type") == "tool_use":
                tool_name = block.get("name", "unknown")
                tool_calls[tool_name] += 1

                # Track if the most recent activity is relay_standby
                if tool_name == "mcp__plugin_voice-multiplexer_voice-multiplexer__relay_standby":
                    is_in_standby = True
                else:
                    is_in_standby = False
                    last_productive_ts = ts

            elif block.get("type") == "text":
                text = block.get("text", "")
                if role == "assistant" and text.strip():
                    recent_text.append(text[:500])
                elif role == "user" and text.strip():
                    # Filter out system/skill prompts
                    if not text.startswith("Base directory for this skill"):
                        recent_user_msgs.append(text[:300])

    # Determine idle status
    idle = False
    idle_reason = ""

    if is_in_standby:
        # Check how long it's been in standby
        if timestamps:
            try:
                last_ts = datetime.fromisoformat(timestamps[-1].replace("Z", "+00:00"))
                if last_ts.tzinfo is None:
                    last_ts = last_ts.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                minutes_idle = (now - last_ts).total_seconds() / 60

                if minutes_idle > 5:
                    idle = True
                    idle_reason = f"In relay_standby for {int(minutes_idle)} minutes"
            except (ValueError, TypeError):
                pass

    # Check for repetitive standby loops (sign of stuck session)
    standby_count = tool_calls.get(
        "mcp__plugin_voice-multiplexer_voice-multiplexer__relay_standby", 0
    )
    relay_status_count = tool_calls.get(
        "mcp__plugin_voice-multiplexer_voice-multiplexer__relay_status", 0
    )
    total_tool_calls = sum(tool_calls.values())

    if total_tool_calls > 0 and (standby_count + relay_status_count) / total_tool_calls > 0.7:
        idle = True
        idle_reason = f"Session stuck in standby loop ({standby_count} standby calls out of {total_tool_calls} total)"

    # Build summary
    first_ts = timestamps[0] if timestamps else None
    last_ts = timestamps[-1] if timestamps else None

    # Get top non-relay tool calls
    productive_tools = {
        k: v
        for k, v in tool_calls.items()
        if "relay" not in k and "voice" not in k
    }
    top_tools = sorted(productive_tools.items(), key=lambda x: -x[1])[:10]

    return {
        "total_entries": total_entries,
        "time_range": {"first": first_ts, "last": last_ts},
        "is_idle": idle,
        "idle_reason": idle_reason,
        "is_in_standby": is_in_standby,
        "last_productive_timestamp": last_productive_ts,
        "tool_usage": dict(top_tools),
        "standby_calls": standby_count,
        "recent_assistant_text": recent_text[-3:] if recent_text else [],
        "recent_user_messages": recent_user_msgs[-3:] if recent_user_msgs else [],
    }


def format_summary(summary: dict) -> str:
    """Format summary as human-readable text."""
    lines = []
    lines.append(f"Entries analyzed: {summary['total_entries']}")

    tr = summary["time_range"]
    if tr["first"] and tr["last"]:
        lines.append(f"Time range: {tr['first']} to {tr['last']}")

    if summary["is_idle"]:
        lines.append(f"STATUS: IDLE — {summary['idle_reason']}")
    elif summary["is_in_standby"]:
        lines.append("STATUS: In standby (recently entered)")
    else:
        lines.append("STATUS: ACTIVE")

    if summary["tool_usage"]:
        lines.append("\nRecent tool usage:")
        for tool, count in summary["tool_usage"].items():
            # Shorten tool names for readability
            short = tool.split("__")[-1] if "__" in tool else tool
            lines.append(f"  {short}: {count}")

    if summary["standby_calls"] > 0:
        lines.append(f"\nStandby loop calls: {summary['standby_calls']}")

    if summary["recent_assistant_text"]:
        lines.append("\nRecent assistant output:")
        for text in summary["recent_assistant_text"]:
            # First 200 chars of each
            lines.append(f"  > {text[:200]}...")

    if summary["recent_user_messages"]:
        lines.append("\nRecent user messages:")
        for msg in summary["recent_user_messages"]:
            lines.append(f"  > {msg[:200]}...")

    return "\n".join(lines)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Read worker session transcript")
    parser.add_argument("worktree_path", help="Path to the worker's worktree")
    parser.add_argument("--lines", type=int, default=200, help="Number of recent lines to analyze")
    parser.add_argument("--format", choices=["summary", "raw", "idle-check"], default="summary")
    args = parser.parse_args()

    transcript = find_transcript(args.worktree_path)
    if not transcript:
        print(f"ERROR: No transcript found for {args.worktree_path}", file=sys.stderr)
        sys.exit(1)

    entries = read_tail(transcript, args.lines)
    if not entries:
        print(f"ERROR: No entries in transcript {transcript}", file=sys.stderr)
        sys.exit(1)

    if args.format == "raw":
        for entry in entries[-20:]:
            print(json.dumps(entry, indent=2))
    elif args.format == "idle-check":
        summary = summarize_entries(entries)
        if summary["is_idle"]:
            print(f"IDLE:{summary['idle_reason']}")
        else:
            print("ACTIVE")
    else:
        summary = summarize_entries(entries)
        print(format_summary(summary))


if __name__ == "__main__":
    main()
