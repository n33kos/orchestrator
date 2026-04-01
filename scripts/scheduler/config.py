"""Config loading for the scheduler.

Parses config/environment.yml with local override merging,
using the same regex-based YAML parsing as parse-config.sh.
"""

import os
import re
from pathlib import Path
from typing import Optional


def _parse_yaml(path: str) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """Parse a simple YAML file into a flat section.key -> value dict,
    plus a repositories dict.

    Matches the parse-config.sh logic: top-level keys become sections,
    indented key: value pairs become section.key entries.
    The repositories section is parsed into a nested dict keyed by repo name.
    """
    values: dict[str, str] = {}
    repos: dict[str, dict[str, str]] = {}
    current_section = ""
    current_repo = ""
    current_subsection = ""
    in_repositories = False

    with open(path) as f:
        for line in f:
            stripped = line.split("#")[0].rstrip()
            if not stripped:
                continue

            indent = len(stripped) - len(stripped.lstrip())

            # Section header (no leading whitespace, ends with colon, no value)
            if (
                indent == 0
                and stripped.endswith(":")
                and ":" not in stripped[:-1]
            ):
                section_name = stripped[:-1]
                current_section = section_name
                in_repositories = section_name == "repositories"
                current_repo = ""
                current_subsection = ""
                continue

            if in_repositories:
                # Repo name (indent 2, ends with colon, no value)
                if indent == 2 and stripped.strip().endswith(":"):
                    repo_key = stripped.strip()[:-1]
                    current_repo = repo_key
                    current_subsection = ""
                    if repo_key not in repos:
                        repos[repo_key] = {}
                    continue

                # Subsection within a repo (indent 4, ends with colon, no value)
                if indent == 4 and current_repo and stripped.strip().endswith(":"):
                    sub = stripped.strip()[:-1]
                    if ":" not in sub:
                        current_subsection = sub
                        continue

                # Key-value pair within repo
                match = re.match(r"^\s+(\w+):\s*(.+)", stripped)
                if match and current_repo:
                    key = match.group(1)
                    val = match.group(2).strip()
                    if (val.startswith('"') and val.endswith('"')) or (
                        val.startswith("'") and val.endswith("'")
                    ):
                        val = val[1:-1]
                    if current_subsection:
                        repos[current_repo][f"{current_subsection}.{key}"] = val
                    else:
                        repos[current_repo][key] = val
                    continue
            else:
                # Standard key-value pair (indented)
                match = re.match(r"^\s+(\w+):\s*(.+)", stripped)
                if match:
                    key = match.group(1)
                    val = match.group(2).strip()
                    if (val.startswith('"') and val.endswith('"')) or (
                        val.startswith("'") and val.endswith("'")
                    ):
                        val = val[1:-1]
                    values[f"{current_section}.{key}"] = val

    return values, repos


def _expand(val: str) -> str:
    """Expand leading ~ to HOME."""
    return os.path.expanduser(val) if val else val


class RepoConfig:
    """Configuration for a single repository."""

    def __init__(self) -> None:
        self.path: str = ""
        self.worktree_prefix: str = ""
        self.commit_strategy: str = "branch_and_pr"
        self.use_worktree: bool = True
        self.branching_pattern: str = ""
        self.worktree_setup: str = "git worktree add -b {branch} {path} main"
        self.worktree_setup_quick: str = "git worktree add -b {branch} {path} main"
        self.worktree_teardown: str = "git worktree remove {path}"
        self.worktree_list: str = "git worktree list --porcelain"
        self.worktree_dev: str = ""


class Config:
    """Scheduler configuration loaded from environment.yml with local overrides."""

    def __init__(self) -> None:
        # Identity
        self.user_initials: str = ""
        self.user_name: str = ""

        # Repository (from _defaults, for backward compat)
        self.repo_path: str = ""
        self.worktree_prefix: str = ""

        # Tools
        self.tool_vmux: str = ""
        self.tool_graphite: str = ""

        # Worktree commands (from _defaults, for backward compat)
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

        # Per-Repository Config
        self.repositories: dict[str, RepoConfig] = {}

    def _bool(self, val: str) -> bool:
        return val.lower() in ("true", "yes", "1")

    def _int(self, val: str, default: int) -> int:
        try:
            return int(val)
        except (ValueError, TypeError):
            return default

    def resolve_repo(self, repo_key: str | None) -> RepoConfig:
        """Resolve a repo_key to its RepoConfig, falling back to _defaults."""
        if repo_key and repo_key in self.repositories:
            return self.repositories[repo_key]
        return self.repositories.get("_defaults", RepoConfig())


