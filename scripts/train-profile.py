#!/usr/bin/env python3
"""
Training hook: incrementally update the user profile from a recent interaction.

This is designed to be called after voice relay exchanges or session interactions.
It reads the latest messages from a specific session transcript and updates the
profile with any new patterns observed.

Usage:
    python3 scripts/train-profile.py <session-jsonl-path> [--last-n N]
"""

import json
import re
import sys
from pathlib import Path
from datetime import datetime


def load_profile(profile_path: Path) -> str:
    """Load the existing profile."""
    if profile_path.exists():
        return profile_path.read_text()
    return ""


def extract_recent_user_messages(session_path: Path, last_n: int = 20) -> list[str]:
    """Extract the N most recent user messages from a session transcript."""
    messages = []

    with open(session_path) as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            if entry.get("type") != "user":
                continue

            content = entry.get("message", {}).get("content", "")
            texts = []

            if isinstance(content, str):
                texts.append(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") == "text":
                            texts.append(part.get("text", ""))
                        elif part.get("type") == "tool_result":
                            inner = part.get("content", "")
                            if isinstance(inner, str):
                                # Extract voice messages
                                m = re.search(r"\[Voice from [^\]]+\]:\s*(.*)", inner, re.DOTALL)
                                if m:
                                    texts.append(m.group(1).strip())
                                else:
                                    try:
                                        parsed = json.loads(inner)
                                        if isinstance(parsed, dict) and "result" in parsed:
                                            vm = re.search(
                                                r"\[Voice from [^\]]+\]:\s*(.*)",
                                                parsed["result"],
                                                re.DOTALL,
                                            )
                                            if vm:
                                                texts.append(vm.group(1).strip())
                                    except json.JSONDecodeError:
                                        pass

            for text in texts:
                # Skip system messages
                skip = [
                    "Base directory",
                    "<command",
                    "local-command",
                    "task-notification",
                    "[Request",
                    "This session is being continued",
                    "<system",
                    "Continue from where you left off",
                ]
                if any(text.startswith(p) for p in skip):
                    continue
                if len(text.strip()) > 10:
                    messages.append(text.strip())

    # Return only the most recent N messages
    return messages[-last_n:]


def find_new_insights(messages: list[str], existing_profile: str) -> list[str]:
    """Identify new insights from messages that aren't already in the profile."""
    insights = []
    existing_lower = existing_profile.lower()

    # Quality concern patterns
    quality_keywords = {
        "test": "Cares about test coverage",
        "type safety": "Values type safety",
        "accessibility": "Prioritizes accessibility",
        "performance": "Watches for performance issues",
        "error handling": "Expects robust error handling",
    }

    for msg in messages:
        msg_lower = msg.lower()

        # Check for quality concerns mentioned in natural speech
        for keyword, insight in quality_keywords.items():
            if keyword in msg_lower and insight.lower() not in existing_lower:
                insights.append(insight)

        # Check for explicit preferences
        pref_patterns = [
            (r"always (use|do|check|make sure|include) (.+)", "Always: {}"),
            (r"never (use|do|run|skip|delete) (.+)", "Never: {}"),
            (r"prefer (\w+ .+?) (over|instead|rather)", "Prefers: {}"),
            (r"don't (like|want|use) (.+)", "Avoids: {}"),
        ]

        for pattern, template in pref_patterns:
            m = re.search(pattern, msg_lower)
            if m:
                pref = m.group(2).strip()[:80]
                formatted = template.format(pref)
                if formatted.lower() not in existing_lower:
                    insights.append(formatted)

    # Deduplicate
    seen = set()
    unique = []
    for insight in insights:
        if insight.lower() not in seen:
            seen.add(insight.lower())
            unique.append(insight)

    return unique


def update_profile(profile_path: Path, new_insights: list[str]) -> bool:
    """Append new insights to the appropriate profile sections."""
    if not new_insights:
        return False

    content = profile_path.read_text()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Find the "Things Always Checked" section and append before "Things Rarely Flagged"
    # For now, append to a training log section
    if "## Training Log" not in content:
        content += "\n## Training Log\n\n"

    for insight in new_insights:
        content += f"- [{timestamp}] {insight}\n"

    profile_path.write_text(content)
    return True


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Update profile from recent interaction")
    parser.add_argument("session_path", type=str, help="Path to JSONL session transcript")
    parser.add_argument("--last-n", type=int, default=20, help="Number of recent messages to analyze")
    args = parser.parse_args()

    session_path = Path(args.session_path)
    if not session_path.exists():
        print(f"Error: {session_path} not found", file=sys.stderr)
        sys.exit(1)

    profile_path = Path.home() / ".claude" / "orchestrator" / "profile.md"
    if not profile_path.exists():
        print(f"Error: Profile not found at {profile_path}", file=sys.stderr)
        print("Run: python3 scripts/preseed-profile.py", file=sys.stderr)
        sys.exit(1)

    print(f"Analyzing recent messages in {session_path.name}...")
    messages = extract_recent_user_messages(session_path, args.last_n)
    print(f"  Found {len(messages)} recent user messages")

    if not messages:
        print("  No new messages to analyze")
        return

    existing_profile = load_profile(profile_path)
    new_insights = find_new_insights(messages, existing_profile)

    if new_insights:
        print(f"  New insights found: {len(new_insights)}")
        for insight in new_insights:
            print(f"    + {insight}")
        update_profile(profile_path, new_insights)
        print(f"  Profile updated at {profile_path}")
    else:
        print("  No new insights — profile already up to date")


if __name__ == "__main__":
    main()
