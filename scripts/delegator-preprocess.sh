#!/usr/bin/env bash
# Pre-process all monitoring data for a delegator cycle.
#
# Gathers worker status, transcript, commits, PR state, and CI checks
# programmatically, then writes a structured JSON payload for the triage
# agent to consume in a single one-shot Claude invocation.
#
# Usage:
#   ./scripts/delegator-preprocess.sh <item-id> [state-file-path]
#
# Output:
#   /tmp/delegator-cycle-<item-id>.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

# Parse config for VMUX path and other settings
CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

VMUX="$CONFIG_TOOL_VMUX"
PROFILE_FILE="${CONFIG_PROFILE_FILE:-}"

# --- Inputs ---
ITEM_ID="${1:?Usage: delegator-preprocess.sh <item-id> [state-file-path]}"
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
STATE_FILE="${2:-$DELEGATOR_DIR/state.json}"
OUTPUT_FILE="/tmp/delegator-cycle-${ITEM_ID}.json"

# Write running PID for liveness detection
mkdir -p "$DELEGATOR_DIR"
echo "$$:$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DELEGATOR_DIR/running.pid"

# Read transcript_lines_triage from config (default 100)
TRANSCRIPT_LINES="$(python3 -c "
import re, os
config_path = '$CONFIG'
default = '100'
try:
    with open(config_path) as f:
        in_delegator = False
        for line in f:
            stripped = line.split('#')[0].rstrip()
            if not stripped:
                continue
            if stripped == 'delegator:':
                in_delegator = True
                continue
            if not stripped.startswith(' ') and stripped.endswith(':'):
                in_delegator = False
                continue
            if in_delegator:
                m = re.match(r'^\s+transcript_lines_triage:\s*(\d+)', stripped)
                if m:
                    print(m.group(1))
                    raise SystemExit(0)
    print(default)
except Exception:
    print(default)
" 2>/dev/null || echo "100")"

QUEUE_PY="python3 -m lib.queue"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

emit_event "delegator.preprocess_start" "Pre-processing cycle for $ITEM_ID" --item-id "$ITEM_ID"

# ============================================================
# Step 1: Read queue item data
# ============================================================
ITEM_JSON="$(cd "$SCRIPT_DIR" && $QUEUE_PY get-item "$ITEM_ID" 2>/dev/null)" || {
    echo "ERROR: Failed to read queue item $ITEM_ID" >&2
    ITEM_JSON="{}"
}

# Step 2: Extract fields from queue
WORKER_SESSION_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)" || WORKER_SESSION_ID=""
WORKTREE_PATH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('worktree_path',''))" 2>/dev/null)" || WORKTREE_PATH=""
BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('branch',''))" 2>/dev/null)" || BRANCH=""

# Resolve actual git repo path (may differ from worktree_path for workspace-based items)
GIT_REPO_PATH="$(echo "$ITEM_JSON" | python3 -c "
import json, sys, os
data = json.load(sys.stdin)
meta = data.get('metadata', {})
repo = meta.get('actual_repo_path') or meta.get('repo_path', '')
if repo:
    print(os.path.expanduser(repo))
else:
    print(data.get('worktree_path', ''))
" 2>/dev/null)" || GIT_REPO_PATH="$WORKTREE_PATH"

# ============================================================
# Step 3: Check if worker session is alive
# ============================================================
SESSION_ALIVE="false"
if [[ -n "$WORKER_SESSION_ID" ]]; then
    if $VMUX sessions 2>/dev/null | grep -q "$WORKER_SESSION_ID"; then
        SESSION_ALIVE="true"
    fi
fi

# ============================================================
# Step 4: Run idle check
# ============================================================
IDLE_CHECK="$(python3 "$SCRIPT_DIR/read-worker-transcript.py" "$WORKTREE_PATH" --format idle-check 2>/dev/null)" || IDLE_CHECK="UNKNOWN"

