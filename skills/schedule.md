---
description: Run the queue scheduler to auto-activate ready items
user_invocable: true
---

# Run Scheduler

Run the queue scheduler to check for available concurrency slots and auto-activate the highest priority ready items.

## Process

1. First, do a dry run to preview:

```bash
bash ~/orchestrator/scripts/scheduler.sh --once --dry-run
```

2. Show the user what would be activated
3. If they confirm, run for real:

```bash
bash ~/orchestrator/scripts/scheduler.sh --once
```

## Auto-Activation Requirements

For an item to be auto-activated, it must:
- Be in `queued` or `planning` status
- Have a branch name configured
- Have no unresolved blockers
- Projects must have an approved plan (if a plan exists)
- There must be available concurrency slots (projects only — quick fixes bypass limits)

## Configuration

Auto-activation is controlled by `autonomy.auto_activate` in `config/environment.yml`.
Currently set to: `false` (manual activation only by default).

To enable continuous scheduling, run without `--once`:
```bash
bash ~/orchestrator/scripts/scheduler.sh
```
This polls every 120 seconds and activates items as slots become available.
