"""Tests for the vmux session-list parser used by reconcile._send_task_instructions.

Run with:
    python3 -m unittest tests.test_reconcile_vmux_parse
"""

import unittest

from scripts.scheduler.reconcile import parse_vmux_sessions, find_session_for_item


class ParseVmuxSessionsTests(unittest.TestCase):
    def test_named_sessions(self) -> None:
        output = (
            "[standby] ws-089-eliminate-description (636d4b11d737)\n"
            "  cwd: /Users/foo/.claude/orchestrator/workspaces/ws-089\n"
            "[thinking] ws-087-vmux-daemon (21487427450c)\n"
            "  cwd: /Users/foo/claude-voice-multiplexer\n"
        )
        parsed = parse_vmux_sessions(output)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["state"], "standby")
        self.assertEqual(parsed[0]["name"], "ws-089-eliminate-description")
        self.assertEqual(parsed[0]["hex_id"], "636d4b11d737")
        self.assertEqual(parsed[1]["state"], "thinking")
        self.assertEqual(parsed[1]["hex_id"], "21487427450c")

    def test_bare_hex_sessions(self) -> None:
        output = "[standby] 1bd9b93adf90\n[zombie] deadbeefcafe\n"
        parsed = parse_vmux_sessions(output)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["name"], "1bd9b93adf90")
        self.assertEqual(parsed[0]["hex_id"], "1bd9b93adf90")
        self.assertEqual(parsed[1]["state"], "zombie")

    def test_skips_noise_and_empty_lines(self) -> None:
        output = "vmux 0.4.2\n\n[standby] ws-001-foo (aaaabbbbcccc)\n  cwd: /tmp\nrandom log line\n"
        parsed = parse_vmux_sessions(output)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["hex_id"], "aaaabbbbcccc")

    def test_find_session_for_item_named(self) -> None:
        output = (
            "[standby] ws-089-eliminate-description (636d4b11d737)\n"
            "[standby] ws-087-vmux-daemon (21487427450c)\n"
        )
        self.assertEqual(find_session_for_item(output, "ws-089"), "636d4b11d737")
        self.assertEqual(find_session_for_item(output, "ws-087"), "21487427450c")

    def test_find_session_for_item_no_match(self) -> None:
        output = "[standby] ws-100-other (aaaabbbbcccc)\n"
        self.assertIsNone(find_session_for_item(output, "ws-089"))

    def test_find_session_for_item_empty_output(self) -> None:
        self.assertIsNone(find_session_for_item("", "ws-089"))


if __name__ == "__main__":
    unittest.main()
