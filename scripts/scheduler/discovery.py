"""Work discovery and issue-tracker writeback.

Discovery polls the adapters in config/sources.json on its own interval and adds
whatever is new to the queue. Writeback pushes orchestrator status changes back
to the originating issue, so the tracker stays the source of truth for state.
"""

import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from scripts.lib import linear_api, sources
from scripts.lib.queue import locked_queue
from scripts.scheduler.config import Config
from scripts.scheduler.events import emit_event
from scripts.scheduler.readiness import ACTIVATABLE_STATUSES, suggest_branch

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
EXEC_ENV = {**os.environ, "HOME": os.path.expanduser("~")}

_last_discovery = 0.0


def discover_work(cfg: Config, dry_run: bool) -> None:
    """Poll configured adapters, no more often than the discovery interval."""
    global _last_discovery

    if cfg.discovery_interval <= 0:
        return

    now = time.monotonic()
    if _last_discovery and now - _last_discovery < cfg.discovery_interval:
        return
    _last_discovery = now

    if not sources.enabled_adapters(PROJECT_ROOT):
        return

    args = ["python3", str(SCRIPTS_DIR / "discover-work.py")]
    if dry_run:
        args.append("--dry-run")

    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=120, env=EXEC_ENV)
    except subprocess.TimeoutExpired:
        print("[scheduler] Work discovery timed out", file=sys.stderr)
        return

    added = [
        line.strip()[len("Added: "):]
        for line in result.stdout.splitlines()
        if line.strip().startswith("Added: ")
    ]

    if result.returncode != 0:
        print(f"[scheduler] Work discovery failed: {result.stderr.strip()}", file=sys.stderr)
        emit_event("discovery.error", "Work discovery failed", severity="error")
        return

    for entry in added:
        print(f"[scheduler] Discovered: {entry}")
        emit_event("discovery.item_added", f"Discovered {entry}")


CLAUDE_BIN = os.path.expanduser("~/.local/bin/claude")
ROUTING_CONTEXT_CHARS = 4000


def _routing_prompt(cfg: Config, item: dict, context: str) -> str:
    catalogue = []
    for key, repo in sorted(cfg.repositories.items()):
        if key == "_defaults":
            continue
        line = f"- {key}: {repo.path}"
        if repo.description:
            line += f" ({repo.description})"
        catalogue.append(line)

    return (
        "Pick which repository this work item belongs to.\n\n"
        "Repositories:\n"
        + "\n".join(catalogue)
        + f"\n\nWork item title: {item['title']}\n\n"
        + (f"Work item details:\n{context[:ROUTING_CONTEXT_CHARS]}\n\n" if context else "")
        + "Answer with exactly one repository key from the list above, and nothing else. "
        "If the item does not clearly belong to any of them, answer UNKNOWN."
    )


def route_unrouted_items(cfg: Config, dry_run: bool) -> None:
    """Infer a repo for items that arrived without one.

    Discovery cannot always determine a repository from labels alone, so rather
    than defaulting to a guess, unrouted items are resolved here, before plan
    generation, using the item's own title and imported detail.
    """
    with locked_queue() as ctx:
        items = list(ctx["data"].get("items", []))

    valid_keys = {key for key in cfg.repositories if key != "_defaults"}
    resolved: dict[str, str] = {}
    attempted: list[str] = []

    for item in items:
        if item["status"] not in ("queued", "planning"):
            continue
        if item.get("repo_key") or (item.get("environment") or {}).get("repo"):
            continue
        # One attempt per item. Without this an unroutable item costs a model call
        # on every scheduler cycle, forever.
        if (item.get("runtime") or {}).get("routing_attempted"):
            continue

        context = ""
        context_path = (item.get("integration") or {}).get("context_file")
        if context_path and Path(context_path).exists():
            context = Path(context_path).read_text()

        if dry_run:
            print(f"[scheduler] Would infer a repo for {item['id']}")
            continue

        attempted.append(item["id"])

        try:
            result = subprocess.run(
                [CLAUDE_BIN, "--print", "--model", "sonnet", _routing_prompt(cfg, item, context)],
                capture_output=True,
                text=True,
                timeout=90,
                env={**EXEC_ENV, "CLAUDECODE": ""},
            )
        except subprocess.TimeoutExpired:
            print(f"[scheduler] Repo inference timed out for {item['id']}", file=sys.stderr)
            continue

        answer = result.stdout.strip().split()[-1].strip("`.,") if result.stdout.strip() else ""

        if result.returncode != 0 or answer not in valid_keys:
            print(f"[scheduler] Could not infer a repo for {item['id']} (got {answer!r})")
            emit_event(
                "discovery.routing_failed",
                f"Could not infer a repo for {item['title']}",
                item_id=item["id"],
                severity="warn",
            )
            continue

        resolved[item["id"]] = answer
        print(f"[scheduler] Routed {item['id']} to '{answer}'")
        emit_event("discovery.routed", f"Routed {item['title']} to {answer}", item_id=item["id"])

    if not attempted:
        return

    with locked_queue(write=True) as ctx:
        for item in ctx["data"].get("items", []):
            if item["id"] not in attempted:
                continue
            if item["id"] in resolved:
                item["repo_key"] = resolved[item["id"]]
            else:
                item.setdefault("runtime", {})["routing_attempted"] = True
            ctx["modified"] = True


