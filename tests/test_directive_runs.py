"""Tests for directive run supervision.

Covers the three things that went wrong in practice: a run whose working
directory was never set, a run that stayed "running" forever with nothing to
stop it, and a status file nobody could read a verdict from.

Run with:
    python3 -m unittest tests.test_directive_runs
"""

import json
import os
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "run-directive.sh"
CONTROL = REPO_ROOT / "scripts" / "directive-control.py"


class DirectiveRunsTestBase(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="orch-runs-")
        self.env = {**os.environ, "HOME": self.home}

    def tearDown(self):
        import shutil
        shutil.rmtree(self.home, ignore_errors=True)

    def _status_path(self, item_id: str, directive: str) -> Path:
        return (
            Path(self.home) / ".claude" / "orchestrator" / "delegators" / item_id
            / f"directive-{directive}.status.json"
        )

    def _read_status(self, item_id: str, directive: str) -> dict:
        with open(self._status_path(item_id, directive)) as f:
            return json.load(f)

    def _run_wrapper(self, *args) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            env=self.env, capture_output=True, text=True,
        )


class WorkingDirectoryTests(DirectiveRunsTestBase):
    """The bug that produced no artifact: relative paths resolved in the wrong place."""

    def test_cwd_flag_sets_the_command_working_directory(self):
        target = tempfile.mkdtemp(prefix="orch-cwd-")
        self.addCleanup(lambda: __import__("shutil").rmtree(target, ignore_errors=True))

        self._run_wrapper("--cwd", target, "ws-1", "d", "pwd")

        status = self._read_status("ws-1", "d")
        with open(status["output_path"]) as f:
            printed = f.read().strip()
        self.assertEqual(os.path.realpath(printed), os.path.realpath(target))

    def test_cwd_is_recorded_in_the_status_file(self):
        target = tempfile.mkdtemp(prefix="orch-cwd-")
        self.addCleanup(lambda: __import__("shutil").rmtree(target, ignore_errors=True))

        self._run_wrapper("--cwd", target, "ws-1", "d", "true")

        self.assertEqual(self._read_status("ws-1", "d")["cwd"], target)

    def test_relative_output_lands_in_the_cwd_not_the_delegator_dir(self):
        target = tempfile.mkdtemp(prefix="orch-cwd-")
        self.addCleanup(lambda: __import__("shutil").rmtree(target, ignore_errors=True))

        self._run_wrapper(
            "--cwd", target, "ws-1", "d",
            "bash", "-c", "mkdir -p sandbox && echo hi > sandbox/out.txt",
        )

        self.assertTrue((Path(target) / "sandbox" / "out.txt").exists())
        delegator_dir = self._status_path("ws-1", "d").parent
        self.assertFalse((delegator_dir / "sandbox").exists())

    def test_missing_cwd_directory_is_refused(self):
        result = self._run_wrapper(
            "--cwd", "/nonexistent/path/xyz", "ws-1", "d", "true",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not exist", result.stderr)

    def test_omitting_cwd_still_works(self):
        result = self._run_wrapper("ws-1", "d", "true")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self._read_status("ws-1", "d")["status"], "completed")


