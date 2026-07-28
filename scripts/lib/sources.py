"""Work source (adapter) configuration.

Adapters are declared in `config/sources.json`. Each adapter type publishes a
field spec so any editing surface (dashboard, CLI) can render a form without
hardcoding the field list per type.
"""

import json
from pathlib import Path
from typing import Any


SOURCES_FILENAME = "sources.json"
EXAMPLE_FILENAME = "sources.example.json"


def _field(
    key: str,
    label: str,
    kind: str = "text",
    default: Any = "",
    help_text: str = "",
    options: list[str] | None = None,
) -> dict[str, Any]:
    spec = {
        "key": key,
        "label": label,
        "kind": kind,
        "default": default,
        "help": help_text,
    }
    if options is not None:
        spec["options"] = options
    return spec


_LIMIT = _field("limit", "Limit", "number", 20, "Max items to pull per poll.")


ADAPTER_SPECS: dict[str, dict[str, Any]] = {
    "linear": {
        "label": "Linear",
        "help": "Pull issues from a Linear team. Requires LINEAR_API_KEY.",
        "fields": [
            _field("team", "Team", "text", "", "Team name, key, or ID. Required."),
            _field("assignee", "Assignee", "text", "me", "'me', a display name, or a user ID. Blank for any."),
            _field("labels", "Labels", "list", ["orchestrator"], "Issue must carry all of these labels."),
            _field("states", "Statuses", "list", [], "Restrict to these workflow statuses. Blank for any open status."),
            _field("project", "Project", "text", "", "Restrict to one project by name or ID."),
            _field("min_priority", "Minimum priority", "number", 0, "Linear priority: 1=Urgent, 4=Low. 0 for any."),
            _field(
                "repo_label_map",
                "Repo by label",
                "list",
                [],
                "Route by issue label, e.g. 'web=babylist-web, ios=ios'. First match wins. Falls back to the default repo key below; blank means the item must be routed by hand before it can activate.",
            ),
            _field("include_comments", "Include comments as context", "boolean", True),
            _field("raw_filter", "Raw filter (JSON)", "textarea", "", "Advanced: a Linear IssueFilter object, merged over the fields above."),
            _LIMIT,
        ],
    },
    "github": {
        "label": "GitHub Issues",
        "help": "Poll issues via the gh CLI.",
        "fields": [
            _field("repo", "Repository", "text", "", "owner/repo. Required."),
            _field("assignee", "Assignee", "text", "@me", "Blank for any."),
            _field("labels", "Labels", "list", []),
            _field("state", "State", "select", "open", options=["open", "closed", "all"]),
            _LIMIT,
        ],
    },
    "jira": {
        "label": "Jira",
        "help": "Poll issues via the Jira REST API. Requires JIRA_EMAIL and JIRA_API_TOKEN.",
        "fields": [
            _field("domain", "Domain", "text", "", "e.g. mycompany.atlassian.net. Required."),
            _field("board", "Project key", "text", "", "e.g. CONSUMER. Required."),
            _field("filter", "JQL", "textarea", "", "Blank uses assignee = currentUser() AND status != Done."),
            _LIMIT,
        ],
    },
    "markdown": {
        "label": "Markdown file",
        "help": "Parse checkbox and numbered task items out of a local markdown file.",
        "fields": [
            _field("path", "File path", "text", "", "Required."),
        ],
    },
}


DEFAULT_ITEM_DEFAULTS: dict[str, Any] = {
    "repo_key": "",
    "priority": 3,
    "commit_strategy": "",
    "delegator_enabled": True,
}


DEFAULT_WRITEBACK: dict[str, Any] = {
    "enabled": False,
    "comment_on_import": False,
    "status_map": {},
}


def describe_adapters() -> dict[str, Any]:
    """Field specs for every adapter type, for rendering a config form."""
    return {
        "types": ADAPTER_SPECS,
        "item_defaults": DEFAULT_ITEM_DEFAULTS,
        "writeback": DEFAULT_WRITEBACK,
    }


