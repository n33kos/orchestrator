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

# Parse config using shared parser
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
MAX_ACTIVE="$CONFIG_MAX_ACTIVE_PROJECTS"
MAX_QUICK_FIXES="${CONFIG_QUICK_FIX_LIMIT:-4}"
AUTO_ACTIVATE="$CONFIG_AUTO_ACTIVATE"
AUTO_APPROVE_PLANS="$CONFIG_AUTO_APPROVE_PLANS"
REQUIRE_APPROVED_PLAN="${CONFIG_REQUIRE_APPROVED_PLAN:-false}"
PLANS_DIR="${CONFIG_PLANS_DIR:-$HOME/.claude/orchestrator/plans}"
POLL_INTERVAL="${CONFIG_POLL_INTERVAL:-120}"
DELEGATOR_CYCLE_INTERVAL="${CONFIG_DELEGATOR_CYCLE_INTERVAL:-300}"
DELEGATOR_DEFAULT="${CONFIG_DELEGATOR_ENABLED:-true}"
CLEANUP_EVERY="${CONFIG_CLEANUP_EVERY:-10}"
ARCHIVE_AFTER_DAYS="${CONFIG_ARCHIVE_AFTER_DAYS:-7}"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

ONCE=false
DRY_RUN=false
CLEANUP=false
PID_FILE="$HOME/.claude/orchestrator/scheduler.pid"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --once) ONCE=true ;;
        --dry-run) DRY_RUN=true ;;
        --cleanup) CLEANUP=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# Write PID file so external processes can signal us
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

# SIGUSR1 handler — interrupts sleep for immediate config reload
CONFIG_CHANGED=false
trap 'CONFIG_CHANGED=true' USR1

