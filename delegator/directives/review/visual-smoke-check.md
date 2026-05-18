---
name: visual-smoke-check
enabled: true
required: false
max_retries: 0
depends_on: null
---

# Visual smoke-check directive

Runs in the `review` status on every cycle. Boots the target repo's dev server (if needed), captures Playwright screenshots of the routes the worker's changes touch, asks the delegator's vision pass to flag render-level breakage only (blank screen, 500 page, JS crash, layout collapsed), produces a self-contained HTML report artifact on the desktop, and posts an informational message back to the worker session linking to the artifact. The user reviews the artifact and decides whether to push findings back to the worker — this directive **never** transitions the item back to `active`, never modifies code, and never instructs the worker to take corrective action.

---

## Behavioral contract — read this first

- The directive is **observational**. It posts findings; it does not act on them.
- The worker session receives a message that explicitly states "**Do not take action on these findings — the user will decide.**" The worker should NOT auto-modify code in response to this message.
- The user decides whether to push the artifact's findings back into the worker. That action is manual.
- The directive does **not** call `trigger_review_transition` and does **not** bump status `review → active`.
- The vision pass is constrained to *render failure* signals — blank viewport, error stack trace shown to the user, "Something went wrong" boundary, 500 page, layout collapsed to zero width, missing critical content. It does NOT judge whether a styling change is intentional, whether colors are correct, or whether the design matches Figma. Those judgments belong to the human reviewer.

---

## Step-by-step instructions per cycle

### 1. Eligibility gates

In order. Exit at the first that fails.

1. **Dev-URL discoverability gate.** Determine the dev URL for this worktree dynamically. Order:
   1. Per-repo override: read `~/orchestrator/config/environment.yml` (and `environment.local.yml`) for the worktree's repo entry. If `worktree.dev_url` is set, use it.
   2. Repo conventions: read `package.json` (`scripts.dev` / `scripts.start` — infer port if `vite`/`webpack-dev-server`/`next dev` style) and any `README.md` / `CONTRIBUTING.md` "Running locally" section.
   3. Repo conventions for known hosts: if the repo includes `babylist-web`'s setup, the URL is `https://babylist.test/` (or the worktree-specific subdomain `<worktree-name>.test` when `environment.use_worktree` is true).
   4. Fallback: `http://localhost:<port>` from whatever the start command would bind to.
   
   If nothing produces a usable URL after all four passes, emit `update_queue_metadata` with `runtime.directives.visual-smoke-check = { status: "skipped", reason: "no_dev_url_discoverable", evaluated_commit: <HEAD> }` and exit. Record the discovery attempts in the artifact log so we learn which repos need explicit `worktree.dev_url` config.

2. **Same-commit gate.** Read `runtime.directives.visual-smoke-check.last_evaluated_commit` from the previous payload. If it equals the current `HEAD` of the worktree, exit silently. The state hasn't changed since the last evaluation.

3. **Frontend-diff gate.** Run `git diff <last_evaluated_commit_or_origin/main>...HEAD --name-only` in the worktree. If no path matches `\.(tsx?|jsx?|scss|css)$` under `app/assets/javascripts/`, emit `update_queue_metadata` with `status: "skipped", reason: "no_frontend_changes", last_evaluated_commit: <HEAD>` and exit. The item didn't change anything visual; no smoke check is warranted.

### 2. Dev-server bootstrap

The user does not keep a dev server running by default, and neither does the worker. The directive starts the dev server itself.

1. **Check for an existing server.** `curl -sf -o /dev/null -m 3 <dev_url>/` against the worktree's dev URL. If it responds with any HTTP status (including 4xx — the server is up, the route just doesn't exist yet), proceed to Section 3 with this existing server. Do not start another.

2. **Determine the start command.** Read the worktree's `package.json` (`scripts` section), any `README.md` or `CONTRIBUTING.md`, and any orchestrator-aware config like `~/orchestrator/config/environment.yml`'s `worktree.dev`. For `babylist-web`, the conventional path is the `rostrum dev` command run from the worktree directory — but verify against the actual repo before committing to it.

