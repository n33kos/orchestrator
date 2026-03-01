#!/usr/bin/env bash
# Migrate inline plans from queue.json to markdown plan files.
#
# Usage:
#   ./scripts/migrate-plans.sh [--dry-run]
#
# Reads queue items with inline plan metadata, writes markdown plan files
# to the configured plans directory, and updates the queue to reference
# the files instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONFIG="$PROJECT_ROOT/config/environment.yml"
eval "$("$SCRIPT_DIR/parse-config.sh" "$CONFIG")"

QUEUE_FILE="$CONFIG_QUEUE_FILE"
PLANS_DIR="${CONFIG_PLANS_DIR:-$HOME/Desktop/plans}"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

mkdir -p "$PLANS_DIR"

echo "Migrating inline plans to files..."
echo "  Queue: $QUEUE_FILE"
echo "  Plans dir: $PLANS_DIR"
echo "  Dry run: $DRY_RUN"
echo ""

python3 -c "
import json, os, sys

queue_file = '$QUEUE_FILE'
plans_dir = '$PLANS_DIR'
dry_run = '$DRY_RUN' == 'true'

with open(queue_file) as f:
    data = json.load(f)

migrated = 0
skipped = 0

for item in data['items']:
    meta = item.get('metadata') or {}
    plan = meta.get('plan')
    plan_file = meta.get('plan_file', '')

    # Skip if no inline plan
    if not plan or not plan.get('steps'):
        continue

    # Skip if already has a plan file that exists
    if plan_file and os.path.exists(plan_file.replace('~', os.environ['HOME'])):
        skipped += 1
        print(f'  SKIP {item[\"id\"]}: already has plan file at {plan_file}')
        continue

    # Generate markdown from the inline plan
    item_id = item['id']
    title = item.get('title', item_id)
    summary = plan.get('summary', '')
    steps = plan.get('steps', [])

    lines = [f'# {title}', '', '## Summary', '', summary, '', '## Steps', '']
    for step in steps:
        marker = 'x' if step.get('done') else ' '
        lines.append(f'- [{marker}] {step.get(\"text\", \"\")}')
    lines.extend(['', '## Notes', '', ''])

    plan_path = os.path.join(plans_dir, f'{item_id}.md')
    content = '\n'.join(lines)

    if dry_run:
        print(f'  WOULD MIGRATE {item_id}: {title}')
        print(f'    -> {plan_path}')
        print(f'    {len(steps)} steps, approved={plan.get(\"approved\", False)}')
    else:
        with open(plan_path, 'w') as f:
            f.write(content)
        # Update queue item
        meta['plan_file'] = plan_path
        meta['plan_approved'] = plan.get('approved', False)
        # Keep a minimal inline plan reference but remove the bulk data
        # The steps are now in the file
        print(f'  MIGRATED {item_id}: {title} -> {plan_path}')

    migrated += 1

if not dry_run and migrated > 0:
    with open(queue_file, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

print()
print(f'Done. Migrated: {migrated}, Skipped: {skipped}')
"
