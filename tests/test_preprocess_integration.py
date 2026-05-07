"""Integration tests for `scripts/delegator-preprocess.sh` directive injection.

Drives the real preprocess script in a sandboxed HOME with a controlled
queue.json. Verifies the contract between the bash payload-passing layer
and the Python directive loader: directive lists, runtime state merging,
per-item overrides, and the directives_enabled global toggle.

These tests rely on the project's actual directive files on disk (under
`delegator/directives/` and `delegator/directives.local/`). They work
whether or not local overrides are present — assertions are written to
validate the wiring, not specific directive names.

Run with:
    python3 -m unittest tests.test_preprocess_integration
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PREPROCESS = REPO_ROOT / "scripts" / "delegator-preprocess.sh"


def _load_project_directives_for_status(status: str) -> list[dict]:
    """Use the real loader to find what directives the project ships."""
    import sys
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from scheduler.directives import load_directives  # type: ignore[import-not-found]
    all_dirs = load_directives(str(REPO_ROOT))
    return all_dirs.get(status, [])


class PreprocessSandbox:
    """Helper that builds a sandbox HOME with a configurable queue item."""

    def __init__(self, item: dict):
        self.tmphome = tempfile.mkdtemp(prefix="orch-pp-")
        self.item = item

        orch_dir = Path(self.tmphome) / ".claude" / "orchestrator"
        (orch_dir / "delegators" / item["id"]).mkdir(parents=True, exist_ok=True)

        queue = {"items": [item]}
        (orch_dir / "queue.json").write_text(json.dumps(queue, indent=2))

        # Minimal state file so the preprocess doesn't error on missing prior state.
        state_file = orch_dir / "delegators" / item["id"] / "state.json"
        state_file.write_text(json.dumps({"item_id": item["id"], "cycle_count": 0}))

    def run(self) -> dict:
        env = {
            **os.environ,
            "HOME": self.tmphome,
            "ORCHESTRATOR_QUEUE_FILE": str(
                Path(self.tmphome) / ".claude" / "orchestrator" / "queue.json"
            ),
        }
        result = subprocess.run(
            ["bash", str(PREPROCESS), self.item["id"]],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"preprocess failed (rc={result.returncode}):\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        out = (
            Path(self.tmphome) / ".claude" / "orchestrator" / "delegators"
            / self.item["id"] / f"cycle-{self.item['id']}.json"
        )
        return json.loads(out.read_text())

    def cleanup(self):
        shutil.rmtree(self.tmphome, ignore_errors=True)


def _make_item(item_id="ws-pp", status="active", **worker_overrides) -> dict:
    """Construct a minimal but well-formed queue item."""
    worker = {
        "commit_strategy": "branch_and_pr",
        "delegator_enabled": True,
        "directives_enabled": True,
    }
    worker.update(worker_overrides)
    return {
        "id": item_id,
        "status": status,
        "title": f"Probe {item_id}",
        "description": "preprocess integration test",
        "priority": 3,
        "blocked_by": [],
        "created_at": "2026-01-01T00:00:00",
        "activated_at": None,
        "completed_at": None,
        "environment": {
            "repo": None, "use_worktree": False, "branch": None,
            "worktree_path": None, "session_id": None,
        },
        "worker": worker,
        "plan": {"file": None, "summary": None, "approved": False, "approved_at": None},
        "runtime": {
            "delegator_status": None, "spend": None, "last_activity": None,
            "pr_url": None, "stack_prs": None, "completion_message": None,
            "directives": {},
        },
    }


class PayloadStructureTests(unittest.TestCase):
    """Baseline contract: every payload has the expected top-level keys."""

    def test_active_payload_has_directive_keys_when_directives_exist(self):
        if not _load_project_directives_for_status("active"):
            self.skipTest("No active directives on disk; skip.")
        sb = PreprocessSandbox(_make_item(status="active"))
        try:
            payload = sb.run()
        finally:
            sb.cleanup()

        self.assertIn("directives", payload)
        self.assertIn("directive_runtime", payload)
        self.assertIsInstance(payload["directives"], list)
        self.assertIsInstance(payload["directive_runtime"], dict)

    def test_payload_preserves_basic_fields(self):
        sb = PreprocessSandbox(_make_item(item_id="ws-fields"))
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        self.assertEqual(payload["item_id"], "ws-fields")
        self.assertIn("item_context", payload)
        self.assertIn("plan", payload)
        self.assertIn("worker", payload)


class DirectivesGlobalToggleTests(unittest.TestCase):
    """`worker.directives_enabled=false` suppresses all directives."""

    def test_disabled_excludes_directives_keys(self):
        sb = PreprocessSandbox(_make_item(directives_enabled=False))
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        # Nothing under `directives` or `directive_runtime` because
        # the preprocess only writes those keys when directives are loaded.
        self.assertNotIn("directives", payload)
        self.assertNotIn("directive_runtime", payload)

    def test_enabled_explicitly_true_includes_directives_when_present(self):
        if not _load_project_directives_for_status("active"):
            self.skipTest("No active directives on disk; skip.")
        sb = PreprocessSandbox(_make_item(directives_enabled=True))
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        self.assertIn("directives", payload)
        self.assertGreater(len(payload["directives"]), 0)


class StatusBasedLoadingTests(unittest.TestCase):
    """Payload directives reflect the item's current status."""

    def test_status_with_no_directives_omits_keys(self):
        # Pick a status that almost certainly has no committed directives.
        status_dirs = _load_project_directives_for_status("queued")
        if status_dirs:
            self.skipTest("Project has queued directives; skip.")

        sb = PreprocessSandbox(_make_item(status="queued"))
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        self.assertNotIn("directives", payload)

    def test_active_status_loads_active_directives_only(self):
        active_dirs = _load_project_directives_for_status("active")
        if not active_dirs:
            self.skipTest("No active directives configured; skip.")

        sb = PreprocessSandbox(_make_item(status="active"))
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        loaded_names = {d["name"] for d in payload["directives"]}
        expected_names = {d["name"] for d in active_dirs}
        # Loaded should be a subset (filter may remove disabled).
        self.assertTrue(loaded_names.issubset(expected_names))


