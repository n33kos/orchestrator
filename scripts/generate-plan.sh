#!/usr/bin/env bash
# Generate an implementation plan for a queued work item using Claude.
#
# Usage:
#   ./scripts/generate-plan.sh <item-id> [--auto-approve]
#
# Generates a markdown plan file in the configured plans directory and stores a
# reference in the queue item's metadata. A completed plan moves the item out of
# "planning" and into "queued", where it awaits approval.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
REPO_PATH="$CONFIG_REPO_PATH"
REPOSITORIES_JSON="$CONFIG_REPOSITORIES_JSON"
PLANS_DIR="${CONFIG_ARTIFACTS_DIR:-$HOME/.claude/orchestrator/plans}"
QUEUE_PY="python3 -m lib.queue"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

ITEM_ID="${1:?Usage: generate-plan.sh <item-id> [--auto-approve]}"
shift || true

AUTO_APPROVE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto-approve) AUTO_APPROVE=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# Ensure plans directory exists
mkdir -p "$PLANS_DIR"

# Read item from queue and validate status
ITEM_STATUS="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" status)"
if [[ "$ITEM_STATUS" != "queued" && "$ITEM_STATUS" != "planning" ]]; then
    echo "ERROR: Item $ITEM_ID is '$ITEM_STATUS', expected queued or planning" >&2
    exit 1
fi

