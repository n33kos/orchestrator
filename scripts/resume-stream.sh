#!/usr/bin/env bash
# Resume a suspended (review/paused) work stream: respawn session + delegator.
# The worktree should still exist from the prior activation.
#
# Usage:
#   ./scripts/resume-stream.sh <item-id> [--no-delegator]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
QUEUE_PY="python3 -m lib.queue"
VMUX="$CONFIG_TOOL_VMUX"
REPO_PATH="$CONFIG_REPO_PATH"
ROSTRUM="$CONFIG_TOOL_ROSTRUM"
WORKTREE_PREFIX="$CONFIG_WORKTREE_PREFIX"
MAX_ACTIVE="$CONFIG_MAX_ACTIVE_PROJECTS"

# shellcheck source=validate-env.sh
source "$SCRIPT_DIR/validate-env.sh"

ITEM_ID="${1:?Usage: resume-stream.sh <item-id> [--no-delegator]}"
NO_DELEGATOR=false

shift || true
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-delegator) NO_DELEGATOR=true ;;
        *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
    shift
done

# Read item and validate status
ITEM_STATUS="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" status)"
if [[ "$ITEM_STATUS" != "review" && "$ITEM_STATUS" != "paused" ]]; then
    echo "ERROR: Item $ITEM_ID is '$ITEM_STATUS', expected review or paused" >&2
    exit 1
fi

IFS=$'\t' read -r ITEM_TITLE ITEM_BRANCH ITEM_TYPE WORKTREE_PATH DELEGATOR_ENABLED \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" title branch type worktree_path delegator_enabled)

echo "Resuming: $ITEM_TITLE ($ITEM_ID)"

# Check concurrency
if [[ "$ITEM_TYPE" == "project" ]]; then
    ACTIVE_COUNT="$(cd "$SCRIPT_DIR" && $QUEUE_PY count --status active --type project)"
    if [[ "$ACTIVE_COUNT" -ge "$MAX_ACTIVE" ]]; then
        echo "ERROR: Concurrency limit reached ($ACTIVE_COUNT/$MAX_ACTIVE active projects)" >&2
        exit 1
    fi
fi

# Ensure worktree exists (it should, but be safe)
if [[ -z "$WORKTREE_PATH" ]]; then
    WORKTREE_PATH="${WORKTREE_PREFIX}${ITEM_BRANCH}"
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
    echo "  Worktree missing — recreating..."
    cd "$REPO_PATH"
    $ROSTRUM setup "$ITEM_BRANCH" --quick
fi

# Spawn worker session
echo "  Spawning worker session..."
$VMUX spawn "$WORKTREE_PATH" 2>&1 || true

SESSION_ID="$(python3 -c "
import hashlib
cwd = '$WORKTREE_PATH'
print(hashlib.sha256(cwd.encode()).hexdigest()[:12])
")"

# Update queue: move to active, set session ID
(cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" status=active session_id="$SESSION_ID" worktree_path="$WORKTREE_PATH")

echo "  Status: active (session: $SESSION_ID)"

# Send task reference to the resumed worker session
sleep 5
PLAN_FILE="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" metadata.plan_file)"

TASK_MESSAGE="[Task Resumed] $ITEM_TITLE

Read your full implementation plan and task context at: $PLAN_FILE

Branch: $ITEM_BRANCH
Status: Resuming — continue where you left off, following the plan steps in order."

if $VMUX send "$SESSION_ID" "$TASK_MESSAGE" 2>/dev/null; then
    echo "  Task context sent to worker"
fi

# Optionally spawn delegator
if [[ "$ITEM_TYPE" == "project" && "$NO_DELEGATOR" == "false" && "$DELEGATOR_ENABLED" == "True" ]]; then
    echo "  Spawning delegator..."
    "$SCRIPT_DIR/spawn-delegator.sh" "$ITEM_ID" || {
        echo "  WARNING: Failed to spawn delegator" >&2
    }
fi

echo ""
echo "Resume complete!"
emit_event "stream.resumed" "Resumed from review: $ITEM_TITLE" --item-id "$ITEM_ID" --session-id "$SESSION_ID"
