#!/usr/bin/env bash
# Generate an implementation plan for a queued work item using Claude.
#
# Usage:
#   ./scripts/generate-plan.sh <item-id> [--auto-approve]
#
# Reads the work item from the queue, generates a plan using claude CLI,
# and stores it in the item's metadata. Moves the item to "planning" status.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
REPO_PATH="$(grep 'path:' "$CONFIG" | head -1 | sed 's/.*: *//' | sed "s|~|$HOME|")"

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

# Read item from queue
ITEM_JSON="$(python3 -c "
import json, sys
with open('$QUEUE_FILE') as f:
    data = json.load(f)
item = next((i for i in data['items'] if i['id'] == '$ITEM_ID'), None)
if not item:
    print('ERROR: Item $ITEM_ID not found', file=sys.stderr)
    sys.exit(1)
if item['status'] not in ('queued', 'planning'):
    print(f'ERROR: Item $ITEM_ID is {item[\"status\"]}, expected queued or planning', file=sys.stderr)
    sys.exit(1)
print(json.dumps(item))
")"

ITEM_TITLE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")"
ITEM_DESC="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('description', ''))")"
ITEM_TYPE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['type'])")"
ITEM_BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('branch', ''))")"
CUSTOM_REPO="$(echo "$ITEM_JSON" | python3 -c "import json,sys; m=json.load(sys.stdin).get('metadata',{}); print(m.get('repo_path',''))" | sed "s|~|$HOME|")"

# Determine the target repo for context
TARGET_REPO="${CUSTOM_REPO:-$REPO_PATH}"

echo "Generating plan for: $ITEM_TITLE ($ITEM_ID)"
echo "  Type: $ITEM_TYPE"
echo "  Repo: $TARGET_REPO"
echo ""

# Build the prompt for Claude
PLAN_PROMPT="$(cat <<PLAN_EOF
You are generating an implementation plan for a work item. Output ONLY valid JSON matching this schema — no markdown, no explanation, no wrapping.

Work item:
- Title: $ITEM_TITLE
- Description: $ITEM_DESC
- Type: $ITEM_TYPE
- Branch: $ITEM_BRANCH
- Repository: $TARGET_REPO

Generate a plan with:
1. A concise summary (1-2 sentences) of the implementation approach
2. A list of concrete, actionable steps (3-8 steps for projects, 1-3 for quick fixes)

Output format (strict JSON, no markdown fences):
{
  "summary": "Brief implementation approach",
  "steps": [
    {"id": "step-1", "text": "Step description", "done": false},
    {"id": "step-2", "text": "Step description", "done": false}
  ],
  "approved": false,
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "approved_at": null
}

Consider the repository context. Be specific and actionable — reference file paths or patterns when possible. Each step should be completable by a single Claude Code session.
PLAN_EOF
)"

# Generate the plan using Claude CLI in non-interactive mode
echo "Calling Claude to generate plan..."
CLAUDE_BIN="${HOME}/.local/bin/claude"
# Unset CLAUDECODE to allow invocation from within a Claude Code session
unset CLAUDECODE 2>/dev/null || true
PLAN_OUTPUT="$("$CLAUDE_BIN" --print --model haiku "$PLAN_PROMPT" 2>/tmp/claude-plan-stderr.log)" || {
    echo "ERROR: Claude CLI invocation failed" >&2
    cat /tmp/claude-plan-stderr.log >&2 2>/dev/null
    exit 1
}

# Extract JSON from the output (Claude might wrap it in markdown fences)
PLAN_JSON="$(echo "$PLAN_OUTPUT" | python3 -c "
import sys, json, re

raw = sys.stdin.read().strip()

# Try direct parse first
try:
    plan = json.loads(raw)
    print(json.dumps(plan))
    sys.exit(0)
except json.JSONDecodeError:
    pass

# Try extracting from markdown code fences
match = re.search(r'\`\`\`(?:json)?\s*\n(.*?)\n\`\`\`', raw, re.DOTALL)
if match:
    try:
        plan = json.loads(match.group(1))
        print(json.dumps(plan))
        sys.exit(0)
    except json.JSONDecodeError:
        pass

# Try finding first { to last }
first_brace = raw.find('{')
last_brace = raw.rfind('}')
if first_brace >= 0 and last_brace > first_brace:
    try:
        plan = json.loads(raw[first_brace:last_brace+1])
        print(json.dumps(plan))
        sys.exit(0)
    except json.JSONDecodeError:
        pass

print('ERROR: Could not parse plan JSON from Claude output', file=sys.stderr)
print(f'Raw output: {raw[:500]}', file=sys.stderr)
sys.exit(1)
")" || {
    echo "ERROR: Failed to parse plan from Claude output" >&2
    echo "Raw output:" >&2
    echo "$PLAN_OUTPUT" | head -20 >&2
    exit 1
}

echo "Plan generated successfully."

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

# Update queue item with the plan
python3 -c "
import json

plan = json.loads('''$(echo "$PLAN_JSON" | sed "s/'/\\\\'/g")''')

with open('$QUEUE_FILE') as f:
    data = json.load(f)

for item in data['items']:
    if item['id'] == '$ITEM_ID':
        if 'metadata' not in item or item['metadata'] is None:
            item['metadata'] = {}
        item['metadata']['plan'] = plan
        if item['status'] == 'queued':
            item['status'] = 'planning'
        break

with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

echo ""
echo "Plan saved to queue."
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
