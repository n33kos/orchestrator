#!/usr/bin/env bash
# Run a directive command for a work item.
# Creates a status file that the delegator and the scheduler's supervisor read.
#
# Usage: run-directive.sh [--cwd <dir>] [--timeout-minutes <n>] <item-id> <directive-name> <cmd> [arg ...]
#
# Each command argument is passed as a separate token (no shell parsing of
# the command — no `eval`). This avoids quoting bugs and command injection.
#
# The command runs in its own process group so the supervisor can stop the
# whole tree (claude, playwright, browsers) with one signal, and a heartbeat
# thread keeps the status file fresh so "is it alive" never needs guessing.

set -uo pipefail

RUN_CWD=""
TIMEOUT_MINUTES=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --cwd)
      RUN_CWD="${2:?--cwd needs a directory}"
      shift 2
      ;;
    --timeout-minutes)
      TIMEOUT_MINUTES="${2:?--timeout-minutes needs a number}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

ITEM_ID="${1:?Usage: run-directive.sh [--cwd <dir>] <item-id> <directive-name> <cmd> [arg ...]}"
DIRECTIVE="${2:?Missing directive name}"
shift 2

if [ "$#" -eq 0 ]; then
  echo "ERROR: No command provided" >&2
  exit 1
fi

if [ -n "$RUN_CWD" ] && [ ! -d "$RUN_CWD" ]; then
  echo "ERROR: --cwd directory does not exist: $RUN_CWD" >&2
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

: > "$OUTPUT_FILE"

DIRECTIVE="$DIRECTIVE" COMMAND_REPR="$COMMAND_REPR" \
STATUS_FILE="$STATUS_FILE" OUTPUT_FILE="$OUTPUT_FILE" \
RUN_CWD="${RUN_CWD:-$PWD}" TIMEOUT_MINUTES="$TIMEOUT_MINUTES" \
python3 -c "
import json, os
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
tm = os.environ.get('TIMEOUT_MINUTES') or ''
json.dump({
    'directive': os.environ['DIRECTIVE'],
    'status': 'running',
    'pid': os.getppid(),
    'pgid': None,
    'cwd': os.environ['RUN_CWD'],
    'timeout_minutes': int(tm) if tm.isdigit() else None,
    'started_at': now,
    'last_heartbeat': now,
    'output_bytes': 0,
    'completed_at': None,
    'exit_code': None,
    'command': os.environ['COMMAND_REPR'],
    'output_path': os.environ['OUTPUT_FILE'],
    'error': None,
}, open(os.environ['STATUS_FILE'], 'w'), indent=2)
"

# Heartbeat: refresh last_heartbeat and output_bytes while the command runs, so
# a reader can distinguish "working" from "wedged" without inspecting processes.
heartbeat() {
  set -m
  while :; do
    sleep 15
    STATUS_FILE="$STATUS_FILE" OUTPUT_FILE="$OUTPUT_FILE" python3 -c "
import json, os
from datetime import datetime, timezone
sf = os.environ['STATUS_FILE']
try:
    st = json.load(open(sf))
except Exception:
    raise SystemExit(0)
if st.get('status') != 'running':
    raise SystemExit(0)
st['last_heartbeat'] = datetime.now(timezone.utc).isoformat()
try:
    st['output_bytes'] = os.path.getsize(os.environ['OUTPUT_FILE'])
except OSError:
    pass
json.dump(st, open(sf, 'w'), indent=2)
" 2>/dev/null || return 0
  done
}
# Detach the heartbeat's stdio so its `sleep` never holds this script's
# stdout pipe open after the command finishes, and give it its own process
# group so stopping it takes the sleep with it.
heartbeat > /dev/null 2>&1 &
HEARTBEAT_PID=$!

cleanup_heartbeat() {
  kill -- "-$HEARTBEAT_PID" 2>/dev/null || kill "$HEARTBEAT_PID" 2>/dev/null
  wait "$HEARTBEAT_PID" 2>/dev/null
}
trap cleanup_heartbeat EXIT

# Run the command in its own process group (setsid via python, since macOS has
# no setsid binary) with preserved argv — no eval, no shell parsing. The group
# id is what makes a clean whole-tree stop possible later.
if [ -n "$RUN_CWD" ]; then
  cd "$RUN_CWD" || exit 1
fi

python3 -c "
import os, sys
os.setsid()
os.execvp(sys.argv[1], sys.argv[1:])
" "$@" > "$OUTPUT_FILE" 2>&1 &
CMD_PID=$!

STATUS_FILE="$STATUS_FILE" CMD_PID="$CMD_PID" python3 -c "
import json, os
sf = os.environ['STATUS_FILE']
try:
    st = json.load(open(sf))
except Exception:
    raise SystemExit(0)
pid = int(os.environ['CMD_PID'])
st['command_pid'] = pid
st['pgid'] = pid  # setsid makes the child its own group leader
json.dump(st, open(sf, 'w'), indent=2)
"

wait "$CMD_PID"
EXIT_CODE=$?

cleanup_heartbeat
trap - EXIT

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
# A supervisor that stopped this run already recorded why; don't overwrite it.
if status.get('status') not in ('killed', 'timed_out'):
    status['status'] = 'completed' if ec == 0 else 'failed'
status['completed_at'] = datetime.now(timezone.utc).isoformat()
status['exit_code'] = ec
status['output_path'] = of
try:
    status['output_bytes'] = os.path.getsize(of)
except OSError:
    pass
if ec != 0:
    try:
        last_lines = open(of).read().strip().split('\n')[-20:]
        status['error'] = '\n'.join(last_lines)
    except Exception:
        status['error'] = f'Command exited with code {ec}'
json.dump(status, open(sf, 'w'), indent=2)
"

exit $EXIT_CODE
