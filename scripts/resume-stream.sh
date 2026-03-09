#!/usr/bin/env bash
# Resume a suspended (review) work stream: respawn session + delegator.
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
MAX_ACTIVE="$CONFIG_MAX_ACTIVE"

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
if [[ "$ITEM_STATUS" != "review" ]]; then
    echo "ERROR: Item $ITEM_ID is '$ITEM_STATUS', expected review" >&2
    exit 1
fi

IFS=$'\x1f' read -r ITEM_TITLE ITEM_BRANCH WORKTREE_PATH DELEGATOR_ENABLED ENV_REPO USE_WORKTREE \
    < <(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" title environment.branch environment.worktree_path worker.delegator_enabled environment.repo environment.use_worktree)

# Expand ~ in repo path
ENV_REPO="${ENV_REPO/#\~/$HOME}"

echo "Resuming: $ITEM_TITLE ($ITEM_ID)"

# Check concurrency (unified limit)
ACTIVE_COUNT="$(cd "$SCRIPT_DIR" && $QUEUE_PY count --status active)"
if [[ "$ACTIVE_COUNT" -ge "$MAX_ACTIVE" ]]; then
    echo "ERROR: Concurrency limit reached ($ACTIVE_COUNT/$MAX_ACTIVE active items)" >&2
    exit 1
fi

# Resolve worktree path: prefer non-worktree repo, then stored worktree_path, then branch prefix
if [[ "$USE_WORKTREE" == "False" && -n "$ENV_REPO" ]]; then
    WORKTREE_PATH="$ENV_REPO"
    if [[ ! -d "$WORKTREE_PATH" ]]; then
        mkdir -p "$WORKTREE_PATH"
        echo "  Created directory: $WORKTREE_PATH"
    fi
elif [[ -z "$WORKTREE_PATH" ]]; then
    WORKTREE_PATH="${WORKTREE_PREFIX}${ITEM_BRANCH}"
fi

# Guard: spawning a worker at the orchestrator's own directory would take over
# the orchestrator's vmux session. PROJECT_ROOT is computed dynamically from the
# script location — not hardcoded to any specific path.
REAL_WORKTREE="$(cd "$WORKTREE_PATH" 2>/dev/null && pwd -P)" || REAL_WORKTREE="$WORKTREE_PATH"
REAL_PROJECT="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P)" || REAL_PROJECT="$PROJECT_ROOT"
if [[ "$REAL_WORKTREE" == "$REAL_PROJECT" ]]; then
    echo "ERROR: WORKTREE_PATH resolved to the orchestrator root ($WORKTREE_PATH)" >&2
    echo "  This would take over the orchestrator's own session. Aborting." >&2
    exit 1
fi

if [[ "$USE_WORKTREE" != "False" && ! -d "$WORKTREE_PATH" ]]; then
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
(cd "$SCRIPT_DIR" && $QUEUE_PY update "$ITEM_ID" status=active environment.session_id="$SESSION_ID" environment.worktree_path="$WORKTREE_PATH")

echo "  Status: active (session: $SESSION_ID)"

# Send task reference to the resumed worker session
PLAN_FILE="$(cd "$SCRIPT_DIR" && $QUEUE_PY get "$ITEM_ID" plan.file)"

# Check PR merge status if a branch exists
PR_STATUS_MSG=""
if [[ -n "$ITEM_BRANCH" ]]; then
    PR_MERGE_JSON="$(cd "$REPO_PATH" && gh pr list --head "$ITEM_BRANCH" --json number,mergeable,mergeStateStatus --limit 1 2>/dev/null)" || PR_MERGE_JSON="[]"
    PR_MERGEABLE="$(echo "$PR_MERGE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('mergeable','') if d else '')" 2>/dev/null)" || PR_MERGEABLE=""
    PR_MERGE_STATE="$(echo "$PR_MERGE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('mergeStateStatus','') if d else '')" 2>/dev/null)" || PR_MERGE_STATE=""
    if [[ "$PR_MERGEABLE" == "CONFLICTING" || "$PR_MERGE_STATE" == "DIRTY" ]]; then
        PR_NUMBER="$(echo "$PR_MERGE_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('number','') if d else '')" 2>/dev/null)" || PR_NUMBER=""
        PR_STATUS_MSG="
WARNING: PR #${PR_NUMBER} has merge conflicts (mergeStateStatus: ${PR_MERGE_STATE}). You MUST rebase onto main and resolve conflicts before any other work."
    fi
fi

TASK_MESSAGE="[Task Resumed] $ITEM_TITLE

Read your full implementation plan and task context at: $PLAN_FILE

Branch: $ITEM_BRANCH
Status: Resuming — continue where you left off, following the plan steps in order.${PR_STATUS_MSG}"

# Retry sending the task message until the session is in standby
MESSAGE_SENT=false
for attempt in $(seq 1 12); do
    if $VMUX send "$SESSION_ID" "$TASK_MESSAGE" 2>/dev/null; then
        echo "  Task context sent to worker"
        MESSAGE_SENT=true
        break
    fi
    echo "  Attempt $attempt/12: session not ready, waiting 5s..."
    sleep 5
done
if [[ "$MESSAGE_SENT" == "false" ]]; then
    echo "  WARNING: Could not send task instructions after 60s (worker may not have entered standby)" >&2
fi

# Optionally spawn delegator (driven by item's delegator_enabled field, not type)
if [[ "$NO_DELEGATOR" == "false" && "$DELEGATOR_ENABLED" == "True" ]]; then
    echo "  Spawning delegator..."
    "$SCRIPT_DIR/spawn-delegator.sh" "$ITEM_ID" || {
        echo "  WARNING: Failed to spawn delegator" >&2
    }
fi

echo ""
echo "Resume complete!"
emit_event "stream.resumed" "Resumed from review: $ITEM_TITLE" --item-id "$ITEM_ID" --session-id "$SESSION_ID"
