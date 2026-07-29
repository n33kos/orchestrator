"""The single definition of whether a work item can advance.

Readiness used to be an implicit conjunction of preconditions spread across the
scheduler and the activation script, evaluated by discarding items that failed and
reporting only a count. That made every stall silent and identical: "Ready: 0", with
no way to tell an unapproved plan from an unresolvable repository. It also meant the
gate duplicated knowledge about where a repository comes from, so adding `repo_key`
left the gate behind and no discovered item could ever activate.

This module answers one question and explains itself. Every caller asks here rather
than reimplementing the conditions, and the reasons are logged and persisted so a
stalled item says why it is stalled.
"""

import re
from typing import Any

from scripts.scheduler.config import Config

ACTIVATABLE_STATUSES = ("queued", "planning")


def resolve_repo_path(cfg: Config, item: dict[str, Any]) -> str:
    """Where this item's work would happen, or empty when it cannot be determined.

    An explicit `environment.repo` wins, then `repo_key` through the repo config.
    `_defaults` deliberately does not count: falling back to it is how an unrouted
    item ends up pointed at a placeholder repository.
    """
    env = item.get("environment") or {}
    explicit = env.get("repo")
    if explicit:
        return str(explicit)

    repo_key = item.get("repo_key")
    if repo_key and repo_key in cfg.repositories:
        return cfg.repositories[repo_key].path

    return ""


def activation_blockers(
    cfg: Config,
    item: dict[str, Any],
    items_by_id: dict[str, dict[str, Any]],
) -> list[str]:
    """Every reason this item cannot be activated right now.

    An empty list means ready. Concurrency is deliberately excluded: a free slot is a
    property of the queue, not of the item, and conflating them is what made "no slots"
    indistinguishable from "not ready".
    """
    reasons = []

    if item["status"] not in ACTIVATABLE_STATUSES:
        reasons.append(f"status is '{item['status']}'")

    if not resolve_repo_path(cfg, item):
        repo_key = item.get("repo_key")
        if repo_key:
            reasons.append(f"repo_key '{repo_key}' is not a configured repository")
        else:
            reasons.append("no repo_key and no environment.repo")

    if not (item.get("environment") or {}).get("branch"):
        reasons.append("no branch")

    for dep_id in item.get("blocked_by") or []:
        dep = items_by_id.get(dep_id)
        if dep is None:
            reasons.append(f"blocked by {dep_id}, which is not in the queue")
        elif dep.get("status") != "completed":
            reasons.append(f"blocked by {dep_id} ({dep.get('status')})")

    if cfg.require_approved_plan:
        plan = item.get("plan") or {}
        if not (isinstance(plan, dict) and plan.get("approved")):
            reasons.append("plan is not approved")

    return reasons


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


# Filler words carry no meaning in a branch name and crowd out the words that do.
_STOPWORDS = frozenset(
    "a an and the to for of on in with into from at by as is are be that this it its".split()
)


def slugify(text: str, max_words: int = 5) -> str:
    words = [w for w in _SLUG_STRIP.sub(" ", text.lower()).split() if w]
    meaningful = [w for w in words if w not in _STOPWORDS]
    return "-".join((meaningful or words)[:max_words])


def suggest_branch(cfg: Config, item: dict[str, Any]) -> str:
    """A branch name for an item that arrived without one.

    Discovered items have no branch, because the tracker does not supply one. Rather
    than leaving them permanently unready, derive a name that traces back to the source
    issue: <initials>/<identifier>/<title slug>.
    """
    initials = cfg.user_initials or "wip"
    integration = item.get("integration") or {}
    identifier = (integration.get("identifier") or "").strip().lower()

    title = item.get("title", "")
    # An imported title is prefixed with its identifier, which would repeat in the slug.
    if identifier and title.lower().startswith(identifier):
        title = title[len(identifier):].lstrip(": ")

    slug = slugify(title) or "work"
    domain = _SLUG_STRIP.sub("-", identifier).strip("-") if identifier else item["id"]
    return f"{initials}/{domain}/{slug}"