function cleanup_completed() {
    # Archive completed items older than configured days
    local archive_dir
    archive_dir="$(dirname "$QUEUE_FILE")/archive"
    mkdir -p "$archive_dir"

    python3 -c "
import json
from datetime import datetime, timezone, timedelta

with open('$QUEUE_FILE') as f:
    data = json.load(f)

cutoff = datetime.now(timezone.utc) - timedelta(days=$ARCHIVE_AFTER_DAYS)
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
    # Write archive first — only update queue if archive succeeds
    archive_file = '$archive_dir/archived-' + datetime.now().strftime('%Y-%m-%d') + '.json'
    try:
        try:
            with open(archive_file) as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = []
        existing.extend(archive)
        with open(archive_file, 'w') as f:
            json.dump(existing, f, indent=2)
            f.write('\n')
    except OSError as e:
        print(f'[cleanup] ERROR: Failed to write archive: {e}', file=__import__('sys').stderr)
        print('[cleanup] Queue NOT modified — items preserved')
    else:
        # Archive write succeeded — safe to remove from queue
        data['items'] = keep
        with open('$QUEUE_FILE', 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print(f'[cleanup] Archived {len(archive)} completed item(s) to {archive_file}')
        print(f'[cleanup] Queue now has {len(keep)} items')
"
}

function rotate_event_log() {
    # Rotate events.jsonl when it exceeds 10000 lines
    local events_file
    events_file="$(dirname "$QUEUE_FILE")/events.jsonl"
    [[ -f "$events_file" ]] || return 0

    local line_count
    line_count="$(wc -l < "$events_file" | tr -d ' ')"
    if [[ "$line_count" -gt 10000 ]]; then
        local archive_dir
        archive_dir="$(dirname "$QUEUE_FILE")/archive"
        mkdir -p "$archive_dir"
        local rotated="$archive_dir/events-$(date +%Y-%m-%d-%H%M%S).jsonl"
        # Keep last 2000 lines, archive the rest
        head -n "$((line_count - 2000))" "$events_file" > "$rotated"
        tail -n 2000 "$events_file" > "$events_file.tmp"
        mv "$events_file.tmp" "$events_file"
        echo "[cleanup] Rotated event log: archived $((line_count - 2000)) entries to $rotated"
        # Compress old archives (older than 7 days)
        find "$archive_dir" -name "events-*.jsonl" -not -name "*.gz" -mtime +7 -exec gzip {} \; 2>/dev/null || true
        # Delete compressed archives older than 30 days
        find "$archive_dir" -name "events-*.jsonl.gz" -mtime +30 -delete 2>/dev/null || true
    fi
}

function check_merged_prs() {
    # Check active items with PR URLs — if PR is merged, auto-complete
    # Supports both single PRs and Graphite stacks
    python3 -c "
import json, subprocess, sys, re

with open('$QUEUE_FILE') as f:
    data = json.load(f)

active_with_pr = [
    i for i in data['items']
    if i['status'] == 'active' and i.get('pr_url')
]

if not active_with_pr:
    print('[pr-check] No active items with PR URLs')
    sys.exit(0)

def check_pr_state(pr_url):
    match = re.search(r'github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
    if not match:
        return None
    owner, repo, number = match.groups()
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', number, '--repo', f'{owner}/{repo}', '--json', 'state'],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return None
        return json.loads(result.stdout).get('state', '')
    except Exception:
        return None

for item in active_with_pr:
    pr_url = item['pr_url']
    is_stack = item.get('metadata', {}).get('pr_type') == 'graphite_stack'

    if is_stack:
        # For Graphite stacks, check all PRs in the stack
        # Find all PRs for this branch prefix
        match = re.search(r'github\.com/([^/]+)/([^/]+)/pull/(\d+)', pr_url)
        if not match:
            continue
        owner, repo, _ = match.groups()
        branch = item.get('branch', '')
        if not branch:
            continue
        try:
            # List PRs with matching head branch prefix
            result = subprocess.run(
                ['gh', 'pr', 'list', '--repo', f'{owner}/{repo}',
                 '--json', 'number,state,headRefName', '--limit', '20'],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode != 0:
                continue
            all_prs = json.loads(result.stdout)
            # Find PRs in this stack (branches starting with same prefix)
            branch_prefix = '/'.join(branch.split('/')[:3])  # e.g. me/project/name
            stack_prs = [p for p in all_prs if p['headRefName'].startswith(branch_prefix)]
            if not stack_prs:
                # Fallback to single PR check
                state = check_pr_state(pr_url)
                if state == 'MERGED':
                    print(f'MERGED:{item[\"id\"]}:{item[\"title\"]}')
                continue
            all_merged = all(p['state'] == 'MERGED' for p in stack_prs)
            merged_count = sum(1 for p in stack_prs if p['state'] == 'MERGED')
            total = len(stack_prs)
            if all_merged:
                print(f'MERGED:{item[\"id\"]}:{item[\"title\"]}')
            else:
                print(f'[pr-check] Stack {item[\"id\"]}: {merged_count}/{total} PRs merged')
        except Exception:
            continue
    else:
        state = check_pr_state(pr_url)
        if state == 'MERGED':
            print(f'MERGED:{item[\"id\"]}:{item[\"title\"]}')
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
    # Check if orchestrator is paused
    local pause_file="$HOME/.claude/orchestrator/paused"
    if [[ -f "$pause_file" ]]; then
        echo "[scheduler] Orchestrator is paused — skipping activation"
        return 0
    fi

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
    # Projects need a branch or a local_directory; quick fixes can activate without one
    has_branch = bool(i.get('branch'))
    has_local_dir = bool(i.get('metadata', {}).get('local_directory'))
    has_repo_path = bool(i.get('metadata', {}).get('repo_path'))
    if i['type'] == 'project' and not (has_branch or has_local_dir or has_repo_path):
        continue
    # Check for unresolved blockers
    if any(not b.get('resolved') for b in i.get('blockers', [])):
        continue
    # Check plan approval requirement if enabled
    require_plan = '$REQUIRE_APPROVED_PLAN' == 'true'
    if require_plan:
        plan = i.get('metadata', {}).get('plan', {})
        plan_file = i.get('metadata', {}).get('plan_file', '')
        plan_approved = plan.get('approved', False) if plan else False
        file_approved = i.get('metadata', {}).get('plan_approved', False)
        if not plan_approved and not file_approved:
            continue
    ready.append(i)

# Sort by priority
ready.sort(key=lambda x: x['priority'])

result = {
    'active_projects': len(active_projects),
    'active_qf': len(active_qf),
    'max_active': $MAX_ACTIVE,
    'max_qf': $MAX_QUICK_FIXES,
    'slots_available': max(0, $MAX_ACTIVE - len(active_projects)),
    'qf_slots_available': max(0, $MAX_QUICK_FIXES - len(active_qf)),
    'ready': [{'id': i['id'], 'title': i['title'], 'type': i['type'], 'priority': i['priority']} for i in ready],
}
print(json.dumps(result))
")"

    local slots_available
    slots_available="$(echo "$state" | python3 -c "import json,sys; print(json.load(sys.stdin)['slots_available'])")"
    local ready_count
    ready_count="$(echo "$state" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['ready']))")"

    local active_qf
    active_qf="$(echo "$state" | python3 -c "import json,sys; print(json.load(sys.stdin)['active_qf'])")"
    echo "[scheduler] Projects: $(echo "$state" | python3 -c "import json,sys; print(json.load(sys.stdin)['active_projects'])")/$MAX_ACTIVE | Quick fixes: $active_qf/$MAX_QUICK_FIXES | Ready: $ready_count | Slots: $slots_available"

    if [[ "$ready_count" -eq 0 ]]; then
        echo "[scheduler] No items ready for activation"
        return 0
    fi

    # Activate ready items that fit in available slots
    echo "$state" | python3 -c "
import json, sys
state = json.load(sys.stdin)
slots = state['slots_available']

qf_slots = state.get('qf_slots_available', 999)
for item in state['ready']:
    if item['type'] == 'project':
        if slots <= 0:
            print(f'[scheduler] Skipping {item[\"id\"]}: {item[\"title\"]} (no project slots)')
            continue
        slots -= 1
    elif item['type'] == 'quick_fix':
        if qf_slots <= 0:
            print(f'[scheduler] Skipping {item[\"id\"]}: {item[\"title\"]} (no quick fix slots)')
            continue
        qf_slots -= 1
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
                    # Rollback: if item was set to active but has no session, revert to queued
                    python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$item_id' and item['status'] == 'active' and not item.get('session_id'):
        item['status'] = 'queued'
        item.pop('activated_at', None)
        item.pop('worktree_path', None)
        with open('$QUEUE_FILE', 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        print(f'[scheduler] Rolled back $item_id to queued (no session created)')
        break
" 2>/dev/null || true
                }
            fi
        else
            echo "$line"
        fi
    done
}

if [[ "$CLEANUP" == "true" ]]; then
    cleanup_completed
    rotate_event_log
    [[ "$ONCE" == "true" ]] && exit 0
fi

function generate_plans() {
    # Auto-generate plans for queued projects that don't have one
    if [[ "$AUTO_ACTIVATE" != "true" ]]; then
        return 0
    fi

    python3 -c "
import json, sys

with open('$QUEUE_FILE') as f:
    data = json.load(f)

for item in data['items']:
    if item['status'] == 'queued' and item['type'] == 'project':
        plan = item.get('metadata', {}).get('plan')
        if not plan:
            print(f'PLAN:{item[\"id\"]}:{item[\"title\"]}')
" | while IFS= read -r line; do
        if [[ "$line" == PLAN:* ]]; then
            local item_id item_title
            item_id="$(echo "$line" | cut -d: -f2)"
            item_title="$(echo "$line" | cut -d: -f3-)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo "[scheduler] Would generate plan for: $item_id — $item_title"
            else
                echo "[scheduler] Generating plan for: $item_id — $item_title"
                local plan_args=("$item_id")
                [[ "$AUTO_APPROVE_PLANS" == "true" ]] && plan_args+=("--auto-approve")
                "$SCRIPT_DIR/generate-plan.sh" "${plan_args[@]}" 2>&1 | sed 's/^/  /' || {
                    echo "[scheduler] ERROR: Failed to generate plan for $item_id" >&2
                    emit_event "scheduler.error" "Failed to generate plan for $item_id" --item-id "$item_id" --severity error
                }
            fi
        else
            echo "$line"
        fi
    done
}

function check_planning_timeouts() {
    # Revert items stuck in "planning" without a completed plan back to "queued"
    # Only times out items where plan generation started but didn't produce a valid plan
    python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta

with open('$QUEUE_FILE') as f:
    data = json.load(f)

now = datetime.now(timezone.utc)
timeout = timedelta(minutes=10)
changed = False

for item in data['items']:
    if item['status'] != 'planning':
        continue
    plan = item.get('metadata', {}).get('plan') or {}
    # Skip items with a valid completed plan (has steps = generation succeeded)
    if plan.get('steps'):
        continue
    # Check how long the item has been in planning status
    activated = item.get('activated_at') or item.get('created_at')
    if not activated:
        continue
    try:
        activated_dt = datetime.fromisoformat(activated.replace('Z', '+00:00'))
        if now - activated_dt > timeout:
            print(f'TIMEOUT:{item[\"id\"]}:{item[\"title\"]}')
            item['status'] = 'queued'
            if item.get('metadata'):
                item['metadata']['plan'] = None
            changed = True
    except (ValueError, TypeError):
        continue

if changed:
    with open('$QUEUE_FILE', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
" | while IFS= read -r line; do
        if [[ "$line" == TIMEOUT:* ]]; then
            local item_id item_title
            item_id="$(echo "$line" | cut -d: -f2)"
            item_title="$(echo "$line" | cut -d: -f3-)"
            echo "[scheduler] Planning timeout: $item_id ($item_title) — reverting to queued"
            emit_event "scheduler.planning_timeout" "Plan timed out for $item_title" --item-id "$item_id" --severity warn
        fi
    done
}

function process_worker_completions() {
    # Find items marked completed by workers that still have active sessions/worktrees
    python3 -c "
import json, sys

with open('$QUEUE_FILE') as f:
    data = json.load(f)

for item in data['items']:
    if item['status'] == 'completed' and (item.get('session_id') or item.get('worktree_path')):
        print(f'TEARDOWN:{item[\"id\"]}:{item[\"title\"]}')
    elif item['status'] == 'review' and (item.get('session_id') or item.get('delegator_id')):
        # Safety net: review items should not have active sessions — suspend them
        print(f'SUSPEND:{item[\"id\"]}:{item[\"title\"]}')
    elif item['status'] == 'review' and item.get('metadata', {}).get('completion_message'):
        # Worker moved to review — log it for visibility
        msg = item['metadata']['completion_message']
        print(f'REVIEW:{item[\"id\"]}:{item[\"title\"]}:{msg}')
" | while IFS= read -r line; do
        if [[ "$line" == TEARDOWN:* ]]; then
            local item_id item_title
            item_id="$(echo "$line" | cut -d: -f2)"
            item_title="$(echo "$line" | cut -d: -f3-)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo "[scheduler] Would teardown (worker-completed): $item_id — $item_title"
            else
                echo "[scheduler] Worker reported done — tearing down: $item_id — $item_title"
                emit_event "scheduler.worker_teardown" "Auto-teardown after worker completion: $item_title" --item-id "$item_id"
                "$SCRIPT_DIR/teardown-stream.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                    echo "[scheduler] ERROR: Failed to teardown $item_id" >&2
                    emit_event "scheduler.error" "Failed to teardown $item_id after worker completion" --item-id "$item_id" --severity error
                }
            fi
        elif [[ "$line" == SUSPEND:* ]]; then
            local item_id item_title
            item_id="$(echo "$line" | cut -d: -f2)"
            item_title="$(echo "$line" | cut -d: -f3-)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo "[scheduler] Would suspend (review with active sessions): $item_id — $item_title"
            else
                echo "[scheduler] Safety net: suspending review item with active sessions: $item_id — $item_title"
                emit_event "scheduler.safety_suspend" "Suspending review item with lingering sessions: $item_title" --item-id "$item_id" --severity warn
                "$SCRIPT_DIR/suspend-stream.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                    echo "[scheduler] ERROR: Failed to suspend $item_id" >&2
                    emit_event "scheduler.error" "Failed to suspend $item_id" --item-id "$item_id" --severity error
                }
            fi
        elif [[ "$line" == REVIEW:* ]]; then
            local item_id item_title msg
            item_id="$(echo "$line" | cut -d: -f2)"
            item_title="$(echo "$line" | cut -d: -f3)"
            msg="$(echo "$line" | cut -d: -f4-)"
            echo "[scheduler] Worker moved to review: $item_id — $item_title ($msg)"
        else
            echo "$line"
        fi
    done
}

function check_services() {
    # Ensure critical services (vmux daemon, relay) are running
    local vmux_path
    vmux_path="$CONFIG_TOOL_VMUX"

    # Check vmux daemon
    if ! "$vmux_path" status &>/dev/null; then
        echo "[watchdog] vmux daemon is down — restarting..."
        emit_event "watchdog.service_restart" "Restarting vmux daemon" --severity warn
        launchctl start com.vmux.daemon 2>/dev/null || true
        sleep 3
        if "$vmux_path" status &>/dev/null; then
            echo "[watchdog] vmux daemon restarted successfully"
            emit_event "watchdog.service_recovered" "vmux daemon recovered"
        else
            echo "[watchdog] ERROR: vmux daemon failed to restart" >&2
            emit_event "watchdog.service_failed" "vmux daemon failed to restart" --severity error
        fi
    fi
}

function recover_delegators() {
    # Check each active item's delegator — respawn if dead or stalled
    local vmux_path="$CONFIG_TOOL_VMUX"
    local delegators_dir="$HOME/.claude/orchestrator/delegators"
    local stall_minutes="${CONFIG_STALL_THRESHOLD_MIN:-30}"

    python3 -c "
import json, subprocess, sys, os
from datetime import datetime, timezone, timedelta
from pathlib import Path

queue_file = '$QUEUE_FILE'
delegators_dir = Path('$delegators_dir')
vmux = '$vmux_path'
stall_minutes = $stall_minutes

with open(queue_file) as f:
    data = json.load(f)

# Find active items that should have delegators
active_items = [i for i in data['items'] if i['status'] == 'active' and i.get('delegator_id')]

if not active_items:
    sys.exit(0)

# Get live session list
try:
    result = subprocess.run([vmux, 'sessions'], capture_output=True, text=True, timeout=10)
    live_sessions = result.stdout if result.returncode == 0 else ''
except Exception:
    live_sessions = ''

now = datetime.now(timezone.utc)

for item in active_items:
    item_id = item['id']
    delegator_id = item['delegator_id']
    status_file = delegators_dir / item_id / 'status.json'

    needs_respawn = False
    reason = ''

    # Check 1: Is the delegator's tmux session actually alive?
    if delegator_id not in live_sessions:
        needs_respawn = True
        reason = f'session {delegator_id} not found in live sessions'
    else:
        # Check 2: Is the delegator stalled (no status update in threshold)?
        if status_file.exists():
            try:
                with open(status_file) as f:
                    status = json.load(f)
                last_check = status.get('last_check_at') or status.get('last_check') or status.get('started_at', '')
                if last_check:
                    ts = datetime.fromisoformat(last_check.replace('Z', '+00:00'))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    minutes_since = (now - ts).total_seconds() / 60
                    if minutes_since > stall_minutes * 3:
                        # Stalled for 3x the normal threshold — definitely stuck
                        needs_respawn = True
                        reason = f'stalled for {int(minutes_since)}m (last check: {last_check})'
                else:
                    # Never checked — if started > stall_minutes ago, it's stuck
                    started = status.get('started_at', '')
                    if started:
                        ts = datetime.fromisoformat(started.replace('Z', '+00:00'))
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        minutes_since = (now - ts).total_seconds() / 60
                        if minutes_since > stall_minutes:
                            needs_respawn = True
                            reason = f'never completed a check cycle (started {int(minutes_since)}m ago)'
            except (json.JSONDecodeError, KeyError):
                needs_respawn = True
                reason = 'corrupt status.json'

    if needs_respawn:
        print(f'RESPAWN:{item_id}:{reason}')
" | while IFS= read -r line; do
        if [[ "$line" == RESPAWN:* ]]; then
            local item_id reason
            item_id="$(echo "$line" | cut -d: -f2)"
            reason="$(echo "$line" | cut -d: -f3-)"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo "[watchdog] Would respawn delegator for $item_id: $reason"
            else
                echo "[watchdog] Respawning delegator for $item_id: $reason"
                emit_event "watchdog.delegator_respawn" "Respawning delegator for $item_id: $reason" --item-id "$item_id" --severity warn

                # Kill existing session if it's still around
                local old_delegator_id
                old_delegator_id="$(python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$item_id':
        print(item.get('delegator_id', ''))
        break
")"
                if [[ -n "$old_delegator_id" ]]; then
                    "$vmux_path" kill "$old_delegator_id" 2>/dev/null || true
                    sleep 1
                fi

                # Respawn
                "$SCRIPT_DIR/spawn-delegator.sh" "$item_id" 2>&1 | sed 's/^/    /' || {
                    echo "[watchdog] ERROR: Failed to respawn delegator for $item_id" >&2
                    emit_event "watchdog.delegator_respawn_failed" "Failed to respawn delegator for $item_id" --item-id "$item_id" --severity error
                }
            fi
        fi
    done
}

function trigger_delegator_cycles() {
    # Send monitoring cycle triggers to active delegators via vmux send.
    # This wakes up delegators that are blocking in relay_standby.
    local vmux_path="$CONFIG_TOOL_VMUX"

    python3 -c "
import json, sys
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['status'] == 'active' and item.get('delegator_id'):
        print(f'{item[\"id\"]}:{item[\"delegator_id\"]}')
" | while IFS= read -r line; do
        local item_id delegator_id
        item_id="$(echo "$line" | cut -d: -f1)"
        delegator_id="$(echo "$line" | cut -d: -f2)"
        # Send monitoring trigger — this wakes up relay_standby
        if "$vmux_path" send "$delegator_id" "[Scheduler] Run your monitoring cycle now. Check the worker transcript, review new commits, check for stalls, and send the worker a status check or feedback message." 2>/dev/null; then
            echo "[scheduler] Triggered monitoring cycle for $item_id delegator"
        else
            echo "[scheduler] WARNING: Failed to trigger $item_id delegator ($delegator_id)" >&2
        fi
    done
}

function recover_sessions() {
    echo "[health] Checking for zombie sessions..."
    "$SCRIPT_DIR/health-check.sh" --auto-recover 2>&1 | sed 's/^/  /'
}

function reconcile_state() {
    # Enforce desired state every polling cycle. This is the PRIMARY mechanism
    # for ensuring active items have sessions and review items do not.
    #
    # For ACTIVE items:
    #   - Must have a live worker session (respawn if missing/zombie)
    #   - Must have a delegator if delegator_enabled (spawn if missing)
    # For REVIEW items:
    #   - Must NOT have active sessions (suspend if found)
    local vmux_path="$CONFIG_TOOL_VMUX"

    python3 -c "
import json, subprocess, sys

queue_file = '$QUEUE_FILE'
vmux = '$vmux_path'
delegator_default = '$DELEGATOR_DEFAULT'

with open(queue_file) as f:
    data = json.load(f)

# Get live sessions from vmux
try:
    result = subprocess.run([vmux, 'sessions'], capture_output=True, text=True, timeout=10)
    sessions_output = result.stdout if result.returncode == 0 else ''
except Exception:
    sessions_output = ''

# Parse session IDs and their states from vmux sessions output
# Format: [state] session_id
live_sessions = set()
zombie_sessions = set()
for line in sessions_output.split('\n'):
    line = line.strip()
    if not line:
        continue
    # Lines like: [standby] abc123def456
    # or:         [zombie] abc123def456
    if line.startswith('[') and ']' in line:
        bracket_end = line.index(']')
        state = line[1:bracket_end]
        session_id = line[bracket_end+1:].strip()
        if session_id:
            if state == 'zombie':
                zombie_sessions.add(session_id)
            else:
                live_sessions.add(session_id)

all_known = live_sessions | zombie_sessions

for item in data['items']:
    item_id = item['id']
    status = item['status']

    if status == 'active':
        session_id = item.get('session_id') or ''
        delegator_id = item.get('delegator_id') or ''
        worktree_path = item.get('worktree_path') or ''
        delegator_enabled = item.get('delegator_enabled')
        if delegator_enabled is None:
            delegator_enabled = delegator_default == 'true' or delegator_default == 'True'
        else:
            delegator_enabled = str(delegator_enabled) in ('true', 'True')

        # Check worker session
        if not session_id:
            # No session_id recorded at all — need to spawn
            if worktree_path:
                print(f'ACTION:{item_id}:spawn_worker:{worktree_path}')
            else:
                print(f'WARN:{item_id}:Active item has no session_id and no worktree_path', file=sys.stderr)
        elif session_id in zombie_sessions:
            # Session exists but is a zombie — respawn it
            print(f'ACTION:{item_id}:respawn_worker:{worktree_path}:{session_id}')
        elif session_id not in live_sessions:
            # Session ID is recorded but not found in vmux at all — respawn
            if worktree_path:
                print(f'ACTION:{item_id}:spawn_worker:{worktree_path}')
            else:
                print(f'WARN:{item_id}:Active item has missing session and no worktree_path', file=sys.stderr)

        # Check delegator (only if delegator_enabled)
        if delegator_enabled:
            if not delegator_id:
                # No delegator recorded — spawn one
                print(f'ACTION:{item_id}:spawn_delegator:')
            elif delegator_id in zombie_sessions:
                # Delegator is a zombie — respawn
                print(f'ACTION:{item_id}:respawn_delegator:{delegator_id}')
            elif delegator_id not in live_sessions:
                # Delegator missing entirely — spawn fresh
                print(f'ACTION:{item_id}:spawn_delegator:')

    elif status == 'review':
        session_id = item.get('session_id') or ''
        delegator_id = item.get('delegator_id') or ''
        # Review items should NOT have active sessions
        if session_id or delegator_id:
            print(f'ACTION:{item_id}:suspend_review:')
" 2>/dev/null | while IFS= read -r line; do
        if [[ "$line" == ACTION:* ]]; then
            local item_id action details
            item_id="$(echo "$line" | cut -d: -f2)"
            action="$(echo "$line" | cut -d: -f3)"
            details="$(echo "$line" | cut -d: -f4-)"

            case "$action" in
                spawn_worker)
                    local worktree_path="$details"
                    if [[ "$DRY_RUN" == "true" ]]; then
                        echo "[reconcile] Would spawn worker for $item_id at $worktree_path"
                    else
                        echo "[reconcile] Spawning missing worker session for $item_id at $worktree_path"
                        emit_event "reconcile.spawn_worker" "Spawning missing worker for $item_id" --item-id "$item_id" --severity warn
                        if "$vmux_path" spawn "$worktree_path" 2>&1 | sed 's/^/  /'; then
                            # Update session_id in queue
                            local new_session_id
                            new_session_id="$(python3 -c "
import hashlib
print(hashlib.sha256('$worktree_path'.encode()).hexdigest()[:12])
")"
                            python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$item_id':
        item['session_id'] = '$new_session_id'
        break
with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
" 2>/dev/null || true
                            echo "[reconcile] Worker spawned for $item_id (session: $new_session_id)"
                        else
                            echo "[reconcile] WARNING: Failed to spawn worker for $item_id" >&2
                            emit_event "reconcile.spawn_worker_failed" "Failed to spawn worker for $item_id" --item-id "$item_id" --severity error
                        fi
                    fi
                    ;;
                respawn_worker)
                    local worktree_path old_session_id
                    worktree_path="$(echo "$details" | cut -d: -f1)"
                    old_session_id="$(echo "$details" | cut -d: -f2)"
                    if [[ "$DRY_RUN" == "true" ]]; then
                        echo "[reconcile] Would respawn zombie worker for $item_id ($old_session_id)"
                    else
                        echo "[reconcile] Respawning zombie worker for $item_id ($old_session_id)"
                        emit_event "reconcile.respawn_worker" "Respawning zombie worker $old_session_id for $item_id" --item-id "$item_id" --severity warn
                        "$vmux_path" kill "$old_session_id" 2>/dev/null || true
                        sleep 2
                        if "$vmux_path" spawn "$worktree_path" 2>&1 | sed 's/^/  /'; then
                            local new_session_id
                            new_session_id="$(python3 -c "
