#!/usr/bin/env python3
"""
Pre-seed the user behavioral profile from existing Claude session transcripts.

Scans JSONL session files in ~/.claude/projects/, extracts user messages,
and generates a structured profile at ~/.claude/orchestrator/profile.md.

Usage:
    python3 scripts/preseed-profile.py [--max-sessions N] [--dry-run]
"""

import json
import os
import sys
import re
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime


def find_session_files(projects_dir: Path, max_files: int = 50) -> list[Path]:
    """Find the most recent JSONL session files, prioritizing larger ones."""
    files = []
    for jsonl in projects_dir.rglob("*.jsonl"):
        try:
            stat = jsonl.stat()
            if stat.st_size > 50_000:  # Skip tiny sessions
                files.append((jsonl, stat.st_mtime, stat.st_size))
        except OSError:
            continue

    # Sort by recency, then size
    files.sort(key=lambda x: (x[1], x[2]), reverse=True)
    return [f[0] for f in files[:max_files]]


SKIP_PREFIXES = [
    "Base directory for this skill",
    "<command",
    "local-command",
    "task-notification",
    "[Request",
    "This session is being continued",
    "<system",
    "Async agent",
    "Shell cwd",
    "MCP error",
    "Continue from where you left off",
]


def _is_genuine_message(text: str) -> bool:
    """Check if a text is a genuine user message (not system-generated)."""
    text = text.strip()
    if len(text) < 15:
        return False
    for prefix in SKIP_PREFIXES:
        if text.startswith(prefix):
            return False
    return True


