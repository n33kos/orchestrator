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


def categorize_insight(insight: str) -> str:
    """Determine which profile section an insight belongs to."""
    lower = insight.lower()
    if lower.startswith("always:") or lower.startswith("never:"):
        return "## Invariants"
    if lower.startswith("prefers:") or lower.startswith("avoids:"):
        return "## Style Preferences"
    if any(k in lower for k in ["test", "type safety", "accessibility", "performance", "error handling", "security"]):
        return "## Quality Priorities"
    if any(k in lower for k in ["review", "pr ", "pull request", "code review"]):
        return "## Review Patterns"
    if any(k in lower for k in ["delegate", "hand off", "worker", "session"]):
        return "## Delegation Patterns"
    return "## Training Log"


def update_profile(profile_path: Path, new_insights: list[str]) -> bool:
    """Append new insights to the appropriate profile sections."""
    if not new_insights:
        return False

    content = profile_path.read_text()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # Group insights by target section
    by_section: dict[str, list[str]] = {}
    for insight in new_insights:
        section = categorize_insight(insight)
        by_section.setdefault(section, []).append(insight)

    for section, insights in by_section.items():
        if section in content:
            # Find the section and append before the next ## heading
            lines = content.split("\n")
            insert_idx = None
            in_section = False
            for i, line in enumerate(lines):
                if line.strip() == section:
                    in_section = True
                    continue
                if in_section:
                    if line.startswith("## "):
                        insert_idx = i
                        break
            if insert_idx is None and in_section:
                insert_idx = len(lines)
            if insert_idx is not None:
                new_lines = [f"- [{timestamp}] {ins}" for ins in insights]
                lines = lines[:insert_idx] + new_lines + [""] + lines[insert_idx:]
                content = "\n".join(lines)
            else:
                # Section header not found properly, append at end
                content += f"\n{section}\n\n"
                for ins in insights:
                    content += f"- [{timestamp}] {ins}\n"
        else:
            # Section doesn't exist yet, create it
            content += f"\n{section}\n\n"
            for ins in insights:
                content += f"- [{timestamp}] {ins}\n"

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
