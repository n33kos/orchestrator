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

    mkdir -p "$(dirname "$EVENTS_FILE")" 2>/dev/null || true

    EVT_TIMESTAMP="$timestamp" \
    EVT_TYPE="$event_type" \
    EVT_MESSAGE="$message" \
    EVT_SEVERITY="$severity" \
    EVT_ITEM_ID="$item_id" \
    EVT_SESSION_ID="$session_id" \
    EVT_EXTRA="$extra" \
    python3 -c "
import json, os
event = {
    'timestamp': os.environ['EVT_TIMESTAMP'],
    'type': os.environ['EVT_TYPE'],
    'message': os.environ['EVT_MESSAGE'],
    'severity': os.environ['EVT_SEVERITY'],
}
if os.environ.get('EVT_ITEM_ID'):
    event['item_id'] = os.environ['EVT_ITEM_ID']
if os.environ.get('EVT_SESSION_ID'):
    event['session_id'] = os.environ['EVT_SESSION_ID']
if os.environ.get('EVT_EXTRA'):
    event['extra'] = os.environ['EVT_EXTRA']
print(json.dumps(event))
" >> "$EVENTS_FILE" 2>/dev/null || true
}

# If called directly (not sourced), emit the event from args
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ $# -lt 2 ]]; then
        echo "Usage: emit-event.sh <type> <message> [--item-id <id>] [--session-id <id>] [--severity <info|warn|error>]" >&2
        exit 1
    fi
    emit_event "$@"
fi