def _completed_blockers(identifiers: list[str]) -> set[str]:
    """Which of these tracker identifiers are already done or cancelled.

    Linear's issue lookup accepts a human identifier while its filters want UUIDs,
    so the batch is expressed as one aliased query rather than a filtered list.
    """
    aliases = {f"i{index}": identifier for index, identifier in enumerate(identifiers)}
    body = "\n".join(
        f'  {alias}: issue(id: "{identifier}") {{ identifier state {{ type }} }}'
        for alias, identifier in aliases.items()
    )
    data = linear_api.query(f"query OrchestratorBlockerStates {{\n{body}\n}}")

    completed = set()
    for node in data.values():
        if node and (node.get("state") or {}).get("type") in ("completed", "canceled"):
            completed.add(node["identifier"])
    return completed


def sync_blocked_by(cfg: Config, dry_run: bool) -> None:
    """Keep blocked_by in step with the tracker's blocking relations.

    A blocker that has been imported is referenced by its queue id. One that has
    not is held as its tracker identifier, which reconciliation treats as
    unsatisfied, so a partially imported chain still sequences correctly. Refs
    are re-checked against the tracker so a blocker completed outside the
    orchestrator stops blocking.
    """
    with locked_queue() as ctx:
        items = list(ctx["data"].get("items", []))

    queue_id_by_identifier = {
        (item.get("integration") or {}).get("identifier"): item["id"]
        for item in items
        if (item.get("integration") or {}).get("identifier")
    }

    unimported = {
        ref
        for item in items
        for ref in ((item.get("integration") or {}).get("blocked_by_refs") or [])
        if ref not in queue_id_by_identifier
    }

    # Anything still outside the queue may have been completed in the tracker.
    cleared: set[str] = set()
    if unimported and not dry_run:
        try:
            cleared = _completed_blockers(sorted(unimported))
        except linear_api.LinearError as err:
            print(f"[scheduler] Could not check blocker states: {err}", file=sys.stderr)

    updates: dict[str, list[str]] = {}

    for item in items:
        refs = (item.get("integration") or {}).get("blocked_by_refs") or []
        if not refs:
            continue

        desired = [
            queue_id_by_identifier.get(ref, ref)
            for ref in refs
            if ref not in cleared
        ]
        if desired != list(item.get("blocked_by") or []):
            updates[item["id"]] = desired

    if not updates:
        return

    if dry_run:
        for item_id, desired in updates.items():
            print(f"[scheduler] Would set {item_id} blocked_by to {desired}")
        return

    with locked_queue(write=True) as ctx:
        for item in ctx["data"].get("items", []):
            if item["id"] in updates:
                item["blocked_by"] = updates[item["id"]]
                print(f"[scheduler] {item['id']} blocked_by: {updates[item['id']] or 'nothing'}")
                ctx["modified"] = True


