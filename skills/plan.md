---
description: Generate or manage an implementation plan for a work item
user_invocable: true
---

# Generate Plan

Generate an implementation plan for a queued or planning-status work item.

## Default plan format — interactive HTML

**All new plans are written as self-contained interactive HTML files using the `plan-html` skill (`~/.claude/skills/plan-html/`).** Plans live at `~/.claude/orchestrator/plans/<item-id>.html` (NOT the skill's default `~/Desktop/plans/` — orchestrator's centralized plans dir).

The HTML format gives each plan:
- Persistent checkbox task state per step (localStorage-backed when viewed in a browser)
- Collapsible sections with per-section progress bars
- Inline SVG charts for dependency graphs / risk matrices / timelines when useful
- Auto-reload every 5 minutes so workers and reviewers see updates without manual refresh
- Embedded design system — fully offline-portable, no external dependencies

Only fall back to markdown if the user explicitly asks for it (e.g., "make a markdown plan", "write it as .md").

## Process

1. If no item ID is provided, show the queue with `bash ~/orchestrator/scripts/status.sh` and ask which item to plan.

2. Invoke the `plan-html` skill to author the plan. Pass the canonical path:
   - Output file: `~/.claude/orchestrator/plans/<item-id>.html`
   - Title: the item's `title` field
   - Slug: `<item-id>` (used as localStorage namespace)
   - Status: `draft` initially; flips to `in-progress` once activated
   - Always include the **Steps** master-progress section if the work has more than one phase
   - Always include the **Linked work** section for tickets / PRs / Slack threads the plan references
   - Always include a final **Sticking points** section calling out edge cases the worker needs to resolve

3. Update the queue item's `plan.file` to point at the new HTML path and `plan.summary` to a one-paragraph summary.

4. Report the plan summary and step titles to the user. Offer to open the HTML file (`open <path>`).

5. Ask if they want to:
   - **Approve** the plan as-is (update via `/api/queue/update` with `plan.approved: true`)
   - **Edit** specific steps before approving
   - **Regenerate** with different guidance
   - **Skip planning** and go straight to activation (quick fixes only)

## Legacy auto-generation (markdown — deprecated)

The old auto-gen path `bash ~/orchestrator/scripts/generate-plan.sh <item-id>` produces markdown. It still runs from the scheduler for items in `planning` status, but is being phased out. New plans authored manually should always use HTML via `plan-html`.

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
