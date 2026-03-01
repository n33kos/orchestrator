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
    python3 -c "
import json, os
from pathlib import Path

delegators_dir = Path('$DELEGATORS_DIR')
results = []
for item_dir in delegators_dir.iterdir():
    if not item_dir.is_dir():
        continue
    status_file = item_dir / 'status.json'
    if status_file.exists():
        with open(status_file) as f:
            status = json.load(f)
        results.append(status)
    else:
        results.append({'item_id': item_dir.name, 'status': 'unknown'})

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