# Check if a plan file already exists — don't overwrite manually created plans
EXISTING_PLAN="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" plan.file 2>/dev/null)" || true
if [[ -n "$EXISTING_PLAN" && "$EXISTING_PLAN" != "None" ]]; then
    # Resolve relative paths against plans dir
    if [[ "$EXISTING_PLAN" != /* && "$EXISTING_PLAN" != ~* ]]; then
        EXISTING_PLAN="$PLANS_DIR/$EXISTING_PLAN"
    else
        EXISTING_PLAN="${EXISTING_PLAN/#\~/$HOME}"
    fi
    if [[ -f "$EXISTING_PLAN" && -s "$EXISTING_PLAN" ]]; then
        echo "Plan file already exists for $ITEM_ID: $EXISTING_PLAN"
        echo "Skipping generation — use --force to overwrite."
        # Still finalize. A hand-written plan needs the same preparation and the same
        # readiness gate, otherwise an item can reach queued without being activatable.
        python3 "$SCRIPT_DIR/finalize-plan.py" "$ITEM_ID"
        exit 0
    fi
fi

# Extract fields in a single call
IFS=$'\x1f' read -r ITEM_TITLE ITEM_BRANCH ENV_REPO REPO_KEY \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" title environment.branch environment.repo repo_key)
ENV_REPO="$(echo "$ENV_REPO" | sed "s|~|$HOME|")"

# Determine the target repo. An explicit environment.repo wins, then repo_key's
# configured path, then the _defaults path.
TARGET_REPO=""
if [[ -n "$ENV_REPO" && "$ENV_REPO" != "None" ]]; then
    TARGET_REPO="$ENV_REPO"
elif [[ -n "$REPO_KEY" && "$REPO_KEY" != "None" ]]; then
    TARGET_REPO="$(python3 -c "
import json, os, sys
repos = json.loads(sys.argv[1])
repo = repos.get(sys.argv[2]) or repos.get('_defaults', {})
print(os.path.expanduser(repo.get('path', '')))
" "$REPOSITORIES_JSON" "$REPO_KEY")"
fi
TARGET_REPO="${TARGET_REPO:-$REPO_PATH}"

# When the item has no repository yet, the planning call picks one. It already holds the
# full ticket context, so a separate inference pass would be a second model call over
# the same information.
NEEDS_REPO=false
if [[ ( -z "$REPO_KEY" || "$REPO_KEY" == "None" ) && ( -z "$ENV_REPO" || "$ENV_REPO" == "None" ) ]]; then
    NEEDS_REPO=true
fi

# The catalogue states each repository's configured strategy, so the planning call can
# see what a repository actually supports rather than guessing.
REPO_CATALOGUE="$(python3 -c "
import json, sys
repos = json.loads(sys.argv[1])
for key, repo in sorted(repos.items()):
    if key == '_defaults':
        continue
    strategy = repo.get('commit_strategy', 'branch_and_pr')
    desc = repo.get('description') or ''
    suffix = f' — {desc}' if desc else ''
    print(f'- {key} [configured strategy: {strategy}]{suffix}')
" "$REPOSITORIES_JSON")"

# Source context is the imported ticket body and discussion, when the item came
# from a work-discovery adapter rather than being entered by hand.
CONTEXT_FILE="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" integration.context_file 2>/dev/null)" || true
SOURCE_CONTEXT=""
if [[ -n "$CONTEXT_FILE" && "$CONTEXT_FILE" != "None" ]]; then
    CONTEXT_FILE="${CONTEXT_FILE/#\~/$HOME}"
    if [[ -s "$CONTEXT_FILE" ]]; then
        SOURCE_CONTEXT="$(cat "$CONTEXT_FILE")"
        echo "  Source context: $CONTEXT_FILE"
    fi
fi

SOURCE_REF_LINE=""
SOURCE_REF="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" integration.source_ref 2>/dev/null)" || true
if [[ -n "$SOURCE_REF" && "$SOURCE_REF" != "None" ]]; then
    SOURCE_REF_LINE="Source: $SOURCE_REF"
fi

# The same authorization the worker gets in its task message, written into the plan
# file as well. The plan file is what the worker re-reads when it loses the thread,
# and a worker that forgets it may push will stop and wait for a human who is not
# there.
PLAN_TARGET_STRATEGY="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" worker.commit_strategy 2>/dev/null)" || true
if [[ -z "$PLAN_TARGET_STRATEGY" || "$PLAN_TARGET_STRATEGY" == "None" ]]; then
    PLAN_TARGET_STRATEGY="$(python3 -c "
import json, sys
repos = json.loads(sys.argv[1])
repo = repos.get(sys.argv[2]) or repos.get('_defaults', {})
print(repo.get('commit_strategy', 'branch_and_pr'))
" "$REPOSITORIES_JSON" "$REPO_KEY" 2>/dev/null || echo "branch_and_pr")"
fi

if [[ "$PLAN_TARGET_STRATEGY" == "commit_to_main" ]]; then
    WORKER_AUTHORIZATION="You are running as an automated software factory. No human will answer a question
mid-run. You are authorized to commit and push to main for this repository without
asking. Do not stop to request permission to push."
else
    WORKER_AUTHORIZATION="You are running as an automated software factory. No human will answer a question
mid-run. You are authorized, and expected, to push your branch and open a DRAFT pull
request immediately once the first working change is in place. Do not ask first.

You are also authorized to push every follow-up commit to that same draft PR, including
fixes for CI failures and anything the delegator asks you to change. Keep the draft PR
up to date; it is the artifact the user reviews. Leave it in draft. Do not mark it ready
for review and do not merge it."
fi

echo "Generating plan for: $ITEM_TITLE ($ITEM_ID)"
echo "  Repo: $TARGET_REPO"
echo "  Plans dir: $PLANS_DIR"
echo ""

# Build the prompt for Claude — request markdown plan output
PLAN_PROMPT="$(cat <<PLAN_EOF
You are generating an implementation plan for a work item. Output a well-structured markdown document.

Work item:
- ID: $ITEM_ID
- Title: $ITEM_TITLE
- Branch: $ITEM_BRANCH
- Repository: $TARGET_REPO
${SOURCE_CONTEXT:+
The work item was imported from an issue tracker. Its description and discussion
follow. Treat this as the authoritative statement of intent and ground the plan in
it rather than inventing scope.

--- SOURCE CONTEXT ---
$SOURCE_CONTEXT
--- END SOURCE CONTEXT ---
}
You are running inside the repository the work targets, so read the code before you
plan against it. Open the files the work touches, confirm the patterns already in use,
and name real paths in the steps. Do not plan against what you assume the code looks like.

Begin your output with a metadata block in exactly this form, then the plan:

---
repo_key: <one repository key from the list below${NEEDS_REPO:+, required}>
branch_slug: <3 to 5 lowercase words, hyphen separated, naming this work>
commit_strategy: <omit unless overriding; see below>
strategy_reason: <one line, required only if you set commit_strategy>
stack_steps: <required only for graphite_stack; see format below>
---

Repositories:
$REPO_CATALOGUE

About commit_strategy: each repository has a configured strategy that reflects how that
repository actually works. Leave commit_strategy out and the configured strategy is used.
That is the right answer almost always.

Only set it when the work genuinely demands a different shape, and say why in
strategy_reason. The one case that justifies an override is a change large enough that it
should land as a sequence of dependent pull requests rather than one: set
commit_strategy: graphite_stack and list the steps. Conversely, if a repository is
configured for a stack but this work is a single self-contained change, set
commit_strategy: branch_and_pr.

Do not propose a strategy that a repository cannot support. A repository configured
commit_to_main commits directly and has no pull request flow, so it can never take
branch_and_pr or graphite_stack; leave commit_strategy out for those.

Format for stack_steps, on one line, steps ordered, separated by two semicolons:
  branch-suffix|what this step does ;; branch-suffix|what this step does

Then generate a plan document with:
1. A title header matching the work item title
2. A "Summary" section with 1-3 sentences describing the implementation approach
3. A "Steps" section with concrete, actionable steps as a numbered checklist (use - [ ] format)
   - Scale the number of steps to the scope of the work (1-8 steps)
4. Each step should be completable by a single Claude Code session
5. Reference specific file paths or patterns when possible

Output only the markdown — no wrapping, no code fences, no preamble.

Example format:

# Work Item Title

## Summary

Brief description of the implementation approach.

## Steps

- [ ] First step description
- [ ] Second step description
- [ ] Third step description

## Notes

Any additional context or considerations.
PLAN_EOF
)"

# Generate the plan using Claude CLI in non-interactive mode.
#
# The call runs inside the repository the work targets. A plan is only as good as
# the code it was written against, and a planning call that cannot open the files
# it is planning changes to is guessing. When the repository is not yet known the
# planning call is also the thing that picks it, so there is nothing to cd into.
PLAN_CWD="$PROJECT_ROOT"
if [[ "$NEEDS_REPO" != "true" && -n "$TARGET_REPO" && -d "$TARGET_REPO" ]]; then
    PLAN_CWD="$TARGET_REPO"
fi

echo "Calling Claude (opus) to generate plan..."
echo "  Working directory: $PLAN_CWD"
CLAUDE_BIN="${HOME}/.local/bin/claude"
# Unset CLAUDECODE to allow invocation from within a Claude Code session
unset CLAUDECODE 2>/dev/null || true
LOGS_DIR="$HOME/.claude/orchestrator/logs"
mkdir -p "$LOGS_DIR"
PLAN_OUTPUT="$(cd "$PLAN_CWD" && "$CLAUDE_BIN" --print --model opus \
    --dangerously-skip-permissions \
    --settings '{"hooks":{}}' \
    --strict-mcp-config \
    "$PLAN_PROMPT" 2>"$LOGS_DIR/claude-plan-stderr.log")" || {
    echo "ERROR: Claude CLI invocation failed" >&2
    cat "$LOGS_DIR/claude-plan-stderr.log" >&2 2>/dev/null
    exit 1
}

echo "Plan generated successfully."

# Split the metadata header off the plan body. A missing or malformed header is not an
# error: finalize-plan.py derives what it needs deterministically instead.
PLAN_META="$(printf '%s' "$PLAN_OUTPUT" | python3 -c "
import re, sys
text = sys.stdin.read()
match = re.match(r'\s*---\s*\n(.*?)\n\s*---\s*\n?', text, re.DOTALL)
if not match:
    sys.exit(0)
fields = {}
for line in match.group(1).splitlines():
    key, sep, value = line.partition(':')
    if sep:
        fields[key.strip()] = value.strip().strip('<>')
for key in ('repo_key', 'branch_slug', 'commit_strategy', 'strategy_reason', 'stack_steps'):
    value = fields.get(key, '')
    print('' if value.lower() in ('omit', 'none', 'n/a') else value)
")"
PLAN_REPO_KEY="$(printf '%s' "$PLAN_META" | sed -n 1p)"
PLAN_BRANCH_SLUG="$(printf '%s' "$PLAN_META" | sed -n 2p)"
PLAN_STRATEGY="$(printf '%s' "$PLAN_META" | sed -n 3p)"
PLAN_STRATEGY_REASON="$(printf '%s' "$PLAN_META" | sed -n 4p)"
PLAN_STACK_STEPS="$(printf '%s' "$PLAN_META" | sed -n 5p)"

PLAN_BODY="$(printf '%s' "$PLAN_OUTPUT" | python3 -c "
import re, sys
text = sys.stdin.read()
print(re.sub(r'^\s*---\s*\n.*?\n\s*---\s*\n?', '', text, count=1, flags=re.DOTALL).lstrip())
")"

# Write plan to file. The plan file is the only thing the worker ever reads, so the
# ticket's own description and discussion are carried into it verbatim. A planning
# call that compresses a ticket into a checklist throws away every detail it did not
# think to keep, and the worker has no way to go back for them.
PLAN_FILE="$PLANS_DIR/${ITEM_ID}.md"
{
    printf '%s\n' "$PLAN_BODY"
    printf '\n## Execution rules\n\n%s\n' "$WORKER_AUTHORIZATION"
    if [[ -n "$SOURCE_CONTEXT" ]]; then
        printf '\n---\n\n## Source ticket (verbatim)\n\n'
        printf '%s\n' "$SOURCE_REF_LINE"
        printf '\n%s\n' "$SOURCE_CONTEXT"
    fi
} > "$PLAN_FILE"
echo "  Plan written to: $PLAN_FILE"

# Also generate a lightweight JSON summary for the queue metadata (backward compat)
PLAN_JSON="$(printf '%s' "$PLAN_BODY" | python3 -c "
import sys, re, json
from datetime import datetime, timezone

content = sys.stdin.read().strip()

# Extract summary: text between ## Summary and the next ## heading
summary_match = re.search(r'## Summary\s*\n+(.*?)(?=\n## |\Z)', content, re.DOTALL)
summary = summary_match.group(1).strip() if summary_match else content[:200]

plan = {
    'summary': summary,
    'approved': False,
    'approved_at': None,
}

print(json.dumps(plan))
")"

# Validate that the JSON extraction succeeded
if [[ -z "$PLAN_JSON" ]] || ! echo "$PLAN_JSON" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "  WARNING: Plan JSON extraction failed, using fallback summary"
    PLAN_JSON='{"summary":"Plan generated. See plan file for details.","approved":false,"approved_at":null}'
fi

# Auto-approve if requested
if [[ "$AUTO_APPROVE" == "true" ]]; then
    PLAN_JSON="$(echo "$PLAN_JSON" | python3 -c "
import json, sys
from datetime import datetime, timezone
plan = json.load(sys.stdin)
plan['approved'] = True
plan['approved_at'] = datetime.now(timezone.utc).isoformat()
print(json.dumps(plan))
")"
    echo "Plan auto-approved."
fi

# Update queue item: simple fields via queue.py, plan object via locked_queue
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" plan.file="$PLAN_FILE"

# Store the plan summary.
cd "$SCRIPT_DIR" && python3 -c "
import json, sys
sys.path.insert(0, '.')
from lib.queue import locked_queue, find_item
plan = json.loads(sys.stdin.read())
with locked_queue(write=True) as ctx:
    item = find_item(ctx['data'], '$ITEM_ID')
    if item:
        item.setdefault('plan', {}).update(plan)
        ctx['modified'] = True
" <<< "$PLAN_JSON"

# Finish preparing the item and promote it only if it is genuinely activatable.
python3 "$SCRIPT_DIR/finalize-plan.py" "$ITEM_ID" \
    --repo-key "$PLAN_REPO_KEY" --branch-slug "$PLAN_BRANCH_SLUG" \
    --commit-strategy "$PLAN_STRATEGY" --strategy-reason "$PLAN_STRATEGY_REASON" \
    --stack-steps "$PLAN_STACK_STEPS"

echo ""
echo "Plan saved."
echo "  File: $PLAN_FILE"


# Print the plan summary
echo ""
echo "=== Plan Summary ==="
echo "$PLAN_JSON" | python3 -c "
import json, sys
plan = json.load(sys.stdin)
print(f'  {plan[\"summary\"]}')
print()
print(f'  Approved: {plan.get(\"approved\", False)}')
"

emit_event "plan.generated" "Plan generated for $ITEM_TITLE" --item-id "$ITEM_ID"