def _extract_voice_text(raw: str) -> str | None:
    """Extract the voice message text from a relay result."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            result = parsed.get("result", "")
            m = re.match(r"\[Voice from [^\]]+\]:\s*(.*)", result, re.DOTALL)
            if m:
                return m.group(1).strip()
    except (json.JSONDecodeError, TypeError):
        pass
    # Try direct pattern match on raw string
    m = re.match(r"\[Voice from [^\]]+\]:\s*(.*)", raw, re.DOTALL)
    if m:
        return m.group(1).strip()
    return None


def extract_user_messages(session_file: Path) -> list[dict]:
    """Extract user messages from a JSONL session transcript.

    Handles both direct typed messages and voice relay messages
    embedded in tool_result parts.
    """
    messages = []
    project = session_file.parent.name

    try:
        with open(session_file, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if entry.get("type") != "user":
                    continue

                content = entry.get("message", {}).get("content", "")
                texts = []

                if isinstance(content, str):
                    if _is_genuine_message(content):
                        texts.append(content.strip())

                elif isinstance(content, list):
                    for part in content:
                        if not isinstance(part, dict):
                            continue

                        ptype = part.get("type", "")

                        # Direct text content
                        if ptype == "text":
                            text = part.get("text", "")
                            if _is_genuine_message(text):
                                texts.append(text.strip())

                        # Tool result (may contain voice messages)
                        elif ptype == "tool_result":
                            inner = part.get("content", "")
                            if isinstance(inner, str):
                                voice = _extract_voice_text(inner)
                                if voice and len(voice) > 10:
                                    texts.append(voice)
                            elif isinstance(inner, list):
                                for ipart in inner:
                                    if isinstance(ipart, dict) and ipart.get("type") == "text":
                                        t = ipart.get("text", "")
                                        voice = _extract_voice_text(t)
                                        if voice and len(voice) > 10:
                                            texts.append(voice)

                for text in texts:
                    messages.append(
                        {
                            "text": text,
                            "file": str(session_file),
                            "project": project,
                        }
                    )

    except (OSError, UnicodeDecodeError):
        pass

    return messages


def extract_project_domain(project_name: str) -> str:
    """Infer the project domain from the session directory name."""
    name = project_name.lower()
    # Domain keywords are configurable — check environment or use generic detection
    design_keywords = os.environ.get("ORCHESTRATOR_DESIGN_KEYWORDS", "design-system,design,ui-kit").split(",")
    if any(kw.strip() in name for kw in design_keywords):
        return "design-system"
    if "react-18" in name or "bootstrap" in name:
        return "react-migration"
    if "voice-multiplexer" in name or "vmux" in name:
        return "voice-tooling"
    if "orchestrator" in name:
        return "orchestrator"
    if "main-project" in name:
        return "main-project"
    return "general"


def categorize_messages(messages: list[dict]) -> dict:
    """Categorize user messages into profile-relevant buckets."""

    categories = {
        "review_feedback": [],
        "quality_concerns": [],
        "style_preferences": [],
        "communication_patterns": [],
        "domain_concerns": defaultdict(list),
        "invariants": [],
        "delegation_patterns": [],
    }

    # Patterns for categorization
    review_patterns = re.compile(
        r"(review|pr |pull request|approve|changes requested|lgtm|looks good|nit|suggestion|issue with)",
        re.I,
    )
    quality_patterns = re.compile(
        r"(test|type.?safe|accessi|a11y|performance|security|error handling|edge case|validation)",
        re.I,
    )
    style_patterns = re.compile(
        r"(naming|convention|pattern|style|format|indent|import|export|prefer|always use|never use|don\'t use)",
        re.I,
    )
    delegation_patterns = re.compile(
        r"(go ahead|continue|keep going|do it|just .* it|approved?|yes|proceed|ship it|make it happen|crush)",
        re.I,
    )
    concern_patterns = re.compile(
        r"(careful|watch out|make sure|don\'t forget|important|critical|never|always|must)",
        re.I,
    )

    for msg in messages:
        text = msg["text"]
        domain = extract_project_domain(msg["project"])

        # Short messages often reveal communication style
        if len(text) < 100:
            categories["communication_patterns"].append(text)

        if review_patterns.search(text):
            categories["review_feedback"].append(text)
        if quality_patterns.search(text):
            categories["quality_concerns"].append(text)
        if style_patterns.search(text):
            categories["style_preferences"].append(text)
        if delegation_patterns.search(text):
            categories["delegation_patterns"].append(text)
        if concern_patterns.search(text):
            categories["invariants"].append(text)

        # Domain-specific messages
        if domain != "general":
            categories["domain_concerns"][domain].append(text)

    return categories


def analyze_communication_style(patterns: list[str]) -> list[str]:
    """Analyze short messages to determine communication style."""
    insights = []

    # Check for brevity
    avg_len = sum(len(p) for p in patterns) / max(len(patterns), 1)
    if avg_len < 50:
        insights.append("Tends toward brief, directive communication")
    elif avg_len < 150:
        insights.append("Uses moderate-length messages with clear intent")
    else:
        insights.append("Provides detailed context and explanations")

    # Check for delegation comfort
    delegation_words = sum(
        1
        for p in patterns
        if re.search(r"(go ahead|continue|keep going|just do|proceed)", p, re.I)
    )
    total = max(len(patterns), 1)
    if delegation_words / total > 0.15:
        insights.append(
            "Comfortable delegating — frequently says 'go ahead', 'continue', 'just do it'"
        )

    # Check for question-asking style
    questions = sum(1 for p in patterns if "?" in p)
    if questions / total > 0.3:
        insights.append("Asks many clarifying questions before proceeding")
    elif questions / total > 0.1:
        insights.append("Asks targeted questions when needed")

    # Check for voice input patterns
    voice_indicators = sum(
        1
        for p in patterns
        if re.search(
            r"(okay|alright|um|uh|yeah|yep|nope|hey|hmm|so basically)", p, re.I
        )
    )
    if voice_indicators / total > 0.1:
        insights.append(
            "Often communicates via voice (informal, conversational tone)"
        )

    return insights


def extract_quality_priorities(concerns: list[str]) -> list[str]:
    """Identify quality priorities from quality-related messages."""
    priorities = Counter()

    keyword_groups = {
        "Type safety": ["type", "typescript", "typed", "type-safe", "any"],
        "Test coverage": ["test", "spec", "coverage", "jest", "rtl"],
        "Accessibility": ["a11y", "accessibility", "aria", "screen reader"],
        "Performance": ["performance", "render", "memo", "lazy", "bundle"],
        "Error handling": ["error", "catch", "try", "fallback", "boundary"],
        "Code style": [
            "naming",
            "convention",
            "consistent",
            "pattern",
            "clean",
        ],
        "Component architecture": [
            "component",
            "prop",
            "composition",
            "reusable",
            "abstraction",
        ],
        "Design system compliance": [
            "design system",
            "token",
            "figma",
            "component library",
        ],
        "CSS/Styling": ["css", "scss", "style", "layout", "responsive"],
    }

    for msg in concerns:
        msg_lower = msg.lower()
        for category, keywords in keyword_groups.items():
            if any(kw in msg_lower for kw in keywords):
                priorities[category] += 1

    return [
        f"{cat} (mentioned {count} times)"
        for cat, count in priorities.most_common(10)
        if count >= 2
    ]


def extract_review_patterns(feedback: list[str]) -> list[str]:
    """Extract common review patterns from review-related messages."""
    patterns = []

    # Look for recurring themes
    if any(
        re.search(r"conventional comment", f, re.I) for f in feedback
    ):
        patterns.append("Uses Conventional Comments standard for PR reviews")

    if any(re.search(r"(blame.?free|kind|deferential)", f, re.I) for f in feedback):
        patterns.append("Prefers kind, blame-free review tone")

    approval_msgs = [f for f in feedback if re.search(r"(approv|lgtm|looks good)", f, re.I)]
    if approval_msgs:
        patterns.append(
            f"Gives explicit approval when satisfied (found {len(approval_msgs)} approval messages)"
        )

    nit_msgs = [f for f in feedback if re.search(r"(nit|minor|small thing)", f, re.I)]
    if nit_msgs:
        patterns.append(
            f"Flags nitpicks when relevant ({len(nit_msgs)} nit-level comments found)"
        )

    return patterns


def extract_invariants(messages: list[str]) -> list[str]:
    """Extract things the user always checks or insists on."""
    invariants = []

    always_patterns = [
        (r"never run all tests", "Never run all tests at once — always target specific files"),
        (r"never.+push.+force", "Never force-push without explicit permission"),
        (r"never.+delete.+branch", "Never delete branches unless explicitly told to"),
        (r"always.+ask.+before.+push", "Always ask before pushing to remote"),
        (r"don't.+commit.*co-authored", "Never include co-authored-by annotations"),
        (r"always.+visual.*(verify|validate|check)", "Always visually verify UI changes with Playwright"),
        (r"small.*commit|focused.*commit", "Prefers small, focused commits"),
    ]

    combined = " ".join(messages).lower()
    for pattern, invariant in always_patterns:
        if re.search(pattern, combined, re.I):
            invariants.append(invariant)

    return invariants


def extract_domain_concerns(domain_msgs: dict) -> dict[str, list[str]]:
    """Extract domain-specific concerns."""
    concerns = {}
    for domain, messages in domain_msgs.items():
        domain_insights = []
        combined = " ".join(messages).lower()

        if domain == "design-system":
            if "figma" in combined:
                domain_insights.append("Cross-references Figma designs for parity")
            if "token" in combined:
                domain_insights.append("Cares about design token usage over hardcoded values")
            if "audit" in combined:
                domain_insights.append("Runs component audits against design specs")

        elif domain == "react-migration":
            if "enzyme" in combined or "rtl" in combined:
                domain_insights.append("Focuses on Enzyme to RTL test migration")
            if "bootstrap" in combined:
                domain_insights.append("Working on Bootstrap elimination/replacement")

        elif domain == "voice-tooling":
            if "relay" in combined:
                domain_insights.append("Cares about relay server reliability and reconnection")
            if "daemon" in combined or "launchd" in combined:
                domain_insights.append("Values robust daemon lifecycle management")

        if messages:
            domain_insights.append(f"({len(messages)} interactions analyzed)")

        if domain_insights:
            concerns[domain] = domain_insights

    return concerns


def generate_profile(
    categories: dict,
    session_count: int,
    message_count: int,
) -> str:
    """Generate the profile markdown document."""

    comm_style = analyze_communication_style(categories["communication_patterns"])
    quality_priorities = extract_quality_priorities(categories["quality_concerns"])
    review_patterns = extract_review_patterns(categories["review_feedback"])
    invariants = extract_invariants(categories["invariants"])
    domain_concerns = extract_domain_concerns(categories["domain_concerns"])

    lines = [
        "# User Profile",
        "",
        f"> Auto-generated by profile pre-seeder on {datetime.now().strftime('%Y-%m-%d')}",
        f"> Based on {session_count} session transcripts ({message_count} user messages analyzed)",
        "> This file can be manually edited to correct or refine the profile.",
        "",
        "## Communication Style",
        "",
    ]

    if comm_style:
        for insight in comm_style:
            lines.append(f"- {insight}")
    else:
        lines.append("- (Insufficient data to determine communication style)")

    lines.extend(["", "## Quality Priorities", ""])
    if quality_priorities:
        for p in quality_priorities:
            lines.append(f"- {p}")
    else:
        lines.append("- (Insufficient data to determine quality priorities)")

    lines.extend(["", "## Common Review Patterns", ""])
    if review_patterns:
        for p in review_patterns:
            lines.append(f"- {p}")
    else:
        lines.append("- (Insufficient review data)")

    lines.extend(["", "## Domain-Specific Concerns", ""])
    if domain_concerns:
        for domain, insights in domain_concerns.items():
            lines.append(f"### {domain.replace('-', ' ').title()}")
            for insight in insights:
                lines.append(f"- {insight}")
            lines.append("")
    else:
        lines.append("- (No domain-specific patterns detected)")

    lines.extend(["", "## Things Always Checked", ""])
    if invariants:
        for inv in invariants:
            lines.append(f"- {inv}")
    else:
        lines.append("- (No strong invariants detected yet)")

    lines.extend(
        [
            "",
            "## Things Rarely Flagged",
            "",
            "- (Will be populated as the training system observes more interactions)",
            "",
            "## Interaction Examples",
            "",
            "- (Representative exchanges will be added by the training agent)",
            "",
        ]
    )

    return "\n".join(lines)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Pre-seed user profile from Claude sessions")
    parser.add_argument("--max-sessions", type=int, default=50, help="Max sessions to scan")
    parser.add_argument("--dry-run", action="store_true", help="Print profile without writing")
    args = parser.parse_args()

    projects_dir = Path.home() / ".claude" / "projects"
    profile_path = Path.home() / ".claude" / "orchestrator" / "profile.md"

    if not projects_dir.exists():
        print(f"Error: {projects_dir} not found", file=sys.stderr)
        sys.exit(1)

    print(f"Scanning session transcripts in {projects_dir}...")
    session_files = find_session_files(projects_dir, max_files=args.max_sessions)
    print(f"Found {len(session_files)} session files to analyze")

    all_messages = []
    for i, sf in enumerate(session_files):
        if (i + 1) % 10 == 0:
            print(f"  Processing {i + 1}/{len(session_files)}...")
        messages = extract_user_messages(sf)
        all_messages.extend(messages)

    print(f"Extracted {len(all_messages)} user messages")

    if not all_messages:
        print("No user messages found — cannot generate profile", file=sys.stderr)
        sys.exit(1)

    categories = categorize_messages(all_messages)
    profile = generate_profile(categories, len(session_files), len(all_messages))

    # Validate profile has expected structure
    required_sections = ["Communication Style", "Quality Priorities", "Things Always Checked"]
    missing = [s for s in required_sections if f"## {s}" not in profile]
    if missing:
        print(f"Warning: Generated profile missing sections: {', '.join(missing)}", file=sys.stderr)

    if args.dry_run:
        print("\n--- PROFILE (dry run) ---\n")
        print(profile)
    else:
        profile_path.parent.mkdir(parents=True, exist_ok=True)
        profile_path.write_text(profile)
        print(f"\nProfile written to {profile_path}")
        print(f"  Sections: {len([l for l in profile.split(chr(10)) if l.startswith('## ')])}")
        print(f"  Lines: {len(profile.split(chr(10)))}")
        print("Review and edit the profile to correct any inaccuracies.")


if __name__ == "__main__":
    main()