def sources_path(project_root: Path) -> Path:
    return project_root / "config" / SOURCES_FILENAME


def load_sources(project_root: Path) -> dict[str, Any]:
    """Read the adapter list, falling back to the committed example."""
    path = sources_path(project_root)
    if not path.exists():
        path = project_root / "config" / EXAMPLE_FILENAME
    if not path.exists():
        return {"version": 1, "adapters": []}

    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "adapters": []}

    adapters = [normalize_adapter(a) for a in data.get("adapters", [])]
    return {"version": data.get("version", 1), "adapters": adapters}


def save_sources(project_root: Path, data: dict[str, Any]) -> None:
    path = sources_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": data.get("version", 1),
        "adapters": [normalize_adapter(a) for a in data.get("adapters", [])],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")


def normalize_adapter(adapter: dict[str, Any]) -> dict[str, Any]:
    """Fill in missing keys and apply per-type field defaults."""
    adapter_type = adapter.get("type", "")
    spec = ADAPTER_SPECS.get(adapter_type, {"fields": []})

    config = dict(adapter.get("config") or {})
    for field in spec["fields"]:
        config.setdefault(field["key"], field["default"])

    defaults = dict(DEFAULT_ITEM_DEFAULTS)
    defaults.update(adapter.get("defaults") or {})

    writeback = dict(DEFAULT_WRITEBACK)
    writeback.update(adapter.get("writeback") or {})

    return {
        "name": adapter.get("name", adapter_type or "unnamed"),
        "type": adapter_type,
        "enabled": bool(adapter.get("enabled", True)),
        "config": config,
        "defaults": defaults,
        "writeback": writeback,
    }


def validate_adapter(adapter: dict[str, Any]) -> list[str]:
    """Return a list of problems, empty when the adapter is usable."""
    problems = []
    adapter_type = adapter.get("type", "")
    if adapter_type not in ADAPTER_SPECS:
        return [f"unknown adapter type '{adapter_type}'"]
    if not adapter.get("name"):
        problems.append("missing name")

    required = {
        "linear": ["team"],
        "github": ["repo"],
        "jira": ["domain", "board"],
        "markdown": ["path"],
    }[adapter_type]

    config = adapter.get("config") or {}
    for key in required:
        if not config.get(key):
            problems.append(f"missing required field '{key}'")
    return problems


def enabled_adapters(project_root: Path, only: str = "") -> list[dict[str, Any]]:
    adapters = load_sources(project_root)["adapters"]
    if only:
        return [a for a in adapters if a["name"] == only]
    return [a for a in adapters if a["enabled"]]


def _main() -> None:
    """CLI so editing surfaces reuse this module's normalization and validation.

    Usage:
        python3 -m lib.sources describe
        python3 -m lib.sources get
        python3 -m lib.sources set   # reads the new document on stdin
    """
    import sys

    project_root = Path(__file__).resolve().parent.parent.parent
    command = sys.argv[1] if len(sys.argv) > 1 else "get"

    if command == "describe":
        print(json.dumps(describe_adapters()))
        return

    if command == "get":
        data = load_sources(project_root)
        for adapter in data["adapters"]:
            adapter["problems"] = validate_adapter(adapter)
        print(json.dumps(data))
        return

    if command == "set":
        incoming = json.loads(sys.stdin.read())
        adapters = [normalize_adapter(a) for a in incoming.get("adapters", [])]

        names = [a["name"] for a in adapters]
        duplicates = {n for n in names if names.count(n) > 1}
        if duplicates:
            print(json.dumps({"ok": False, "error": f"duplicate adapter names: {', '.join(sorted(duplicates))}"}))
            sys.exit(1)

        save_sources(project_root, {"version": incoming.get("version", 1), "adapters": adapters})
        for adapter in adapters:
            adapter["problems"] = validate_adapter(adapter)
        print(json.dumps({"ok": True, "adapters": adapters}))
        return

    print(json.dumps({"ok": False, "error": f"unknown command '{command}'"}))
    sys.exit(1)


if __name__ == "__main__":
    _main()
