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
    state_file = item_dir / 'state.json'
    item_id = item_dir.name
    if state_file.exists():
        try:
            with open(state_file) as f:
                state = json.load(f)
            health = state.get('health', {})
            cycle_running = (item_dir / 'running.pid').exists()
            # Read saved cycle payload and triage output if they exist
            last_cycle_payload = None
            last_triage_output = None
            cycle_payload_file = item_dir / 'last-cycle-payload.json'
            triage_output_file = item_dir / 'last-triage-output.json'
            if cycle_payload_file.exists():
                try:
                    with open(cycle_payload_file) as f:
                        last_cycle_payload = json.load(f)
                except Exception:
                    last_cycle_payload = None
            if triage_output_file.exists():
                try:
                    with open(triage_output_file) as f:
                        last_triage_output = json.load(f)
                except Exception:
                    # Triage output may not be valid JSON (e.g. wrapped in markdown fences)
                    try:
                        last_triage_output = triage_output_file.read_text()
                    except Exception:
                        last_triage_output = None
            results.append({
                'item_id': state.get('item_id', item_id),
                'worker_session_id': state.get('worker_session_id', ''),
                'branch': state.get('branch', ''),
                'cycle_count': state.get('cycle_count', 0),
                'last_cycle_at': state.get('last_cycle_at'),
                'health': health,
                'cycle_running': cycle_running,
                'commits_reviewed': state.get('commits', {}).get('total_reviewed', 0),
                'stall_detected': state.get('flags', {}).get('stall_detected', False),
                'assessment': None,  # derived from latest cycle
                'pr': state.get('pr', {}),
                'worker_state': state.get('worker_state', {}),
                'flags': state.get('flags', {}),
                'lastCyclePayload': last_cycle_payload,
                'lastTriageOutput': last_triage_output,
            })
        except (json.JSONDecodeError, KeyError) as e:
            results.append({'item_id': item_id, 'health': {'status': 'error', 'last_error': str(e)}, 'cycle_running': False})
    else:
        results.append({'item_id': item_id, 'health': {'status': 'unknown'}, 'cycle_running': False})

print(json.dumps({'delegators': results}, indent=2))
"
else
    echo "=== Delegator Status ==="
    echo ""

    count=0
    for item_dir in "$DELEGATORS_DIR"/*/; do
        [[ -d "$item_dir" ]] || continue
        item_id="$(basename "$item_dir")"
        state_file="$item_dir/state.json"
        count=$((count + 1))

        if [[ -f "$state_file" ]]; then
            python3 -c "
import json
from pathlib import Path
try:
    with open('$state_file') as f:
        s = json.load(f)
    health = s.get('health', {})
    health_status = health.get('status', 'unknown')
    cycles = s.get('cycle_count', 0)
    last_cycle = s.get('last_cycle_at', 'never')
    commits = s.get('commits', {}).get('total_reviewed', 0)
    running = Path('$item_dir/running.pid').exists()
    state_label = 'RUNNING' if running else health_status.upper()
    print(f'  {s.get(\"item_id\", \"$item_id\")}')
    print(f'    Health: {state_label}')
    print(f'    Cycles: {cycles} (last: {last_cycle})')
    print(f'    Commits reviewed: {commits}')
    flags = s.get('flags', {})
    if flags.get('stall_detected'):
        print(f'    ⚠ Stall detected')
    if flags.get('ready_for_review'):
        print(f'    Ready for review')
except (json.JSONDecodeError, KeyError) as e:
    print(f'  $item_id')
    print(f'    Health: ERROR ({e})')
"
        else
            echo "  $item_id"
            echo "    Health: no state file"
        fi
        echo ""
    done

    if [[ "$count" -eq 0 ]]; then
        echo "  No delegator instances found."
    else
        echo "$count delegator(s) total."
    fi
fi
