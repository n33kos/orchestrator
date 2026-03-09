---
description: Generate or manage an implementation plan for a work item
user_invocable: true
---

# Generate Plan

Generate an implementation plan for a queued or planning-status work item.

## Process

1. If no item ID is provided, show the queue with `bash ~/orchestrator/scripts/status.sh` and ask which item to plan
2. Generate the plan:

```bash
bash ~/orchestrator/scripts/generate-plan.sh <item-id>
```

Options:
- Add `--auto-approve` to auto-approve the plan after generation

3. Report the plan summary and steps to the user
4. Ask if they want to:
   - **Approve** the plan as-is (update via `/api/queue/update` with `plan.approved: true`)
   - **Edit** specific steps before approving
   - **Regenerate** with different guidance
   - **Skip planning** and go straight to activation (quick fixes only)

## Important
- Plans are generated using `claude --print --model haiku` for speed
- The item must be in `queued` or `planning` status
- Projects require an approved plan before activation; quick fixes can skip planning
- Plans are stored in the `plan` sub-object on the queue item (`plan.file`, `plan.summary`, `plan.approved`, `plan.approved_at`)
