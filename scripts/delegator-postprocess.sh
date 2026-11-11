#!/usr/bin/env bash
# Delegator post-processing: execute actions from Claude's output and update state.
#
# Usage:
#   ./scripts/delegator-postprocess.sh <item-id> <claude-output-file> [--model haiku|opus]
#
# Reads the JSON output from Claude (Haiku triage or Opus review), executes
# any specified actions, and updates the delegator state file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

VMUX="$CONFIG_TOOL_VMUX"
DASHBOARD_PORT="$CONFIG_API_PORT"
QUEUE_PY="python3 -m lib.queue"

ITEM_ID="${1:?Usage: delegator-postprocess.sh <item-id> <claude-output-file> [--model haiku|opus]}"
CLAUDE_OUTPUT_FILE="${2:?Usage: delegator-postprocess.sh <item-id> <claude-output-file> [--model haiku|opus]}"
MODEL="haiku"
shift 2
while [[ $# -gt 0 ]]; do
    case "$1" in
        --model) MODEL="$2"; shift 2 ;;
        *) shift ;;
    esac
done

DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
STATE_FILE="$DELEGATOR_DIR/state.json"
CYCLE_FILE="$DELEGATOR_DIR/cycle-${ITEM_ID}.json"

# Read Claude's output
if [[ ! -f "$CLAUDE_OUTPUT_FILE" ]]; then
    echo "ERROR: Claude output file not found: $CLAUDE_OUTPUT_FILE" >&2
    exit 1
fi

# Parse the JSON output — Claude may wrap it in markdown code fences
CLAUDE_JSON="$(python3 -c "
import json, sys, re

with open('$CLAUDE_OUTPUT_FILE') as f:
    raw = f.read().strip()

def try_parse(text):
    \"\"\"Try to parse JSON, stripping trailing commas first.\"\"\"
    # Remove trailing commas before } or ] (common AI output artifact)
    cleaned = re.sub(r',\s*([}\]])', r'\1', text)
    return json.loads(cleaned)

parsed = None

# Strategy 1: Extract from markdown code fences (prefer json-tagged blocks)
fence = chr(96)*3
nl = chr(10)
# First try json-tagged fence blocks
json_pat = fence + r'json\s*' + nl + '(.*?)' + nl + fence
for m in re.finditer(json_pat, raw, re.DOTALL):
    try:
        parsed = try_parse(m.group(1).strip())
        break
    except (json.JSONDecodeError, ValueError):
        continue

# Fall back to any fence block
if parsed is None:
    pat = fence + '[^' + nl + ']*' + nl + '(.*?)' + nl + fence
    for m in re.finditer(pat, raw, re.DOTALL):
        try:
            parsed = try_parse(m.group(1).strip())
            break
        except (json.JSONDecodeError, ValueError):
            continue

# Strategy 2: Try parsing the whole output as JSON
if parsed is None:
    try:
        parsed = try_parse(raw)
    except (json.JSONDecodeError, ValueError):
        pass

# Strategy 3: Find first { ... } block in the text (handles leading/trailing prose)
if parsed is None:
    brace_match = re.search(r'\{.*\}', raw, re.DOTALL)
    if brace_match:
        try:
            parsed = try_parse(brace_match.group(0))
        except (json.JSONDecodeError, ValueError):
            pass

if parsed is None:
    parsed = {'decision': 'no_action', 'reason': 'Failed to parse Claude output as JSON'}
    sys.stderr.write(f'WARNING: Could not parse Claude output as JSON. Raw (first 500 chars): {raw[:500]}\n')

print(json.dumps(parsed))
")"

DECISION="$(echo "$CLAUDE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('decision', 'no_action'))")"

echo "[postprocess] $ITEM_ID: decision=$DECISION model=$MODEL"

# The commit watermark and the state fingerprint are facts about the cycle, not
# judgements, so they are recorded here rather than left to the model. When the
# model omitted last_seen_hash, preprocess fell back to re-reporting the last 20
# commits every cycle and every cycle escalated as if the work were new.
CYCLE_FACTS="$(python3 -c "
import json, sys
try:
    with open('$CYCLE_FILE') as f:
        cycle = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cycle = {}