# ============================================================
# Step 5: Get activity summary from transcript
# ============================================================
ACTIVITY_SUMMARY="$(python3 "$SCRIPT_DIR/delegator-summarize-transcript.py" "$WORKTREE_PATH" --lines "$TRANSCRIPT_LINES" 2>/dev/null)" || ACTIVITY_SUMMARY="{}"

# ============================================================
# Step 5b: Get recent conversation transcript (raw text for triage context)
# ============================================================
CONVERSATION_RECENT="$(python3 "$SCRIPT_DIR/read-worker-transcript.py" "$WORKTREE_PATH" --lines 30 --format summary 2>/dev/null)" || CONVERSATION_RECENT=""

# ============================================================
# Step 5c: Read user profile
# ============================================================
PROFILE_CONTENT=""
if [[ -n "$PROFILE_FILE" && -f "$PROFILE_FILE" ]]; then
    PROFILE_CONTENT="$(cat "$PROFILE_FILE" 2>/dev/null)" || PROFILE_CONTENT=""
fi

# ============================================================
# Step 6-7: Check for new commits and get diffs
# ============================================================
# Read the last seen commit hash from previous state
LAST_SEEN_HASH=""
if [[ -f "$STATE_FILE" ]]; then
    LAST_SEEN_HASH="$(python3 -c "
import json, sys
try:
    with open('$STATE_FILE') as f:
        state = json.load(f)
    # Check both top-level and nested paths (commits.last_seen_hash)
    h = (state.get('commits', {}).get('last_seen_hash')
         or state.get('last_seen_commit')
         or state.get('last_seen_hash')
         or '')
    print(h)
except Exception:
    print('')
" 2>/dev/null)" || LAST_SEEN_HASH=""
fi

NEW_COMMITS_RAW=""
DIFF_STAT=""
DIFF_CONTENT=""

if [[ -n "$GIT_REPO_PATH" && -d "$GIT_REPO_PATH" ]]; then
    if [[ -n "$LAST_SEEN_HASH" ]]; then
        NEW_COMMITS_RAW="$(cd "$GIT_REPO_PATH" && git log --oneline "${LAST_SEEN_HASH}..HEAD" 2>/dev/null)" || NEW_COMMITS_RAW=""
        DIFF_STAT="$(cd "$GIT_REPO_PATH" && git diff --stat "${LAST_SEEN_HASH}..HEAD" 2>/dev/null)" || DIFF_STAT=""
        DIFF_CONTENT="$(cd "$GIT_REPO_PATH" && git diff "${LAST_SEEN_HASH}..HEAD" 2>/dev/null)" || DIFF_CONTENT=""
    else
        # No last seen hash — show recent commit history for context (last 20)
        NEW_COMMITS_RAW="$(cd "$GIT_REPO_PATH" && git log --oneline -20 2>/dev/null)" || NEW_COMMITS_RAW=""
        DIFF_STAT="$(cd "$GIT_REPO_PATH" && git diff --stat HEAD~5..HEAD 2>/dev/null)" || DIFF_STAT=""
        DIFF_CONTENT="$(cd "$GIT_REPO_PATH" && git diff HEAD~5..HEAD 2>/dev/null | head -500)" || DIFF_CONTENT=""
    fi
fi

# ============================================================
# Step 8: Check for PR
# ============================================================
PR_JSON=""
if [[ -n "$GIT_REPO_PATH" && -d "$GIT_REPO_PATH" && -n "$BRANCH" ]]; then
    PR_JSON="$(cd "$GIT_REPO_PATH" && gh pr list --head "$BRANCH" --json number,title,state,url --limit 1 2>/dev/null)" || PR_JSON="[]"
fi

# ============================================================
# Step 9-10: Check CI status and merge status if PR exists
# ============================================================
CI_CHECKS_RAW=""
MERGE_STATUS_JSON=""
PR_NUMBER=""

