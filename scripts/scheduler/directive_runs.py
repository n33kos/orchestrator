"""Supervision of in-flight directive runs.

A directive launched through `scripts/run-directive.sh` is a detached process
group whose progress is recorded in
`~/.claude/orchestrator/delegators/<item-id>/directive-<name>.status.json`.

This module is the single place that answers three questions about such a run:

  1. Is it still alive, and is it making progress?
  2. Has it exceeded its time or cost budget, and must it be stopped?
  3. What should the queue, the dashboard, and the worker session be told?

Nothing else in the scheduler inspects directive processes, and nothing else
decides when a run has gone on too long. `stop_run` is also what the dashboard
and the worker session call to cancel a run by hand, so a manual stop and a
budget stop take exactly the same path and leave exactly the same record.
"""

import json
import os
import signal
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from scripts.scheduler.events import emit_event

DELEGATORS_DIR = Path.home() / ".claude" / "orchestrator" / "delegators"

# Terminal states a run can be left in. Anything else means the run is live.
TERMINAL_STATUSES = ("completed", "failed", "killed", "timed_out")


def status_path(item_id: str, directive: str) -> Path:
    return DELEGATORS_DIR / item_id / f"directive-{directive}.status.json"


def read_status(item_id: str, directive: str) -> Optional[dict]:
    """Read one directive's status file, or None when there is nothing to read."""
    path = status_path(item_id, directive)
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _write_status(item_id: str, directive: str, updates: dict) -> None:
    path = status_path(item_id, directive)
    try:
        with open(path) as f:
            status = json.load(f)
    except (OSError, json.JSONDecodeError):
        status = {"directive": directive}
    status.update(updates)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(status, f, indent=2)
    os.replace(tmp, path)


def list_runs(item_id: str) -> list[dict]:
    """Every directive run recorded for an item, live or finished."""
    item_dir = DELEGATORS_DIR / item_id
    if not item_dir.is_dir():
        return []
    runs = []
    for path in sorted(item_dir.glob("directive-*.status.json")):
        try:
            with open(path) as f:
                runs.append(json.load(f))
        except (OSError, json.JSONDecodeError):
            continue
    return runs


