"""The CI counts the delegator branches on must match what gh actually reports."""

import re
import unittest
from pathlib import Path

PREPROCESS = Path(__file__).resolve().parents[1] / "scripts" / "delegator-preprocess.sh"


def _load_parser():
    src = PREPROCESS.read_text()
    start = src.index("SETTLED_OK_CI = {")
    end = src.index("def parse_merge_status")
    namespace = {"re": re}
    exec(src[start:end], namespace)
    return namespace["parse_ci_checks"]


parse_ci_checks = _load_parser()


class CiCheckParsingTests(unittest.TestCase):
    def test_skipped_checks_count_as_settled_not_pending(self):
        raw = "\n".join(
            ["build\tpass\t1m\turl"] * 3 + ["optional-suite\tskipping\t0\turl"] * 2
        )
        total, passing, failing, names, pending = parse_ci_checks(raw)
        self.assertEqual((total, passing, failing, pending), (5, 5, 0, 0))
        self.assertEqual(names, [])

    def test_failing_checks_are_named(self):
        raw = "lint\tfail\t2m\turl\nbuild\tpass\t1m\turl"
        total, passing, failing, names, pending = parse_ci_checks(raw)
        self.assertEqual((total, passing, failing, pending), (2, 1, 1, 0))
        self.assertEqual(names, ["lint"])

    def test_pending_checks_are_counted_separately(self):
        raw = "deploy\tpending\t0\turl\nbuild\tpass\t1m\turl"
        total, passing, failing, names, pending = parse_ci_checks(raw)
        self.assertEqual((total, passing, failing, pending), (2, 1, 0, 1))

    def test_a_check_named_after_a_status_word_does_not_shift_the_count(self):
        raw = "fail-fast-lint\tpass\t1m\turl"
        total, passing, failing, names, pending = parse_ci_checks(raw)
        self.assertEqual((total, passing, failing, pending), (1, 1, 0, 0))


if __name__ == "__main__":
    unittest.main()
