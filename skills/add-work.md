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
6. **Repo key** — Repository key from config (e.g., `babylist-web`, `orchestrator`). Optional — if not set, defaults are used. If provided, the item inherits the repo's path, worktree settings, and commit strategy from config.
7. **Repo path** — Target repo path (optional override — only needed if different from the repo key's configured path)

When a `repo_key` is provided, the item automatically inherits per-repo settings (path, worktree config, commit strategy) from `config/environment.yml`. Per-item overrides (branch, commit_strategy, repo path) still take precedence.

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
    'repo_key': '<REPO_KEY>' or None,
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
        'directives': {},  # Auto-populated from configured directives
    },
}

queue['items'].append(item)
queue_path.write_text(json.dumps(queue, indent=2) + '\n')

# Auto-populate runtime.directives from configured directives
import subprocess as _sp
try:
    _r = _sp.run(
        ['python3', '-c', '''
import json, sys
sys.path.insert(0, \"scripts\")
from scheduler.directives import load_directives
directives = load_directives(\".\")
all_names = set()
for status_directives in directives.values():
    for d in status_directives:
        all_names.add(d[\"name\"])
print(json.dumps({name: {\"status\": \"pending\", \"retries\": 0, \"last_run\": None, \"output_path\": None} for name in all_names}))
'''],
        capture_output=True, text=True, timeout=10,
        cwd=str(Path.home() / 'orchestrator'),
    )
    if _r.returncode == 0 and _r.stdout.strip():
        item['runtime']['directives'] = json.loads(_r.stdout.strip())
        queue_path.write_text(json.dumps(queue, indent=2) + '\n')
except Exception:
    pass  # Non-critical — directives can be populated later

print(f'Added {new_id}: {item[\"title\"]}')"
```

Replace `<TITLE>`, `<DESCRIPTION>`, `<PRIORITY>`, `<BRANCH>`, `<COMMIT_STRATEGY>` (default `branch_and_pr`), `<REPO_KEY>` (optional), and `<REPO_PATH>` (optional override) with the actual values.

When `repo_key` is set, the `environment.repo` and `environment.use_worktree` fields can be omitted — they'll be resolved from the repo config at activation time. Setting them explicitly overrides the repo config.

Confirm the addition to the user with the assigned ID and priority position.
