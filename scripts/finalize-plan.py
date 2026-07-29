#!/usr/bin/env python3
"""Complete an item's preparation and decide whether it may leave planning.

Plan generation is the one step that already holds the item's full context, so it is
where the remaining preparation belongs: choosing the repository and naming the branch.
Doing it here, rather than in separate passes, means an item is made whole in one place.

The promotion to `queued` is gated on readiness. `queued` is the status the scheduler
draws from, so an item that reaches it must be activatable once its plan is approved.
An item that cannot be made ready stays in `planning` with its reasons recorded, which
is visible, instead of sitting in `queued` looking fine and never moving.

Usage:
    python3 scripts/finalize-plan.py <item-id> [--repo-key KEY] [--branch-slug SLUG]
"""

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(PROJECT_ROOT))

from lib.queue import find_item, locked_queue  # noqa: E402
from scripts.scheduler.config import load_config  # noqa: E402
from scripts.scheduler.readiness import (  # noqa: E402
    activation_blockers,
    slugify,
    suggest_branch,
)

APPROVAL_REASON = "plan is not approved"


def main() -> int:
    parser = argparse.ArgumentParser(description="Finalize an item's preparation")
    parser.add_argument("item_id")
    parser.add_argument("--repo-key", default="", help="Repository chosen during planning")
    parser.add_argument("--branch-slug", default="", help="Short branch slug chosen during planning")
    args = parser.parse_args()

    cfg = load_config(str(PROJECT_ROOT))
    valid_keys = {key for key in cfg.repositories if key != "_defaults"}

    with locked_queue(write=True) as ctx:
        items_by_id = {i["id"]: i for i in ctx["data"]["items"]}
        item = find_item(ctx["data"], args.item_id)
        if not item:
            print(f"ERROR: Item {args.item_id} not found", file=sys.stderr)
            return 1

        env = item.setdefault("environment", {})

        # Repository: only fill a gap. An existing choice is never overridden, since it
        # may have come from a label rule or from the user.
        if not item.get("repo_key") and not env.get("repo"):
            if args.repo_key in valid_keys:
                item["repo_key"] = args.repo_key
                print(f"  repo_key set to '{args.repo_key}'")
            elif args.repo_key:
                print(f"  ignored unknown repo_key '{args.repo_key}'", file=sys.stderr)

        # Branch: prefer the slug chosen with the plan in hand, else derive one.
        if not env.get("branch"):
            slug = slugify(args.branch_slug) if args.branch_slug else ""
            if slug:
                initials = cfg.user_initials or "wip"
                identifier = (item.get("integration") or {}).get("identifier") or item["id"]
                env["branch"] = f"{initials}/{identifier.lower()}/{slug}"
            else:
                env["branch"] = suggest_branch(cfg, item)
            print(f"  branch set to '{env['branch']}'")

        reasons = [
            reason
            for reason in activation_blockers(cfg, item, items_by_id)
            if not reason.startswith("status is")
        ]
        item.setdefault("runtime", {})["blocked_reasons"] = reasons

        # Approval is the user's gate, not a preparation failure, so it alone does not
        # hold an item in planning.
        blockers = [r for r in reasons if r != APPROVAL_REASON]

        if blockers:
            print(f"  staying in planning: {'; '.join(blockers)}")
        elif item["status"] == "planning":
            item["status"] = "queued"
            print("  promoted to queued (awaiting plan approval)")

        ctx["modified"] = True

    return 0


if __name__ == "__main__":
    sys.exit(main())
