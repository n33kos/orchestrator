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
#   CONFIG_ASK_BEFORE_TEARDOWN, CONFIG_PLANS_DIR
#   CONFIG_DELEGATOR_ENABLED
#   CONFIG_DELEGATOR_COMMUNICATION, CONFIG_DELEGATOR_CYCLE_INTERVAL
#   CONFIG_BRANCH_PATTERN
#   CONFIG_DASHBOARD_PORT, CONFIG_API_PORT
#   CONFIG_POLL_INTERVAL, CONFIG_CLEANUP_EVERY, CONFIG_ARCHIVE_AFTER_DAYS
#   CONFIG_STALL_THRESHOLD_MIN

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
import re, os, sys

config_path = sys.argv[1]
local_config_path = sys.argv[2] if len(sys.argv) > 2 else None
home = os.environ.get('HOME', os.path.expanduser('~'))

def parse_yaml(path):
    \"\"\"Parse a simple YAML file into a flat section.key -> value dict.\"\"\"
    values = {}
    current_section = ''
    with open(path) as f:
        for line in f:
            stripped = line.split('#')[0].rstrip()
            if not stripped:
                continue
            # Section header (no leading whitespace, ends with colon, no value)
            if not stripped.startswith(' ') and stripped.endswith(':') and ':' not in stripped[:-1]:
                current_section = stripped[:-1]
                continue
            # Key-value pair (indented)
            match = re.match(r'^\s+(\w+):\s*(.+)', stripped)
            if match:
                key = match.group(1)
                val = match.group(2).strip()
                # Remove surrounding quotes
                if (val.startswith('\"') and val.endswith('\"')) or (val.startswith(\"'\") and val.endswith(\"'\")):
                    val = val[1:-1]
                values[f'{current_section}.{key}'] = val
    return values

# Parse base config
values = parse_yaml(config_path)

# Merge local overrides if the file exists
if local_config_path and os.path.isfile(local_config_path):
    local_values = parse_yaml(local_config_path)
    values.update(local_values)

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

# Repository
emit('CONFIG_REPO_PATH', expand(values.get('repo.path', '')))
emit('CONFIG_WORKTREE_PREFIX', expand(values.get('repo.worktree_prefix', '')))

# Tools
emit('CONFIG_TOOL_VMUX', expand(values.get('tools.vmux', '')))
emit('CONFIG_TOOL_GRAPHITE', values.get('tools.graphite', ''))

# Worktree commands
emit('CONFIG_WORKTREE_SETUP', values.get('worktree.setup', 'git worktree add -b {branch} {path} main'))
emit('CONFIG_WORKTREE_SETUP_QUICK', values.get('worktree.setup_quick', 'git worktree add -b {branch} {path} main'))
emit('CONFIG_WORKTREE_TEARDOWN', values.get('worktree.teardown', 'git worktree remove {path}'))
emit('CONFIG_WORKTREE_LIST', values.get('worktree.list', 'git worktree list --porcelain'))
emit('CONFIG_WORKTREE_DEV', values.get('worktree.dev', ''))

# State
emit('CONFIG_QUEUE_FILE', expand(values.get('state.queue_file', '')))

# Concurrency
emit('CONFIG_MAX_ACTIVE_PROJECTS', values.get('concurrency.max_active_projects', '2'))
emit('CONFIG_QUICK_FIX_LIMIT', values.get('concurrency.quick_fix_limit', 'unlimited'))
# Unified limit: explicit max_active or sum of legacy values
_max_p = int(values.get('concurrency.max_active_projects', '2'))
_qf = values.get('concurrency.quick_fix_limit', 'unlimited')
_qf_n = 999 if _qf == 'unlimited' else int(_qf)
emit('CONFIG_MAX_ACTIVE', values.get('concurrency.max_active', str(_max_p + _qf_n)))

# Autonomy
emit('CONFIG_AUTO_ACTIVATE', values.get('autonomy.auto_activate', 'false'))
emit('CONFIG_AUTO_APPROVE_PLANS', values.get('autonomy.auto_approve_plans', 'false'))
emit('CONFIG_REQUIRE_APPROVED_PLAN', values.get('autonomy.require_approved_plan', 'false'))
emit('CONFIG_ASK_BEFORE_TEARDOWN', values.get('autonomy.ask_before_teardown', 'true'))

# Plans
emit('CONFIG_PLANS_DIR', expand(values.get('plans.plans_directory', '~/.claude/orchestrator/plans')))

# Delegator
emit('CONFIG_DELEGATOR_ENABLED', values.get('delegator.enabled_by_default', 'true'))
emit('CONFIG_DELEGATOR_COMMUNICATION', values.get('delegator.communication', 'text'))
emit('CONFIG_DELEGATOR_CYCLE_INTERVAL', values.get('delegator.cycle_interval', '300'))

# Branches
emit('CONFIG_BRANCH_PATTERN', values.get('branches.pattern', ''))

# Dashboard
emit('CONFIG_DASHBOARD_PORT', values.get('dashboard.port', '3201'))
emit('CONFIG_API_PORT', values.get('dashboard.api_port', '3201'))

# Scheduler
emit('CONFIG_POLL_INTERVAL', values.get('scheduler.poll_interval', '120'))
emit('CONFIG_CLEANUP_EVERY', values.get('scheduler.cleanup_every', '10'))
emit('CONFIG_ARCHIVE_AFTER_DAYS', values.get('scheduler.archive_after_days', '7'))

# Stall Detection
emit('CONFIG_STALL_THRESHOLD_MIN', values.get('stall_detection.threshold_minutes', '30'))
" "$CONFIG_FILE" "$LOCAL_CONFIG_FILE"
