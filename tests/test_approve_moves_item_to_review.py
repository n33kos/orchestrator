"""An `approve` assessment is what moves an item to review.

The reviewer's assessment used to be documented as triggering the transition while
nothing in the code read it, so a branch-and-PR item could be approved every cycle
and stay in `active` forever.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
ACTIONS = SCRIPTS / "delegator-actions.py"


class ApproveTransitionTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.bin = self.home / "bin"
        self.bin.mkdir()
        fake_vmux = self.bin / "vmux"
        fake_vmux.write_text("#!/bin/bash\nexit 0\n")
        fake_vmux.chmod(0o755)
        queue_dir = self.home / ".claude" / "orchestrator"
        queue_dir.mkdir(parents=True)
        self.queue = queue_dir / "queue.json"
        self.addCleanup(shutil.rmtree, self.home, True)

    def seed(self, status):
        self.queue.write_text(json.dumps({
            "version": 1,
            "items": [{
                "id": "ws-900",
                "title": "Probe",
                "priority": 3,
                "status": status,
                "worker": {"delegator_enabled": True, "commit_strategy": "branch_and_pr"},
            }],
        }))

    def run_actions(self, payload):
        env = dict(os.environ)
        env.update({
            "HOME": str(self.home),
            "PATH": f"{self.bin}:{env['PATH']}",
            "DELEGATOR_ITEM_ID": "ws-900",
            "DELEGATOR_SCRIPT_DIR": str(SCRIPTS),
            "DELEGATOR_VMUX": str(self.bin / "vmux"),
        })
        return subprocess.run(
            ["python3", str(ACTIONS)],
            input=json.dumps(payload), text=True, capture_output=True, env=env, timeout=30,
        )

    def status(self):
        return json.loads(self.queue.read_text())["items"][0]["status"]

    def test_approve_without_an_explicit_action_still_moves_to_review(self):
        self.seed("active")
        result = self.run_actions({"decision": "handle", "actions": [], "assessment": "approve"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.status(), "review")

    def test_monitoring_leaves_the_item_active(self):
        self.seed("active")
        self.run_actions({"decision": "handle", "actions": [], "assessment": "monitoring"})
        self.assertEqual(self.status(), "active")

    def test_approve_does_not_pull_a_completed_item_backwards(self):
        self.seed("completed")
        self.run_actions({"decision": "handle", "actions": [], "assessment": "approve"})
        self.assertEqual(self.status(), "completed")


if __name__ == "__main__":
    unittest.main()