import hashlib
print(hashlib.sha256('$worktree_path'.encode()).hexdigest()[:12])
")"
                            python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$item_id':
        item['session_id'] = '$new_session_id'
        break
with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
" 2>/dev/null || true
                            echo "[reconcile] Worker respawned for $item_id (session: $new_session_id)"
                        else
                            echo "[reconcile] WARNING: Failed to respawn worker for $item_id" >&2
                            emit_event "reconcile.respawn_worker_failed" "Failed to respawn worker for $item_id" --item-id "$item_id" --severity error
                        fi
                    fi
                    ;;
                spawn_delegator)
                    if [[ "$DRY_RUN" == "true" ]]; then
                        echo "[reconcile] Would spawn delegator for $item_id"
                    else
                        echo "[reconcile] Spawning missing delegator for $item_id"
                        emit_event "reconcile.spawn_delegator" "Spawning missing delegator for $item_id" --item-id "$item_id" --severity warn
                        "$SCRIPT_DIR/spawn-delegator.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                            echo "[reconcile] WARNING: Failed to spawn delegator for $item_id" >&2
                            emit_event "reconcile.spawn_delegator_failed" "Failed to spawn delegator for $item_id" --item-id "$item_id" --severity error
                        }
                    fi
                    ;;
                respawn_delegator)
                    local old_delegator_id="$details"
                    if [[ "$DRY_RUN" == "true" ]]; then
                        echo "[reconcile] Would respawn zombie delegator for $item_id ($old_delegator_id)"
                    else
                        echo "[reconcile] Respawning zombie delegator for $item_id ($old_delegator_id)"
                        emit_event "reconcile.respawn_delegator" "Respawning zombie delegator $old_delegator_id for $item_id" --item-id "$item_id" --severity warn
                        "$vmux_path" kill "$old_delegator_id" 2>/dev/null || true
                        sleep 1
                        "$SCRIPT_DIR/spawn-delegator.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                            echo "[reconcile] WARNING: Failed to respawn delegator for $item_id" >&2
                            emit_event "reconcile.respawn_delegator_failed" "Failed to respawn delegator for $item_id" --item-id "$item_id" --severity error
                        }
                    fi
                    ;;
                suspend_review)
                    if [[ "$DRY_RUN" == "true" ]]; then
                        echo "[reconcile] Would suspend review item $item_id (has active sessions)"
                    else
                        echo "[reconcile] Suspending review item $item_id (has lingering sessions)"
                        emit_event "reconcile.suspend_review" "Suspending review item with active sessions: $item_id" --item-id "$item_id" --severity warn
                        "$SCRIPT_DIR/suspend-stream.sh" "$item_id" 2>&1 | sed 's/^/  /' || {
                            echo "[reconcile] WARNING: Failed to suspend $item_id" >&2
                            emit_event "reconcile.suspend_failed" "Failed to suspend review item $item_id" --item-id "$item_id" --severity error
                        }
                    fi
                    ;;
                *)
                    echo "[reconcile] Unknown action: $action for $item_id"
                    ;;
            esac
        fi
    done
}

