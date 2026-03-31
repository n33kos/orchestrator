"""Config loading for the scheduler.

Parses config/environment.yml with local override merging,
using the same regex-based YAML parsing as parse-config.sh.
"""

import os
import re
from pathlib import Path
from typing import Optional


def _parse_yaml(path: str) -> dict[str, str]:
    """Parse a simple YAML file into a flat section.key -> value dict.

    Matches the parse-config.sh logic: top-level keys become sections,
    indented key: value pairs become section.key entries.
    """
    values: dict[str, str] = {}
    current_section = ""
    with open(path) as f:
        for line in f:
            stripped = line.split("#")[0].rstrip()
            if not stripped:
                continue
            # Section header (no leading whitespace, ends with colon, no value)
            if (
                not stripped.startswith(" ")
                and stripped.endswith(":")
                and ":" not in stripped[:-1]
            ):
                current_section = stripped[:-1]
                continue
            # Key-value pair (indented)
            match = re.match(r"^\s+(\w+):\s*(.+)", stripped)
            if match:
                key = match.group(1)
                val = match.group(2).strip()
                # Remove surrounding quotes
                if (val.startswith('"') and val.endswith('"')) or (
                    val.startswith("'") and val.endswith("'")
                ):
                    val = val[1:-1]
                values[f"{current_section}.{key}"] = val
    return values


def _expand(val: str) -> str:
    """Expand leading ~ to HOME."""
    return os.path.expanduser(val) if val else val


class Config:
    """Scheduler configuration loaded from environment.yml with local overrides."""

    def __init__(self) -> None:
        # Identity
        self.user_initials: str = ""
        self.user_name: str = ""

        # Repository
        self.repo_path: str = ""
        self.worktree_prefix: str = ""

        # Tools
        self.tool_vmux: str = ""
        self.tool_graphite: str = ""

        # Worktree commands
        self.worktree_setup: str = "git worktree add -b {branch} {path} main"
        self.worktree_setup_quick: str = "git worktree add -b {branch} {path} main"
        self.worktree_teardown: str = "git worktree remove {path}"
        self.worktree_list: str = "git worktree list --porcelain"
        self.worktree_dev: str = ""

        # State
        self.queue_file: str = ""

        # Concurrency
        self.max_active: int = 6

        # Autonomy
        self.auto_activate: bool = False
        self.auto_approve_plans: bool = False
        self.require_approved_plan: bool = False
        self.ask_before_teardown: bool = True

        # Plans
        self.plans_dir: str = os.path.expanduser("~/.claude/orchestrator/plans")

        # Delegator
        self.delegator_enabled: bool = True
        self.delegator_communication: str = "text"
        self.delegator_cycle_interval: int = 300

        # Dashboard
        self.dashboard_port: int = 3201
        self.api_port: int = 3201

        # Scheduler
        self.poll_interval: int = 120
        self.cleanup_every: int = 10
        self.archive_after_days: int = 7

        # Stall Detection
        self.stall_threshold_min: int = 30

        # Project-specific
        self.design_keywords: str = "design-system,design,ui-kit"

    def _bool(self, val: str) -> bool:
        return val.lower() in ("true", "yes", "1")

    def _int(self, val: str, default: int) -> int:
        try:
            return int(val)
        except (ValueError, TypeError):
            return default


