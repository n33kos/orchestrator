"""Orchestrator scheduler — checks for available concurrency slots and auto-activates
the highest priority queued item.

Usage:
    python3 -m scripts.scheduler [--once] [--dry-run] [--cleanup]

Without --once, runs continuously (poll interval from config).
With --dry-run, shows what would be activated without doing it.
"""

import argparse
import os
import shutil
import signal
import sys
import time
from pathlib import Path

from scripts.scheduler.config import load_config
from scripts.scheduler.events import emit_event
from scripts.scheduler.reconcile import (
    check_and_activate,
    check_planning_timeouts,
    generate_plans,
    process_worker_completions,
    reconcile_state,
)
from scripts.scheduler.activate import teardown_merged
from scripts.scheduler.cleanup import cleanup_completed, rotate_event_log
from scripts.scheduler.spend import update_spend
from scripts.scheduler.delegator import (
    check_services,
    recover_delegators,
    recover_sessions,
    trigger_delegator_cycles,
)

PID_FILE = os.path.expanduser("~/.claude/orchestrator/scheduler.pid")
LOG_FILE = os.path.expanduser("~/.claude/orchestrator/logs/scheduler.log")
LOG_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
LOG_BACKUP_COUNT = 3


def rotate_scheduler_log():
    """Rotate the scheduler log file if it exceeds LOG_MAX_BYTES.

    Keeps up to LOG_BACKUP_COUNT rotated copies:
      scheduler.log.1, scheduler.log.2, scheduler.log.3
    """
    log_path = Path(LOG_FILE)
    if not log_path.exists():
        return
    try:
        size = log_path.stat().st_size
    except OSError:
        return
    if size < LOG_MAX_BYTES:
        return

    # Shift existing backups: .3 is deleted, .2 -> .3, .1 -> .2
    for i in range(LOG_BACKUP_COUNT, 0, -1):
        src = Path(f"{LOG_FILE}.{i}")
        if i == LOG_BACKUP_COUNT:
            src.unlink(missing_ok=True)
        elif src.exists():
            dst = Path(f"{LOG_FILE}.{i + 1}")
            shutil.move(str(src), str(dst))

    # Move current log to .1
    shutil.move(str(log_path), f"{LOG_FILE}.1")

    # Create a fresh empty log file
    log_path.touch()
    print(f"[scheduler] Rotated log file ({size / 1024 / 1024:.1f} MB exceeded limit)")


# Global flags for signal handling
_config_changed = False
_shutdown = False


def _sigusr1_handler(signum, frame):
    global _config_changed
    _config_changed = True


def _shutdown_handler(signum, frame):
    global _shutdown
    _shutdown = True


def write_pid():
    Path(PID_FILE).parent.mkdir(parents=True, exist_ok=True)
    Path(PID_FILE).write_text(str(os.getpid()))


def remove_pid():
    try:
        os.unlink(PID_FILE)
    except OSError:
        pass


def main():
    global _config_changed, _shutdown

    parser = argparse.ArgumentParser(description="Orchestrator scheduler")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit")
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen")
    parser.add_argument("--cleanup", action="store_true", help="Run cleanup only")
    args = parser.parse_args()

    # Derive project root from this file's location
    project_root = str(Path(__file__).resolve().parent.parent.parent)

    write_pid()
    signal.signal(signal.SIGUSR1, _sigusr1_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)
    signal.signal(signal.SIGINT, _shutdown_handler)

    try:
        # Rotate log at startup
        rotate_scheduler_log()

        cfg = load_config(project_root)

        if args.cleanup:
            cleanup_completed(cfg)
            rotate_event_log(cfg)
            if args.once:
                return
            # Fall through to main loop if not --once

        if args.once:
            check_services(cfg)
            recover_sessions(cfg)
            recover_delegators(cfg, args.dry_run)
            trigger_delegator_cycles(cfg, args.dry_run)
            process_worker_completions(cfg, args.dry_run)
            teardown_merged(cfg, args.dry_run)
            check_planning_timeouts(cfg)
            generate_plans(cfg, args.dry_run)
            reconcile_state(cfg, args.dry_run)
            check_and_activate(cfg, args.dry_run)
            update_spend(cfg)
            return

        # Continuous mode
        delegator_trigger_every = max(
            1, (cfg.delegator_cycle_interval + cfg.poll_interval - 1) // cfg.poll_interval
        )
        print(f"[scheduler] Starting continuous scheduler (Ctrl+C to stop)")
        print(
            f"[scheduler] Poll interval: {cfg.poll_interval}s | "
            f"Delegator cycle: {cfg.delegator_cycle_interval}s "
            f"(every {delegator_trigger_every} cycles) | "
            f"Max active: {cfg.max_active_projects} | "
            f"Auto-activate: {cfg.auto_activate}"
        )
        print()

        cycle = 0
        while not _shutdown:
            # Reload config each cycle
            cfg = load_config(project_root)
            delegator_trigger_every = max(
                1,
                (cfg.delegator_cycle_interval + cfg.poll_interval - 1)
                // cfg.poll_interval,
            )

            check_services(cfg)
            recover_sessions(cfg)
            recover_delegators(cfg, args.dry_run)

            is_delegator_cycle = cycle % delegator_trigger_every == 0
            if is_delegator_cycle:
                print(f"[scheduler] Cycle {cycle}: reconciliation + delegator monitoring")
                trigger_delegator_cycles(cfg, args.dry_run)
            else:
                cycles_until_delegator = delegator_trigger_every - (cycle % delegator_trigger_every)
                print(f"[scheduler] Cycle {cycle}: reconciliation (next delegator in {cycles_until_delegator} cycles)")

            process_worker_completions(cfg, args.dry_run)
            teardown_merged(cfg, args.dry_run)
            check_planning_timeouts(cfg)
            generate_plans(cfg, args.dry_run)
            reconcile_state(cfg, args.dry_run)
            check_and_activate(cfg, args.dry_run)
            update_spend(cfg)

            cycle += 1
            if cycle % cfg.cleanup_every == 0:
                cleanup_completed(cfg)
                rotate_event_log(cfg)
                rotate_scheduler_log()

            print(f"[scheduler] Next check in {cfg.poll_interval}s...")

            # Sleep in 1s increments so SIGUSR1 can interrupt quickly
            for _ in range(cfg.poll_interval):
                if _config_changed or _shutdown:
                    break
                time.sleep(1)

            if _config_changed:
                _config_changed = False
                print("[scheduler] Config change signal received — running immediate cycle")

    finally:
        remove_pid()


if __name__ == "__main__":
    main()
