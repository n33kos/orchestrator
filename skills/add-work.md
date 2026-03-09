---
description: Add a new work item to the orchestrator queue
user_invocable: true
---

# Add Work Item

Add a new work item to the orchestrator queue. Ask the user for the following if not provided:

1. **Title** — Short description of the work
2. **Description** — Detailed description of what needs to be done
3. **Priority** — 1 (critical) to 5 (low), default 3
4. **Branch name** — Git branch name for this work (required for activation)
5. **Commit strategy** — `branch_and_pr` (default), `graphite_stack`, or `commit_to_main`
6. **Repo path** — Target repo (optional, defaults to config repo)

Then add the item to the queue:

```bash
python3 -c "
import json, subprocess
from pathlib import Path
from datetime import datetime

queue_path = Path.home() / '.claude/orchestrator/queue.json'
queue = json.loads(queue_path.read_text())

# Use the shared counter script for monotonically incrementing IDs
counter_script = Path.home() / 'orchestrator/scripts/next-ws-id.sh'
result = subprocess.run([str(counter_script)], capture_output=True, text=True)
if result.returncode != 0:
    raise RuntimeError(f'Failed to generate ID: {result.stderr.strip()}')
new_id = result.stdout.strip()

item = {
    'id': new_id,
    'source': 'manual',
    'source_ref': 'CLI — manual entry',
    'title': '<TITLE>',
    'description': '<DESCRIPTION>',
    'priority': <PRIORITY>,
    'status': 'queued',
    'blocked_by': [],
    'created_at': datetime.now().isoformat(),
    'activated_at': None,
    'completed_at': None,
    'environment': {
        'repo': '<REPO_PATH>' or None,
        'use_worktree': True,
        'branch': '<BRANCH>',
        'worktree_path': None,
        'session_id': None,
    },
    'worker': {
        'commit_strategy': '<COMMIT_STRATEGY>',
        'delegator_enabled': True,
    },
    'plan': {
        'file': None,
        'summary': None,
        'approved': False,
        'approved_at': None,
    },
    'runtime': {
        'delegator_status': None,
        'spend': None,
        'last_activity': None,
        'pr_url': None,
        'stack_prs': None,
        'completion_message': None,
    },
}

queue['items'].append(item)
queue_path.write_text(json.dumps(queue, indent=2) + '\n')
print(f'Added {new_id}: {item[\"title\"]}')"
```

Replace `<TITLE>`, `<DESCRIPTION>`, `<PRIORITY>`, `<BRANCH>`, `<COMMIT_STRATEGY>` (default `branch_and_pr`), and `<REPO_PATH>` with the actual values.

Confirm the addition to the user with the assigned ID and priority position.
