#!/usr/bin/env bash
# Run a directive command for a work item.
# Creates a status file that the delegator checks on each cycle.
#
# Usage: run-directive.sh <item-id> <directive-name> <command...>

set -uo pipefail

ITEM_ID="${1:?Usage: run-directive.sh <item-id> <directive-name> <command...>}"
DIRECTIVE="${2:?Missing directive name}"
shift 2
COMMAND="$*"

if [ -z "$COMMAND" ]; then
  echo "ERROR: No command provided" >&2
  exit 1
fi

DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
STATUS_FILE="$DELEGATOR_DIR/directive-${DIRECTIVE}.status.json"
OUTPUT_FILE="$DELEGATOR_DIR/directive-${DIRECTIVE}.output.log"

mkdir -p "$DELEGATOR_DIR"

# Write running status
python3 -c "
import json
from datetime import datetime, timezone
json.dump({
    'directive': '$DIRECTIVE',
    'status': 'running',
    'pid': $$,
    'started_at': datetime.now(timezone.utc).isoformat(),
    'completed_at': None,
    'exit_code': None,
    'command': '''$COMMAND''',
    'output_path': '$OUTPUT_FILE',
    'error': None,
}, open('$STATUS_FILE', 'w'), indent=2)
"

# Run the command, capturing output
eval "$COMMAND" > "$OUTPUT_FILE" 2>&1
EXIT_CODE=$?

# Write completion status
python3 -c "
import json
from datetime import datetime, timezone
try:
    status = json.load(open('$STATUS_FILE'))
except Exception:
    status = {'directive': '$DIRECTIVE', 'pid': $$}
status['status'] = 'completed' if $EXIT_CODE == 0 else 'failed'
status['completed_at'] = datetime.now(timezone.utc).isoformat()
status['exit_code'] = $EXIT_CODE
status['output_path'] = '$OUTPUT_FILE'
if $EXIT_CODE != 0:
    try:
        last_lines = open('$OUTPUT_FILE').read().strip().split('\n')[-20:]
        status['error'] = '\n'.join(last_lines)
    except Exception:
        status['error'] = 'Command exited with code $EXIT_CODE'
json.dump(status, open('$STATUS_FILE', 'w'), indent=2)
"

exit $EXIT_CODE
