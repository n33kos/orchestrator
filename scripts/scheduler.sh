#!/usr/bin/env bash
# Queue scheduler — checks for available concurrency slots and auto-activates
# the highest priority queued item.
#
# Usage:
#   ./scripts/scheduler.sh [--once] [--dry-run]
#
# Without --once, runs continuously (poll interval from config).
# With --dry-run, shows what would be activated without doing it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
MAX_ACTIVE="$(grep 'max_active_projects:' "$CONFIG" | sed 's/.*: *//')"
AUTO_ACTIVATE="$(grep 'auto_activate:' "$CONFIG" | sed 's/.*: *//')"
POLL_INTERVAL="$(grep 'poll_interval:' "$CONFIG" | sed 's/.*: *//')"
POLL_INTERVAL="${POLL_INTERVAL:-120}"
CLEANUP_EVERY="$(grep 'cleanup_every:' "$CONFIG" | sed 's/[^0-9]//g')"
CLEANUP_EVERY="${CLEANUP_EVERY:-10}"

ONCE=false
DRY_RUN=false
CLEANUP=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --once) ONCE=true ;;
        --dry-run) DRY_RUN=true ;;
        --cleanup) CLEANUP=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

function cleanup_completed() {
    # Archive completed items older than 7 days
    local archive_dir
    archive_dir="$(dirname "$QUEUE_FILE")/archive"
    mkdir -p "$archive_dir"

    python3 -c "
import json
from datetime import datetime, timezone, timedelta

with open('$QUEUE_FILE') as f:
    data = json.load(f)

cutoff = datetime.now(timezone.utc) - timedelta(days=7)
keep = []
archive = []

for item in data['items']:
    if item['status'] == 'completed' and item.get('completed_at'):
        try:
            completed = datetime.fromisoformat(item['completed_at'].replace('Z', '+00:00'))
            if completed.tzinfo is None:
                completed = completed.replace(tzinfo=timezone.utc)
            if completed < cutoff:
                archive.append(item)
                continue
        except (ValueError, TypeError):
            pass
    keep.append(item)

if not archive:
    print('[cleanup] No completed items older than 7 days')
else:
    # Write archive
    archive_file = '$archive_dir/archived-' + datetime.now().strftime('%Y-%m-%d') + '.json'
    try:
        with open(archive_file) as f:
            existing = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        existing = []
    existing.extend(archive)
    with open(archive_file, 'w') as f:
        json.dump(existing, f, indent=2)
        f.write('\n')

    # Update queue
    data['items'] = keep
    with open('$QUEUE_FILE', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    print(f'[cleanup] Archived {len(archive)} completed item(s) to {archive_file}')
    print(f'[cleanup] Queue now has {len(keep)} items')
"
}

function check_merged_prs() {
    # Check active items with PR URLs — if PR is merged, auto-complete
    python3 -c "
import json, subprocess, sys

with open('$QUEUE_FILE') as f:
    data = json.load(f)

active_with_pr = [
    i for i in data['items']
    if i['status'] == 'active' and i.get('pr_url')
]

if not active_with_pr:
    print('[pr-check] No active items with PR URLs')
    sys.exit(0)

for item in active_with_pr:
    pr_url = item['pr_url']
    # Extract owner/repo/number
    import re
    match = re.search(r'github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
    if not match:
        continue
    owner, repo, number = match.groups()
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', number, '--repo', f'{owner}/{repo}', '--json', 'state'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            continue
        state = json.loads(result.stdout).get('state', '')
        if state == 'MERGED':
            print(f'MERGED:{item[\"id\"]}:{item[\"title\"]}')
    except Exception:
        continue
"
}

function teardown_merged() {
    check_merged_prs | while IFS= read -r line; do
        if [[ "$line" == MERGED:* ]]; then
            local item_id item_title
            item_id="$(echo "$line" | cut -d: -f2)"
            item_title="$(echo "$line" | cut -d: -f3-)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo "[scheduler] Would auto-complete (PR merged): $item_id — $item_title"
            else
                echo "[scheduler] PR merged — auto-completing: $item_id — $item_title"
                emit_event "pr.merged" "PR merged, auto-completing: $item_title" --item-id "$item_id"
                "$SCRIPT_DIR/teardown-stream.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                    echo "[scheduler] ERROR: Failed to teardown $item_id" >&2
                    emit_event "scheduler.error" "Failed to teardown $item_id after PR merge" --item-id "$item_id" --severity error
                }
            fi
        else
            echo "$line"
        fi
    done
}

function check_and_activate() {
    # Check auto_activate setting
    if [[ "$AUTO_ACTIVATE" != "true" ]]; then
        echo "[scheduler] auto_activate is disabled in config"
        return 0
    fi

    # Get current state
    local state
    state="$(python3 -c "
import json, sys
with open('$QUEUE_FILE') as f:
    data = json.load(f)

active_projects = [i for i in data['items'] if i['status'] == 'active' and i['type'] == 'project']
active_qf = [i for i in data['items'] if i['status'] == 'active' and i['type'] == 'quick_fix']

# Items ready for activation (queued with approved plan, or queued quick fixes)
ready = []
for i in data['items']:
    if i['status'] not in ('queued', 'planning'):
        continue
    if not i.get('branch'):
        continue  # Can't activate without a branch
    # Check for unresolved blockers
    if any(not b.get('resolved') for b in i.get('blockers', [])):
        continue
    # Projects need approved plan (or no plan required for quick fixes)
    plan = i.get('metadata', {}).get('plan')
    if i['type'] == 'project' and plan and not plan.get('approved'):
        continue
    ready.append(i)

# Sort by priority
ready.sort(key=lambda x: x['priority'])

result = {
    'active_projects': len(active_projects),
    'active_qf': len(active_qf),
    'max_active': $MAX_ACTIVE,
    'slots_available': max(0, $MAX_ACTIVE - len(active_projects)),
    'ready': [{'id': i['id'], 'title': i['title'], 'type': i['type'], 'priority': i['priority']} for i in ready],
}
print(json.dumps(result))
")"

    local slots_available
    slots_available="$(echo "$state" | python3 -c "import json,sys; print(json.load(sys.stdin)['slots_available'])")"
    local ready_count
    ready_count="$(echo "$state" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['ready']))")"

    echo "[scheduler] Active projects: $(echo "$state" | python3 -c "import json,sys; print(json.load(sys.stdin)['active_projects'])")/$MAX_ACTIVE | Ready: $ready_count | Slots: $slots_available"

    if [[ "$ready_count" -eq 0 ]]; then
        echo "[scheduler] No items ready for activation"
        return 0
    fi

    # Activate ready items that fit in available slots
    echo "$state" | python3 -c "
import json, sys
state = json.load(sys.stdin)
slots = state['slots_available']

for item in state['ready']:
    if item['type'] == 'project':
        if slots <= 0:
            print(f'[scheduler] Skipping {item[\"id\"]}: {item[\"title\"]} (no project slots)')
            continue
        slots -= 1
    # Quick fixes always get activated
    print(f'ACTIVATE:{item[\"id\"]}:{item[\"type\"]}:{item[\"title\"]}')
" | while IFS= read -r line; do
        if [[ "$line" == ACTIVATE:* ]]; then
            local item_id item_type item_title
            item_id="$(echo "$line" | cut -d: -f2)"
            item_type="$(echo "$line" | cut -d: -f3)"
            item_title="$(echo "$line" | cut -d: -f4-)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo "[scheduler] Would activate: $item_id — $item_title ($item_type)"
            else
                echo "[scheduler] Activating: $item_id — $item_title ($item_type)"
                emit_event "scheduler.activating" "Auto-activating: $item_title" --item-id "$item_id"
                "$SCRIPT_DIR/activate-stream.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                    echo "[scheduler] ERROR: Failed to activate $item_id" >&2
                    emit_event "scheduler.error" "Failed to activate $item_id" --item-id "$item_id" --severity error
                }
            fi
        else
            echo "$line"
        fi
    done
}

if [[ "$CLEANUP" == "true" ]]; then
    cleanup_completed
    [[ "$ONCE" == "true" ]] && exit 0
fi

function recover_sessions() {
    echo "[health] Checking for zombie sessions..."
    "$SCRIPT_DIR/health-check.sh" --auto-recover 2>&1 | sed 's/^/  /'
}

if [[ "$ONCE" == "true" ]]; then
    recover_sessions
    teardown_merged
    check_and_activate
else
    echo "[scheduler] Starting continuous scheduler (Ctrl+C to stop)"
    echo "[scheduler] Poll interval: ${POLL_INTERVAL}s | Max active: $MAX_ACTIVE | Auto-activate: $AUTO_ACTIVATE"
    echo ""
    CYCLE=0
    while true; do
        recover_sessions
        teardown_merged
        check_and_activate
        # Run cleanup every N cycles
        CYCLE=$((CYCLE + 1))
        if [[ $((CYCLE % CLEANUP_EVERY)) -eq 0 ]]; then
            cleanup_completed
        fi
        echo "[scheduler] Next check in ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
    done
fi