class StatusContractTests(DirectiveRunsTestBase):
    def test_timeout_minutes_is_recorded(self):
        self._run_wrapper("--timeout-minutes", "25", "ws-1", "d", "true")
        self.assertEqual(self._read_status("ws-1", "d")["timeout_minutes"], 25)

    def test_process_group_id_is_recorded(self):
        self._run_wrapper("ws-1", "d", "true")
        status = self._read_status("ws-1", "d")
        self.assertIsNotNone(status["pgid"])
        self.assertEqual(status["pgid"], status["command_pid"])

    def test_output_bytes_reflects_the_output_size(self):
        self._run_wrapper("ws-1", "d", "bash", "-c", "printf 'hello'")
        self.assertEqual(self._read_status("ws-1", "d")["output_bytes"], 5)

    def test_heartbeat_advances_while_the_command_runs(self):
        proc = subprocess.Popen(
            ["bash", str(SCRIPT), "ws-1", "d", "sleep", "40"],
            env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.addCleanup(proc.kill)
        try:
            deadline = time.time() + 30
            first = None
            while time.time() < deadline:
                try:
                    status = self._read_status("ws-1", "d")
                except (OSError, json.JSONDecodeError):
                    time.sleep(0.5)
                    continue
                if first is None:
                    first = status["last_heartbeat"]
                elif status["last_heartbeat"] != first:
                    return  # heartbeat advanced
                time.sleep(1)
            self.fail("heartbeat never advanced")
        finally:
            proc.kill()


class DescribeRunTests(unittest.TestCase):
    def _describe(self, status: dict, now=None):
        from scripts.scheduler.directive_runs import describe_run
        return describe_run(status, now)

    def test_a_running_status_with_a_dead_pid_is_not_alive(self):
        summary = self._describe({
            "directive": "d",
            "status": "running",
            "command_pid": 999999,
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        self.assertFalse(summary["alive"])

    def test_a_running_status_with_a_live_pid_is_alive(self):
        summary = self._describe({
            "directive": "d",
            "status": "running",
            "command_pid": os.getpid(),
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        self.assertTrue(summary["alive"])

    def test_a_completed_run_is_never_alive_even_with_a_live_pid(self):
        summary = self._describe({
            "directive": "d",
            "status": "completed",
            "command_pid": os.getpid(),
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        self.assertFalse(summary["alive"])

    def test_runtime_is_measured_from_started_at(self):
        now = datetime.now(timezone.utc)
        summary = self._describe(
            {"directive": "d", "status": "running",
             "started_at": (now - timedelta(minutes=12)).isoformat()},
            now,
        )
        self.assertEqual(summary["runtime_minutes"], 12.0)

    def test_seconds_since_heartbeat_uses_the_heartbeat_not_the_start(self):
        now = datetime.now(timezone.utc)
        summary = self._describe(
            {"directive": "d", "status": "running",
             "started_at": (now - timedelta(minutes=30)).isoformat(),
             "last_heartbeat": (now - timedelta(seconds=20)).isoformat()},
            now,
        )
        self.assertEqual(summary["seconds_since_heartbeat"], 20)

    def test_a_malformed_timestamp_does_not_raise(self):
        summary = self._describe({"directive": "d", "status": "running",
                                  "started_at": "not-a-date"})
        self.assertEqual(summary["runtime_seconds"], 0)


class StopRunTests(DirectiveRunsTestBase):
    def _patched_dir(self):
        return mock.patch(
            "scripts.scheduler.directive_runs.DELEGATORS_DIR",
            Path(self.home) / ".claude" / "orchestrator" / "delegators",
        )

    def test_stopping_a_live_run_kills_it_and_records_the_reason(self):
        from scripts.scheduler.directive_runs import stop_run

        proc = subprocess.Popen(
            ["bash", str(SCRIPT), "ws-1", "d", "sleep", "120"],
            env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.addCleanup(proc.kill)

        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                if self._read_status("ws-1", "d").get("command_pid"):
                    break
            except (OSError, json.JSONDecodeError):
                pass
            time.sleep(0.5)

        cmd_pid = self._read_status("ws-1", "d")["command_pid"]

        with self._patched_dir(), mock.patch(
            "scripts.scheduler.directive_runs.emit_event"
        ):
            result = stop_run("ws-1", "d", "timeout: ran too long")

        self.assertTrue(result["stopped"])
        self.assertEqual(result["status"], "timed_out")
        self.assertEqual(self._read_status("ws-1", "d")["status"], "timed_out")
        self.assertIn("timeout", self._read_status("ws-1", "d")["stopped_reason"])

        time.sleep(1)
        with self.assertRaises(OSError):
            os.kill(cmd_pid, 0)

    def test_a_manual_stop_is_recorded_as_killed_not_timed_out(self):
        from scripts.scheduler.directive_runs import stop_run

        path = self._status_path("ws-1", "d")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "directive": "d", "status": "running",
            "pid": 999999, "command_pid": 999999, "pgid": 999999,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }))

        with self._patched_dir(), mock.patch(
            "scripts.scheduler.directive_runs.emit_event"
        ):
            result = stop_run("ws-1", "d", "stopped from the dashboard")

        self.assertEqual(result["status"], "killed")

    def test_stopping_a_finished_run_changes_nothing(self):
        from scripts.scheduler.directive_runs import stop_run

        path = self._status_path("ws-1", "d")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "directive": "d", "status": "completed", "exit_code": 0,
        }))

        with self._patched_dir(), mock.patch(
            "scripts.scheduler.directive_runs.emit_event"
        ):
            result = stop_run("ws-1", "d", "timeout")

        self.assertFalse(result["stopped"])
        self.assertEqual(result["reason"], "already_finished")
        self.assertEqual(self._read_status("ws-1", "d")["status"], "completed")

    def test_stopping_a_run_with_no_status_file_reports_that(self):
        from scripts.scheduler.directive_runs import stop_run
        with self._patched_dir():
            result = stop_run("ws-nope", "d", "timeout")
        self.assertFalse(result["stopped"])
        self.assertEqual(result["reason"], "no_status_file")


class SuperviseTests(DirectiveRunsTestBase):
    class FakeConfig:
        directive_timeout_minutes = 25
        directive_max_item_usd = 12.0
        directives: dict = {}
        tool_vmux = "true"

    def _spawn_child(self) -> int:
        """A real, disposable process to stand in for a live directive run.

        Never use the test process's own pid here: a stop signals the whole
        process group, which would take the test runner down with it.
        """
        proc = subprocess.Popen(
            ["sleep", "120"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        def reap():
            proc.kill()
            proc.wait(timeout=5)

        self.addCleanup(reap)
        return proc.pid

    def _write_run(self, item_id, directive, **fields):
        path = self._status_path(item_id, directive)
        path.parent.mkdir(parents=True, exist_ok=True)
        base = {
            "directive": directive,
            "status": "running",
            "pid": 999999,
            "command_pid": 999999,
            "pgid": 999999,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "last_heartbeat": datetime.now(timezone.utc).isoformat(),
            "output_bytes": 0,
            "output_path": str(path.with_suffix("").with_suffix(".output.log")),
        }
        base.update(fields)
        path.write_text(json.dumps(base))

    def _supervise(self, item):
        from scripts.scheduler import directive_runs

        queue = {"items": [item]}

        class Ctx(dict):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_locked_queue(queue_path=None, write=False):
            return Ctx({"data": queue, "modified": False})

        with mock.patch.object(
            directive_runs, "DELEGATORS_DIR",
            Path(self.home) / ".claude" / "orchestrator" / "delegators",
        ), mock.patch.dict(
            "sys.modules",
        ), mock.patch(
            "scripts.lib.queue.locked_queue", fake_locked_queue
        ), mock.patch.object(
            directive_runs, "emit_event"
        ), mock.patch.object(
            directive_runs, "_message_worker"
        ) as msg:
            directive_runs.supervise_directive_runs(self.FakeConfig())
        return queue["items"][0], msg

    def _item(self, **runtime):
        return {
            "id": "ws-1",
            "status": "review",
            "environment": {"session_id": "abc"},
            "worker": {},
            "runtime": runtime,
        }

    def test_a_run_past_its_timeout_is_stopped(self):
        started = datetime.now(timezone.utc) - timedelta(minutes=40)
        self._write_run("ws-1", "d", started_at=started.isoformat(),
                        last_heartbeat=datetime.now(timezone.utc).isoformat())
        item, _ = self._supervise(self._item())
        run = item["runtime"]["directive_runs"]["runs"][0]
        self.assertEqual(run["status"], "timed_out")
        self.assertIn("timeout", run["stopped_reason"])

    def test_a_run_within_its_timeout_is_left_alone(self):
        started = datetime.now(timezone.utc) - timedelta(minutes=5)
        child = self._spawn_child()
        self._write_run("ws-1", "d", started_at=started.isoformat(),
                        command_pid=child, pid=child, pgid=child)
        item, _ = self._supervise(self._item())
        run = item["runtime"]["directive_runs"]["runs"][0]
        self.assertEqual(run["status"], "running")
        self.assertTrue(run["alive"])

    def test_a_run_is_stopped_when_the_item_passes_the_cost_ceiling(self):
        started = datetime.now(timezone.utc) - timedelta(minutes=2)
        child = self._spawn_child()
        self._write_run("ws-1", "d", started_at=started.isoformat(),
                        command_pid=child, pid=child, pgid=child)
        item, _ = self._supervise(self._item(spend={"total_usd": 15.0}))
        run = item["runtime"]["directive_runs"]["runs"][0]
        self.assertEqual(run["status"], "killed")
        self.assertIn("cost ceiling", run["stopped_reason"])

    def test_spend_below_the_ceiling_does_not_stop_a_run(self):
        started = datetime.now(timezone.utc) - timedelta(minutes=2)
        child = self._spawn_child()
        self._write_run("ws-1", "d", started_at=started.isoformat(),
                        command_pid=child, pid=child, pgid=child)
        item, _ = self._supervise(self._item(spend={"total_usd": 3.0}))
        self.assertEqual(item["runtime"]["directive_runs"]["runs"][0]["status"], "running")

    def test_a_run_whose_process_vanished_is_recorded_as_stopped(self):
        self._write_run("ws-1", "d", command_pid=999999, pid=999999, pgid=999999)
        item, _ = self._supervise(self._item())
        run = item["runtime"]["directive_runs"]["runs"][0]
        self.assertIn(run["status"], ("killed", "timed_out"))
        self.assertIn("process gone", run["stopped_reason"])

    def test_the_worker_is_told_about_a_live_run_once(self):
        started = datetime.now(timezone.utc) - timedelta(minutes=2)
        child = self._spawn_child()
        self._write_run("ws-1", "d", started_at=started.isoformat(),
                        command_pid=child, pid=child, pgid=child)

        item, msg = self._supervise(self._item())
        self.assertEqual(msg.call_count, 1)
        self.assertIn("d", item["runtime"]["directive_runs"]["announced"])

        # A second pass with the run already announced must stay quiet.
        item2, msg2 = self._supervise(self._item(
            directive_runs={"runs": [], "announced": ["d"], "updated_at": ""},
        ))
        self.assertEqual(msg2.call_count, 0)

    def test_an_item_with_no_runs_is_not_touched(self):
        item, _ = self._supervise(self._item())
        self.assertNotIn("directive_runs", item["runtime"])


class ControlCliTests(DirectiveRunsTestBase):
    def _control(self, *args) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["python3", str(CONTROL), *args],
            env=self.env, capture_output=True, text=True,
        )

    def test_list_json_reports_recorded_runs(self):
        self._run_wrapper("ws-1", "d", "true")
        result = self._control("list", "ws-1", "--json")
        self.assertEqual(result.returncode, 0)
        runs = json.loads(result.stdout)["runs"]
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["directive"], "d")
        self.assertEqual(runs[0]["status"], "completed")

    def test_list_on_an_unknown_item_is_not_an_error(self):
        result = self._control("list", "ws-nope")
        self.assertEqual(result.returncode, 0)

    def test_status_reports_one_run(self):
        self._run_wrapper("ws-1", "d", "true")
        result = self._control("status", "ws-1", "d")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["directive"], "d")

    def test_tail_returns_the_output(self):
        self._run_wrapper("ws-1", "d", "bash", "-c", "echo marker-line")
        result = self._control("tail", "ws-1", "d")
        self.assertIn("marker-line", result.stdout)

    def test_stop_on_a_finished_run_succeeds_without_changing_it(self):
        self._run_wrapper("ws-1", "d", "true")
        result = self._control("stop", "ws-1", "d", "manual")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self._read_status("ws-1", "d")["status"], "completed")


if __name__ == "__main__":
    unittest.main()
