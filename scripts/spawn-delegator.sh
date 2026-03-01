#!/usr/bin/env bash
# Spawn a delegator instance for a project work stream.
#
# The delegator is a separate Claude Code session that monitors a worker,
# reviews commits, and communicates via vmux send.
#
# Usage:
#   ./scripts/spawn-delegator.sh <item-id>
#
# Prerequisites:
#   - Work item must be active with a session_id
#   - User profile must exist at ~/.claude/orchestrator/profile.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONFIG="$PROJECT_ROOT/config/environment.yml"
QUEUE_FILE="$(grep 'queue_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
PROFILE_FILE="$(grep 'profile_file:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
VMUX="$(grep 'vmux:' "$CONFIG" | sed 's/.*: *//' | sed "s|~|$HOME|")"
DASHBOARD_PORT="$(grep 'api_port:' "$CONFIG" | sed 's/.*: *//')"

ITEM_ID="${1:?Usage: spawn-delegator.sh <item-id>}"

# Validate profile exists
if [[ ! -f "$PROFILE_FILE" ]]; then
    echo "WARNING: User profile not found at $PROFILE_FILE" >&2
    echo "  Delegator will run without a trained profile." >&2
    echo "  Run: python3 scripts/preseed-profile.py" >&2
fi

# Read item from queue
ITEM_JSON="$(python3 -c "
import json, sys
with open('$QUEUE_FILE') as f:
    data = json.load(f)
item = next((i for i in data['items'] if i['id'] == '$ITEM_ID'), None)
if not item:
    print('ERROR: Item $ITEM_ID not found', file=sys.stderr)
    sys.exit(1)
if item['status'] != 'active':
    print(f'ERROR: Item $ITEM_ID is {item[\"status\"]}, expected active', file=sys.stderr)
    sys.exit(1)
if not item.get('session_id'):
    print('ERROR: Item $ITEM_ID has no worker session', file=sys.stderr)
    sys.exit(1)
print(json.dumps(item))
")"

WORKER_SESSION_ID="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['session_id'])")"
WORKTREE_PATH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('worktree_path', ''))")"
ITEM_TITLE="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")"
ITEM_BRANCH="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['branch'])")"
ITEM_DESC="$(echo "$ITEM_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('description', ''))")"

echo "Spawning delegator for: $ITEM_TITLE ($ITEM_ID)"
echo "  Worker session: $WORKER_SESSION_ID"
echo "  Worktree: $WORKTREE_PATH"

# Create the delegator session directory
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
mkdir -p "$DELEGATOR_DIR"

# Write the initial prompt with all context the delegator needs
cat > "$DELEGATOR_DIR/initial-prompt.md" << PROMPT
# Delegator Assignment — $ITEM_TITLE

## Work Item
- **ID**: $ITEM_ID
- **Title**: $ITEM_TITLE
- **Description**: $ITEM_DESC
- **Branch**: $ITEM_BRANCH
- **Worker Session**: $WORKER_SESSION_ID
- **Worktree**: $WORKTREE_PATH

## Commands

Send message to worker:
\`\`\`bash
$VMUX send $WORKER_SESSION_ID "your message"
\`\`\`

Check worker session status:
\`\`\`bash
$VMUX sessions
\`\`\`

Check git activity:
\`\`\`bash
cd $WORKTREE_PATH && git log --oneline -10
\`\`\`

Check for PR:
\`\`\`bash
cd $WORKTREE_PATH && gh pr list --head $ITEM_BRANCH --json number,title,state --limit 1
\`\`\`

Report to orchestrator dashboard:
\`\`\`bash
curl -s -X PATCH http://localhost:${DASHBOARD_PORT}/api/queue/update \\
  -H 'Content-Type: application/json' \\
  -d '{"id": "$ITEM_ID", "metadata": {"delegator_assessment": "YOUR_ASSESSMENT", "delegator_status": "STATUS"}}'
\`\`\`

## Files to Load
- **Delegator instructions**: $PROJECT_ROOT/delegator/CLAUDE.md
- **User behavioral profile**: $PROFILE_FILE
- **Status file** (read/write): $DELEGATOR_DIR/status.json

## Startup Sequence
1. Read the delegator instructions at $PROJECT_ROOT/delegator/CLAUDE.md
2. Read the user profile at $PROFILE_FILE (if it exists)
3. Update status.json to "monitoring"
4. Send a brief introduction to the worker
5. Begin the monitoring loop
PROMPT

# Write the delegator CLAUDE.md for the session
cat > "$DELEGATOR_DIR/CLAUDE.md" << DELEGATOR_CLAUDE
# Delegator Session

You are a code quality delegator monitoring a worker Claude Code session.

## First Steps

1. Read \`initial-prompt.md\` in this directory for your assignment details
2. Read the delegator instructions referenced there
3. Read the user behavioral profile referenced there (if it exists)
4. Begin monitoring

## Critical Rules

- NEVER run all tests — always target specific test files
- NEVER make code changes in the worker's worktree
- NEVER approve PRs on GitHub directly — only report your recommendation
- Keep messages to the worker concise and actionable
- Update status.json after every monitoring cycle
- Report significant findings to the orchestrator dashboard API
DELEGATOR_CLAUDE

# Initialize status file
python3 -c "
import json
from datetime import datetime
status = {
    'status': 'initializing',
    'item_id': '$ITEM_ID',
    'worker_session': '$WORKER_SESSION_ID',
    'worktree_path': '$WORKTREE_PATH',
    'branch': '$ITEM_BRANCH',
    'started_at': datetime.now().isoformat(),
    'last_check': None,
    'last_seen_commit': None,
    'commits_reviewed': 0,
    'commit_reviews': [],
    'issues_found': [],
    'stall_detected': False,
    'pr_reviewed': False,
    'assessment': None,
    'errors': [],
}
with open('$DELEGATOR_DIR/status.json', 'w') as f:
    json.dump(status, f, indent=2)
"

# Spawn the delegator session using vmux
echo ""
echo "Spawning delegator session in $DELEGATOR_DIR..."
$VMUX spawn "$DELEGATOR_DIR" 2>&1 || {
    echo "ERROR: Failed to spawn delegator session" >&2
    exit 1
}

# Get the delegator session ID (deterministic from path)
DELEGATOR_SESSION_ID="$(python3 -c "
import hashlib
cwd = '$DELEGATOR_DIR'
print(hashlib.sha256(cwd.encode()).hexdigest()[:12])
")"

# Update queue item with delegator ID
python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    if item['id'] == '$ITEM_ID':
        item['delegator_id'] = '$DELEGATOR_SESSION_ID'
        item.setdefault('metadata', {})['delegator_status'] = 'initializing'
        break
with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

echo ""
echo "Delegator spawned!"
echo "  Delegator session: $DELEGATOR_SESSION_ID"
echo "  Delegator dir: $DELEGATOR_DIR"
echo "  Monitoring worker: $WORKER_SESSION_ID"
echo "  Status file: $DELEGATOR_DIR/status.json"
