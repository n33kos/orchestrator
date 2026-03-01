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

ITEM_ID="${1:?Usage: spawn-delegator.sh <item-id>}"

# Validate profile exists
if [[ ! -f "$PROFILE_FILE" ]]; then
    echo "ERROR: User profile not found at $PROFILE_FILE" >&2
    echo "Run: python3 scripts/preseed-profile.py" >&2
    exit 1
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

echo "Spawning delegator for: $ITEM_TITLE ($ITEM_ID)"
echo "  Worker session: $WORKER_SESSION_ID"
echo "  Worktree: $WORKTREE_PATH"

# Create a temporary directory for the delegator session
DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
mkdir -p "$DELEGATOR_DIR"

# Write the delegator's initial prompt
cat > "$DELEGATOR_DIR/initial-prompt.md" << PROMPT
# Delegator Session — $ITEM_TITLE

You are a delegator instance monitoring worker session \`$WORKER_SESSION_ID\`.

## Work Item
- **ID**: $ITEM_ID
- **Title**: $ITEM_TITLE
- **Worker Session**: $WORKER_SESSION_ID
- **Worktree**: $WORKTREE_PATH

## Your Instructions

Load and follow the delegator instructions at:
\`$PROJECT_ROOT/delegator/CLAUDE.md\`

Load the user behavioral profile at:
\`$PROFILE_FILE\`

## Communication

To send a message to the worker, use:
\`\`\`bash
$VMUX send $WORKER_SESSION_ID "your message here"
\`\`\`

## Monitoring

Monitor the worker's progress by:
1. Checking git log in $WORKTREE_PATH for new commits
2. Reading changed files to review code quality
3. Checking if the worker's session is still active via \`$VMUX sessions\`

## Lifecycle

1. Introduce yourself to the worker with a brief greeting
2. Periodically check for new commits and review them
3. Ask questions and provide feedback as the user profile dictates
4. When the worker signals completion, perform a final comprehensive review
5. Report your assessment back by updating the queue item

## Reporting

To report status, write to:
\`$DELEGATOR_DIR/status.json\`

Format:
\`\`\`json
{
  "status": "monitoring|reviewing|complete",
  "last_check": "ISO timestamp",
  "commits_reviewed": 0,
  "issues_found": [],
  "assessment": null
}
\`\`\`
PROMPT

# Write the delegator CLAUDE.md for the session
cat > "$DELEGATOR_DIR/CLAUDE.md" << 'DELEGATOR_CLAUDE'
# Delegator Session

You are a code quality delegator. Read the initial prompt file in this directory
for your specific assignment, then follow the delegator instructions and user profile
referenced there.

Start by:
1. Reading initial-prompt.md in this directory
2. Loading the delegator instructions (delegator/CLAUDE.md in the orchestrator repo)
3. Loading the user profile
4. Introducing yourself to the worker
5. Beginning your monitoring loop
DELEGATOR_CLAUDE

# Initialize status file
python3 -c "
import json
from datetime import datetime
status = {
    'status': 'initializing',
    'item_id': '$ITEM_ID',
    'worker_session': '$WORKER_SESSION_ID',
    'started_at': datetime.now().isoformat(),
    'last_check': None,
    'commits_reviewed': 0,
    'issues_found': [],
    'assessment': None,
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

# Get the delegator session ID
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
        break
with open('$QUEUE_FILE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

echo ""
echo "Delegator spawned!"
echo "  Delegator session: $DELEGATOR_SESSION_ID"
echo "  Monitoring worker: $WORKER_SESSION_ID"
echo "  Status file: $DELEGATOR_DIR/status.json"