def _parse_ts(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _process_alive(pid: Optional[int]) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def describe_run(status: dict, now: Optional[datetime] = None) -> dict:
    """Summarize one run for the queue, the dashboard, and the worker message.

    Returns a flat dict of the facts a reader needs to judge a run without
    inspecting any process itself: whether it is live, how long it has run,
    how long since it last showed progress, and how much output it has produced.
    """
    now = now or datetime.now(timezone.utc)
    started = _parse_ts(status.get("started_at", ""))
    heartbeat = _parse_ts(status.get("last_heartbeat", "")) or started

    runtime_seconds = int((now - started).total_seconds()) if started else 0
    since_heartbeat = int((now - heartbeat).total_seconds()) if heartbeat else 0

    raw_status = status.get("status", "unknown")
    pid = status.get("command_pid") or status.get("pid")
    alive = raw_status not in TERMINAL_STATUSES and _process_alive(pid)

    return {
        "directive": status.get("directive", ""),
        "status": raw_status,
        "alive": alive,
        "pid": pid,
        "pgid": status.get("pgid"),
        "cwd": status.get("cwd"),
        "started_at": status.get("started_at"),
        "runtime_seconds": runtime_seconds,
        "runtime_minutes": round(runtime_seconds / 60, 1),
        "seconds_since_heartbeat": since_heartbeat,
        "output_bytes": status.get("output_bytes", 0),
        "output_path": status.get("output_path"),
        "exit_code": status.get("exit_code"),
        "stopped_reason": status.get("stopped_reason"),
        "timeout_minutes": status.get("timeout_minutes"),
    }


def stop_run(item_id: str, directive: str, reason: str) -> dict:
    """Stop a directive run and everything it started.

    Signals the whole process group, so the `claude` call, its Playwright
    server, and any browser it opened all go down together. Escalates to
    SIGKILL only if the group ignores SIGTERM.

    Returns a result dict describing what happened. Safe to call on a run that
    has already finished; that reports `already_finished` and changes nothing.
    """
    status = read_status(item_id, directive)
    if not status:
        return {"stopped": False, "reason": "no_status_file"}

    if status.get("status") in TERMINAL_STATUSES:
        return {"stopped": False, "reason": "already_finished",
                "status": status.get("status")}

    pgid = status.get("pgid")
    pid = status.get("command_pid") or status.get("pid")
    wrapper_pid = status.get("pid")

    signalled = False
    for sig in (signal.SIGTERM, signal.SIGKILL):
        targets_hit = False
        if pgid:
            try:
                os.killpg(int(pgid), sig)
                targets_hit = True
            except (OSError, ValueError):
                pass
        if not targets_hit and pid:
            try:
                os.kill(int(pid), sig)
                targets_hit = True
            except (OSError, ValueError):
                pass
        signalled = signalled or targets_hit
        if not targets_hit:
            break
        # Give the group a moment to exit before escalating.
        time.sleep(2)
        if not _process_alive(pid):
            break

    # The wrapper holds the heartbeat; stop it too so the status file settles.
    if wrapper_pid and _process_alive(wrapper_pid):
        try:
            os.kill(int(wrapper_pid), signal.SIGTERM)
        except (OSError, ValueError):
            pass

    final_status = "timed_out" if reason.startswith("timeout") else "killed"
    _write_status(item_id, directive, {
        "status": final_status,
        "stopped_reason": reason,
        "stopped_at": datetime.now(timezone.utc).isoformat(),
    })

    emit_event(
        "directive.stopped",
        f"Directive {directive} on {item_id} stopped: {reason}",
        item_id=item_id,
        severity="warn",
    )

    return {"stopped": True, "signalled": signalled, "status": final_status,
            "reason": reason}


def _cost_ceiling_exceeded(item: dict, cfg) -> tuple[bool, float, float]:
    """Compare an item's recorded spend against the configured ceiling.

    Spend comes from `runtime.spend`, which the spend step refreshes each cycle.
    A ceiling of 0 disables the check.
    """
    ceiling = float(getattr(cfg, "directive_max_item_usd", 0) or 0)
    spend = (item.get("runtime") or {}).get("spend") or {}
    total = float(spend.get("total_usd", 0) or 0)
    if ceiling <= 0:
        return False, total, ceiling
    return total >= ceiling, total, ceiling


def _worker_notice(item_id: str, directive: str, summary: dict,
                   headline: str, guidance: str) -> str:
    """Compose the message the worker session receives about a directive run.

    The worker is an autonomous agent, so the message states plainly that it is
    informational and what the worker is allowed to do about it.
    """
    lines = [
        f"[{directive}] {headline}",
        "",
        f"Item: {item_id}",
        f"State: {summary['status']}"
        + (" (process alive)" if summary["alive"] else " (process not running)"),
        f"Running for: {summary['runtime_minutes']} min",
        f"Output so far: {summary['output_bytes']} bytes at {summary['output_path']}",
    ]
    if summary.get("stopped_reason"):
        lines.append(f"Stopped because: {summary['stopped_reason']}")
    lines += [
        "",
        guidance,
        "",
        "You can inspect this run yourself:",
        f"  tail -f {summary['output_path']}",
        f"  cat {status_path(item_id, directive)}",
        "To stop it:",
        f"  python3 {Path(__file__).resolve().parent.parent}/directive-control.py stop {item_id} {directive}",
        "",
        "Do not modify application code in response to this message.",
    ]
    return "\n".join(lines)


def _message_worker(cfg, item: dict, text: str) -> None:
    session = (item.get("environment") or {}).get("session_id")
    if not session:
        return
    try:
        subprocess.run(
            [cfg.tool_vmux, "send", session, text],
            capture_output=True, timeout=15,
        )
    except Exception as err:
        print(f"[directive] Failed to message worker for {item['id']}: {err}")


def supervise_directive_runs(cfg, dry_run: bool = False) -> None:
    """Enforce budgets on every live directive run, and publish their state.

    Runs on every scheduler tick, independent of the delegator cycle, so a
    runaway run is stopped on the poll interval rather than waiting for the
    much slower delegator interval.

    For each item with directive runs on disk:
      - Record a summary of every run to `runtime.directive_runs` so the
        dashboard can show what is happening without reading process tables.
      - Stop a run that exceeded its time budget, that stopped heartbeating
        while its process is gone, or whose item exceeded the cost ceiling.
      - Tell the worker session when a run starts being supervised, and again
        when a run is stopped, so the agent in the session can act on it.
    """
    from scripts.lib.queue import locked_queue

    with locked_queue() as ctx:
        items = list(ctx["data"]["items"])

    now = datetime.now(timezone.utc)
    updates: dict[str, dict] = {}

    default_timeout = int(getattr(cfg, "directive_timeout_minutes", 30) or 30)
    directives_by_status = getattr(cfg, "directives", {}) or {}

    for item in items:
        item_id = item["id"]
        runs = list_runs(item_id)
        if not runs:
            continue

        # Per-directive timeout from frontmatter, falling back to the config default.
        timeouts = {}
        for status_directives in directives_by_status.values():
            for d in status_directives:
                configured = d.get("timeout_minutes")
                timeouts[d["name"]] = int(configured) if configured else default_timeout

        summaries = []
        notices: list[str] = []

        over_cost, spend_total, ceiling = _cost_ceiling_exceeded(item, cfg)

        for status in runs:
            directive = status.get("directive", "")
            summary = describe_run(status, now)

            if summary["status"] in TERMINAL_STATUSES:
                summaries.append(summary)
                continue

            limit = status.get("timeout_minutes") or timeouts.get(directive, default_timeout)
            stop_reason = None

            if over_cost:
                stop_reason = (
                    f"cost ceiling: item spend ${spend_total:.2f} "
                    f"reached the ${ceiling:.2f} limit"
                )
            elif limit and summary["runtime_minutes"] >= limit:
                stop_reason = (
                    f"timeout: ran {summary['runtime_minutes']} min, "
                    f"limit is {limit} min"
                )
            elif not summary["alive"]:
                stop_reason = (
                    "process gone: the run left no exit code, so it died "
                    "without recording a result"
                )
            elif summary["seconds_since_heartbeat"] > 180:
                stop_reason = (
                    f"no heartbeat for {summary['seconds_since_heartbeat']}s "
                    "while the process is still alive"
                )

            if stop_reason and not dry_run:
                result = stop_run(item_id, directive, stop_reason)
                summary = describe_run(read_status(item_id, directive) or status, now)
                if result.get("stopped"):
                    notices.append(_worker_notice(
                        item_id, directive, summary,
                        "Run stopped by the orchestrator.",
                        "The orchestrator stopped this run. No artifact was produced. "
                        "The user decides whether it runs again.",
                    ))
            elif stop_reason:
                print(f"[directive] DRY RUN would stop {item_id}/{directive}: {stop_reason}")

            summaries.append(summary)

        if not summaries:
            continue

        # Announce a live run to the worker once, so the session knows what is
        # happening in its worktree and can stop it.
        prior = (item.get("runtime") or {}).get("directive_runs") or {}
        prior_announced = set(prior.get("announced") or [])
        announced = set(prior_announced)
        for summary in summaries:
            name = summary["directive"]
            if summary["alive"] and name not in prior_announced:
                announced.add(name)
                notices.append(_worker_notice(
                    item_id, name, summary,
                    "A supervised background run started against your branch.",
                    "This is informational. It captures and diffs screenshots; "
                    "it does not change code. Keep working, or stop it if it is "
                    "in your way.",
                ))

        updates[item_id] = {
            "runs": summaries,
            "announced": sorted(announced),
            "updated_at": now.isoformat(),
        }

        if notices and not dry_run:
            _message_worker(cfg, item, "\n\n".join(notices))

    if not updates or dry_run:
        return

    with locked_queue(write=True) as ctx:
        for item in ctx["data"]["items"]:
            payload = updates.get(item["id"])
            if payload is None:
                continue
            item.setdefault("runtime", {})["directive_runs"] = payload
            ctx["modified"] = True