if [[ "$ONCE" == "true" ]]; then
    check_services
    recover_sessions
    recover_delegators
    trigger_delegator_cycles
    process_worker_completions
    teardown_merged
    check_planning_timeouts
    generate_plans
    reconcile_state
    check_and_activate
else
    function reload_config() {
        # Re-read config to pick up dashboard settings changes
        eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"
        QUEUE_FILE="$CONFIG_QUEUE_FILE"
        MAX_ACTIVE="$CONFIG_MAX_ACTIVE_PROJECTS"
        MAX_QUICK_FIXES="${CONFIG_QUICK_FIX_LIMIT:-4}"
        AUTO_ACTIVATE="$CONFIG_AUTO_ACTIVATE"
        AUTO_APPROVE_PLANS="$CONFIG_AUTO_APPROVE_PLANS"
        REQUIRE_APPROVED_PLAN="${CONFIG_REQUIRE_APPROVED_PLAN:-false}"
        PLANS_DIR="${CONFIG_PLANS_DIR:-$HOME/.claude/orchestrator/plans}"
        POLL_INTERVAL="${CONFIG_POLL_INTERVAL:-120}"
        DELEGATOR_CYCLE_INTERVAL="${CONFIG_DELEGATOR_CYCLE_INTERVAL:-300}"
        CLEANUP_EVERY="${CONFIG_CLEANUP_EVERY:-10}"
        ARCHIVE_AFTER_DAYS="${CONFIG_ARCHIVE_AFTER_DAYS:-7}"
        # Recalculate delegator trigger frequency
        DELEGATOR_TRIGGER_EVERY=$(( (DELEGATOR_CYCLE_INTERVAL + POLL_INTERVAL - 1) / POLL_INTERVAL ))
    }

    # Initial calculation
    DELEGATOR_TRIGGER_EVERY=$(( (DELEGATOR_CYCLE_INTERVAL + POLL_INTERVAL - 1) / POLL_INTERVAL ))
    echo "[scheduler] Starting continuous scheduler (Ctrl+C to stop)"
    echo "[scheduler] Poll interval: ${POLL_INTERVAL}s | Delegator cycle: ${DELEGATOR_CYCLE_INTERVAL}s (every ${DELEGATOR_TRIGGER_EVERY} cycles) | Max active: $MAX_ACTIVE | Auto-activate: $AUTO_ACTIVATE"
    echo ""
    CYCLE=0
    while true; do
        # Reload config each cycle to pick up settings changes
        reload_config
        check_services
        recover_sessions
        recover_delegators
        # Only trigger delegator cycles at the configured interval
        if [[ $((CYCLE % DELEGATOR_TRIGGER_EVERY)) -eq 0 ]]; then
            trigger_delegator_cycles
        fi
        process_worker_completions
        teardown_merged
        check_planning_timeouts
        generate_plans
        reconcile_state
        check_and_activate
        # Run cleanup every N cycles
        CYCLE=$((CYCLE + 1))
        if [[ $((CYCLE % CLEANUP_EVERY)) -eq 0 ]]; then
            cleanup_completed
            rotate_event_log
        fi
        echo "[scheduler] Next check in ${POLL_INTERVAL}s..."
        # Sleep in 1s increments so SIGUSR1 can interrupt quickly
        for (( _s=0; _s<POLL_INTERVAL; _s++ )); do
            if [[ "$CONFIG_CHANGED" == "true" ]]; then
                CONFIG_CHANGED=false
                echo "[scheduler] Config change signal received — running immediate cycle"
                break
            fi
            sleep 1
        done
    done
fi
