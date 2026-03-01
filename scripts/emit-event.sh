#!/usr/bin/env bash
# Append a structured event to the orchestrator event log.
#
# Usage:
#   emit-event.sh <type> <message> [--item-id <id>] [--session-id <id>] [--severity <info|warn|error>]
#
# Or source this file and call emit_event directly:
#   source "$(dirname "$0")/emit-event.sh"
#   emit_event "stream.activated" "Activated work stream ws-003" --item-id ws-003

set -euo pipefail

EVENTS_FILE="${EVENTS_FILE:-$HOME/.claude/orchestrator/events.jsonl}"

emit_event() {
    local event_type="$1"
    local message="$2"
    shift 2

    local item_id=""
    local session_id=""
    local severity="info"
    local extra=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --item-id) item_id="$2"; shift 2 ;;
            --session-id) session_id="$2"; shift 2 ;;
            --severity) severity="$2"; shift 2 ;;
            --extra) extra="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local timestamp
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    mkdir -p "$(dirname "$EVENTS_FILE")"

    python3 -c "
import json, sys
event = {
    'timestamp': '$timestamp',
    'type': '$event_type',
    'message': '''$message''',
    'severity': '$severity',
}
if '$item_id': event['item_id'] = '$item_id'
if '$session_id': event['session_id'] = '$session_id'
if '''$extra''': event['extra'] = '''$extra'''
print(json.dumps(event))
" >> "$EVENTS_FILE"
}

# If called directly (not sourced), emit the event from args
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ $# -lt 2 ]]; then
        echo "Usage: emit-event.sh <type> <message> [--item-id <id>] [--session-id <id>] [--severity <info|warn|error>]" >&2
        exit 1
    fi
    emit_event "$@"
fi
