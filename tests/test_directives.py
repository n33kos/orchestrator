"""Tests for scripts.scheduler.directives.

Run with:
    python3 -m unittest tests.test_directives
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.scheduler.directives import (
    _parse_frontmatter,
    load_directives,
    filter_enabled_directives,
    merge_runtime_directives,
    next_actionable_directive,
    blocking_directives,
    item_should_cycle,
    applicable_directives_for_item,
    ALWAYS_CYCLE_STATUSES,
)


class ParseFrontmatterTests(unittest.TestCase):
    def test_no_frontmatter_returns_full_body(self):
        fm, body = _parse_frontmatter("just body text")
        self.assertEqual(fm, {})
        self.assertEqual(body, "just body text")

    def test_basic_frontmatter(self):
        fm, body = _parse_frontmatter(
            "---\nname: foo\nrequired: true\n---\nthe body\n"
        )
        self.assertEqual(fm["name"], "foo")
        self.assertEqual(fm["required"], True)
        self.assertEqual(body, "the body")

    def test_type_coercion(self):
        fm, _ = _parse_frontmatter(
            "---\n"
            "enabled: false\n"
            "required: yes\n"
            "max_retries: 3\n"
            "depends_on: other\n"
            "---\nx\n"
        )
        self.assertIs(fm["enabled"], False)
        self.assertIs(fm["required"], True)
        self.assertEqual(fm["max_retries"], 3)
        self.assertEqual(fm["depends_on"], "other")

    def test_malformed_frontmatter_treated_as_body(self):
        fm, body = _parse_frontmatter("---\nbad\n---\nx")
        # Line "bad" has no colon — gets skipped silently. Body still parses.
        self.assertEqual(fm, {})
        self.assertEqual(body, "x")

    def test_comments_and_blank_lines_skipped(self):
        fm, _ = _parse_frontmatter(
            "---\n"
            "# a comment\n"
            "\n"
            "name: bar\n"
            "---\nbody\n"
        )
        self.assertEqual(fm, {"name": "bar"})


class LoadDirectivesTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="orch-test-")
        self.committed = Path(self.root) / "delegator" / "directives"
        self.local = Path(self.root) / "delegator" / "directives.local"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _write(self, base: Path, status: str, filename: str, content: str):
        d = base / status
        d.mkdir(parents=True, exist_ok=True)
        (d / filename).write_text(content)

    def test_empty_dirs_returns_empty(self):
        self.assertEqual(load_directives(self.root), {})

    def test_loads_committed_only(self):
        self._write(
            self.committed,
            "active",
            "alpha.md",
            "---\nname: alpha\nrequired: true\n---\nDo alpha.\n",
        )
        result = load_directives(self.root)
        self.assertEqual(list(result.keys()), ["active"])
        self.assertEqual(len(result["active"]), 1)
        d = result["active"][0]
        self.assertEqual(d["name"], "alpha")
        self.assertEqual(d["enabled"], True)
        self.assertEqual(d["required"], True)
        self.assertEqual(d["instructions"], "Do alpha.")

    def test_local_overrides_committed_by_name(self):
        self._write(
            self.committed,
            "active",
            "alpha.md",
            "---\nname: alpha\nrequired: true\n---\nCommitted alpha.\n",
        )
        self._write(
            self.local,
            "active",
            "alpha.md",
            "---\nname: alpha\nrequired: false\n---\nLocal alpha.\n",
        )
        result = load_directives(self.root)
        self.assertEqual(len(result["active"]), 1)
        d = result["active"][0]
        self.assertEqual(d["instructions"], "Local alpha.")
        self.assertEqual(d["required"], False)

    def test_local_appends_new_names(self):
        self._write(
            self.committed,
            "active",
            "alpha.md",
            "---\nname: alpha\n---\nCommitted alpha.\n",
        )
        self._write(
            self.local,
            "active",
            "beta.md",
            "---\nname: beta\n---\nLocal beta.\n",
        )
        result = load_directives(self.root)
        names = {d["name"] for d in result["active"]}
        self.assertEqual(names, {"alpha", "beta"})

    def test_filename_fallback_for_name(self):
        self._write(
            self.committed,
            "active",
            "auto-named.md",
            "---\n---\nbody\n",
        )
        result = load_directives(self.root)
        self.assertEqual(result["active"][0]["name"], "auto-named")

    def test_empty_body_skipped(self):
        self._write(
            self.committed,
            "active",
            "blank.md",
            "---\nname: blank\n---\n   \n",
        )
        # No body → not loaded → no active key in result.
        self.assertEqual(load_directives(self.root), {})

    def test_enabled_default_true(self):
        self._write(
            self.committed,
            "active",
            "alpha.md",
            "---\nname: alpha\n---\nbody\n",
        )
        d = load_directives(self.root)["active"][0]
        self.assertTrue(d["enabled"])

    def test_enabled_can_be_false(self):
        self._write(
            self.committed,
            "active",
            "alpha.md",
            "---\nname: alpha\nenabled: false\n---\nbody\n",
        )
        d = load_directives(self.root)["active"][0]
        self.assertFalse(d["enabled"])


class FilterEnabledTests(unittest.TestCase):
    def _ds(self):
        return [
            {"name": "alpha", "enabled": True},
            {"name": "beta", "enabled": False},
            {"name": "gamma", "enabled": True},
        ]

    def test_no_overrides_uses_frontmatter_enabled(self):
        out = filter_enabled_directives(self._ds())
        self.assertEqual([d["name"] for d in out], ["alpha", "gamma"])

    def test_override_can_disable(self):
        out = filter_enabled_directives(self._ds(), {"alpha": False})
        self.assertEqual([d["name"] for d in out], ["gamma"])

    def test_override_can_enable_disabled_directive(self):
        out = filter_enabled_directives(self._ds(), {"beta": True})
        self.assertEqual([d["name"] for d in out], ["alpha", "beta", "gamma"])

    def test_override_for_unknown_name_ignored(self):
        out = filter_enabled_directives(self._ds(), {"never-existed": True})
        self.assertEqual([d["name"] for d in out], ["alpha", "gamma"])

    def test_empty_overrides_dict_is_safe(self):
        out = filter_enabled_directives(self._ds(), {})
        self.assertEqual([d["name"] for d in out], ["alpha", "gamma"])

    def test_none_overrides_is_safe(self):
        out = filter_enabled_directives(self._ds(), None)
        self.assertEqual([d["name"] for d in out], ["alpha", "gamma"])


class MergeRuntimeTests(unittest.TestCase):
    def _ds(self):
        return [{"name": "a"}, {"name": "b"}]

    def test_preserves_existing_state(self):
        existing = {"a": {"status": "running", "retries": 1, "last_run": "x", "output_path": "/p"}}
        result = merge_runtime_directives(existing, self._ds())
        self.assertEqual(result["a"]["status"], "running")
        self.assertEqual(result["a"]["retries"], 1)

    def test_initializes_new_directives(self):
        result = merge_runtime_directives({}, self._ds())
        self.assertEqual(result["a"]["status"], "pending")
        self.assertEqual(result["b"]["status"], "pending")
        self.assertEqual(result["a"]["retries"], 0)

    def test_drops_orphaned_state(self):
        # 'gone' is in existing state but not in current directives — should be dropped.
        existing = {"gone": {"status": "completed"}}
        result = merge_runtime_directives(existing, self._ds())
        self.assertNotIn("gone", result)


class NextActionableTests(unittest.TestCase):
    def test_no_runtime_returns_first(self):
        ds = [{"name": "a"}, {"name": "b"}]
        self.assertEqual(next_actionable_directive(ds), "a")

    def test_no_runtime_empty_list_returns_none(self):
        self.assertIsNone(next_actionable_directive([]))

    def test_picks_first_pending_with_met_dependency(self):
        ds = [
            {"name": "a"},
            {"name": "b", "depends_on": "a"},
        ]
        rt = {"a": {"status": "completed"}, "b": {"status": "pending"}}
        self.assertEqual(next_actionable_directive(ds, rt), "b")

    def test_skips_pending_when_dependency_unmet(self):
        ds = [
            {"name": "a"},
            {"name": "b", "depends_on": "a"},
        ]
        rt = {"a": {"status": "running"}, "b": {"status": "pending"}}
        # 'a' isn't pending, 'b' deps not met — nothing actionable.
        self.assertIsNone(next_actionable_directive(ds, rt))

    def test_failed_retry_eligible(self):
        ds = [{"name": "a", "max_retries": 3}]
        rt = {"a": {"status": "failed", "retries": 1}}
        self.assertEqual(next_actionable_directive(ds, rt), "a")

    def test_failed_max_retries_exceeded(self):
        ds = [{"name": "a", "max_retries": 2}]
        rt = {"a": {"status": "failed", "retries": 2}}
        self.assertIsNone(next_actionable_directive(ds, rt))

    def test_pending_preferred_over_failed_retry(self):
        ds = [
            {"name": "a", "max_retries": 3},
            {"name": "b"},
        ]
        rt = {"a": {"status": "failed", "retries": 0}, "b": {"status": "pending"}}
        # Pending wins over failed-retry even though 'a' comes first in list.
        self.assertEqual(next_actionable_directive(ds, rt), "b")


class BlockingTests(unittest.TestCase):
    def test_no_runtime_returns_all_required(self):
        ds = [
            {"name": "a", "required": True},
            {"name": "b", "required": False},
            {"name": "c", "required": True},
        ]
        self.assertEqual(blocking_directives(ds), ["a", "c"])

    def test_completed_required_not_blocking(self):
        ds = [
            {"name": "a", "required": True},
            {"name": "b", "required": True},
        ]
        rt = {"a": {"status": "completed"}, "b": {"status": "pending"}}
        self.assertEqual(blocking_directives(ds, rt), ["b"])

    def test_non_required_never_blocking(self):
        ds = [{"name": "a", "required": False}]
        rt = {"a": {"status": "pending"}}
        self.assertEqual(blocking_directives(ds, rt), [])

    def test_running_or_failed_required_is_blocking(self):
        ds = [
            {"name": "a", "required": True},
            {"name": "b", "required": True},
        ]
        rt = {"a": {"status": "running"}, "b": {"status": "failed"}}
        self.assertEqual(set(blocking_directives(ds, rt)), {"a", "b"})


class CycleGateTests(unittest.TestCase):
    """Tests for `item_should_cycle` — the always-cycle vs gated decision."""

    def setUp(self):
        # Self-contained project root with no committed or local directives
        # by default. Subtests can write directive files into self.committed.
        self.root = tempfile.mkdtemp(prefix="orch-test-")
        self.committed = Path(self.root) / "delegator" / "directives"
        self.committed.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _write_directive(self, status: str, name: str, enabled: bool = True):
        d = self.committed / status
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.md").write_text(
            f"---\nname: {name}\nenabled: {'true' if enabled else 'false'}\n---\nbody\n"
        )

    def test_delegator_disabled_never_cycles(self):
        item = {"status": "active", "worker": {"delegator_enabled": False}}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_active_always_cycles_even_without_directives(self):
        item = {"status": "active", "worker": {"delegator_enabled": True}}
        self.assertTrue(item_should_cycle(item, self.root))

    def test_review_always_cycles_even_without_directives(self):
        item = {"status": "review", "worker": {"delegator_enabled": True}}
        self.assertTrue(item_should_cycle(item, self.root))

    def test_planning_without_directives_skips(self):
        item = {"status": "planning", "worker": {"delegator_enabled": True}}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_completed_without_directives_skips(self):
        item = {"status": "completed", "worker": {"delegator_enabled": True}}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_planning_with_applicable_directive_cycles(self):
        self._write_directive("planning", "alpha")
        item = {"status": "planning", "worker": {"delegator_enabled": True}}
        self.assertTrue(item_should_cycle(item, self.root))

    def test_planning_with_disabled_directive_skips(self):
        self._write_directive("planning", "alpha", enabled=False)
        item = {"status": "planning", "worker": {"delegator_enabled": True}}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_planning_with_directive_but_overridden_off_skips(self):
        self._write_directive("planning", "alpha")
        item = {
            "status": "planning",
            "worker": {
                "delegator_enabled": True,
                "directive_overrides": {"alpha": False},
            },
        }
        self.assertFalse(item_should_cycle(item, self.root))

    def test_completed_with_directive_overridden_on_cycles(self):
        # Directive disabled by default but turned on for this item.
        self._write_directive("completed", "cleanup", enabled=False)
        item = {
            "status": "completed",
            "worker": {
                "delegator_enabled": True,
                "directive_overrides": {"cleanup": True},
            },
        }
        self.assertTrue(item_should_cycle(item, self.root))

    def test_directives_globally_disabled_blocks_non_cycle_status(self):
        # Even with an applicable directive, directives_enabled=false stops cycling.
        self._write_directive("planning", "alpha")
        item = {
            "status": "planning",
            "worker": {"delegator_enabled": True, "directives_enabled": False},
        }
        self.assertFalse(item_should_cycle(item, self.root))

    def test_active_status_unaffected_by_directives_disabled(self):
        # Active always cycles for the existing pipeline regardless of directives flag.
        item = {
            "status": "active",
            "worker": {"delegator_enabled": True, "directives_enabled": False},
        }
        self.assertTrue(item_should_cycle(item, self.root))


class ApplicableDirectivesTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="orch-test-")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _write(self, status: str, name: str, enabled: bool = True):
        d = Path(self.root) / "delegator" / "directives" / status
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.md").write_text(
            f"---\nname: {name}\nenabled: {'true' if enabled else 'false'}\n---\nbody\n"
        )

    def test_no_status_returns_empty(self):
        self.assertEqual(applicable_directives_for_item(self.root, ""), [])

    def test_unknown_status_returns_empty(self):
        self._write("active", "alpha")
        self.assertEqual(applicable_directives_for_item(self.root, "queued"), [])

    def test_returns_only_enabled_directives(self):
        self._write("planning", "on")
        self._write("planning", "off", enabled=False)
        names = [d["name"] for d in applicable_directives_for_item(self.root, "planning")]
        self.assertEqual(names, ["on"])

    def test_override_enables_disabled_directive(self):
        self._write("planning", "off", enabled=False)
        names = [
            d["name"]
            for d in applicable_directives_for_item(self.root, "planning", {"off": True})
        ]
        self.assertEqual(names, ["off"])


class AlwaysCycleStatusesContractTest(unittest.TestCase):
    """Lock in the contract that active and review always cycle."""

    def test_active_and_review_in_always_cycle(self):
        self.assertIn("active", ALWAYS_CYCLE_STATUSES)
        self.assertIn("review", ALWAYS_CYCLE_STATUSES)

    def test_no_other_statuses_in_always_cycle(self):
        # If we ever expand this, update the test deliberately.
        self.assertEqual(set(ALWAYS_CYCLE_STATUSES), {"active", "review"})


# ---------------------------------------------------------------------------
# Edge case / robustness tests
# ---------------------------------------------------------------------------


class FrontmatterEdgeCaseTests(unittest.TestCase):
    """Robustness for the simple YAML parser."""

    def test_quoted_string_values_kept_literal(self):
        # The simple parser does NOT strip quotes — values are taken verbatim.
        # Document this so callers don't write `name: "foo"` and expect "foo".
        fm, _ = _parse_frontmatter('---\nname: "foo"\n---\nbody\n')
        self.assertEqual(fm["name"], '"foo"')

    def test_value_with_colon_kept_intact(self):
        # The split limits to first colon, so URLs survive.
        fm, _ = _parse_frontmatter(
            "---\nurl: https://example.com/x\n---\nbody\n"
        )
        self.assertEqual(fm["url"], "https://example.com/x")

    def test_trailing_whitespace_stripped(self):
        fm, _ = _parse_frontmatter("---\nname:   spaced   \n---\nbody\n")
        self.assertEqual(fm["name"], "spaced")

    def test_negative_int_coerced(self):
        fm, _ = _parse_frontmatter(
            "---\nmax_retries: -1\n---\nbody\n"
        )
        self.assertEqual(fm["max_retries"], -1)

    def test_zero_coerced_as_int(self):
        fm, _ = _parse_frontmatter(
            "---\nmax_retries: 0\n---\nbody\n"
        )
        self.assertEqual(fm["max_retries"], 0)
        self.assertIsInstance(fm["max_retries"], int)

    def test_only_open_fence_treated_as_body(self):
        fm, body = _parse_frontmatter("---\nname: foo\nno close fence\n")
        # No closing `---` — entire thing is body, no frontmatter parsed.
        self.assertEqual(fm, {})
        self.assertIn("no close fence", body)

    def test_empty_input(self):
        fm, body = _parse_frontmatter("")
        self.assertEqual(fm, {})
        self.assertEqual(body, "")

    def test_only_frontmatter_no_body(self):
        fm, body = _parse_frontmatter("---\nname: foo\n---\n")
        self.assertEqual(fm["name"], "foo")
        self.assertEqual(body, "")

    def test_crlf_line_endings(self):
        # Some editors write CRLF; ensure parser still works.
        # Note: with CRLF, the trailing \r appears in the body. The frontmatter
        # delimiter regex requires \n so CRLF will fall through and the
        # whole content becomes body. Document the limitation as a test.
        fm, body = _parse_frontmatter("---\r\nname: foo\r\n---\r\nbody\r\n")
        # Either parse or no-parse is acceptable; just lock current behavior.
        if fm:
            # If implementation grows to handle CRLF, name should still parse.
            self.assertIn("name", fm)
        else:
            self.assertIn("body", body)

    def test_value_that_looks_like_int_but_has_text(self):
        fm, _ = _parse_frontmatter("---\nver: 1.0\n---\nbody\n")
        # 1.0 isn't a pure int — kept as string.
        self.assertEqual(fm["ver"], "1.0")


class LoadDirectivesRobustnessTests(unittest.TestCase):
    """Loader behavior under unusual filesystem states."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="orch-test-")
        self.committed = Path(self.root) / "delegator" / "directives"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _write(self, status: str, filename: str, content: str):
        d = self.committed / status
        d.mkdir(parents=True, exist_ok=True)
        (d / filename).write_text(content)

    def test_non_md_files_skipped(self):
        d = self.committed / "active"
        d.mkdir(parents=True, exist_ok=True)
        (d / "alpha.md").write_text("---\nname: alpha\n---\nbody\n")
        (d / "notes.txt").write_text("ignore me")
        (d / "config.json").write_text("{}")
        result = load_directives(self.root)
        self.assertEqual(len(result["active"]), 1)
        self.assertEqual(result["active"][0]["name"], "alpha")

    def test_files_at_directives_root_ignored(self):
        # A stray file at delegator/directives/ (not under a status folder)
        # should not crash the loader.
        self.committed.mkdir(parents=True, exist_ok=True)
        (self.committed / "stray.md").write_text("---\nname: stray\n---\nbody\n")
        # Also include a real one in a status folder.
        self._write("active", "alpha.md", "---\nname: alpha\n---\nbody\n")
        result = load_directives(self.root)
        # Stray file at root is ignored — only the status-folder file loads.
        names_per_status = {s: [d["name"] for d in lst] for s, lst in result.items()}
        self.assertEqual(names_per_status, {"active": ["alpha"]})

    def test_nested_subdirectory_under_status_ignored(self):
        # We don't recurse — only top-level *.md under status dir.
        d = self.committed / "active" / "nested"
        d.mkdir(parents=True, exist_ok=True)
        (d / "alpha.md").write_text("---\nname: alpha\n---\nbody\n")
        result = load_directives(self.root)
        self.assertEqual(result, {})

    def test_unreadable_file_skipped_gracefully(self):
        d = self.committed / "active"
        d.mkdir(parents=True, exist_ok=True)
        good = d / "good.md"
        good.write_text("---\nname: good\n---\nbody\n")
        bad = d / "bad.md"
        bad.write_text("---\nname: bad\n---\nbody\n")
        os.chmod(bad, 0o000)
        try:
            result = load_directives(self.root)
            # The good one always loads. The bad one is skipped (or loads —
            # both behaviors are acceptable; key thing is no exception).
            names = [d["name"] for d in result["active"]]
            self.assertIn("good", names)
        finally:
            # Restore so tearDown can rmtree.
            os.chmod(bad, 0o644)

    def test_nonexistent_project_root(self):
        # Should not crash; should return empty dict.
        result = load_directives("/this/does/not/exist")
        self.assertEqual(result, {})

    def test_none_project_root_defaults_to_module_relative(self):
        # Don't actually compare the result (depends on what's checked in)
        # — just make sure it doesn't crash and returns a dict.
        result = load_directives(None)
        self.assertIsInstance(result, dict)


