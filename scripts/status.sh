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
MAX_ACTIVE="$CONFIG_MAX_ACTIVE_PROJECTS"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

JSON_OUTPUT=false
[[ "${1:-}" == "--json" ]] && JSON_OUTPUT=true

# Queue summary
QUEUE_SUMMARY="$(python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)

items = data['items']
by_status = {}
by_type = {}
for item in items:
    by_status[item['status']] = by_status.get(item['status'], 0) + 1
    by_type[item['type']] = by_type.get(item['type'], 0) + 1

active_projects = sum(1 for i in items if i['status'] == 'active' and i['type'] == 'project')
queued = [i for i in items if i['status'] in ('queued', 'planning')]
blocked = [i for i in items if any(not b.get('resolved', False) for b in i.get('blockers', []))]

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
print(f'  Active projects: {data[\"active_projects\"]}/{data[\"max_active\"]} (slots: {data[\"slots_available\"]})')
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
    type_tag = 'P' if item['type'] == 'project' else 'Q'
    print(f'  {status_icon} [{type_tag}] {item[\"id\"]:8} p{item[\"priority\"]} {item[\"title\"]}')
"
echo ""

# Next in queue
echo "$QUEUE_SUMMARY" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if data['queued']:
    print('Next up:')
    for item in data['queued'][:3]:
        print(f'  → {item[\"id\"]}: {item[\"title\"]} (p{item[\"priority\"]}, {item[\"type\"]})')
    if data['slots_available'] > 0:
        print(f'  ({data[\"slots_available\"]} slot(s) available for projects)')
    else:
        print('  (no project slots available)')
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
