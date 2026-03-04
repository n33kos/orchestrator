#!/usr/bin/env bash
# Generate an implementation plan for a queued work item using Claude.
#
# Usage:
#   ./scripts/generate-plan.sh <item-id> [--auto-approve]
#
# Generates a markdown plan file in the configured plans directory and
# stores a reference in the queue item's metadata. Moves the item to "planning" status.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
REPO_PATH="$CONFIG_REPO_PATH"
PLANS_DIR="${CONFIG_PLANS_DIR:-$HOME/.claude/orchestrator/plans}"
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

# Extract fields in a single call
IFS=$'\x1f' read -r ITEM_TITLE ITEM_DESC ITEM_TYPE ITEM_BRANCH CUSTOM_REPO \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" title description type branch metadata.repo_path)
CUSTOM_REPO="$(echo "$CUSTOM_REPO" | sed "s|~|$HOME|")"

# Determine the target repo for context
TARGET_REPO="${CUSTOM_REPO:-$REPO_PATH}"

echo "Generating plan for: $ITEM_TITLE ($ITEM_ID)"
echo "  Type: $ITEM_TYPE"
echo "  Repo: $TARGET_REPO"
echo "  Plans dir: $PLANS_DIR"
echo ""

# Build the prompt for Claude — request markdown plan output
PLAN_PROMPT="$(cat <<PLAN_EOF
You are generating an implementation plan for a work item. Output a well-structured markdown document.

Work item:
- ID: $ITEM_ID
- Title: $ITEM_TITLE
- Description: $ITEM_DESC
- Type: $ITEM_TYPE
- Branch: $ITEM_BRANCH
- Repository: $TARGET_REPO

Generate a plan document with:
1. A title header matching the work item title
2. A "Summary" section with 1-3 sentences describing the implementation approach
3. A "Steps" section with concrete, actionable steps as a numbered checklist (use - [ ] format)
   - Projects: 3-8 steps
   - Quick fixes: 1-3 steps
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

# Generate the plan using Claude CLI in non-interactive mode
echo "Calling Claude (sonnet) to generate plan..."
CLAUDE_BIN="${HOME}/.local/bin/claude"
# Unset CLAUDECODE to allow invocation from within a Claude Code session
unset CLAUDECODE 2>/dev/null || true
PLAN_OUTPUT="$("$CLAUDE_BIN" --print --model sonnet "$PLAN_PROMPT" 2>/tmp/claude-plan-stderr.log)" || {
    echo "ERROR: Claude CLI invocation failed" >&2
    cat /tmp/claude-plan-stderr.log >&2 2>/dev/null
    exit 1
}

echo "Plan generated successfully."

# Write plan to file
PLAN_FILE="$PLANS_DIR/${ITEM_ID}.md"
echo "$PLAN_OUTPUT" > "$PLAN_FILE"
echo "  Plan written to: $PLAN_FILE"

# Also generate a lightweight JSON summary for the queue metadata (backward compat)
PLAN_JSON="$(echo "$PLAN_OUTPUT" | python3 -c "
import sys, re, json
from datetime import datetime, timezone

content = sys.stdin.read().strip()

# Extract summary: text between ## Summary and the next ## heading
summary_match = re.search(r'## Summary\s*\n+(.*?)(?=\n## |\Z)', content, re.DOTALL)
summary = summary_match.group(1).strip() if summary_match else content[:200]

# Extract steps: lines starting with - [ ] or - [x]
steps = []
for i, match in enumerate(re.finditer(r'- \[([ x])\]\s*(.+)', content)):
    done = match.group(1) == 'x'
    text = match.group(2).strip()
    steps.append({'id': f'step-{i+1}', 'text': text, 'done': done})

plan = {
    'summary': summary,
    'steps': steps,
    'approved': False,
    'created_at': datetime.now(timezone.utc).isoformat(),
    'approved_at': None,
}

print(json.dumps(plan))
")"

# Validate that the JSON extraction succeeded
if [[ -z "$PLAN_JSON" ]] || ! echo "$PLAN_JSON" | python3 -c "import json, sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "  WARNING: Plan JSON extraction failed, using fallback summary"
    PLAN_JSON='{"summary":"Plan generated — see plan file for details","steps":[],"approved":false,"created_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","approved_at":null}'
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
cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" metadata.plan_file="$PLAN_FILE"

# Set the plan object and conditionally update status (requires locked write)
cd "$SCRIPT_DIR" && python3 -c "
import json, sys
sys.path.insert(0, '.')
from lib.queue import locked_queue, find_item
plan = json.loads(sys.stdin.read())
with locked_queue(write=True) as ctx:
    item = find_item(ctx['data'], '$ITEM_ID')
    if item:
        item.setdefault('metadata', {})['plan'] = plan
        if item['status'] == 'queued':
            item['status'] = 'planning'
        ctx['modified'] = True
" <<< "$PLAN_JSON"

echo ""
echo "Plan saved."
echo "  File: $PLAN_FILE"
echo "  Status: planning"

# Print the plan summary
echo ""
echo "=== Plan Summary ==="
echo "$PLAN_JSON" | python3 -c "
import json, sys
plan = json.load(sys.stdin)
print(f'  {plan[\"summary\"]}')
print()
for step in plan['steps']:
    marker = 'x' if step['done'] else ' '
    print(f'  [{marker}] {step[\"text\"]}')
approved = plan.get('approved', False)
print()
print(f'  Approved: {approved}')
"

emit_event "plan.generated" "Plan generated for $ITEM_TITLE" --item-id "$ITEM_ID"
