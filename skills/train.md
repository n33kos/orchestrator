---
description: Train the delegator profile from recent session interactions
user_invocable: true
---

# Train Profile

Update the delegator's behavioral profile by analyzing recent user-worker interactions.

## Preseed (First Time)

If the profile doesn't exist yet, bootstrap it from existing Claude session transcripts:

```bash
python3 ~/orchestrator/scripts/preseed-profile.py
```

This scans all available session files at `~/.claude/projects/*/` and generates an initial profile.

## Incremental Training

After interactions, run the training script on the most recent session transcript:

```bash
# Find the most recent session transcript
LATEST=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1)
python3 ~/orchestrator/scripts/train-profile.py "$LATEST" --last-n 30
```

This:
1. Reads the last N user messages from the transcript
2. Identifies quality concerns, preferences, and patterns
3. Deduplicates against the existing profile
4. Appends new insights to the profile

## Viewing the Profile

```bash
cat ~/.claude/orchestrator/profile.md
```

The user can also edit the profile directly at any time.

## What Gets Learned

- Quality priorities (test coverage, type safety, accessibility, etc.)
- Explicit preferences ("always use...", "never do...", "prefer X over Y")
- Communication style patterns
- Domain-specific concerns consistently flagged
