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
#   ~/.claude/orchestrator/delegators/<item-id>/cycle-<item-id>.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# shellcheck source=emit-event.sh
source "$SCRIPT_DIR/emit-event.sh"

# Parse config for VMUX path and other settings
CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

VMUX="$CONFIG_TOOL_VMUX"
# --- Inputs ---
ITEM_ID="${1:?Usage: delegator-preprocess.sh <item-id> [state-file-path]}"
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
STATE_FILE="${2:-$DELEGATOR_DIR/state.json}"
OUTPUT_FILE="$DELEGATOR_DIR/cycle-${ITEM_ID}.json"

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
WORKER_SESSION_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print((json.load(sys.stdin).get('environment') or {}).get('session_id',''))" 2>/dev/null)" || WORKER_SESSION_ID=""
WORKTREE_PATH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print((json.load(sys.stdin).get('environment') or {}).get('worktree_path',''))" 2>/dev/null)" || WORKTREE_PATH=""
BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print((json.load(sys.stdin).get('environment') or {}).get('branch',''))" 2>/dev/null)" || BRANCH=""

# Resolve actual git repo path (may differ from worktree_path for workspace-based items)
GIT_REPO_PATH="$(echo "$ITEM_JSON" | python3 -c "
import json, sys, os
data = json.load(sys.stdin)
env = data.get('environment') or {}
repo = env.get('repo', '')
if repo:
    print(os.path.expanduser(repo))
else:
    print(env.get('worktree_path', ''))
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
IS_GRAPHITE_STACK="$(echo "$ITEM_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if (d.get('worker') or {}).get('commit_strategy')=='graphite_stack' else 'false')" 2>/dev/null)" || IS_GRAPHITE_STACK="false"

if [[ -n "$GIT_REPO_PATH" && -d "$GIT_REPO_PATH" && -n "$BRANCH" ]]; then
    if [[ "$IS_GRAPHITE_STACK" == "true" ]]; then
        # Graphite stacks: branch is a prefix, actual PR branches are children.
        # Use --search with head: prefix to find all stack PRs, --state all to include drafts.
        PR_JSON="$(cd "$GIT_REPO_PATH" && gh pr list --search "head:$BRANCH" --state all --json number,title,state,url,isDraft --limit 20 2>/dev/null)" || PR_JSON="[]"
    else
        # Standard items: exact branch match, --state all to include drafts
        PR_JSON="$(cd "$GIT_REPO_PATH" && gh pr list --head "$BRANCH" --state all --json number,title,state,url,isDraft --limit 1 2>/dev/null)" || PR_JSON="[]"
    fi
fi

# ============================================================
# Step 9-10: Check CI status and merge status if PR exists
# ============================================================
CI_CHECKS_RAW=""
MERGE_STATUS_JSON=""
PR_NUMBER=""
# Per-PR CI checks and merge status for Graphite stacks (JSON array)
PER_PR_CI_JSON="[]"

if [[ -n "$PR_JSON" && "$PR_JSON" != "[]" ]]; then
    if [[ "$IS_GRAPHITE_STACK" == "true" ]]; then
        # Graphite stack: collect CI checks and merge status for ALL PRs
        PR_NUMBERS="$(echo "$PR_JSON" | python3 -c "import json,sys; [print(p['number']) for p in json.load(sys.stdin)]" 2>/dev/null)" || PR_NUMBERS=""
        PER_PR_ENTRIES="["
        FIRST_ENTRY="true"
        while IFS= read -r NUM; do
            [[ -z "$NUM" ]] && continue
            PR_CI="$(cd "$GIT_REPO_PATH" && gh pr checks "$NUM" 2>/dev/null || true)"
            PR_MERGE="$(cd "$GIT_REPO_PATH" && gh pr view "$NUM" --json mergeable,mergeStateStatus 2>/dev/null)" || PR_MERGE="{}"
            # Escape for JSON embedding
            PR_CI_ESCAPED="$(echo "$PR_CI" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" 2>/dev/null)" || PR_CI_ESCAPED='""'
            PR_MERGE_ESCAPED="$(echo "$PR_MERGE" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" 2>/dev/null)" || PR_MERGE_ESCAPED='"{}"'
            if [[ "$FIRST_ENTRY" == "true" ]]; then
                FIRST_ENTRY="false"
            else
                PER_PR_ENTRIES+=","
            fi
            PER_PR_ENTRIES+="{\"number\":$NUM,\"ci_raw\":$PR_CI_ESCAPED,\"merge_raw\":$PR_MERGE_ESCAPED}"
        done <<< "$PR_NUMBERS"
        PER_PR_ENTRIES+="]"
        PER_PR_CI_JSON="$PER_PR_ENTRIES"
        # Set PR_NUMBER to first for backward compat; CI_CHECKS_RAW stays empty (per-PR used instead)
        PR_NUMBER="$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['number'] if d else '')" 2>/dev/null)" || PR_NUMBER=""
    else
        # Standard (non-stack) item: single PR
        PR_NUMBER="$(echo "$PR_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['number'] if d else '')" 2>/dev/null)" || PR_NUMBER=""
        if [[ -n "$PR_NUMBER" ]]; then
            CI_CHECKS_RAW="$(cd "$GIT_REPO_PATH" && gh pr checks "$PR_NUMBER" 2>/dev/null || true)"
            MERGE_STATUS_JSON="$(cd "$GIT_REPO_PATH" && gh pr view "$PR_NUMBER" --json mergeable,mergeStateStatus 2>/dev/null)" || MERGE_STATUS_JSON=""
        fi
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
# Pipe all data as null-delimited fields through stdin to a Python script that
# creates a single JSON payload file. This avoids the "Argument list too long"
# error from exceeding macOS's ~256KB execve limit when passing large
# diffs/transcripts as environment variables. Bash printf+pipe uses write()
# syscalls, not execve, so there is no size limit.
PAYLOAD_FILE="$DELEGATOR_DIR/preprocess-payload.json"

