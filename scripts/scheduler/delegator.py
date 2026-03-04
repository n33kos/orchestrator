"""Delegator lifecycle and service watchdog functions for the scheduler.

Ports: check_services, recover_sessions, recover_delegators,
       trigger_delegator_cycles from scheduler.sh.
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from scripts.lib.queue import locked_queue
from scripts.scheduler.config import Config
from scripts.scheduler.events import emit_event

PROJECT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
SCRIPTS_DIR = os.path.join(PROJECT_ROOT, "scripts")
EXEC_ENV = {**os.environ, "HOME": os.path.expanduser("~")}


def check_services(cfg: Config) -> None:
    """Ensure critical services (vmux daemon) are running."""
    try:
        result = subprocess.run(
            [cfg.tool_vmux, "status"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return
    except Exception:
        pass

    print("[watchdog] vmux daemon is down — restarting...")
    emit_event("watchdog.service_restart", "Restarting vmux daemon", severity="warn")
    subprocess.run(["launchctl", "start", "com.vmux.daemon"], capture_output=True)
    time.sleep(3)

    try:
        result = subprocess.run(
            [cfg.tool_vmux, "status"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            print("[watchdog] vmux daemon restarted successfully")
            emit_event("watchdog.service_recovered", "vmux daemon recovered")
        else:
            print("[watchdog] ERROR: vmux daemon failed to restart", file=sys.stderr)
            emit_event("watchdog.service_failed", "vmux daemon failed to restart", severity="error")
    except Exception:
        print("[watchdog] ERROR: vmux daemon failed to restart", file=sys.stderr)
        emit_event("watchdog.service_failed", "vmux daemon failed to restart", severity="error")


def recover_sessions(cfg: Config) -> None:
    """Auto-recover zombie sessions via health-check.sh."""
    pause_file = os.path.expanduser("~/.claude/orchestrator/paused")
    if os.path.isfile(pause_file):
        print("[health] Paused — skipping session recovery")
        return

    print("[health] Checking for zombie sessions...")
    try:
        result = subprocess.run(
            ["bash", os.path.join(SCRIPTS_DIR, "health-check.sh"), "--auto-recover"],
            capture_output=True, text=True, timeout=30, env=EXEC_ENV,
        )
        if result.stdout:
            for line in result.stdout.strip().split("\n"):
                print(f"  {line}")
    except subprocess.TimeoutExpired:
        print("  ERROR: Health check timed out", file=sys.stderr)


def _read_respawn_state(state_file: Path) -> dict:
    """Read respawn tracking from delegator state.json."""
    try:
        with open(state_file) as f:
            state = json.load(f)
        return state.get("respawn", {"count": 0, "last_at": None})
    except Exception:
        return {"count": 0, "last_at": None}


def _update_respawn_state(state_file: Path, count: int, now: datetime) -> None:
    """Write respawn tracking into delegator state.json."""
    try:
        with open(state_file) as f:
            state = json.load(f)
    except Exception:
        state = {}
    state["respawn"] = {
        "count": count,
        "last_at": now.isoformat(),
    }
    try:
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
            f.write("\n")
    except Exception as e:
        print(f"[watchdog] WARNING: Failed to update respawn state: {e}", file=sys.stderr)


def _has_completed_cycle(status_file: Path) -> bool:
    """Check if a delegator has ever completed a monitoring cycle."""
    try:
        with open(status_file) as f:
            status = json.load(f)
        return bool(
            status.get("last_cycle_at")
            or status.get("cycle_count", 0) > 0
            or status.get("last_check_at")
            or status.get("last_check")
        )
    except Exception:
        return False


# Backoff schedule: respawn count -> minimum seconds before next respawn
_RESPAWN_BACKOFF = {
    0: 300,    # 5 min before 1st respawn
    1: 900,    # 15 min before 2nd
}
_MAX_RESPAWNS_WITHOUT_CYCLE = 3  # Give up after 3 if never completed a cycle


def recover_delegators(cfg: Config, dry_run: bool) -> None:
    """Check each active item's delegator — respawn if dead or stalled."""
    pause_file = os.path.expanduser("~/.claude/orchestrator/paused")
    if os.path.isfile(pause_file):
        print("[watchdog] Paused — skipping delegator recovery")
        return

    delegators_dir = Path.home() / ".claude" / "orchestrator" / "delegators"
    stall_minutes = cfg.stall_threshold_min

    with locked_queue() as ctx:
        data = ctx["data"]

    # Bug 1 fix: filter on delegator_enabled, not delegator_id
    active_items = [
        i for i in data["items"]
        if i["status"] == "active"
        and str(i.get("delegator_enabled", "")).lower() in ("true",)
    ]

    if not active_items:
        return

    # Get live sessions (only needed if any item still has a delegator_id)
    live_sessions = ""
    if any(i.get("delegator_id") for i in active_items):
        try:
            result = subprocess.run(
                [cfg.tool_vmux, "sessions"],
                capture_output=True, text=True, timeout=10,
            )
            live_sessions = result.stdout if result.returncode == 0 else ""
        except Exception:
            live_sessions = ""

    now = datetime.now(timezone.utc)

    for item in active_items:
        item_id = item["id"]
        delegator_id = item.get("delegator_id") or ""
        state_file = delegators_dir / item_id / "state.json"
        status_file = delegators_dir / item_id / "status.json"

        # Skip items that don't have delegator state initialized yet
        # (reconcile_state handles initial creation)
        if not state_file.exists():
            continue

        needs_respawn = False
        reason = ""

        # Check stale delegator_id against live sessions
        if delegator_id and delegator_id not in live_sessions:
            needs_respawn = True
            reason = f"session {delegator_id} not found in live sessions (stale delegator_id)"
        elif status_file.exists():
            try:
                with open(status_file) as f:
                    status = json.load(f)
                last_check = (
                    status.get("last_check_at")
                    or status.get("last_check")
                    or status.get("started_at", "")
                )
                if last_check:
                    ts = datetime.fromisoformat(last_check.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    minutes_since = (now - ts).total_seconds() / 60
                    if minutes_since > stall_minutes * 3:
                        needs_respawn = True
                        reason = f"stalled for {int(minutes_since)}m (last check: {last_check})"
                else:
                    started = status.get("started_at", "")
                    if started:
                        ts = datetime.fromisoformat(started.replace("Z", "+00:00"))
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        minutes_since = (now - ts).total_seconds() / 60
                        if minutes_since > stall_minutes:
                            needs_respawn = True
                            reason = f"never completed a check cycle (started {int(minutes_since)}m ago)"
            except (json.JSONDecodeError, KeyError):
                needs_respawn = True
                reason = "corrupt status.json"

        if not needs_respawn:
            continue

        # Bug 2 fix: check respawn backoff and limits
        respawn = _read_respawn_state(state_file)
        respawn_count = respawn["count"]

        # If never completed a cycle, enforce max respawn limit
        if respawn_count >= _MAX_RESPAWNS_WITHOUT_CYCLE and not _has_completed_cycle(status_file):
            print(
                f"[watchdog] Giving up on delegator for {item_id}: "
                f"{respawn_count} respawns, never completed a cycle"
            )
            emit_event(
                "watchdog.delegator_respawn_limit",
                f"Delegator for {item_id} hit respawn limit ({respawn_count}) without completing a cycle",
                item_id=item_id, severity="error",
            )
            continue

        # Check backoff window
        last_respawn_at = respawn.get("last_at")
        if last_respawn_at:
            try:
                last_ts = datetime.fromisoformat(last_respawn_at.replace("Z", "+00:00"))
                if last_ts.tzinfo is None:
                    last_ts = last_ts.replace(tzinfo=timezone.utc)
                backoff_secs = _RESPAWN_BACKOFF.get(respawn_count, 900)
                elapsed = (now - last_ts).total_seconds()
                if elapsed < backoff_secs:
                    remaining = int(backoff_secs - elapsed)
                    print(
                        f"[watchdog] Skipping delegator respawn for {item_id}: "
                        f"in backoff ({remaining}s remaining, attempt {respawn_count})"
                    )
                    continue
            except (ValueError, TypeError):
                pass

        if dry_run:
            print(f"[watchdog] Would respawn delegator for {item_id}: {reason}")
        else:
            print(f"[watchdog] Respawning delegator for {item_id} (attempt {respawn_count + 1}): {reason}")
            emit_event(
                "watchdog.delegator_respawn",
                f"Respawning delegator for {item_id} (attempt {respawn_count + 1}): {reason}",
                item_id=item_id, severity="warn",
            )
            # Kill existing session if there's a stale delegator_id
            if delegator_id:
                try:
                    subprocess.run(
                        [cfg.tool_vmux, "kill", delegator_id],
                        capture_output=True, timeout=10,
                    )
                    time.sleep(1)
                except Exception:
                    pass
            # Respawn
            try:
                result = subprocess.run(
                    ["bash", os.path.join(SCRIPTS_DIR, "spawn-delegator.sh"), item_id],
                    capture_output=True, text=True, timeout=60, env=EXEC_ENV,
                )
                if result.stdout:
                    for line in result.stdout.strip().split("\n"):
                        print(f"    {line}")
                if result.returncode != 0:
                    print(f"[watchdog] ERROR: Failed to respawn delegator for {item_id}", file=sys.stderr)
                    emit_event(
                        "watchdog.delegator_respawn_failed",
                        f"Failed to respawn delegator for {item_id}",
                        item_id=item_id, severity="error",
                    )
                else:
                    # Bug 1 fix: clear stale delegator_id after successful respawn
                    try:
                        subprocess.run(
                            ["python3", "-m", "lib.queue", "update", item_id, "delegator_id=NULL"],
                            cwd=SCRIPTS_DIR, capture_output=True, timeout=10,
                        )
                    except Exception:
                        pass
                    # Bug 2 fix: only count successful respawns toward the limit
                    _update_respawn_state(state_file, respawn_count + 1, now)
            except subprocess.TimeoutExpired:
                _update_respawn_state(state_file, respawn_count + 1, now)


def trigger_delegator_cycles(cfg: Config, dry_run: bool) -> None:
    """Run delegator one-shot cycles for active items with delegator enabled."""
    pause_file = os.path.expanduser("~/.claude/orchestrator/paused")
    if os.path.isfile(pause_file):
        print("[scheduler] Paused — skipping delegator cycles")
        return

    with locked_queue() as ctx:
        data = ctx["data"]

    active_items = [
        i for i in data["items"]
        if i["status"] == "active"
        and str(i.get("delegator_enabled", "")).lower() in ("true",)
        and i.get("session_id")
    ]

    processes = []

    for item in active_items:
        item_id = item["id"]
        delegator_dir = Path.home() / ".claude" / "orchestrator" / "delegators" / item_id
        state_file = delegator_dir / "state.json"

        if not state_file.exists():
            print(f"[scheduler] Delegator for {item_id} has no state file — skipping")
            continue

        running_pid = delegator_dir / "running.pid"
        if running_pid.exists():
            # Check if the PID is still alive — clean up stale lock files
            try:
                pid_str = running_pid.read_text().split(":")[0].strip()
                pid = int(pid_str)
                os.kill(pid, 0)  # signal 0 = check if process exists
                print(f"[scheduler] Delegator cycle already running for {item_id} (PID {pid}) — skipping")
                continue
            except PermissionError:
                print(f"[scheduler] Delegator PID {pid} exists (different owner) for {item_id} — skipping")
                continue
            except (ValueError, ProcessLookupError, OSError):
                print(f"[scheduler] Removing stale running.pid for {item_id}")
                running_pid.unlink(missing_ok=True)

        print(f"[scheduler] Running delegator cycle for {item_id}...")

        if dry_run:
            print(f"[scheduler] Would run delegator cycle for {item_id}")
            continue

        # Run the full pipeline: preprocess → triage → (optional escalate) → postprocess
        # Run in background subprocess to allow parallel execution
        try:
            proc = subprocess.Popen(
                [
                    "bash", "-c",
                    f"""
                    set -e
                    SCRIPT_DIR="{SCRIPTS_DIR}"
                    PROJECT_ROOT="{PROJECT_ROOT}"
                    ITEM_ID="{item_id}"

                    # Preprocess
                    "$SCRIPT_DIR/delegator-preprocess.sh" "$ITEM_ID" 2>&1 | sed 's/^/  [preprocess] /' || exit 1

                    CYCLE_JSON="/tmp/delegator-cycle-$ITEM_ID.json"
                    [ -f "$CYCLE_JSON" ] || exit 1

                    # Triage via Haiku
                    TRIAGE_OUTPUT="/tmp/delegator-triage-$ITEM_ID.json"
                    TRIAGE_INSTRUCTIONS="$PROJECT_ROOT/delegator/triage-instructions.md"

                    echo "  [triage] Invoking Haiku for $ITEM_ID..."
                    claude --print --model haiku \
                        --system-prompt "$(cat "$TRIAGE_INSTRUCTIONS")" \
                        < "$CYCLE_JSON" > "$TRIAGE_OUTPUT" 2>/dev/null || exit 1

                    # Check decision
                    DECISION=$(python3 -c "
import json, sys
try:
    text = open('$TRIAGE_OUTPUT').read().strip()
    if text.startswith('\`\`\`'):
        text = text.split('\\n', 1)[1] if '\\n' in text else text
        if text.endswith('\`\`\`'):
            text = text[:-3].strip()
    data = json.loads(text)
    print(data.get('decision', 'no_action'))
except Exception:
    print('no_action')
" 2>/dev/null)

                    if [ "$DECISION" = "escalate" ]; then
                        echo "  [escalate] Escalating to Opus for $ITEM_ID..."
                        REVIEW_INSTRUCTIONS="$PROJECT_ROOT/delegator/review-instructions.md"
                        ESCALATION_OUTPUT="/tmp/delegator-escalation-$ITEM_ID.json"
                        claude --print --model opus \
                            --system-prompt "$(cat "$REVIEW_INSTRUCTIONS")" \
                            < "$CYCLE_JSON" > "$ESCALATION_OUTPUT" 2>/dev/null && \
                            cp "$ESCALATION_OUTPUT" "$TRIAGE_OUTPUT" || true
                    fi

                    # Save copies for dashboard debugging (before postprocess, which deletes the files)
                    DELEGATOR_DIR="$HOME/.claude/orchestrator/delegators/$ITEM_ID"
                    mkdir -p "$DELEGATOR_DIR"
                    [ -f "$CYCLE_JSON" ] && cp "$CYCLE_JSON" "$DELEGATOR_DIR/last-cycle-payload.json"
                    [ -f "$TRIAGE_OUTPUT" ] && cp "$TRIAGE_OUTPUT" "$DELEGATOR_DIR/last-triage-output.json"

                    # Postprocess (note: this deletes TRIAGE_OUTPUT)
                    "$SCRIPT_DIR/delegator-postprocess.sh" "$ITEM_ID" "$TRIAGE_OUTPUT" 2>&1 | sed 's/^/  [postprocess] /' || true

                    # Cleanup remaining temp files
                    rm -f "$CYCLE_JSON" "/tmp/delegator-escalation-$ITEM_ID.json"
                    """,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=EXEC_ENV,
            )
            processes.append((item_id, proc))
        except Exception as e:
            print(f"[scheduler] ERROR: Failed to start delegator cycle for {item_id}: {e}", file=sys.stderr)

    # Wait for all background delegator cycles
    for item_id, proc in processes:
        try:
            stdout, _ = proc.communicate(timeout=300)
            if stdout:
                for line in stdout.decode("utf-8", errors="replace").strip().split("\n"):
                    print(line)
        except subprocess.TimeoutExpired:
            proc.kill()
            print(f"[scheduler] ERROR: Delegator cycle timed out for {item_id}", file=sys.stderr)