class FilterEnabledEdgeCaseTests(unittest.TestCase):
    def test_empty_directive_list(self):
        self.assertEqual(filter_enabled_directives([], {"x": True}), [])

    def test_directive_missing_enabled_key_treated_as_enabled(self):
        # Defensive: if loader ever omits `enabled`, default to True.
        out = filter_enabled_directives([{"name": "a"}])
        self.assertEqual([d["name"] for d in out], ["a"])

    def test_override_with_truthy_non_bool_treated_as_enabled(self):
        # Strict typing isn't enforced — any truthy value enables.
        out = filter_enabled_directives(
            [{"name": "a", "enabled": False}], {"a": "yes"}
        )
        # Implementation tests `if overrides[name]:` so "yes" is truthy.
        self.assertEqual([d["name"] for d in out], ["a"])

    def test_override_with_falsy_non_bool_treated_as_disabled(self):
        out = filter_enabled_directives(
            [{"name": "a", "enabled": True}], {"a": ""}
        )
        self.assertEqual(out, [])


class MergeRuntimeEdgeCaseTests(unittest.TestCase):
    def test_empty_inputs(self):
        self.assertEqual(merge_runtime_directives({}, []), {})

    def test_existing_runtime_with_extra_keys_preserved(self):
        # If a future field is added to runtime state, merge shouldn't strip it.
        existing = {
            "a": {
                "status": "running",
                "retries": 1,
                "last_run": "x",
                "output_path": "/p",
                "future_field": "kept",
            }
        }
        result = merge_runtime_directives(existing, [{"name": "a"}])
        self.assertEqual(result["a"]["future_field"], "kept")

    def test_drops_when_directive_renamed(self):
        # A common case: directive file renamed → old runtime entry dropped.
        existing = {"old-name": {"status": "completed"}}
        result = merge_runtime_directives(existing, [{"name": "new-name"}])
        self.assertNotIn("old-name", result)
        self.assertIn("new-name", result)
        self.assertEqual(result["new-name"]["status"], "pending")


