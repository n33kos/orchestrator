#!/usr/bin/env bash
# Check status of all running delegator instances.
#
# Usage:
#   ./scripts/delegator-status.sh [--json]

set -euo pipefail

DELEGATORS_DIR="$HOME/.claude/orchestrator/delegators"
JSON_OUTPUT=false

[[ "${1:-}" == "--json" ]] && JSON_OUTPUT=true

if [[ ! -d "$DELEGATORS_DIR" ]]; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        echo '{"delegators": []}'
    else
        echo "No delegators directory found."
    fi
    exit 0
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
    # Grab live session IDs from vmux to cross-reference
    VMUX_PATH="${HOME}/.local/bin/vmux"
    LIVE_SESSIONS=""
    if [[ -x "$VMUX_PATH" ]]; then
        LIVE_SESSIONS=$("$VMUX_PATH" sessions 2>/dev/null || true)
    fi

    QUEUE_FILE="$HOME/.claude/orchestrator/queue.json"
    python3 -c "
import json, os, re
from pathlib import Path

delegators_dir = Path('$DELEGATORS_DIR')
queue_file = '$QUEUE_FILE'
vmux_output = '''$LIVE_SESSIONS'''

# Parse live session IDs from vmux sessions output
live_ids = set()
for line in vmux_output.splitlines():
    m = re.match(r'^\s+\[\w+\]\s+(\w+)', line)
    if m:
        live_ids.add(m.group(1))

# Load delegator_id mapping from queue
delegator_ids = {}
try:
    with open(queue_file) as f:
        queue = json.load(f)
    for item in queue.get('items', []):
        if item.get('delegator_id'):
            delegator_ids[item['id']] = item['delegator_id']
except Exception:
    pass

results = []
for item_dir in delegators_dir.iterdir():
    if not item_dir.is_dir():
        continue
    status_file = item_dir / 'status.json'
    item_id = item_dir.name
    if status_file.exists():
        try:
            with open(status_file) as f:
                status = json.load(f)
            # Check if the DELEGATOR session is alive (not the worker)
            delegator_session = delegator_ids.get(item_id, '')
            status['session_alive'] = delegator_session in live_ids if delegator_session else False
            results.append(status)
        except (json.JSONDecodeError, KeyError) as e:
            results.append({'item_id': item_id, 'status': 'parse_error', 'session_alive': False, 'error': str(e)})
    else:
        results.append({'item_id': item_id, 'status': 'unknown', 'session_alive': False})

print(json.dumps({'delegators': results}, indent=2))
"
else
    echo "=== Delegator Status ==="
    echo ""

    count=0
    for item_dir in "$DELEGATORS_DIR"/*/; do
        [[ -d "$item_dir" ]] || continue
        item_id="$(basename "$item_dir")"
        status_file="$item_dir/status.json"
        count=$((count + 1))

        if [[ -f "$status_file" ]]; then
            python3 -c "
import json
try:
    with open('$status_file') as f:
        s = json.load(f)
    status = s.get('status', 'unknown')
    worker = s.get('worker_session', 'unknown')
    commits = s.get('commits_reviewed', 0)
    issues = len(s.get('issues_found', []))
    print(f'  {s.get(\"item_id\", \"$item_id\")}')
    print(f'    Status: {status}')
    print(f'    Worker: {worker}')
    print(f'    Commits reviewed: {commits}')
    print(f'    Issues found: {issues}')
    if s.get('assessment'):
        print(f'    Assessment: {s[\"assessment\"]}')
except (json.JSONDecodeError, KeyError) as e:
    print(f'  $item_id')
    print(f'    Status: parse_error ({e})')
"
        else
            echo "  $item_id"
            echo "    Status: no status file"
        fi
        echo ""
    done

    if [[ "$count" -eq 0 ]]; then
        echo "  No delegator instances found."
    else
        echo "$count delegator(s) total."
    fi
fi
