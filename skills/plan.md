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

## Plan File Format

Plan files should include the following sections:

1. **Context** — Jira/source reference, component paths, Figma IDs, branch, repo
2. **Steps** — Ordered implementation steps with explicit instructions
3. **Acceptance Criteria** — Structured, verifiable criteria organized by domain:
   - **Functional** — What the code must do (testable assertions)
   - **Visual** — What it must look like (Figma node IDs, pixel tolerances, specific CSS values)
   - **Behavioral** — How it must respond to interaction (click, hover, keyboard, state transitions)
   - **Accessibility** — WCAG requirements, keyboard nav, ARIA, contrast ratios
   - **Performance** — Bundle size, render time, or other measurable thresholds (if applicable)

Write acceptance criteria as **machine-verifiable statements** where possible. Instead of "button should look correct," write "button has 12px padding, $color-grey-900 text, 44px height on mobile." The more precise the criteria, the higher confidence automated review (via Council) can achieve.

## Important
- Plans are generated using `claude --print --model haiku` for speed
- The item must be in `queued` or `planning` status
- Projects require an approved plan before activation; quick fixes can skip planning
- Plans are stored in the `plan` sub-object on the queue item (`plan.file`, `plan.summary`, `plan.approved`, `plan.approved_at`)
