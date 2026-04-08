#!/usr/bin/env bash
# Parse orchestrator config and export shell variables.
#
# Usage:
#   eval "$(parse-config.sh)"                     # use default config path
#   eval "$(parse-config.sh /path/to/config.yml)" # custom config
#
# Or source the output:
#   source <("$SCRIPT_DIR/parse-config.sh")
#
# Exported variables (with CONFIG_ prefix):
#   CONFIG_USER_INITIALS, CONFIG_USER_NAME
#   CONFIG_REPO_PATH, CONFIG_WORKTREE_PREFIX
#   CONFIG_TOOL_VMUX, CONFIG_TOOL_GRAPHITE
#   CONFIG_WORKTREE_SETUP, CONFIG_WORKTREE_SETUP_QUICK
#   CONFIG_WORKTREE_TEARDOWN, CONFIG_WORKTREE_LIST, CONFIG_WORKTREE_DEV
#   CONFIG_QUEUE_FILE
#   CONFIG_MAX_ACTIVE_PROJECTS, CONFIG_QUICK_FIX_LIMIT
#   CONFIG_AUTO_ACTIVATE, CONFIG_AUTO_APPROVE_PLANS, CONFIG_REQUIRE_APPROVED_PLAN
#   CONFIG_ASK_BEFORE_TEARDOWN, CONFIG_ARTIFACTS_DIR
#   CONFIG_DELEGATOR_ENABLED
#   CONFIG_DELEGATOR_COMMUNICATION, CONFIG_DELEGATOR_CYCLE_INTERVAL
#   CONFIG_BRANCH_PATTERN
#   CONFIG_DASHBOARD_PORT, CONFIG_API_PORT
#   CONFIG_POLL_INTERVAL, CONFIG_CLEANUP_EVERY, CONFIG_ARCHIVE_AFTER_DAYS
#   CONFIG_STALL_THRESHOLD_MIN
#   CONFIG_REPOSITORIES_JSON  (JSON blob with all per-repo config)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="${1:-$PROJECT_ROOT/config/environment.yml}"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "echo 'ERROR: Config file not found: $CONFIG_FILE' >&2; exit 1"
    exit 1
fi

# Derive local override path: environment.yml -> environment.local.yml
LOCAL_CONFIG_FILE="${CONFIG_FILE%.yml}.local.yml"

python3 -c "
import re, os, sys, json

config_path = sys.argv[1]
local_config_path = sys.argv[2] if len(sys.argv) > 2 else None
home = os.environ.get('HOME', os.path.expanduser('~'))

