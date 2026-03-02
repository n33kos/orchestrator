#!/usr/bin/env bash
# Sync metadata header in a plan file from the corresponding queue item.
#
# Reads the queue item by ID, then updates or inserts the "## Task Metadata"
# section in the plan file while preserving all other content.
#
# Usage:
#   ./scripts/sync-plan-metadata.sh <item-id>
#   ./scripts/sync-plan-metadata.sh --all

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"

sync_one() {
    local ITEM_ID="$1"

    python3 -c "
import json, sys, os, re

item_id = '$ITEM_ID'
queue_file = '$QUEUE_FILE'

with open(queue_file) as f:
    data = json.load(f)

item = next((i for i in data['items'] if i['id'] == item_id), None)
if not item:
    print(f'ERROR: Item {item_id} not found in queue', file=sys.stderr)
    sys.exit(1)

meta = item.get('metadata', {}) or {}
plan_file = meta.get('plan_file', '')
if not plan_file:
    print(f'SKIP: Item {item_id} has no plan_file in metadata', file=sys.stderr)
    sys.exit(0)

plan_file = os.path.expanduser(plan_file)
if not os.path.isfile(plan_file):
    print(f'ERROR: Plan file not found: {plan_file}', file=sys.stderr)
    sys.exit(1)

# Build the metadata header
lines = []
lines.append('## Task Metadata')
lines.append('')
lines.append(f'- **ID**: {item[\"id\"]}')
lines.append(f'- **Type**: {item[\"type\"]}')

branch = item.get('branch', '')
if branch:
    lines.append(f'- **Branch**: {branch}')
else:
    lines.append('- **Branch**: (not yet assigned)')

desc = item.get('description', '')
if desc:
    lines.append(f'- **Description**: {desc}')

impl_notes = meta.get('implementation_notes', [])
if impl_notes:
    lines.append('- **Implementation Notes**:')
    for note in impl_notes:
        lines.append(f'  - {note}')

metadata_block = '\n'.join(lines)

# Read the existing plan file
with open(plan_file) as f:
    content = f.read()

# Replace existing metadata section or insert after the H1 title
metadata_pattern = r'## Task Metadata\n(?:.*\n)*?(?=\n## |\Z)'
if re.search(metadata_pattern, content):
    # Replace existing metadata block (up to next ## heading or end of file)
    # More precise: match from '## Task Metadata' to just before the next '## ' heading
    parts = content.split('## Task Metadata')
    before = parts[0]
    after = parts[1]
    # Find the next ## heading in the 'after' portion
    next_heading = re.search(r'\n## ', after)
    if next_heading:
        after_rest = after[next_heading.start():]
    else:
        after_rest = ''
    content = before + metadata_block + '\n' + after_rest
else:
    # Insert after the first H1 line
    h1_match = re.match(r'(#[^#].*\n\n?)', content)
    if h1_match:
        insert_pos = h1_match.end()
        content = content[:insert_pos] + metadata_block + '\n\n' + content[insert_pos:]
    else:
        # No H1 found, prepend
        content = metadata_block + '\n\n' + content

with open(plan_file, 'w') as f:
    f.write(content)

print(f'Synced metadata for {item_id} -> {plan_file}')
"
}

if [[ "${1:-}" == "--all" ]]; then
    # Sync all items that have plan files
    ITEM_IDS="$(python3 -c "
import json
with open('$QUEUE_FILE') as f:
    data = json.load(f)
for item in data['items']:
    meta = item.get('metadata', {}) or {}
    if meta.get('plan_file'):
        print(item['id'])
")"
    while IFS= read -r id; do
        [[ -n "$id" ]] && sync_one "$id"
    done <<< "$ITEM_IDS"
else
    ITEM_ID="${1:?Usage: sync-plan-metadata.sh <item-id> | --all}"
    sync_one "$ITEM_ID"
fi