# Step 12a: Serialize all raw inputs into a single JSON file via stdin pipe.
# Fields are null-delimited (\0) so they can contain any content safely.
printf '%s\0' \
    "$ITEM_ID" \
    "$TIMESTAMP" \
    "$SESSION_ALIVE" \
    "$IDLE_CHECK" \
    "$ACTIVITY_SUMMARY" \
    "$NEW_COMMITS_RAW" \
    "$DIFF_STAT" \
    "$DIFF_CONTENT" \
    "$PR_JSON" \
    "$CI_CHECKS_RAW" \
    "$MERGE_STATUS_JSON" \
    "$PREVIOUS_STATE" \
    "$CONVERSATION_RECENT" \
    "$ITEM_JSON" \
    "$OUTPUT_FILE" \
    "$PER_PR_CI_JSON" \
    "$PROJECT_ROOT" \
| python3 -c '
import json, sys
fields = sys.stdin.buffer.read().split(b"\0")
# Last split element is empty (trailing delimiter)
keys = [
    "item_id", "timestamp", "session_alive", "idle_check",
    "activity_summary", "new_commits_raw", "diff_stat", "diff_content",
    "pr_json", "ci_checks_raw", "merge_status_json", "previous_state",
    "conversation_recent", "item_json", "output_file",
    "per_pr_ci_json", "project_root",
]
data = {k: fields[i].decode("utf-8", errors="replace") if i < len(fields) else "" for i, k in enumerate(keys)}
json.dump(data, sys.stdout)
' > "$PAYLOAD_FILE"

# Step 12b: Process the single payload file into the final output.
python3 - "$PAYLOAD_FILE" << 'PYEOF'
import json
import os
import re
import sys

with open(sys.argv[1], "r") as f:
    raw = json.load(f)

item_id = raw.get("item_id", "")
timestamp = raw.get("timestamp", "")
session_alive = raw.get("session_alive", "") == "true"
idle_check = raw.get("idle_check", "")
activity_summary_raw = raw.get("activity_summary", "")
new_commits_raw = raw.get("new_commits_raw", "")
diff_stat = raw.get("diff_stat", "")
diff_content = raw.get("diff_content", "")
pr_json_raw = raw.get("pr_json", "")
ci_checks_raw = raw.get("ci_checks_raw", "")
merge_status_raw = raw.get("merge_status_json", "")
per_pr_ci_json_raw = raw.get("per_pr_ci_json", "[]")
previous_state_raw = raw.get("previous_state", "")
conversation_recent = raw.get("conversation_recent", "")
item_json_raw = raw.get("item_json", "") or "{}"
output_file = raw.get("output_file", "")

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
all_prs = []
try:
    pr_list = json.loads(pr_json_raw) if pr_json_raw else []
    if pr_list:
        pr_exists = True
        pr_url = pr_list[0].get("url", "")
        pr_state = pr_list[0].get("state", "")
        pr_number = pr_list[0].get("number")
        # For Graphite stacks, capture all PRs
        all_prs = [
            {
                "number": p.get("number"),
                "title": p.get("title", ""),
                "state": p.get("state", ""),
                "url": p.get("url", ""),
                "isDraft": p.get("isDraft", False),
            }
            for p in pr_list
        ]
except (json.JSONDecodeError, ValueError):
    pass

