#!/usr/bin/env python3
"""Summarize a worker session transcript for the delegator one-shot pipeline.

Produces a structured JSON summary for inclusion in the delegator cycle payload.
Extends read-worker-transcript.py with additional fields needed by triage/review.

Usage:
    python3 scripts/delegator-summarize-transcript.py <worktree_path> [--lines N]

Output: JSON blob with tool histogram, conversation text, relay messages, errors.
"""

import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# Reuse transcript reading from the existing module
sys.path.insert(0, str(Path(__file__).parent))
import importlib
_rwt = importlib.import_module("read-worker-transcript")
find_transcript = _rwt.find_transcript
read_tail = _rwt.read_tail


def summarize_for_delegator(entries: list[dict], lines: int = 100) -> dict:
    """Produce a structured summary for the delegator pipeline."""
    tool_calls = Counter()
    last_10_tools = []
    errors_in_results = []
    conversation = []
    relay_messages = []
    timestamps = []
    standby_count = 0
    total_productive = 0
    last_productive_ts = None

    for entry in entries:
        ts = entry.get("timestamp", "")
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

            block_type = block.get("type", "")

            # Tool use tracking
            if block_type == "tool_use":
                tool_name = block.get("name", "unknown")
                # Shorten MCP tool names
                short_name = tool_name.split("__")[-1] if "__" in tool_name else tool_name
                tool_calls[short_name] += 1
                last_10_tools.append({"tool": short_name, "ts": ts})
                if len(last_10_tools) > 10:
                    last_10_tools.pop(0)

                if "relay_standby" in tool_name:
                    standby_count += 1
                else:
                    total_productive += 1
                    last_productive_ts = ts

                # Track relay_respond messages (outbound)
                if "relay_respond" in tool_name:
                    text = block.get("input", {}).get("text", "")
                    if text:
                        relay_messages.append({
                            "direction": "outbound",
                            "ts": ts,
                            "text": text[:500],
                        })

            # Tool results — check for errors
            elif block_type == "tool_result":
                result_content = block.get("content", "")
                if isinstance(result_content, str) and any(
                    kw in result_content.lower()
                    for kw in ["error", "failed", "exception", "traceback"]
                ):
                    errors_in_results.append({
                        "ts": ts,
                        "snippet": result_content[:300],
                    })

            # Text blocks — capture conversation
            elif block_type == "text":
                text = block.get("text", "").strip()
                if not text:
                    continue
                if role == "user":
                    # Filter out system/skill prompts
                    if text.startswith("Base directory for this skill"):
                        continue
                    conversation.append({
                        "role": "user",
                        "ts": ts,
                        "text": text[:500],
                    })
                    # Inbound relay messages (from delegator/user via vmux send)
                    if "[Delegator" in text or "[Scheduler]" in text:
                        relay_messages.append({
                            "direction": "inbound",
                            "ts": ts,
                            "text": text[:500],
                        })
                elif role == "assistant":
                    conversation.append({
                        "role": "assistant",
                        "ts": ts,
                        "text": text[:500],
                    })

    # Calculate standby ratio
    total = sum(tool_calls.values())
    standby_ratio = standby_count / total if total > 0 else 0

    # Seconds since last productive action
    seconds_since_productive = None
    if last_productive_ts:
        try:
            lpt = datetime.fromisoformat(last_productive_ts.replace("Z", "+00:00"))
            if lpt.tzinfo is None:
                lpt = lpt.replace(tzinfo=timezone.utc)
            seconds_since_productive = int(
                (datetime.now(timezone.utc) - lpt).total_seconds()
            )
        except (ValueError, TypeError):
            pass

    return {
        "total_entries_scanned": len(entries),
        "tool_call_histogram": dict(tool_calls.most_common(20)),
        "last_10_tool_calls": last_10_tools,
        "seconds_since_last_productive_action": seconds_since_productive,
        "errors_in_tool_results": errors_in_results[-5:],
        "standby_ratio": round(standby_ratio, 3),
        "conversation": conversation[-20:],
        "relay_messages": relay_messages[-10:],
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Summarize worker transcript for delegator pipeline"
    )
    parser.add_argument("worktree_path", help="Path to the worker's worktree")
    parser.add_argument(
        "--lines", type=int, default=100, help="Number of recent lines to analyze"
    )
    args = parser.parse_args()

    transcript = find_transcript(args.worktree_path)
    if not transcript:
        # Output empty summary rather than failing
        print(json.dumps({"error": f"No transcript found for {args.worktree_path}"}))
        sys.exit(0)

    entries = read_tail(transcript, args.lines)
    summary = summarize_for_delegator(entries, args.lines)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
