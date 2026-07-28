---
description: Inspect the configured work sources and poll them on demand
user_invocable: true
---

# Work Discovery

The scheduler polls every enabled adapter in `config/sources.json` on its own
interval (`discovery.interval` in `config/environment.yml`), so discovery normally
needs no manual step. Use this skill to inspect adapters or force a poll.

## Show the configured adapters

```bash
cd ~/orchestrator/scripts && python3 -m lib.sources get
```

Each adapter reports a `problems` array. A non-empty array means the adapter is
misconfigured and will be skipped at poll time.

## Preview what an adapter would import

```bash
python3 ~/orchestrator/scripts/discover-work.py --dry-run --source <adapter-name>
```

## Poll now instead of waiting for the scheduler

```bash
python3 ~/orchestrator/scripts/discover-work.py
```

Report which items were added, then stop. Imported items arrive as `queued` with
no plan, so the scheduler generates a plan from the issue body and discussion and
leaves it unapproved. Approval and activation stay a human decision.

## Change what gets imported

Adapter configuration lives in the dashboard's Work Sources panel. Editing
`config/sources.json` by hand works too; the scheduler rereads it each cycle.
