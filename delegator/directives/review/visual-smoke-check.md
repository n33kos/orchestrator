---
name: visual-smoke-check
enabled: true
required: false
max_retries: 0
depends_on: null
---

# Visual smoke-check directive

Runs in the `review` status on every cycle. Delegates the entire capture + diff + report pipeline to the `visual-testing:visual-regression` skill, which compares the worker's branch against `main` (or the graphite parent), produces a self-contained HTML report, and writes a `coverage.json` the directive reads to populate queue metadata. The directive's job is the eligibility gating, the skill invocation, the observational worker message, and the metadata write — nothing more.

The user reviews the artifact and decides whether to push findings back to the worker. This directive **never** transitions the item back to `active`, never modifies code, and never instructs the worker to take corrective action.

---

## Behavioral contract — read this first

- The directive is **observational**. It posts findings; it does not act on them.
- The worker session receives a message that explicitly states "**Do not take action on these findings — the user will decide.**" The worker should NOT auto-modify code in response to this message.
- The user decides whether to push the artifact's findings back into the worker. That action is manual.
- The directive does **not** call `trigger_review_transition` and does **not** bump status `review → active`.
- The skill's pixel-diff signal is "did the branch introduce a visible change vs the base." It is not a judgment about whether a change is intentional, correct, or matches Figma. Those judgments belong to the human reviewer.

---

## Step-by-step instructions per cycle

### 1. Eligibility gates

In order. Exit at the first that fails.

1. **Same-commit gate.** Read `runtime.directives.visual-smoke-check.last_evaluated_commit` from the previous payload. If it equals the current `HEAD` of the worktree, exit silently — the state hasn't changed since the last evaluation. (Same-commit is the cheapest gate; check it first to avoid spending any time on the others when nothing has moved.)

2. **Frontend-diff gate.** Run `git diff <last_evaluated_commit_or_origin/main>...HEAD --name-only` in the worktree. If no path matches `\.(tsx?|jsx?|scss|css)$` under `app/assets/javascripts/`, emit `update_queue_metadata` with `runtime.directives.visual-smoke-check = { status: "skipped", reason: "no_frontend_changes", last_evaluated_commit: <HEAD> }` and exit. The item didn't change anything visual; no smoke check is warranted.

3. **Branch-host discoverability gate.** The `visual-regression` skill resolves the branch host by querying `rostrum status --json` for the current worktree path. Run that query in the worktree:

   ```bash
   rostrum status --json | jq -r --arg path "$(pwd -P)" \
     '.worktrees[] | select(.path == $path) | .rails_url'
   ```

   If the result is empty / null / `rostrum` is unavailable, the skill cannot resolve a host either. Emit `update_queue_metadata` with `runtime.directives.visual-smoke-check = { status: "skipped", reason: "no_branch_host_discoverable", last_evaluated_commit: <HEAD> }` and exit. Record the attempt in the directive output log so we can learn which repos need extra config.

### 2. Invoke the `visual-regression` skill

Invoke `visual-testing:visual-regression` via the `Skill` tool. Inputs:

- `base_ref`:
  - If `item_context.worker.commit_strategy` is `graphite_stack`, omit `base_ref` — the skill auto-detects the graphite parent.
  - Otherwise, pass `main`.
- `branch_host`: omit. The skill queries rostrum to discover the worktree's URL (the same query the gate ran above).
- `viewport`: `both` (desktop + mobile).
- `output_dir`: compute a deterministic path:

  ```
  COMMIT_SHORT=$(git rev-parse --short HEAD)
  TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
  FINAL_DIR="$HOME/Desktop/visual-smoke-checks/<item-id>/${TIMESTAMP}-${COMMIT_SHORT}"
  SANDBOX_DIR=".playwright-mcp/regression-<item-id>-${COMMIT_SHORT}"
  ```

  Pass the sandbox path to the skill (the Playwright MCP needs writes inside the repo root). After the skill finishes successfully, `mkdir -p $(dirname "$FINAL_DIR") && mv "$SANDBOX_DIR" "$FINAL_DIR"`. Use `$FINAL_DIR/report.html` as the canonical artifact path from this point on.

The skill owns dev-server preflight (via `browsing-babylist`), authentication, route discovery (`map-routes`), interaction mapping (`map-interactions`), capture (`frame-capture`), diffing (`pixel-diff`), and HTML report generation (`visual-report`, which composes `present-html` styling). The directive does NOT bootstrap servers, run Playwright commands, or author HTML on its own. If the skill is missing a capability the directive used to do by hand, the right answer is to file an upstream issue against `visual-testing`, not to inline the logic here.

### 3. Read the skill's output

After the skill returns, read `$FINAL_DIR/coverage.json`. The wrapped shape is:

```json
{
  "branch": "...",
  "base_ref": "...",
  "totals": { "PASS": N, "CLOSE": N, "FAIL": N, "SKIPPED": N, "coverage_percent": N },
  "variants": [ { "variant": "...", "url": "...", "selector": "...", "status": "PASS|CLOSE|FAIL", "diff_percent": N, "notes": "...", ... } ],
  "skipped": [ ... ]
}
```