def _build_repo_config(
    repo_vals: dict[str, str],
    defaults: dict[str, str],
) -> RepoConfig:
    """Build a RepoConfig from raw parsed values, inheriting from defaults."""
    rc = RepoConfig()
    rc.path = _expand(repo_vals.get("path", defaults.get("path", "")))
    rc.worktree_prefix = _expand(
        repo_vals.get("worktree_prefix", defaults.get("worktree_prefix", ""))
    )
    rc.commit_strategy = repo_vals.get(
        "commit_strategy", defaults.get("commit_strategy", "branch_and_pr")
    )
    use_wt = repo_vals.get("use_worktree", defaults.get("use_worktree", "true"))
    rc.use_worktree = use_wt.lower() in ("true", "yes", "1") if isinstance(use_wt, str) else bool(use_wt)
    rc.branching_pattern = repo_vals.get(
        "branching_pattern", defaults.get("branching_pattern", "")
    )
    rc.worktree_setup = repo_vals.get(
        "worktree.setup",
        defaults.get("worktree.setup", "git worktree add -b {branch} {path} main"),
    )
    rc.worktree_setup_quick = repo_vals.get(
        "worktree.setup_quick",
        defaults.get("worktree.setup_quick", "git worktree add -b {branch} {path} main"),
    )
    rc.worktree_teardown = repo_vals.get(
        "worktree.teardown",
        defaults.get("worktree.teardown", "git worktree remove {path}"),
    )
    rc.worktree_list = repo_vals.get(
        "worktree.list",
        defaults.get("worktree.list", "git worktree list --porcelain"),
    )
    rc.worktree_dev = repo_vals.get(
        "worktree.dev", defaults.get("worktree.dev", "")
    )
    return rc


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
    values, repos = _parse_yaml(config_path)

    # Merge local overrides if the file exists
    if os.path.isfile(local_config_path):
        local_values, local_repos = _parse_yaml(local_config_path)
        values.update(local_values)
        # Deep-merge repos: local repo entries override base entries per-key
        for repo_key, repo_vals in local_repos.items():
            if repo_key not in repos:
                repos[repo_key] = {}
            repos[repo_key].update(repo_vals)

    cfg = Config()

    # Identity
    cfg.user_initials = values.get("user.initials", "")
    cfg.user_name = values.get("user.name", "")

    # Build per-repo configs
    defaults_raw = repos.get("_defaults", {})
    for repo_key, repo_vals in repos.items():
        cfg.repositories[repo_key] = _build_repo_config(repo_vals, defaults_raw)

    # Ensure _defaults exists even if not in config
    if "_defaults" not in cfg.repositories:
        cfg.repositories["_defaults"] = RepoConfig()

    # Repository — from _defaults for backward compat
    default_repo = cfg.repositories["_defaults"]
    cfg.repo_path = default_repo.path or _expand(values.get("repo.path", ""))
    cfg.worktree_prefix = default_repo.worktree_prefix or _expand(
        values.get("repo.worktree_prefix", "")
    )

    # Tools
    cfg.tool_vmux = _expand(values.get("tools.vmux", ""))
    cfg.tool_graphite = values.get("tools.graphite", "")

    # Worktree commands — from _defaults for backward compat
    cfg.worktree_setup = default_repo.worktree_setup
    cfg.worktree_setup_quick = default_repo.worktree_setup_quick
    cfg.worktree_teardown = default_repo.worktree_teardown
    cfg.worktree_list = default_repo.worktree_list
    cfg.worktree_dev = default_repo.worktree_dev

    # State
    cfg.queue_file = _expand(values.get("state.queue_file", ""))

    # Concurrency
    cfg.max_active = cfg._int(values.get("concurrency.max_active", "2"), 2)

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
