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

# Extract JSON from markdown code fences if present (handles trailing text after closing fence)
fence = chr(96)*3
nl = chr(10)
pat = fence + '[^' + nl + ']*' + nl + '(.*?)' + nl + fence
m = re.search(pat, raw, re.DOTALL)
if m:
    raw = m.group(1).strip()

try:
    data = json.loads(raw)
    print(json.dumps(data))
except json.JSONDecodeError as e:
    print(json.dumps({'decision': 'no_action', 'reason': f'Failed to parse Claude output: {e}'}))
")"

DECISION="$(echo "$CLAUDE_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('decision', 'no_action'))")"

echo "[postprocess] $ITEM_ID: decision=$DECISION model=$MODEL"

# Update state file FIRST (before actions), so state is persisted even if an action causes issues
python3 -c "
import json, sys, os
from datetime import datetime, timezone

state_file = '$STATE_FILE'
claude_json = json.loads('''$(echo "$CLAUDE_JSON" | sed "s/'/\\\\'/g")''')
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
    echo "$CLAUDE_JSON" | python3 -c "
import json, sys, subprocess, os

data = json.load(sys.stdin)
actions = data.get('actions', [])
vmux = '$VMUX'
dashboard_port = '$DASHBOARD_PORT'
item_id = '$ITEM_ID'

for action in actions:
    action_type = action.get('type', '')
    try:
        if action_type == 'message_worker':
            text = action.get('text', '')
            # Get worker session ID from queue
            result = subprocess.run(
                ['python3', '-m', 'lib.queue', 'get', item_id, 'environment.session_id'],
                capture_output=True, text=True, cwd='$SCRIPT_DIR'
            )
            worker_id = result.stdout.strip()
            if worker_id and text:
                subprocess.run(
                    [vmux, 'send', worker_id, text],
                    capture_output=True, timeout=10
                )
                print(f'  [action] Sent message to worker: {text[:80]}...')

        elif action_type == 'update_queue_metadata':
            metadata = action.get('data', {})
            args = ['python3', '-m', 'lib.queue', 'update', item_id]
            # Map known fields to their new nested paths
            FIELD_MAPPING = {
                'delegator_enabled': 'worker.delegator_enabled',
                'status': 'status',
                'delegator_status': 'runtime.delegator_status',
                'last_activity': 'runtime.last_activity',
                'completion_message': 'runtime.completion_message',
                'spend': 'runtime.spend',
            }
            for key, value in metadata.items():
                if key in FIELD_MAPPING:
                    mapped = FIELD_MAPPING[key]
                elif key.startswith('runtime.') or key.startswith('worker.') or key.startswith('environment.'):
                    # Already fully qualified — pass through as-is
                    mapped = key
                else:
                    mapped = f'runtime.{key}'
                args.append(f'{mapped}={value}')
            subprocess.run(args, cwd='$SCRIPT_DIR', capture_output=True)
            print(f'  [action] Updated queue metadata: {list(metadata.keys())}')

        elif action_type == 'trigger_review_transition':
            # Only update queue status to review — do NOT suspend session or delegator.
            # Both stay alive so the delegator can monitor CI and the worker can receive commands.
            subprocess.run(
                ['python3', '-m', 'lib.queue', 'update', item_id, 'status=review'],
                cwd='$SCRIPT_DIR', capture_output=True, timeout=10
            )
            print(f'  [action] Moved {item_id} to review status (session + delegator stay alive)')

        elif action_type == 'request_ci_fix':
            result = subprocess.run(
                ['python3', '-m', 'lib.queue', 'get', item_id, 'environment.session_id'],
                capture_output=True, text=True, cwd='$SCRIPT_DIR'
            )
            worker_id = result.stdout.strip()
            if worker_id:
                msg = f'[Delegator {item_id}]: CI checks are failing. Run /fix-ci-tests to identify and fix the failures.'
                subprocess.run([vmux, 'send', worker_id, msg], capture_output=True, timeout=10)
                print(f'  [action] Sent CI fix request to worker')

        elif action_type == 'flag_for_user':
            description = action.get('description', 'Delegator flagged an issue')
            print(f'  [action] Flagged for user: {description}')

        else:
            print(f'  [action] Unknown action type: {action_type}')
    except Exception as e:
        print(f'  [action] ERROR executing {action_type}: {e}')
"
fi

# Clean up running.pid
rm -f "$DELEGATOR_DIR/running.pid"

# Clean up temp files
rm -f "$CLAUDE_OUTPUT_FILE"

emit_event "delegator.cycle_complete" "Delegator cycle for $ITEM_ID: $DECISION ($MODEL)" \
    --item-id "$ITEM_ID"