class NextActionableEdgeCaseTests(unittest.TestCase):
    def test_running_state_not_picked_again(self):
        # An in-flight directive shouldn't be re-launched.
        ds = [{"name": "a"}]
        rt = {"a": {"status": "running"}}
        self.assertIsNone(next_actionable_directive(ds, rt))

    def test_completed_state_not_picked(self):
        ds = [{"name": "a"}]
        rt = {"a": {"status": "completed"}}
        self.assertIsNone(next_actionable_directive(ds, rt))

    def test_dependency_chain_three_levels(self):
        # a → b → c
        ds = [
            {"name": "a"},
            {"name": "b", "depends_on": "a"},
            {"name": "c", "depends_on": "b"},
        ]
        # Initially → a.
        self.assertEqual(next_actionable_directive(ds, {}), "a")
        # a complete → b.
        self.assertEqual(
            next_actionable_directive(ds, {"a": {"status": "completed"}}),
            "b",
        )
        # a + b complete → c.
        self.assertEqual(
            next_actionable_directive(
                ds, {"a": {"status": "completed"}, "b": {"status": "completed"}}
            ),
            "c",
        )

    def test_max_retries_zero_means_unlimited(self):
        # max_retries=0 (the default) is documented as "unlimited" — ensure
        # high retry counts still allow re-attempt.
        ds = [{"name": "a", "max_retries": 0}]
        rt = {"a": {"status": "failed", "retries": 99}}
        self.assertEqual(next_actionable_directive(ds, rt), "a")

    def test_dependency_on_unknown_directive_blocks(self):
        # If depends_on points to a name that doesn't exist, the dependency is
        # never "completed" and the directive is blocked.
        ds = [{"name": "a", "depends_on": "ghost"}]
        rt = {"a": {"status": "pending"}}
        self.assertIsNone(next_actionable_directive(ds, rt))