if [[ -n "$PR_JSON" && "$PR_JSON" != "[]" ]]; then
    PR_NUMBER="$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['number'] if d else '')" 2>/dev/null)" || PR_NUMBER=""
    if [[ -n "$PR_NUMBER" ]]; then
        CI_CHECKS_RAW="$(cd "$GIT_REPO_PATH" && gh pr checks "$PR_NUMBER" 2>/dev/null)" || CI_CHECKS_RAW=""
        MERGE_STATUS_JSON="$(cd "$GIT_REPO_PATH" && gh pr view "$PR_NUMBER" --json mergeable,mergeStateStatus 2>/dev/null)" || MERGE_STATUS_JSON=""
    fi
fi

# ============================================================
# Step 11: Read previous state file
# ============================================================
PREVIOUS_STATE="{}"
if [[ -f "$STATE_FILE" ]]; then
    PREVIOUS_STATE="$(cat "$STATE_FILE" 2>/dev/null)" || PREVIOUS_STATE="{}"
fi

# ============================================================
# Step 12: Compile JSON payload via Python
# ============================================================
ITEM_ID_ENV="$ITEM_ID" \
TIMESTAMP_ENV="$TIMESTAMP" \
SESSION_ALIVE_ENV="$SESSION_ALIVE" \
IDLE_CHECK_ENV="$IDLE_CHECK" \
ACTIVITY_SUMMARY_ENV="$ACTIVITY_SUMMARY" \
NEW_COMMITS_RAW_ENV="$NEW_COMMITS_RAW" \
DIFF_STAT_ENV="$DIFF_STAT" \
DIFF_CONTENT_ENV="$DIFF_CONTENT" \
PR_JSON_ENV="$PR_JSON" \
CI_CHECKS_RAW_ENV="$CI_CHECKS_RAW" \
MERGE_STATUS_JSON_ENV="$MERGE_STATUS_JSON" \
PREVIOUS_STATE_ENV="$PREVIOUS_STATE" \
CONVERSATION_RECENT_ENV="$CONVERSATION_RECENT" \
ITEM_JSON_ENV="$ITEM_JSON" \
PROFILE_CONTENT_ENV="$PROFILE_CONTENT" \
OUTPUT_FILE_ENV="$OUTPUT_FILE" \
python3 << 'PYEOF'
import json
import os
import re

item_id = os.environ["ITEM_ID_ENV"]
timestamp = os.environ["TIMESTAMP_ENV"]
session_alive = os.environ["SESSION_ALIVE_ENV"] == "true"
idle_check = os.environ["IDLE_CHECK_ENV"]
activity_summary_raw = os.environ["ACTIVITY_SUMMARY_ENV"]
new_commits_raw = os.environ["NEW_COMMITS_RAW_ENV"]
diff_stat = os.environ["DIFF_STAT_ENV"]
diff_content = os.environ["DIFF_CONTENT_ENV"]
pr_json_raw = os.environ["PR_JSON_ENV"]
ci_checks_raw = os.environ["CI_CHECKS_RAW_ENV"]
merge_status_raw = os.environ["MERGE_STATUS_JSON_ENV"]
previous_state_raw = os.environ["PREVIOUS_STATE_ENV"]
conversation_recent = os.environ.get("CONVERSATION_RECENT_ENV", "")
item_json_raw = os.environ.get("ITEM_JSON_ENV", "{}")
profile_content = os.environ.get("PROFILE_CONTENT_ENV", "")
output_file = os.environ["OUTPUT_FILE_ENV"]

# Parse activity summary (may be JSON or plain text)
try:
    activity_summary = json.loads(activity_summary_raw)
except (json.JSONDecodeError, ValueError):
    activity_summary = {"raw": activity_summary_raw} if activity_summary_raw else {}

