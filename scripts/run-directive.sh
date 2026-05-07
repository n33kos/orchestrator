#!/usr/bin/env bash
# Run a directive command for a work item.
# Creates a status file that the delegator checks on each cycle.
#
# Usage: run-directive.sh <item-id> <directive-name> <cmd> [arg ...]
#
# Each command argument is passed as a separate token (no shell parsing of
# the command — no `eval`). This avoids quoting bugs and command injection.

set -uo pipefail

ITEM_ID="${1:?Usage: run-directive.sh <item-id> <directive-name> <cmd> [arg ...]}"
DIRECTIVE="${2:?Missing directive name}"
shift 2

if [ "$#" -eq 0 ]; then
  echo "ERROR: No command provided" >&2
  exit 1
fi

DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
STATUS_FILE="$DELEGATOR_DIR/directive-${DIRECTIVE}.status.json"
OUTPUT_FILE="$DELEGATOR_DIR/directive-${DIRECTIVE}.output.log"

mkdir -p "$DELEGATOR_DIR"

# Build a shell-safe representation of the command for the status file.
# printf '%q' quotes any token that needs it, leaving plain tokens unquoted.
COMMAND_REPR="$(printf '%q ' "$@")"
COMMAND_REPR="${COMMAND_REPR% }"

DIRECTIVE="$DIRECTIVE" COMMAND_REPR="$COMMAND_REPR" \
STATUS_FILE="$STATUS_FILE" OUTPUT_FILE="$OUTPUT_FILE" \
python3 -c "
import json, os
from datetime import datetime, timezone
json.dump({
    'directive': os.environ['DIRECTIVE'],
    'status': 'running',
    'pid': os.getppid(),
    'started_at': datetime.now(timezone.utc).isoformat(),
    'completed_at': None,
    'exit_code': None,
    'command': os.environ['COMMAND_REPR'],
    'output_path': os.environ['OUTPUT_FILE'],
    'error': None,
}, open(os.environ['STATUS_FILE'], 'w'), indent=2)
"

# Run the command directly with preserved argv — no eval, no shell parsing.
"$@" > "$OUTPUT_FILE" 2>&1
EXIT_CODE=$?

DIRECTIVE="$DIRECTIVE" EXIT_CODE="$EXIT_CODE" \
STATUS_FILE="$STATUS_FILE" OUTPUT_FILE="$OUTPUT_FILE" \
python3 -c "
import json, os
from datetime import datetime, timezone
sf = os.environ['STATUS_FILE']
of = os.environ['OUTPUT_FILE']
ec = int(os.environ['EXIT_CODE'])
try:
    status = json.load(open(sf))
except Exception:
    status = {'directive': os.environ['DIRECTIVE'], 'pid': os.getppid()}
status['status'] = 'completed' if ec == 0 else 'failed'
status['completed_at'] = datetime.now(timezone.utc).isoformat()
status['exit_code'] = ec
status['output_path'] = of
if ec != 0:
    try:
        last_lines = open(of).read().strip().split('\n')[-20:]
        status['error'] = '\n'.join(last_lines)
    except Exception:
        status['error'] = f'Command exited with code {ec}'
json.dump(status, open(sf, 'w'), indent=2)
"

exit $EXIT_CODE