class CycleGateDefensiveTests(unittest.TestCase):
    """item_should_cycle resilience to malformed queue items."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="orch-test-")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_missing_status(self):
        item = {"worker": {"delegator_enabled": True}}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_missing_worker_key(self):
        item = {"status": "active"}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_worker_is_none(self):
        item = {"status": "active", "worker": None}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_directive_overrides_is_none(self):
        # No applicable directives → no cycle. This shouldn't crash.
        item = {
            "status": "planning",
            "worker": {"delegator_enabled": True, "directive_overrides": None},
        }
        self.assertFalse(item_should_cycle(item, self.root))

    def test_unknown_status_no_directives(self):
        item = {
            "status": "frobnicated",
            "worker": {"delegator_enabled": True},
        }
        self.assertFalse(item_should_cycle(item, self.root))

    def test_active_with_missing_delegator_enabled_field(self):
        # delegator_enabled defaults to falsy when absent.
        item = {"status": "active", "worker": {}}
        self.assertFalse(item_should_cycle(item, self.root))

    def test_project_root_does_not_exist(self):
        item = {
            "status": "planning",
            "worker": {"delegator_enabled": True},
        }
        # Should not crash; returns False since no directives load.
        self.assertFalse(item_should_cycle(item, "/nope/nope"))


class IntegrationLoaderTests(unittest.TestCase):
    """End-to-end against a real on-disk layout that mirrors production."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="orch-test-")
        self.committed = Path(self.root) / "delegator" / "directives"
        self.local = Path(self.root) / "delegator" / "directives.local"

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def _write(self, base: Path, status: str, name: str, **frontmatter):
        d = base / status
        d.mkdir(parents=True, exist_ok=True)
        fm_lines = [f"{k}: {('true' if v is True else 'false' if v is False else v)}"
                    for k, v in frontmatter.items()]
        content = "---\nname: " + name + "\n" + "\n".join(fm_lines) + "\n---\nbody\n"
        (d / f"{name}.md").write_text(content)

    def test_full_lifecycle_simulation(self):
        # Configure a chain across two statuses with a local override.
        self._write(self.committed, "active", "council", required=True, max_retries=3)
        self._write(self.committed, "active", "exhibit",
                    required=True, depends_on="council")
        self._write(self.local, "active", "council", enabled=False)  # disable globally

        loaded = load_directives(self.root)
        self.assertEqual(len(loaded["active"]), 2)

        # Per-item: keep council off (matches local), exhibit picks up automatically.
        active_for_item = applicable_directives_for_item(self.root, "active")
        names = [d["name"] for d in active_for_item]
        self.assertEqual(names, ["exhibit"])
        # exhibit depends on council which is disabled — but at the loader level
        # the dependency is still listed. Cycle gate doesn't itself check that
        # the dep can complete; that's the LLM's job at runtime.

        # Override for a specific item turns council back on.
        active_for_override = applicable_directives_for_item(
            self.root, "active", {"council": True}
        )
        self.assertEqual(
            [d["name"] for d in active_for_override], ["council", "exhibit"]
        )


if __name__ == "__main__":
    unittest.main()