def assign_missing_branches(cfg: Config, dry_run: bool) -> None:
    """Give discovered items a branch, since a tracker does not supply one.

    Only items that came from work discovery are named automatically. A hand-created
    item without a branch is a human omission, and readiness reports it as one rather
    than having the system guess at intent.
    """
    with locked_queue() as ctx:
        items = list(ctx["data"].get("items", []))

    assigned: dict[str, str] = {}
    for item in items:
        if item["status"] not in ACTIVATABLE_STATUSES:
            continue
        if (item.get("environment") or {}).get("branch"):
            continue
        if not (item.get("integration") or {}).get("identifier"):
            continue

        branch = suggest_branch(cfg, item)
        if dry_run:
            print(f"[scheduler] Would set {item['id']} branch to '{branch}'")
            continue
        assigned[item["id"]] = branch

    if not assigned:
        return

    with locked_queue(write=True) as ctx:
        for item in ctx["data"].get("items", []):
            if item["id"] in assigned:
                item["environment"]["branch"] = assigned[item["id"]]
                print(f"[scheduler] {item['id']} branch set to '{assigned[item['id']]}'")
                emit_event(
                    "discovery.branch_assigned",
                    f"Branch {assigned[item['id']]} assigned to {item['title']}",
                    item_id=item["id"],
                )
                ctx["modified"] = True


def _writeback_for(adapter_name: str) -> dict:
    for adapter in sources.load_sources(PROJECT_ROOT)["adapters"]:
        if adapter["name"] == adapter_name:
            return adapter["writeback"]
    return {}


def announce_imports(cfg: Config, dry_run: bool) -> None:
    """Comment on newly imported issues so the tracker shows what picked them up."""
    if not cfg.discovery_writeback:
        return

    with locked_queue() as ctx:
        items = list(ctx["data"].get("items", []))

    announced = []

    for item in items:
        integration = item.get("integration") or {}
        if integration.get("provider") != "linear" or not integration.get("issue_id"):
            continue
        if integration.get("announced_at"):
            continue

        writeback = _writeback_for(integration.get("adapter", ""))
        if not (writeback.get("enabled") and writeback.get("comment_on_import")):
            continue

        identifier = integration.get("identifier") or integration["issue_id"]
        body = f"Picked up by the orchestrator as `{item['id']}`. Status updates will follow here."

        if dry_run:
            print(f"[scheduler] Would comment on {identifier}")
            continue

        try:
            linear_api.add_comment(integration["issue_id"], body)
        except linear_api.LinearError as err:
            print(f"[scheduler] Could not comment on {identifier}: {err}", file=sys.stderr)
            continue

        print(f"[scheduler] Commented on {identifier} for {item['id']}")
        announced.append(item["id"])

    if not announced:
        return

    stamp = datetime.now(timezone.utc).isoformat()
    with locked_queue(write=True) as ctx:
        for item in ctx["data"].get("items", []):
            if item["id"] in announced:
                item.setdefault("integration", {})["announced_at"] = stamp
                ctx["modified"] = True


def sync_integrations(cfg: Config, dry_run: bool) -> None:
    """Push orchestrator status changes back to the originating issues."""
    if not cfg.discovery_writeback:
        return

    with locked_queue() as ctx:
        items = list(ctx["data"].get("items", []))

    updates: dict[str, str] = {}

    for item in items:
        integration = item.get("integration") or {}
        if integration.get("provider") != "linear" or not integration.get("issue_id"):
            continue

        writeback = _writeback_for(integration.get("adapter", ""))
        if not writeback.get("enabled"):
            continue

        target_state = (writeback.get("status_map") or {}).get(item["status"])
        if not target_state or integration.get("synced_status") == item["status"]:
            continue

        identifier = integration.get("identifier") or integration["issue_id"]
        if dry_run:
            print(f"[scheduler] Would set {identifier} to '{target_state}'")
            continue

        try:
            linear_api.set_issue_state(integration["issue_id"], target_state)
        except linear_api.LinearError as err:
            print(f"[scheduler] Linear writeback failed for {identifier}: {err}", file=sys.stderr)
            emit_event(
                "discovery.writeback_error",
                f"Could not set {identifier} to {target_state}",
                item_id=item["id"],
                severity="warn",
            )
            continue

        print(f"[scheduler] {identifier} set to '{target_state}'")
        emit_event("discovery.writeback", f"{identifier} set to {target_state}", item_id=item["id"])
        updates[item["id"]] = item["status"]

    if not updates:
        return

    stamp = datetime.now(timezone.utc).isoformat()
    with locked_queue(write=True) as ctx:
        for item in ctx["data"].get("items", []):
            if item["id"] in updates:
                item.setdefault("integration", {})["synced_status"] = updates[item["id"]]
                item["integration"]["synced_at"] = stamp
                ctx["modified"] = True