Map `totals` to a single overall verdict:

| Condition on `totals` | Verdict |
|---|---|
| `variants` is empty | `no_routes_resolved` |
| `FAIL > 0` | `failed_to_render` |
| `FAIL == 0 && CLOSE > 0` | `rendered_with_issues` |
| `FAIL == 0 && CLOSE == 0 && PASS > 0` | `rendered_ok` |

(The verdict labels are kept from the previous shape so dashboards and downstream readers don't have to change. Their meaning has shifted from "render-failure detection" to "visual regression vs base" — the artifact itself carries the actual diff details.)

If the skill exited non-zero or any of its three validators (`validate-coverage.sh`, `validate-observations.sh`, `validate-report.sh`) failed, treat the run as failed: emit `update_queue_metadata` with `runtime.directives.visual-smoke-check = { status: "failed", reason: "<short reason>", last_evaluated_commit: <HEAD>, output_log: "<path>" }`, emit `message_worker` with the failure framing (still informational, still do-not-act), and exit. Do **not** call `flag_for_user`; this is a directive-internal failure, not user-actionable.

### 4. Post message to the worker session

Emit `message_worker` with text exactly in this shape (substitute values):

```
[visual-smoke-check] Informational report — do NOT take action.

A render-level smoke check ran against your recent work in the review stage.

Verdict: <overall_verdict>
Routes checked: <N>
Artifact: <path-to-html-file>

This message is informational only. The user will review the artifact and decide whether to push any findings back to you. Do not modify code in response to this message. Continue waiting in review.

If verdict is rendered_with_issues or failed_to_render, the artifact contains per-route screenshots, console logs, and the specific render-failure signals observed.
```

Substitute `<overall_verdict>` with the verdict from Section 3, `<N>` with `len(variants)`, `<path-to-html-file>` with `$FINAL_DIR/report.html`.

The "do not take action" framing is critical — the worker session is an autonomous Claude Code agent that will otherwise treat any inbound message as a task assignment. Do not paraphrase this template; substitute values, leave everything else verbatim.

### 5. Update queue metadata

Emit `update_queue_metadata` with:

```json
{
  "runtime.directives.visual-smoke-check": {
    "status": "completed",
    "evaluated_commit": "<HEAD short SHA>",
    "last_evaluated_commit": "<HEAD short SHA>",
    "evaluated_at": "<ISO 8601 timestamp>",
    "verdict": "rendered_ok" | "rendered_with_issues" | "failed_to_render" | "no_routes_resolved",
    "artifact_path": "<absolute path to report.html>",
    "totals": { "PASS": N, "CLOSE": N, "FAIL": N, "SKIPPED": N, "coverage_percent": N },
    "routes_checked": ["<url-1>", "<url-2>", ...],
    "findings": [
      {
        "variant": "<slug>",
        "url": "<url>",
        "status": "PASS|CLOSE|FAIL",
        "diff_percent": <number>,
        "notes": "<concrete observation from coverage.json>"
      }
    ]
  }
}
```

Populate `totals`, `routes_checked`, and `findings` directly from `coverage.json` — do not recompute them. If `coverage.json` carries a top-level `skipped` array, include it as `findings_skipped`.

### 6. Cleanup

The `visual-regression` skill manages its own Playwright lifecycle (close session, organize `.playwright-mcp/` artifacts). The directive should NOT re-run `playwright-cli close && playwright-cli delete-data && rm -rf .playwright-cli/` on top of that — let the skill own its cleanup. If a stale `.playwright-cli/` directory is present in the worktree from an older directive version, remove it once and move on.

---

## Configuration and constants

- **Output root**: `~/Desktop/visual-smoke-checks/<item-id>/<YYYYMMDD-HHMMSS>-<commit-short>/`. Created on demand each cycle.
- **Sandbox staging root**: `<worktree>/.playwright-mcp/regression-<item-id>-<commit-short>/`. Removed after the `mv` to the final path.

Route caps, dev-server timeouts, auth flow, and capture details are owned by the skill — see `visual-regression`'s SKILL.md for current values.

---

## What this directive does NOT do (delegated to the skill)

- Dev-server bootstrap, readiness polling, log capture → `browsing-babylist` preflight.
- Route discovery and interaction sequencing → `map-routes` + `map-interactions`.
- Screenshot capture, viewport handling, scroll-into-view → `frame-capture`.
- Dimension normalization, pixel diffing → `normalize-image` + `pixel-diff`.
- HTML report authoring, base64 embedding, lightbox, validator gates → `visual-report` (composed with `present-html` styling).
- Intent-vs-plan Opus analysis → out of scope for this iteration. The pixel diff plus the concrete `notes` field on each variant is the signal. If that proves insufficient in practice, file a follow-up to layer an Opus pass on top of the skill's output — do not bolt it back on here.
