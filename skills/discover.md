---
description: Discover new work items from configured sources (GitHub Issues, markdown plans)
user_invocable: true
---

# Discover Work

Run work discovery to find new items from configured sources (GitHub Issues, markdown plan files).

## Process

1. Run discovery in dry-run mode first to preview:

```bash
python3 ~/orchestrator/scripts/discover-work.py --dry-run
```

2. Show the user what was found: new items, their inferred types and priorities
3. Ask if they want to add the discovered items
4. If yes, run without dry-run:

```bash
python3 ~/orchestrator/scripts/discover-work.py
```

5. Report what was added to the queue

## Options

- `--source NAME` — Only poll a specific source (e.g., `--source github-issues`)
- `--dry-run` — Preview without adding

## Sources

Sources are configured in `~/orchestrator/config/sources.yml`. Current sources:
- **markdown** — Parse markdown plan files for task items
- **github** — Poll GitHub Issues assigned to you with optional label filters