def parse_yaml(path):
    \"\"\"Parse a simple YAML file into a flat section.key -> value dict.

    Handles up to 3 levels of nesting for the repositories section:
      repositories._defaults.path -> value
      repositories._defaults.worktree.setup -> value
    \"\"\"
    values = {}
    repos = {}
    current_section = ''
    current_repo = ''
    current_subsection = ''
    in_repositories = False

    with open(path) as f:
        for line in f:
            stripped = line.split('#')[0].rstrip()
            if not stripped:
                continue

            # Measure indent level
            indent = len(stripped) - len(stripped.lstrip())

            # Top-level section (no indent, ends with colon, no value after)
            if indent == 0 and stripped.endswith(':') and ':' not in stripped[:-1]:
                section_name = stripped[:-1]
                current_section = section_name
                in_repositories = (section_name == 'repositories')
                current_repo = ''
                current_subsection = ''
                continue

            if in_repositories:
                # Repo name (indent 2, ends with colon, no value)
                if indent == 2 and stripped.strip().endswith(':'):
                    repo_key = stripped.strip()[:-1]
                    current_repo = repo_key
                    current_subsection = ''
                    if repo_key not in repos:
                        repos[repo_key] = {}
                    continue

                # Subsection within a repo (indent 4, ends with colon, no value)
                if indent == 4 and current_repo and stripped.strip().endswith(':'):
                    sub = stripped.strip()[:-1]
                    if ':' not in sub:
                        current_subsection = sub
                        continue

                # Key-value pair within repo
                match = re.match(r'^\s+(\w+):\s*(.+)', stripped)
                if match and current_repo:
                    key = match.group(1)
                    val = match.group(2).strip()
                    if (val.startswith('\"') and val.endswith('\"')) or (val.startswith(\"'\") and val.endswith(\"'\")):
                        val = val[1:-1]
                    if current_subsection:
                        repos[current_repo][f'{current_subsection}.{key}'] = val
                    else:
                        repos[current_repo][key] = val
                    continue
            else:
                # Standard key-value pair (indented)
                match = re.match(r'^\s+(\w+):\s*(.+)', stripped)
                if match:
                    key = match.group(1)
                    val = match.group(2).strip()
                    if (val.startswith('\"') and val.endswith('\"')) or (val.startswith(\"'\") and val.endswith(\"'\")):
                        val = val[1:-1]
                    values[f'{current_section}.{key}'] = val

    return values, repos

# Parse base config
values, repos = parse_yaml(config_path)

# Merge local overrides if the file exists
if local_config_path and os.path.isfile(local_config_path):
    local_values, local_repos = parse_yaml(local_config_path)
    values.update(local_values)
    # Deep-merge repos: local repo entries override base entries per-key
    for repo_key, repo_vals in local_repos.items():
        if repo_key not in repos:
            repos[repo_key] = {}
        repos[repo_key].update(repo_vals)

def expand(val):
    \"\"\"Expand ~ to HOME.\"\"\"
    return val.replace('~', home) if val else val

def emit(var_name, val):
    # Shell-safe quoting
    safe_val = val.replace(\"'\", \"'\\\\''\" ) if val else ''
    print(f\"{var_name}='{safe_val}'\")

# Identity
emit('CONFIG_USER_INITIALS', values.get('user.initials', ''))
emit('CONFIG_USER_NAME', values.get('user.name', ''))

# Repository — resolve from _defaults repo config (backward compat)
defaults = repos.get('_defaults', {})
repo_path = defaults.get('path', values.get('repo.path', ''))
worktree_prefix = defaults.get('worktree_prefix', values.get('repo.worktree_prefix', ''))
emit('CONFIG_REPO_PATH', expand(repo_path))
emit('CONFIG_WORKTREE_PREFIX', expand(worktree_prefix))

# Tools
emit('CONFIG_TOOL_VMUX', expand(values.get('tools.vmux', '')))
emit('CONFIG_TOOL_GRAPHITE', values.get('tools.graphite', ''))

# Worktree commands — from _defaults repo config (backward compat)
emit('CONFIG_WORKTREE_SETUP', defaults.get('worktree.setup', values.get('worktree.setup', 'git worktree add -b {branch} {path} main')))
emit('CONFIG_WORKTREE_SETUP_QUICK', defaults.get('worktree.setup_quick', values.get('worktree.setup_quick', 'git worktree add -b {branch} {path} main')))
emit('CONFIG_WORKTREE_TEARDOWN', defaults.get('worktree.teardown', values.get('worktree.teardown', 'git worktree remove {path}')))
emit('CONFIG_WORKTREE_LIST', defaults.get('worktree.list', values.get('worktree.list', 'git worktree list --porcelain')))
emit('CONFIG_WORKTREE_DEV', defaults.get('worktree.dev', values.get('worktree.dev', '')))

# State
emit('CONFIG_QUEUE_FILE', expand(values.get('state.queue_file', '')))

# Concurrency
emit('CONFIG_MAX_ACTIVE', values.get('concurrency.max_active', '2'))

# Autonomy
emit('CONFIG_AUTO_ACTIVATE', values.get('autonomy.auto_activate', 'false'))
emit('CONFIG_AUTO_APPROVE_PLANS', values.get('autonomy.auto_approve_plans', 'false'))
emit('CONFIG_REQUIRE_APPROVED_PLAN', values.get('autonomy.require_approved_plan', 'false'))
emit('CONFIG_ASK_BEFORE_TEARDOWN', values.get('autonomy.ask_before_teardown', 'true'))

# Artifacts
emit('CONFIG_ARTIFACTS_DIR', expand(values.get('artifacts.artifacts_directory', '~/.claude/orchestrator/plans')))

# Delegator
emit('CONFIG_DELEGATOR_ENABLED', values.get('delegator.enabled_by_default', 'true'))
emit('CONFIG_DELEGATOR_COMMUNICATION', values.get('delegator.communication', 'text'))
emit('CONFIG_DELEGATOR_CYCLE_INTERVAL', values.get('delegator.cycle_interval', '300'))

# Branches — from _defaults repo config (backward compat)
emit('CONFIG_BRANCH_PATTERN', defaults.get('branching_pattern', values.get('branches.pattern', '')))

# Dashboard
emit('CONFIG_DASHBOARD_PORT', values.get('dashboard.port', '3201'))
emit('CONFIG_API_PORT', values.get('dashboard.api_port', '3201'))

# Scheduler
emit('CONFIG_POLL_INTERVAL', values.get('scheduler.poll_interval', '120'))
emit('CONFIG_CLEANUP_EVERY', values.get('scheduler.cleanup_every', '10'))
emit('CONFIG_ARCHIVE_AFTER_DAYS', values.get('scheduler.archive_after_days', '7'))

# Stall Detection
emit('CONFIG_STALL_THRESHOLD_MIN', values.get('stall_detection.threshold_minutes', '30'))

# Per-Repository Config (JSON blob for scripts that need repo resolution)
# Structure each repo as a normalized dict with all fields resolved
repo_json = {}
for repo_key, repo_vals in repos.items():
    entry = {
        'path': expand(repo_vals.get('path', expand(repo_path))),
        'worktree_prefix': expand(repo_vals.get('worktree_prefix', expand(worktree_prefix))),
        'commit_strategy': repo_vals.get('commit_strategy', defaults.get('commit_strategy', 'branch_and_pr')),
        'use_worktree': repo_vals.get('use_worktree', defaults.get('use_worktree', 'true')).lower() in ('true', 'yes', '1') if isinstance(repo_vals.get('use_worktree', defaults.get('use_worktree', 'true')), str) else bool(repo_vals.get('use_worktree', defaults.get('use_worktree', True))),
        'branching_pattern': repo_vals.get('branching_pattern', defaults.get('branching_pattern', '')),
        'worktree': {
            'setup': repo_vals.get('worktree.setup', defaults.get('worktree.setup', 'git worktree add -b {branch} {path} main')),
            'setup_quick': repo_vals.get('worktree.setup_quick', defaults.get('worktree.setup_quick', 'git worktree add -b {branch} {path} main')),
            'teardown': repo_vals.get('worktree.teardown', defaults.get('worktree.teardown', 'git worktree remove {path}')),
            'list': repo_vals.get('worktree.list', defaults.get('worktree.list', 'git worktree list --porcelain')),
            'dev': repo_vals.get('worktree.dev', defaults.get('worktree.dev', '')),
        },
    }
    repo_json[repo_key] = entry

safe_json = json.dumps(repo_json).replace(\"'\", \"'\\\\''\" )
print(f\"CONFIG_REPOSITORIES_JSON='{safe_json}'\")
" "$CONFIG_FILE" "$LOCAL_CONFIG_FILE"
