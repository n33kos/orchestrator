---
description: Add a new work item to the orchestrator queue
user_invocable: true
---

# Add Work Item

Add a new work item to the orchestrator queue. Ask the user for the following if not provided:

1. **Title** — Short description of the work
2. **Type** — "project" (gets worktree + session + delegator) or "quick_fix" (lightweight, no delegator)
3. **Description** — Detailed description of what needs to be done
4. **Priority** — 1 (critical) to 5 (low), default 3
5. **Branch name** — Git branch name for this work (required for activation)

Then add the item to the queue:

```bash
python3 -c "
import json
from pathlib import Path
from datetime import datetime
import re

queue_path = Path.home() / '.claude/orchestrator/queue.json'
queue = json.loads(queue_path.read_text())

max_id = max((int(re.match(r'ws-(\d+)', i['id']).group(1)) for i in queue['items'] if re.match(r'ws-(\d+)', i['id'])), default=0)
new_id = f'ws-{max_id + 1:03d}'

item = {
    'id': new_id,
    'source': 'manual',
    'title': '<TITLE>',
    'description': '<DESCRIPTION>',
    'type': '<TYPE>',
    'priority': <PRIORITY>,
    'status': 'queued',
    'branch': '<BRANCH>',
    'pr_url': None,
    'worktree_path': None,
    'session_id': None,
    'delegator_id': None,
    'delegator_enabled': True if '<TYPE>' == 'project' else False,
    'blockers': [],
    'created_at': datetime.now().isoformat(),
    'activated_at': None,
    'completed_at': None,
    'metadata': {'source_ref': 'CLI — manual entry'},
}

queue['items'].append(item)
queue_path.write_text(json.dumps(queue, indent=2) + '\n')
print(f'Added {new_id}: {item[\"title\"]}')"
```

Replace `<TITLE>`, `<DESCRIPTION>`, `<TYPE>`, `<PRIORITY>`, and `<BRANCH>` with the actual values.

Confirm the addition to the user with the assigned ID and priority position.