print(json.dumps({
    'head_hash': (cycle.get('commits') or {}).get('head_hash', ''),
    'state_fingerprint': cycle.get('state_fingerprint', ''),
    'cycles_unchanged': cycle.get('cycles_unchanged', 0),
}))
")"

# Update state file FIRST (before actions), so state is persisted even if an action causes issues
echo "$CLAUDE_JSON" | CYCLE_FACTS="$CYCLE_FACTS" python3 -c "
import json, sys, os
from datetime import datetime, timezone

state_file = '$STATE_FILE'
claude_json = json.loads(sys.stdin.read())
model = '$MODEL'
decision = '$DECISION'
item_id = '$ITEM_ID'

# Load existing state
try:
    with open(state_file) as f:
        state = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    state = {'item_id': item_id, 'cycle_count': 0, 'cycle_log': []}

# Increment cycle count
state['cycle_count'] = state.get('cycle_count', 0) + 1
state['last_cycle_at'] = datetime.now(timezone.utc).isoformat()

# Apply state_updates from Claude's output
state_updates = claude_json.get('state_updates', {})
for key, value in state_updates.items():
    parts = key.split('.')
    obj = state
    for part in parts[:-1]:
        if part not in obj or not isinstance(obj[part], dict):
            obj[part] = {}
        obj = obj[part]
    # Handle list appends (e.g., commits.reviews is a list)
    if isinstance(value, list) and isinstance(obj.get(parts[-1]), list):
        obj[parts[-1]].extend(value)
    else:
        obj[parts[-1]] = value

# Record the cycle's own facts after the model's state_updates, so a stale or
# absent value from the model cannot hold the watermark back.
try:
    facts = json.loads(os.environ.get('CYCLE_FACTS', '{}'))
except (json.JSONDecodeError, ValueError):
    facts = {}
if facts.get('head_hash'):
    state.setdefault('commits', {})['last_seen_hash'] = facts['head_hash']
if facts.get('state_fingerprint'):
    state['state_fingerprint'] = facts['state_fingerprint']
state['cycles_unchanged'] = facts.get('cycles_unchanged', 0)

# Update health
state.setdefault('health', {})
state['health']['status'] = 'healthy'
state['health']['last_successful_cycle_at'] = state['last_cycle_at']
state['health']['consecutive_errors'] = 0
state['health']['last_error'] = None

# Append to cycle_log (keep last 50 entries)
cycle_entry = {
    'cycle': state['cycle_count'],
    'timestamp': state['last_cycle_at'],
    'model': model,
    'decision': decision,
    'actions': [a.get('type', '') for a in claude_json.get('actions', [])],
}
state.setdefault('cycle_log', []).append(cycle_entry)
state['cycle_log'] = state['cycle_log'][-50:]

# Update assessment if provided
assessment = claude_json.get('assessment')
if assessment:
    state['assessment'] = assessment

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')

print(f'[postprocess] State updated: cycle={state[\"cycle_count\"]}, model={model}, decision={decision}')
"

# Execute actions if decision is "handle"
if [[ "$DECISION" == "handle" || "$DECISION" == "escalate" ]]; then
    echo "$CLAUDE_JSON" | \
        DELEGATOR_VMUX="$VMUX" \
        DELEGATOR_DASHBOARD_PORT="$DASHBOARD_PORT" \
        DELEGATOR_ITEM_ID="$ITEM_ID" \
        DELEGATOR_SCRIPT_DIR="$SCRIPT_DIR" \
        python3 "$SCRIPT_DIR/delegator-actions.py"
fi

# Clean up running.pid
rm -f "$DELEGATOR_DIR/running.pid"

# Clean up temp files
rm -f "$CLAUDE_OUTPUT_FILE"

emit_event "delegator.cycle_complete" "Delegator cycle for $ITEM_ID: $DECISION ($MODEL)" \
    --item-id "$ITEM_ID"