class OverrideTests(unittest.TestCase):
    """Per-item `directive_overrides` filter the payload."""

    def test_override_disables_a_directive_for_this_item(self):
        active_dirs = _load_project_directives_for_status("active")
        if not active_dirs:
            self.skipTest("No active directives to override; skip.")

        target = active_dirs[0]["name"]
        sb = PreprocessSandbox(
            _make_item(directive_overrides={target: False})
        )
        try:
            payload = sb.run()
        finally:
            sb.cleanup()

        names = [d["name"] for d in payload.get("directives", [])]
        self.assertNotIn(target, names)

    def test_override_enables_a_disabled_directive(self):
        # Find a directive that's disabled by default. If none, skip.
        active_dirs = _load_project_directives_for_status("active")
        disabled = [d for d in active_dirs if d.get("enabled") is False]
        if not disabled:
            self.skipTest("No disabled active directives to enable; skip.")

        target = disabled[0]["name"]
        sb = PreprocessSandbox(
            _make_item(directive_overrides={target: True})
        )
        try:
            payload = sb.run()
        finally:
            sb.cleanup()

        names = [d["name"] for d in payload.get("directives", [])]
        self.assertIn(target, names)

    def test_unknown_directive_in_overrides_is_ignored(self):
        sb = PreprocessSandbox(
            _make_item(directive_overrides={"completely-fake-name-xyz": True})
        )
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        # Shouldn't crash; payload still produced. If any active directives
        # exist, they should still be there.
        if "directives" in payload:
            names = {d["name"] for d in payload["directives"]}
            self.assertNotIn("completely-fake-name-xyz", names)


class RuntimeStateTests(unittest.TestCase):
    """`directive_runtime` reflects the merge between queue item and definitions."""

    def test_new_item_initializes_pending_state(self):
        active_dirs = _load_project_directives_for_status("active")
        if not active_dirs:
            self.skipTest("No active directives; skip.")

        sb = PreprocessSandbox(_make_item())
        try:
            payload = sb.run()
        finally:
            sb.cleanup()

        runtime = payload["directive_runtime"]
        for d in payload["directives"]:
            self.assertIn(d["name"], runtime)
            self.assertEqual(runtime[d["name"]]["status"], "pending")
            self.assertEqual(runtime[d["name"]]["retries"], 0)

    def test_existing_runtime_state_preserved(self):
        active_dirs = _load_project_directives_for_status("active")
        if not active_dirs:
            self.skipTest("No active directives; skip.")

        target = active_dirs[0]["name"]
        item = _make_item()
        item["runtime"]["directives"] = {
            target: {
                "status": "running",
                "retries": 2,
                "last_run": "2026-01-01T00:00:00Z",
                "output_path": "/some/path.log",
            }
        }
        sb = PreprocessSandbox(item)
        try:
            payload = sb.run()
        finally:
            sb.cleanup()

        if target in {d["name"] for d in payload.get("directives", [])}:
            self.assertEqual(
                payload["directive_runtime"][target]["status"], "running"
            )
            self.assertEqual(payload["directive_runtime"][target]["retries"], 2)


class DefensiveItemShapeTests(unittest.TestCase):
    """Preprocess shouldn't crash on malformed-but-valid items."""

    def test_item_without_directive_overrides_field(self):
        item = _make_item()
        # Remove the field entirely (it's optional in the schema).
        item["worker"].pop("directive_overrides", None)
        sb = PreprocessSandbox(item)
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        # Just need it not to crash; payload should be produced.
        self.assertEqual(payload["item_id"], item["id"])

    def test_item_with_null_directive_overrides(self):
        item = _make_item()
        item["worker"]["directive_overrides"] = None
        sb = PreprocessSandbox(item)
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        self.assertEqual(payload["item_id"], item["id"])

    def test_item_with_empty_runtime_directives(self):
        item = _make_item()
        item["runtime"]["directives"] = {}
        sb = PreprocessSandbox(item)
        try:
            payload = sb.run()
        finally:
            sb.cleanup()
        self.assertEqual(payload["item_id"], item["id"])


if __name__ == "__main__":
    unittest.main()
