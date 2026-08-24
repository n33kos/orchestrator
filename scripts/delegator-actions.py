#!/usr/bin/env python3
"""Execute the actions a delegator cycle decided on.

Reads the cycle's JSON on stdin and performs each action: messaging the worker,
updating queue metadata, moving the item to review, and so on.

This lives in its own file rather than embedded in delegator-postprocess.sh because
embedding it means the Python source has to survive bash's quoting rules. A single
unescaped docstring quote silently terminated the surrounding bash string and turned
the whole block into shell words, so every action was discarded without an error the
caller could see. A real module cannot be broken that way.
"""

import json
import os
import subprocess
import sys

VMUX = os.environ.get("DELEGATOR_VMUX", "vmux")
ITEM_ID = os.environ["DELEGATOR_ITEM_ID"]
SCRIPT_DIR = os.environ["DELEGATOR_SCRIPT_DIR"]

# Known metadata fields and where they live on a work item.
FIELD_MAPPING = {
    "delegator_enabled": "worker.delegator_enabled",
    "status": "status",
    "delegator_status": "runtime.delegator_status",
    "last_activity": "runtime.last_activity",
    "completion_message": "runtime.completion_message",
    "spend": "runtime.spend",
}


def coalesce_worker_messages(actions):
    """Collapse a cycle's worker messages into one.

    A cycle can return several message_worker actions, and sending each one
    separately interrupts a worker repeatedly within a few seconds for what is a
    single round of feedback. They are merged into one message, in order, so the
    worker reads the cycle's guidance as a whole and its own turn is broken once
    rather than once per point.
    """
    texts = []
    others = []
    for action in actions:
        if isinstance(action, dict) and action.get("type") == "message_worker":
            text = (action.get("text") or "").strip()
            if text:
                texts.append(text)
        else:
            others.append(action)

    if not texts:
        return others

    if len(texts) == 1:
        merged = texts[0]
    else:
        merged = "\n\n".join(f"{i}. {t}" for i, t in enumerate(texts, 1))
        print(f"  [action] Coalesced {len(texts)} worker messages into one")

    return [{"type": "message_worker", "text": merged}] + others


def worker_session_id():
    result = subprocess.run(
        ["python3", "-m", "lib.queue", "get", ITEM_ID, "environment.session_id"],
        capture_output=True,
        text=True,
        cwd=SCRIPT_DIR,
    )
    return result.stdout.strip()


def flatten(obj, prefix=""):
    """Flatten nested dicts into dotted key paths for a queue update."""
    pairs = []
    for key, value in obj.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            pairs.extend(flatten(value, full_key))
        elif isinstance(value, list):
            # Serialize lists as JSON strings so queue update can parse them.
            pairs.append((full_key, json.dumps(value)))
        else:
            pairs.append((full_key, value))
    return pairs


def as_arg(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def do_message_worker(action):
    text = action.get("text", "")
    session = worker_session_id()
    if session and text:
        subprocess.run([VMUX, "send", session, text], capture_output=True, timeout=10)
        print(f"  [action] Sent message to worker: {text[:80]}...")


def do_update_queue_metadata(action):
    metadata = action.get("data") or action.get("metadata") or {}
    args = ["python3", "-m", "lib.queue", "update", ITEM_ID]
    for key, value in flatten(metadata):
        if key in FIELD_MAPPING:
            mapped = FIELD_MAPPING[key]
        elif key.startswith(("runtime.", "worker.", "environment.")):
            mapped = key
        else:
            mapped = f"runtime.{key}"
        args.append(f"{mapped}={as_arg(value)}")
    subprocess.run(args, cwd=SCRIPT_DIR, capture_output=True)
    print(f"  [action] Updated queue metadata: {[k for k, _ in flatten(metadata)]}")


def do_trigger_review_transition(_action):
    # Only update queue status to review — do NOT suspend session or delegator.
    # Both stay alive so the delegator can monitor CI and the worker can receive commands.
    subprocess.run(
        ["python3", "-m", "lib.queue", "update", ITEM_ID, "status=review"],
        cwd=SCRIPT_DIR,
        capture_output=True,
        timeout=10,
    )
    print(f"  [action] Moved {ITEM_ID} to review status (session + delegator stay alive)")


def do_request_ci_fix(_action):
    session = worker_session_id()
    if session:
        msg = (
            f"[Delegator {ITEM_ID}]: CI checks are failing. "
            "Run /fix-ci-tests to identify and fix the failures."
        )
        subprocess.run([VMUX, "send", session, msg], capture_output=True, timeout=10)
        print("  [action] Sent CI fix request to worker")


def do_post_pr_review(action):
    # Review instructions tell Opus to emit this action, but we don't have automated
    # PR comment posting yet. Log the review so it is visible in the delegator output
    # and can be acted on manually.
    summary = action.get("summary", "")
    print(f"  [action] PR review (not posted): summary={summary[:120]}")
    for comment in (action.get("comments") or [])[:5]:
        if isinstance(comment, str):
            body = comment
        else:
            body = comment.get("body") or comment.get("text") or str(comment)
        print(f"    comment: {body[:120]}")


def do_flag_for_user(action):
    description = (
        action.get("message")
        or action.get("description")
        or "Delegator flagged an issue"
    )
    print(f"  [action] Flagged for user: {description}")


HANDLERS = {
    "message_worker": do_message_worker,
    "update_queue_metadata": do_update_queue_metadata,
    "trigger_review_transition": do_trigger_review_transition,
    "request_ci_fix": do_request_ci_fix,
    "post_pr_review": do_post_pr_review,
    "flag_for_user": do_flag_for_user,
}


def main():
    data = json.load(sys.stdin)
    actions = coalesce_worker_messages(data.get("actions", []))

    for action in actions:
        action_type = action.get("type", "")
        handler = HANDLERS.get(action_type)
        if handler is None:
            print(f"  [action] Unknown action type: {action_type}")
            continue
        try:
            handler(action)
        except Exception as exc:
            print(f"  [action] ERROR executing {action_type}: {exc}")


if __name__ == "__main__":
    main()
