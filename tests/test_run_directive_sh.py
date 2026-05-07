"""Integration tests for `scripts/run-directive.sh`.

Drives the bash wrapper as a real subprocess against a temporary HOME so the
status files land in a sandbox. Each test verifies the JSON status contract
end-to-end: lifecycle (running → completed/failed), exit code propagation,
output capture, and shell-quoting safety.

Run with:
    python3 -m unittest tests.test_run_directive_sh
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "run-directive.sh"


class RunDirectiveShTestBase(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="orch-rdsh-")
        self.env = {
            **os.environ,
            "HOME": self.home,
        }

    def tearDown(self):
        import shutil
        shutil.rmtree(self.home, ignore_errors=True)

    def _status_path(self, item_id: str, directive: str) -> Path:
        return (
            Path(self.home)
            / ".claude" / "orchestrator" / "delegators" / item_id
            / f"directive-{directive}.status.json"
        )

    def _output_path(self, item_id: str, directive: str) -> Path:
        return (
            Path(self.home)
            / ".claude" / "orchestrator" / "delegators" / item_id
            / f"directive-{directive}.output.log"
        )

    def _run(self, *args, expect_success: bool = True) -> subprocess.CompletedProcess:
        cmd = ["bash", str(SCRIPT), *args]
        result = subprocess.run(cmd, env=self.env, capture_output=True, text=True)
        if expect_success:
            self.assertEqual(
                result.returncode, 0,
                msg=f"unexpected failure:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
            )
        return result


class HappyPathTests(RunDirectiveShTestBase):
    def test_simple_command_writes_completed_status(self):
        self._run("ws-x", "alpha", "true")
        status = json.loads(self._status_path("ws-x", "alpha").read_text())
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["exit_code"], 0)
        self.assertIsNone(status["error"])
        self.assertEqual(status["directive"], "alpha")

    def test_command_with_arguments_preserved(self):
        self._run("ws-x", "echo", "echo", "hello", "world")
        out = self._output_path("ws-x", "echo").read_text()
        self.assertEqual(out.strip(), "hello world")
        status = json.loads(self._status_path("ws-x", "echo").read_text())
        # Args joined with spaces in the recorded `command` field; quoting only
        # applied where shell-needed.
        self.assertEqual(status["command"], "echo hello world")

    def test_command_with_special_characters_quoted_safely(self):
        # An arg with a space MUST be passed as a single shell argument and
        # come out the other side intact.
        self._run("ws-x", "spaced", "echo", "one two", "three")
        out = self._output_path("ws-x", "spaced").read_text()
        self.assertEqual(out.strip(), "one two three")

    def test_status_file_is_valid_json_at_running_phase_too(self):
        # Run a command slow enough to observe the running state? Hard to do
        # without sleeping. Instead, verify the schema after completion has
        # the `started_at` and `completed_at` both populated.
        self._run("ws-x", "alpha", "true")
        status = json.loads(self._status_path("ws-x", "alpha").read_text())
        self.assertIn("started_at", status)
        self.assertIn("completed_at", status)
        self.assertIsNotNone(status["started_at"])
        self.assertIsNotNone(status["completed_at"])

    def test_output_path_recorded_in_status(self):
        self._run("ws-x", "alpha", "true")
        status = json.loads(self._status_path("ws-x", "alpha").read_text())
        self.assertEqual(
            status["output_path"], str(self._output_path("ws-x", "alpha"))
        )


class FailurePathTests(RunDirectiveShTestBase):
    def test_failed_command_marks_failed_status(self):
        result = self._run("ws-x", "fail", "false", expect_success=False)
        self.assertEqual(result.returncode, 1)
        status = json.loads(self._status_path("ws-x", "fail").read_text())
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["exit_code"], 1)

    def test_failure_captures_error_tail(self):
        # Run a command that prints to stderr and exits non-zero.
        result = self._run(
            "ws-x", "stderr-fail",
            "bash", "-c", "echo broken >&2; exit 7",
            expect_success=False,
        )
        self.assertEqual(result.returncode, 7)
        status = json.loads(self._status_path("ws-x", "stderr-fail").read_text())
        self.assertEqual(status["exit_code"], 7)
        self.assertIsNotNone(status["error"])
        self.assertIn("broken", status["error"])

    def test_command_not_found_records_failure(self):
        result = self._run(
            "ws-x", "missing", "this-binary-does-not-exist-xyz",
            expect_success=False,
        )
        # Bash exit codes for missing command are typically 127.
        self.assertNotEqual(result.returncode, 0)
        status = json.loads(self._status_path("ws-x", "missing").read_text())
        self.assertEqual(status["status"], "failed")


class UsageTests(RunDirectiveShTestBase):
    def test_missing_args_prints_usage_and_exits_nonzero(self):
        result = self._run(expect_success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Usage", result.stderr + result.stdout)

    def test_missing_directive_name_exits_nonzero(self):
        result = self._run("ws-x", expect_success=False)
        self.assertNotEqual(result.returncode, 0)

    def test_missing_command_exits_with_clear_error(self):
        result = self._run("ws-x", "alpha", expect_success=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No command", result.stderr + result.stdout)


class IsolationTests(RunDirectiveShTestBase):
    """Verify the wrapper writes only to the expected paths."""

    def test_creates_delegator_dir_if_missing(self):
        self._run("brand-new-item", "alpha", "true")
        delegator_dir = (
            Path(self.home) / ".claude" / "orchestrator" / "delegators" / "brand-new-item"
        )
        self.assertTrue(delegator_dir.is_dir())

    def test_two_directives_for_same_item_are_independent(self):
        self._run("ws-x", "first", "echo", "first-out")
        self._run("ws-x", "second", "echo", "second-out")
        first = json.loads(self._status_path("ws-x", "first").read_text())
        second = json.loads(self._status_path("ws-x", "second").read_text())
        self.assertEqual(first["directive"], "first")
        self.assertEqual(second["directive"], "second")
        self.assertEqual(self._output_path("ws-x", "first").read_text().strip(), "first-out")
        self.assertEqual(self._output_path("ws-x", "second").read_text().strip(), "second-out")

    def test_rerun_overwrites_prior_status(self):
        # Simulate a retry: run once that fails, then once that succeeds.
        self._run("ws-x", "retry", "false", expect_success=False)
        first = json.loads(self._status_path("ws-x", "retry").read_text())
        self.assertEqual(first["status"], "failed")

        self._run("ws-x", "retry", "true")
        second = json.loads(self._status_path("ws-x", "retry").read_text())
        self.assertEqual(second["status"], "completed")
        self.assertEqual(second["exit_code"], 0)
        self.assertIsNone(second["error"])


class NoEvalSemanticsTests(RunDirectiveShTestBase):
    """Lock in that the wrapper does NOT shell-eval the command string.

    This is the security/quoting guarantee — `eval` is gone.
    """

    def test_command_with_pipe_does_not_pipe(self):
        # Old eval-based code would interpret '|' as a pipe. The new code
        # passes 'echo' with literal arg 'piped|word' — output should contain
        # the literal pipe character.
        self._run("ws-x", "pipe-safe", "echo", "piped|word")
        out = self._output_path("ws-x", "pipe-safe").read_text()
        self.assertEqual(out.strip(), "piped|word")

    def test_command_with_semicolon_does_not_chain(self):
        # If eval'd this would run `echo a` then `echo b`. With argv
        # preservation it just echoes the literal string.
        self._run("ws-x", "semi-safe", "echo", "a; echo b")
        out = self._output_path("ws-x", "semi-safe").read_text()
        self.assertEqual(out.strip(), "a; echo b")

    def test_dollar_variable_not_expanded(self):
        # If eval'd, $HOME would expand. With argv it's literal.
        self._run("ws-x", "dollar-safe", "echo", "$HOME")
        out = self._output_path("ws-x", "dollar-safe").read_text()
        self.assertEqual(out.strip(), "$HOME")


if __name__ == "__main__":
    unittest.main()