3. **Start the server in the background.** Launch the command via `nohup ... &` (or `setsid` — whatever cleanly detaches), capture the PID, redirect stdout/stderr to `~/.claude/orchestrator/delegators/<item-id>/visual-smoke-check/dev-server.log`. Remember the PID — you'll kill it at the end of the cycle.

4. **Wait for readiness.** Poll `curl -sf -m 5 <dev_url>/` every 5 seconds for up to 90 seconds per attempt. While the server is starting, the curl will fail or timeout — that is **not a failure**, it is loading. Only count an "attempt" as failed when:
   - the dev-server process has exited (check via the PID), OR
   - the dev-server log shows an obvious startup error (`EADDRINUSE`, `Cannot find module`, fatal compilation error visible in the log), OR
   - 90 seconds have passed without any HTTP response.

5. **Retry up to 3 attempts.** If an attempt fails per the criteria above, kill any lingering PID, wait 5 seconds, restart. After 3 failed start attempts, give up: emit `update_queue_metadata` with `runtime.directives.visual-smoke-check = { status: "failed", reason: "dev_server_could_not_start", evaluated_commit: <HEAD>, dev_server_log_path: "<path>" }`, emit `message_worker` (per Section 7's framing — informational, do not act, see the log), and exit. Do **not** call `flag_for_user`; this is a directive-internal failure, not a user-actionable escalation.

### 3. Route discovery

Use the `visual-testing/map-routes` skill to trace changed frontend files back to the URLs that render them. If a changed component requires interaction to appear (drawer open, hover, click sequence), invoke `visual-testing/map-interactions` for that component.

Cap at 5 routes per cycle. If discovery returns more, prioritize by directness (the route whose primary component file is in the diff before the route whose grandchild is in the diff) and record the rest in `findings.routes_skipped`.

If discovery returns zero routes, that is itself a finding — record `verdict: "no_routes_resolved"` and proceed to artifact generation. The user may still want to know the change is unreachable from the route map.

### 4. Screenshot capture

For each route:

1. Launch a fresh Playwright session via `playwright-cli open --browser=chrome <dev_url><route>`.
2. Authenticate if the route requires it. The local-dev credentials live in `~/.claude/knowledge/frontend-visual-validation.md`.
3. Apply the interaction sequence from `map-interactions` if any.
4. Capture a full-page screenshot to `~/.claude/orchestrator/delegators/<item-id>/visual-smoke-check/<commit-short>/<route-slug>.png`.
5. Capture browser console output via `playwright-cli console` to the same directory as `<route-slug>.console.log`.
6. Close the Playwright session before moving to the next route to avoid state bleed.

After all routes are captured, run `playwright-cli close && playwright-cli delete-data && rm -rf .playwright-cli/`.

### 5. Vision pass — intent-vs-actual analysis (Opus)

Run an Opus analysis pass over the captured screenshots, with full context about what the worker was supposed to build. This is the core review step.

Gather the inputs the Opus call needs:

- The plan file content (read from `item_context.plan.file`, or `~/.claude/orchestrator/plans/<item-id>.md`).
- The git diff for the evaluated commit range: `git diff <last_evaluated_commit_or_origin/main>...HEAD` in the worktree. Include both the file list and a representative slice of the actual code changes (cap at ~4000 lines of diff — truncate the largest files first if it overflows).
- The `map-routes` and `map-interactions` outputs from Section 3, so Opus knows what each screenshot is supposed to represent and how it was reached.
- The screenshots themselves (Read tool loads PNGs inline as image content; Opus is multimodal).
- Each route's `console.log` contents.

Apply this prompt to the assembled context:

> You are reviewing a screenshot of a UI change in the review stage. Your job is to determine whether what was built matches what was supposed to be built, AND whether it renders without obvious failure.
>
> Inputs you have:
> - The implementation plan describing what the worker was asked to build.
> - The git diff showing what the worker actually changed.
> - The route map showing what URL this screenshot represents and the interaction sequence used to reach this state.
> - The screenshot itself.
> - The browser console log for this route.
>
> Analyze:
>
> **1. Render layer** — Is the page broken at the render layer? Blank viewport, error stack trace, "Something went wrong" boundary, 500 page, layout collapsed, critical content missing, console errors / unhandled rejections.
>
> **2. Intent layer** — Does the visible result appear consistent with what the plan and diff describe? Examples of concerns:
> - Plan says "add a new component on the registry home page" but the screenshot shows the registry home unchanged.
> - Diff removes a prop the plan said to keep.
> - Plan describes specific visual treatment (e.g. "selected state shows an inner 2px border") and the screenshot's selected element doesn't appear to have that treatment.
> - Diff appears to have unintended scope (touches a section the plan didn't mention, and the section looks broken or different).
>
> **Calibration**: be honest about what you can and can't tell from a screenshot. If the plan describes a color value and the screenshot looks "about right" to you, that is a PASS — don't speculate about whether the hex is exactly correct. Trust the worker on numeric values you can't verify from a static image. Flag only concerns where the visible evidence clearly contradicts intent.
>
> Return a verdict for each screenshot. Verdicts:
> - `looks_correct` — renders cleanly and appears consistent with the plan and diff.
> - `concerns_noted` — renders but there are specific observations worth surfacing to the user (intent mismatch, render warning, console error, etc.). Always include the specific signals.
> - `failed_to_render` — render failure as defined in the "Render layer" section. Always include the specific signals.
>
> For every verdict that isn't `looks_correct`, include:
> - A short list of specific signals (each one observable in the screenshot or console log — no speculation).
> - A short recommendation aimed at the human reviewer (one or two sentences). Frame as "the user may want to confirm X" or "consider whether Y was intentional." Never frame as an instruction to the worker.
>
> Do not produce a code-level fix. Do not write code. Your output is a review note, not a remediation.

Run this prompt per screenshot, then collect the per-route verdicts into the overall verdict for the artifact:

- `looks_correct` if every route is `looks_correct`.
- `concerns_noted` if any route is `concerns_noted` but none failed to render.
- `failed_to_render` if any route is `failed_to_render`.
- `no_routes_resolved` if discovery returned empty.

Be deliberate about cost: this is an Opus call with multiple images and significant context per cycle. The directive's same-commit gate (Section 1, item 2) ensures we don't re-run on identical state. If the diff is enormous (e.g. a sweeping refactor), prioritize the most-changed files in the diff slice handed to Opus.

### 6. Artifact generation (this IS the dashboard)

The HTML artifact is the visual smoke check's primary surface — it carries the full history of every cycle's findings, all screenshots inlined and visible, all Opus analysis preserved. The user opens this file to see everything the directive ever saw.

Produce two files:

**A. Per-cycle report** at `~/Desktop/visual-smoke-checks/<item-id>/<YYYYMMDD-HHMMSS>-<commit-short>.html`.

Mirror the styling conventions of the `plan-html` skill — read `~/.claude/skills/plan-html/` (or the closest equivalent path) before authoring to align CSS, design tokens, dark-mode palette, collapsible sections, and SVG affordances. Inline everything — no external requests, no CDN dependencies. The file must work fully offline.

Structure:

1. Header — item ID, item title (`item_context.title`), worker session ID, evaluated commit (short SHA + full SHA on hover), evaluation timestamp, dev-server start path used, total cycle time, overall verdict pill (`looks_correct` / `concerns_noted` / `failed_to_render` / `no_routes_resolved` / `dev_server_could_not_start`).
2. Summary panel — counts of routes checked vs. routes skipped, list of files in the diff, link back to the per-item index file (described below).
3. Plan excerpt — first 80 lines (or to the first `---` separator) of the plan file, in a collapsible block. Helps the user contextualize the Opus verdicts without leaving the artifact.
4. Per-route section. For each route:
   - The route URL and interaction sequence.
   - The screenshot embedded inline as base64 (`<img src="data:image/png;base64,...">`). Always include — never link out, even if the PNG is large.
   - The Opus verdict for this route.
   - The signals list (when verdict isn't `looks_correct`).
   - The recommendation for the human reviewer (when verdict isn't `looks_correct`).
   - The console log, collapsible, default closed unless verdict is `concerns_noted` or `failed_to_render`.
5. Footer — restate the behavioral contract: "These findings are informational. No code has been modified. The user decides whether to act."

**B. Per-item index** at `~/Desktop/visual-smoke-checks/<item-id>/index.html`.

Updated on every cycle to add the new report. Lists every per-cycle report for this item, newest first, with: evaluation timestamp, commit short SHA, overall verdict pill, route count, one-line summary, link to the per-cycle report. This is what the user opens when they want to see how the item evolved across review cycles.

**C. Top-level index** at `~/Desktop/visual-smoke-checks/index.html`.

Updated on every cycle. Lists every item that has run the directive, with most recently evaluated at the top, linking to each per-item index. This is the user's home view.

Reuse the per-cycle filename in the `message_worker` call (Section 7) and in the queue metadata (Section 8).

### 7. Post message to the worker session

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

The framing of "do not take action" is critical — the worker session is an autonomous Claude Code agent that will otherwise treat any inbound message as a task assignment.

### 8. Update queue metadata

Emit `update_queue_metadata` with:

```json
{
  "runtime.directives.visual-smoke-check": {
    "status": "completed",
    "evaluated_commit": "<HEAD short SHA>",
    "last_evaluated_commit": "<HEAD short SHA>",
    "evaluated_at": "<ISO 8601 timestamp>",
    "verdict": "rendered_ok" | "rendered_with_issues" | "failed_to_render" | "no_routes_resolved",
    "artifact_path": "/Users/<user>/Desktop/visual-smoke-checks/<filename>.html",
    "routes_checked": ["<route-1>", "<route-2>", ...],
    "routes_skipped": ["<route-N+1>", ...],
    "findings": [
      {
        "route": "<url>",
        "verdict": "rendered_ok" | "rendered_with_issues" | "failed_to_render",
        "signals": ["..."],
        "screenshot_path": "<absolute path to png>",
        "console_log_path": "<absolute path to console log>"
      }
    ]
  }
}
```

This is what surfaces in the dashboard's per-item directive panel.

### 9. Cleanup

Always — including on every early-exit and failure path:

1. Kill the dev-server PID if the directive started it. Do NOT kill a dev server that was already running before the directive started (Section 2 step 1).
2. Run `playwright-cli close && playwright-cli delete-data && rm -rf .playwright-cli/` in the worktree.
3. Verify no `.playwright-cli/` directory exists before the directive exits.

---

## Configuration and constants

- **Dev server start timeout per attempt**: 90 seconds.
- **Dev server start attempts**: 3.
- **Inter-attempt wait**: 5 seconds.
- **Curl poll interval during readiness wait**: 5 seconds.
- **Route cap per cycle**: 5.
- **Artifact directory**: `~/Desktop/visual-smoke-checks/`. Create the directory if it doesn't exist on first run.
- **Screenshot directory**: `~/.claude/orchestrator/delegators/<item-id>/visual-smoke-check/<commit-short>/`. One subdirectory per commit so prior runs are preserved for diff reference.

---

## Vision pass scope — what to flag and what to stay out of

**Always flag when visible in the screenshot or console log:**
- Blank or near-blank viewport
- Visible JavaScript error / stack trace
- Visible 500 / 404 page when the route should resolve
- "Something went wrong" / error-boundary fallback content
- Layout collapsed to zero width or zero height
- Critical content visibly missing
- Console errors or unhandled promise rejections
- An intent mismatch the screenshot clearly contradicts — e.g. plan describes a new component on a page; the page screenshot shows nothing new.
- A scope concern from the diff — e.g. diff touches a file the plan didn't mention and the section visibly changed in a way that looks unintended.

**Use judgment, lean toward not flagging unless evidence is clear:**
- Subtle styling differences (slightly different padding, slightly different color shade) — if you can't tell whether it matches the plan from the image, trust the worker.
- Numeric precision claims — the plan saying "12px gap" and the screenshot looking about right is a pass. You can't measure pixels precisely from a screenshot.
- "Looks different from before" without a clear contradiction to plan or diff — change is the whole point of a review-stage item.

**Out of scope entirely (separate tooling exists or is planned):**
- Accessibility issues (semantic HTML, ARIA, contrast precision) — separate a11y tooling.
- Performance issues (bundle size, render time) — separate perf tooling.
- Pixel-perfect Figma comparison — that's `/compare-figma`, a different workflow.
- Code-level review (logic correctness, security, test coverage) — that's the delegator's normal review pass.