# Parse new commits into structured list
new_commits = []
for line in new_commits_raw.strip().splitlines():
    line = line.strip()
    if not line:
        continue
    parts = line.split(" ", 1)
    commit_hash = parts[0]
    message = parts[1] if len(parts) > 1 else ""
    new_commits.append({"hash": commit_hash, "message": message})

# Truncate diff_content to 5000 chars
MAX_DIFF = 5000
if len(diff_content) > MAX_DIFF:
    diff_content = diff_content[:MAX_DIFF] + "\n... [truncated at 5000 chars]"

# Parse PR data
pr_exists = False
pr_url = ""
pr_state = ""
pr_number = None
try:
    pr_list = json.loads(pr_json_raw) if pr_json_raw else []
    if pr_list:
        pr_exists = True
        pr_url = pr_list[0].get("url", "")
        pr_state = pr_list[0].get("state", "")
        pr_number = pr_list[0].get("number")
except (json.JSONDecodeError, ValueError):
    pass

# Parse CI checks
ci_total = 0
ci_passing = 0
ci_failing = 0
failing_names = []
for line in ci_checks_raw.strip().splitlines():
    line = line.strip()
    if not line:
        continue
    ci_total += 1
    if re.search(r'\bpass\b', line, re.IGNORECASE):
        ci_passing += 1
    elif re.search(r'\bfail\b', line, re.IGNORECASE):
        ci_failing += 1
        # Extract check name (first column before any tab/multiple spaces)
        name = re.split(r'\t|\s{2,}', line)[0]
        failing_names.append(name)

# Parse merge status
mergeable = None
merge_state_status = None
try:
    if merge_status_raw:
        merge_data = json.loads(merge_status_raw)
        mergeable = merge_data.get("mergeable") == "MERGEABLE"
        merge_state_status = merge_data.get("mergeStateStatus")
except (json.JSONDecodeError, ValueError):
    pass

# Parse previous state
try:
    previous_state = json.loads(previous_state_raw)
except (json.JSONDecodeError, ValueError):
    previous_state = {}

# Parse queue item data
try:
    item_data = json.loads(item_json_raw)
except (json.JSONDecodeError, ValueError):
    item_data = {}

# Extract item context for triage
item_context = {
    "title": item_data.get("title", ""),
    "description": item_data.get("description", ""),
    "metadata": item_data.get("metadata", {}),
}

# Read plan file if specified in metadata
plan_content = ""
plan_file = item_data.get("metadata", {}).get("plan_file", "")
if plan_file:
    try:
        with open(os.path.expanduser(plan_file)) as pf:
            plan_content = pf.read()[:5000]  # Truncate to 5K chars
    except (OSError, IOError):
        pass

# Compute cycle number from previous state
cycle_number = previous_state.get("cycle_number", 0) + 1

# Build the payload
payload = {
    "cycle_number": cycle_number,
    "timestamp": timestamp,
    "item_id": item_id,
    "item_context": item_context,
    "plan": plan_content,
    "user_profile": profile_content,
    "worker": {
        "session_alive": session_alive,
        "idle_check": idle_check,
        "activity_summary": activity_summary,
    },
    "conversation_recent": conversation_recent,
    "commits": {
        "new_commits": new_commits,
        "diff_stat": diff_stat,
        "diff_content": diff_content,
    },
    "pr": {
        "exists": pr_exists,
        "url": pr_url,
        "state": pr_state,
        "ci_checks": {
            "total": ci_total,
            "passing": ci_passing,
            "failing": ci_failing,
            "failing_names": failing_names,
        },
        "mergeable": mergeable,
        "merge_state_status": merge_state_status,
    },
    "previous_state": previous_state,
}

with open(output_file, "w") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")

print(f"Wrote {output_file}")
PYEOF

emit_event "delegator.preprocess_done" "Pre-processed cycle $ITEM_ID -> $OUTPUT_FILE" --item-id "$ITEM_ID"
echo "Pre-processing complete: $OUTPUT_FILE"