def parse_ci_checks(raw_text):
    """Parse gh pr checks output into structured counts."""
    total = 0
    passing = 0
    failing = 0
    failing_names_list = []
    for line in raw_text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        total += 1
        if re.search(r'\bpass\b', line, re.IGNORECASE):
            passing += 1
        elif re.search(r'\bfail\b', line, re.IGNORECASE):
            failing += 1
            name = re.split(r'\t|\s{2,}', line)[0]
            failing_names_list.append(name)
    return total, passing, failing, failing_names_list

def parse_merge_status(raw_text):
    """Parse gh pr view merge status JSON."""
    try:
        if raw_text:
            data = json.loads(raw_text)
            return (data.get("mergeable") == "MERGEABLE", data.get("mergeStateStatus"))
    except (json.JSONDecodeError, ValueError):
        pass
    return None, None

# Parse per-PR CI data (Graphite stacks) or fall back to single-PR parsing
per_pr_ci = []
ci_total = 0
ci_passing = 0
ci_failing = 0
failing_names = []
mergeable = None
merge_state_status = None

try:
    per_pr_entries = json.loads(per_pr_ci_json_raw) if per_pr_ci_json_raw else []
except (json.JSONDecodeError, ValueError):
    per_pr_entries = []

if per_pr_entries:
    # Graphite stack: aggregate CI and merge status across all PRs
    any_unmergeable = False
    unmergeable_prs = []
    for entry in per_pr_entries:
        pr_num = entry.get("number")
        pr_ci_raw = entry.get("ci_raw", "")
        pr_merge_raw = entry.get("merge_raw", "")
        t, p, f, fn = parse_ci_checks(pr_ci_raw)
        ci_total += t
        ci_passing += p
        ci_failing += f
        failing_names.extend(fn)
        per_pr_ci.append({
            "number": pr_num,
            "total": t,
            "passing": p,
            "failing": f,
            "failing_names": fn,
            "no_checks": t == 0,
        })
        # Parse merge status for this PR
        pr_mergeable, pr_merge_state = parse_merge_status(pr_merge_raw)
        per_pr_ci[-1]["mergeable"] = pr_mergeable
        per_pr_ci[-1]["merge_state_status"] = pr_merge_state
        if pr_mergeable is False:
            any_unmergeable = True
            unmergeable_prs.append(pr_num)
    # Aggregate: unmergeable if ANY PR is unmergeable
    if any_unmergeable:
        mergeable = False
        merge_state_status = f"UNMERGEABLE_PRS:{','.join(str(n) for n in unmergeable_prs)}"
    elif any(e.get("mergeable") is True for e in per_pr_ci):
        mergeable = True
        merge_state_status = "MERGEABLE"
else:
    # Standard single-PR path
    ci_total, ci_passing, ci_failing, failing_names = parse_ci_checks(ci_checks_raw)
    mergeable, merge_state_status = parse_merge_status(merge_status_raw)

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
    "status": item_data.get("status", ""),
    "environment": item_data.get("environment", {}),
    "worker": item_data.get("worker", {}),
    "plan": item_data.get("plan", {}),
    "runtime": item_data.get("runtime", {}),
}

# Read plan file if specified
plan_content = ""
plan_file = (item_data.get("plan") or {}).get("file", "")
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
        "all_prs": all_prs,
        "ci_checks": {
            "total": ci_total,
            "passing": ci_passing,
            "failing": ci_failing,
            "failing_names": failing_names,
            "some_prs_missing_checks": any(e.get("no_checks") for e in per_pr_ci) if per_pr_ci else (ci_total == 0 and pr_exists),
            "per_pr": per_pr_ci if per_pr_ci else None,
        },
        "mergeable": mergeable,
        "merge_state_status": merge_state_status,
    },
    "previous_state": previous_state,
}

# Load directives for the item's current status using the shared loader.
# This loads from both delegator/directives/ (committed) and
# delegator/directives.local/ (gitignored, machine-specific).
# Local directives override same-name committed ones.
item_status = item_context.get("status", "")
project_root = raw.get("project_root", "")
directives = []
runtime_directives = {}

if project_root and item_status:
    sys.path.insert(0, os.path.join(project_root, "scripts"))
    from scheduler.directives import load_directives, merge_runtime_directives

    all_directives = load_directives(project_root)
    directives = all_directives.get(item_status, [])

    # Get existing runtime.directives from the queue item (if any)
    existing_runtime = (item_data.get("runtime") or {}).get("directives", {})
    runtime_directives = merge_runtime_directives(existing_runtime, directives)

if directives:
    payload["directives"] = directives
    payload["directive_runtime"] = runtime_directives

with open(output_file, "w") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")

print(f"Wrote {output_file}")
PYEOF

emit_event "delegator.preprocess_done" "Pre-processed cycle $ITEM_ID -> $OUTPUT_FILE" --item-id "$ITEM_ID"
echo "Pre-processing complete: $OUTPUT_FILE"
