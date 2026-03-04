#!/usr/bin/env bash
# Print comprehensive orchestrator status: queue overview, sessions, and health.
#
# Usage:
#   ./scripts/status.sh [--json]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
VMUX="$CONFIG_TOOL_VMUX"
ROSTRUM="$CONFIG_TOOL_ROSTRUM"
REPO_PATH="$CONFIG_REPO_PATH"
MAX_ACTIVE="$CONFIG_MAX_ACTIVE"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

JSON_OUTPUT=false
[[ "${1:-}" == "--json" ]] && JSON_OUTPUT=true

# Queue summary
QUEUE_SUMMARY="$(cd "$SCRIPT_DIR" && python3 -c "
import json, sys
sys.path.insert(0, '.')
from lib.queue import locked_queue

with locked_queue() as ctx:
    data = ctx['data']

items = data['items']
by_status = {}
by_type = {}
for item in items:
    by_status[item['status']] = by_status.get(item['status'], 0) + 1
    by_type[item['type']] = by_type.get(item['type'], 0) + 1

active_projects = sum(1 for i in items if i['status'] == 'active')
queued = [i for i in items if i['status'] in ('queued', 'planning')]
all_by_id = {i['id']: i for i in items}
blocked = [i for i in items if i.get('blocked_by') and any(all_by_id.get(dep, {}).get('status') != 'completed' for dep in i.get('blocked_by', []))]

print(json.dumps({
    'total': len(items),
    'by_status': by_status,
    'by_type': by_type,
    'active_projects': active_projects,
    'max_active': $MAX_ACTIVE,
    'slots_available': max(0, $MAX_ACTIVE - active_projects),
    'queued': [{'id': i['id'], 'title': i['title'], 'priority': i['priority'], 'type': i['type']} for i in queued],
    'blocked': [{'id': i['id'], 'title': i['title']} for i in blocked],
    'items': [{'id': i['id'], 'title': i['title'], 'status': i['status'], 'type': i['type'], 'priority': i['priority']} for i in items],
}))
")"

# Session summary
SESSIONS_RAW="$($VMUX sessions 2>&1)" || SESSIONS_RAW="(no sessions)"

# Worktree summary
WORKTREE_RAW="$(cd "$REPO_PATH" && $ROSTRUM list 2>&1)" || WORKTREE_RAW="(no worktrees)"

if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "$QUEUE_SUMMARY"
    exit 0
fi

# Human-readable output
echo "╔══════════════════════════════════════╗"
echo "║       Orchestrator Status            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Queue overview
echo "Queue:"
echo "$QUEUE_SUMMARY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'  Total items: {data[\"total\"]}')
print(f'  Active: {data[\"active_projects\"]}/{data[\"max_active\"]} (slots: {data[\"slots_available\"]})')
for status, count in sorted(data['by_status'].items()):
    print(f'  {status}: {count}')
"
echo ""

# Items list
echo "Work Items:"
echo "$QUEUE_SUMMARY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data['items']:
    status_icon = {
        'active': '●',
        'queued': '○',
        'planning': '◇',
        'paused': '◎',
        'review': '◆',
        'completed': '✓',
    }.get(item['status'], '?')
    print(f'  {status_icon} {item[\"id\"]:8} p{item[\"priority\"]} {item[\"title\"]}')
"
echo ""

# Next in queue
echo "$QUEUE_SUMMARY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data['queued']:
    print('Next up:')
    for item in data['queued'][:3]:
        print(f'  → {item[\"id\"]}: {item[\"title\"]} (p{item[\"priority\"]})')
    if data['slots_available'] > 0:
        print(f'  ({data[\"slots_available\"]} slot(s) available)')
    else:
        print('  (no slots available)')
else:
    print('Queue empty — nothing waiting to be activated.')
print()
"

# Blocked items
echo "$QUEUE_SUMMARY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data['blocked']:
    print('Blocked:')
    for item in data['blocked']:
        print(f'  ! {item[\"id\"]}: {item[\"title\"]}')
    print()
"

# Sessions
echo "Sessions:"
echo "$SESSIONS_RAW" | head -30
echo ""

# Worktrees
echo "Worktrees:"
echo "$WORKTREE_RAW" | head -20