def load_config(project_root: Optional[str] = None) -> Config:
    """Load configuration from environment.yml with local override merging.

    Args:
        project_root: Path to the orchestrator project root. If None,
                      derived from this file's location (../../).
    """
    if project_root is None:
        # scripts/scheduler/config.py -> scripts/ -> project_root
        project_root = str(Path(__file__).resolve().parent.parent.parent)

    config_path = os.path.join(project_root, "config", "environment.yml")
    local_config_path = os.path.join(project_root, "config", "environment.local.yml")

    if not os.path.isfile(config_path):
        raise FileNotFoundError(f"Config file not found: {config_path}")

    # Parse base config
    values = _parse_yaml(config_path)

    # Merge local overrides if the file exists
    if os.path.isfile(local_config_path):
        local_values = _parse_yaml(local_config_path)
        values.update(local_values)

    cfg = Config()

    # Identity
    cfg.user_initials = values.get("user.initials", "")
    cfg.user_name = values.get("user.name", "")

    # Repository
    cfg.repo_path = _expand(values.get("repo.path", ""))
    cfg.worktree_prefix = _expand(values.get("repo.worktree_prefix", ""))

    # Tools
    cfg.tool_vmux = _expand(values.get("tools.vmux", ""))
    cfg.tool_graphite = values.get("tools.graphite", "")

    # Worktree commands
    cfg.worktree_setup = values.get("worktree.setup", "git worktree add -b {branch} {path} main")
    cfg.worktree_setup_quick = values.get("worktree.setup_quick", "git worktree add -b {branch} {path} main")
    cfg.worktree_teardown = values.get("worktree.teardown", "git worktree remove {path}")
    cfg.worktree_list = values.get("worktree.list", "git worktree list --porcelain")
    cfg.worktree_dev = values.get("worktree.dev", "")

    # State
    cfg.queue_file = _expand(values.get("state.queue_file", ""))

    # Concurrency — single unified limit (sum of old max_active_projects + quick_fix_limit)
    max_projects = cfg._int(values.get("concurrency.max_active_projects", "2"), 2)
    qf_val = values.get("concurrency.quick_fix_limit", "4")
    qf_limit = 999 if qf_val == "unlimited" else cfg._int(qf_val, 4)
    # Prefer explicit max_active if set, otherwise derive from legacy values
    explicit_max = values.get("concurrency.max_active")
    if explicit_max:
        cfg.max_active = cfg._int(explicit_max, 6)
    else:
        cfg.max_active = max_projects + qf_limit

    # Autonomy
    cfg.auto_activate = cfg._bool(values.get("autonomy.auto_activate", "false"))
    cfg.auto_approve_plans = cfg._bool(
        values.get("autonomy.auto_approve_plans", "false")
    )
    cfg.require_approved_plan = cfg._bool(
        values.get("autonomy.require_approved_plan", "false")
    )
    cfg.ask_before_teardown = cfg._bool(
        values.get("autonomy.ask_before_teardown", "true")
    )

    # Plans
    cfg.plans_dir = _expand(
        values.get("plans.plans_directory", "~/.claude/orchestrator/plans")
    )

    # Delegator
    cfg.delegator_enabled = cfg._bool(
        values.get("delegator.enabled_by_default", "true")
    )
    cfg.delegator_communication = values.get("delegator.communication", "text")
    cfg.delegator_cycle_interval = cfg._int(
        values.get("delegator.cycle_interval", "300"), 300
    )

    # Dashboard
    cfg.dashboard_port = cfg._int(values.get("dashboard.port", "3201"), 3201)
    cfg.api_port = cfg._int(values.get("dashboard.api_port", "3201"), 3201)

    # Scheduler
    cfg.poll_interval = cfg._int(values.get("scheduler.poll_interval", "120"), 120)
    cfg.cleanup_every = cfg._int(values.get("scheduler.cleanup_every", "10"), 10)
    cfg.archive_after_days = cfg._int(
        values.get("scheduler.archive_after_days", "7"), 7
    )

    # Stall Detection
    cfg.stall_threshold_min = cfg._int(
        values.get("stall_detection.threshold_minutes", "30"), 30
    )

    # Project-specific
    cfg.design_keywords = values.get(
        "project.design_keywords", "design-system,design,ui-kit"
    )

    # Export config-driven env vars so subprocesses can read them.
    # Only set if not already overridden by the system environment.
    if "ORCHESTRATOR_DESIGN_KEYWORDS" not in os.environ:
        os.environ["ORCHESTRATOR_DESIGN_KEYWORDS"] = cfg.design_keywords

    return cfg
