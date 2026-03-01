#!/usr/bin/env bash
# Health check: detect zombie sessions, stalled streams, and auto-recover.
#
# Usage:
#   ./scripts/health-check.sh [--auto-recover] [--json]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
VMUX="$(grep 'vmux:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
MAX_ACTIVE="$(grep 'max_active_projects:' "$CONFIG" | sed 's/.*: *//')"
STALL_THRESHOLD_MIN="$(grep 'threshold_minutes:' "$CONFIG" | sed 's/.*: *//')"
STALL_THRESHOLD_MIN="${STALL_THRESHOLD_MIN:-30}"
STALL_THRESHOLD_HOURS="$(python3 -c "print($STALL_THRESHOLD_MIN / 60)")"

AUTO_RECOVER=false
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --auto-recover) AUTO_RECOVER=true ;;
        --json) JSON_OUTPUT=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# Get session list
SESSIONS_RAW="$($VMUX sessions 2>&1)" || SESSIONS_RAW=""

# Parse sessions
ZOMBIES=()
HEALTHY=()
TOTAL=0

while IFS= read -r line; do
    if [[ "$line" =~ \[zombie\][[:space:]]+([a-f0-9]+) ]]; then
        ZOMBIES+=("${BASH_REMATCH[1]}")
        TOTAL=$((TOTAL + 1))
    elif [[ "$line" =~ \[(standby|thinking|responding)\][[:space:]]+([a-f0-9]+) ]]; then
        HEALTHY+=("${BASH_REMATCH[2]}")
        TOTAL=$((TOTAL + 1))
    fi
done <<< "$SESSIONS_RAW"

# Get queue health
QUEUE_HEALTH="$(python3 -c "
import json
from datetime import datetime, timezone

with open('$QUEUE_FILE') as f:
    data = json.load(f)

active = [i for i in data['items'] if i['status'] == 'active']
stalled = []
for item in active:
    if item.get('activated_at'):
        activated = datetime.fromisoformat(item['activated_at'].replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        hours = (now - activated).total_seconds() / 3600
        if hours > $STALL_THRESHOLD_HOURS:
            stalled.append({'id': item['id'], 'title': item['title'], 'hours': round(hours, 1)})

blocked = [i for i in data['items'] if any(not b.get('resolved', False) for b in i.get('blockers', []))]

print(json.dumps({
    'active_count': len(active),
    'max_concurrent': $MAX_ACTIVE,
    'stalled': stalled,
    'blocked': [{'id': i['id'], 'title': i['title']} for i in blocked],
    'total_items': len(data['items']),
}))
")"

if [[ "$JSON_OUTPUT" == "true" ]]; then
    # Build zombie IDs as a proper JSON array
    ZOMBIE_JSON="[]"
    if [[ ${#ZOMBIES[@]} -gt 0 ]]; then
        ZOMBIE_JSON="$(printf '%s\n' "${ZOMBIES[@]}" | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))")"
    fi

    python3 -c "
import json
sessions = {
    'total': $TOTAL,
    'healthy': ${#HEALTHY[@]},
    'zombie': ${#ZOMBIES[@]},
    'zombie_list': json.loads('$ZOMBIE_JSON'),
}
queue = json.loads('''$QUEUE_HEALTH''')
issues = []
if sessions['zombie'] > 0:
    for zid in sessions['zombie_list']:
        issues.append({'type': 'zombie_session', 'id': zid, 'message': f'Session {zid} is a zombie'})
for s in queue.get('stalled', []):
    issues.append({'type': 'stalled_stream', 'id': s['id'], 'message': f'{s[\"title\"]} active for {s[\"hours\"]}h'})
for b in queue.get('blocked', []):
    issues.append({'type': 'blocked_item', 'id': b['id'], 'message': f'{b[\"title\"]} has unresolved blockers'})

health = {
    'sessions': sessions,
    'queue': queue,
    'issues': issues,
}
print(json.dumps(health, indent=2))
"
    exit 0
fi

# Human-readable output
echo "=== Orchestrator Health Check ==="
echo ""
echo "Sessions: $TOTAL total, ${#HEALTHY[@]} healthy, ${#ZOMBIES[@]} zombie"

if [[ ${#ZOMBIES[@]} -gt 0 ]]; then
    echo ""
    echo "Zombie sessions:"
    for zid in "${ZOMBIES[@]}"; do
        echo "  - $zid"
    done
fi

STALLED_COUNT="$(echo "$QUEUE_HEALTH" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['stalled']))")"
BLOCKED_COUNT="$(echo "$QUEUE_HEALTH" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['blocked']))")"
ACTIVE_COUNT="$(echo "$QUEUE_HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin)['active_count'])")"

echo ""
echo "Queue: $ACTIVE_COUNT active"

if [[ "$STALLED_COUNT" -gt 0 ]]; then
    echo ""
    echo "Stalled streams (active >24h):"
    echo "$QUEUE_HEALTH" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for s in data['stalled']:
    print(f\"  - {s['id']}: {s['title']} ({s['hours']}h)\")
"
fi

if [[ "$BLOCKED_COUNT" -gt 0 ]]; then
    echo ""
    echo "Blocked items:"
    echo "$QUEUE_HEALTH" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for b in data['blocked']:
    print(f\"  - {b['id']}: {b['title']}\")
"
fi

# Auto-recover zombies
if [[ "$AUTO_RECOVER" == "true" && ${#ZOMBIES[@]} -gt 0 ]]; then
    echo ""
    echo "Auto-recovering zombie sessions..."
    for zid in "${ZOMBIES[@]}"; do
        # Find the session's cwd from vmux sessions output
        CWD="$(echo "$SESSIONS_RAW" | grep -A5 "$zid" | grep 'cwd:' | sed 's/.*cwd: *//' | head -1)"
        if [[ -n "$CWD" ]]; then
            echo "  Reconnecting $zid ($CWD)..."
            if $VMUX reconnect "$CWD" 2>&1; then
                emit_event "health.recovered" "Recovered zombie session $zid" --session-id "$zid"
            else
                echo "    Failed to reconnect $zid"
                emit_event "health.recovery_failed" "Failed to recover zombie $zid" --session-id "$zid" --severity warn
            fi
        else
            echo "  Cannot find cwd for $zid, skipping"
        fi
    done
fi

# Summary
ISSUES=$((${#ZOMBIES[@]} + STALLED_COUNT + BLOCKED_COUNT))
if [[ "$ISSUES" -eq 0 ]]; then
    echo ""
    echo "All clear — no issues detected."
else
    echo ""
    echo "$ISSUES issue(s) detected."
fi
