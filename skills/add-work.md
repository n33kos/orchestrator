---
description: Add a new work item to the orchestrator queue
user_invocable: true
---

# Add Work Item

Add a work item to the queue. Ask the user for anything below that was not provided.

1. **Title** — Short description of the work
2. **Priority** — 1 (critical) to 5 (low), default 3
3. **Branch name** — Git branch for this work, required before it can activate
4. **Commit strategy** — `branch_and_pr` (default), `graphite_stack`, or `commit_to_main`
5. **Repo key** — Repository key from `config/environment.yml`, e.g. `babylist-web`. The
   item inherits that repo's path, worktree settings, and commit strategy.

There is no description field on a work item. All ticket content lives in the plan
file, which is the single source of truth.

## Add the item

Run `scripts/add-work.py` with the collected values:

```bash
python3 ~/orchestrator/scripts/add-work.py \
  --title "<TITLE>" \
  --priority <PRIORITY> \
  --repo-key <REPO_KEY> \
  --branch "<BRANCH>" \
  --commit-strategy <COMMIT_STRATEGY>
```

Further options: `--repo-path` to override the repo key's path, `--plan-file` to point
at an existing plan, `--blocked-by` for a comma-separated list of item ids that must
complete first, `--no-worktree`, and `--no-delegator`.

The script allocates the id from the shared counter, fills in delegator directive
state, and writes through the locking, schema-validating queue helper, so a malformed
item cannot be persisted. It prints the new id as JSON.

## Write the plan

Items are created in `planning` status with no plan. Write the plan next using
`/plan`, which is what promotes the item to `queued`. Plans are interactive HTML by
default at `~/.claude/orchestrator/plans/<item-id>.html`; use `.md` only when the
user asks for markdown.

## Verify

Run `scripts/verify-ticket.sh <item-id>`. Every check must pass before reporting the
ticket as queued. Report the assigned id and its priority position.
