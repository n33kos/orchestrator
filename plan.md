# Orchestrator Implementation Plan

## Phase 1: Foundation

Core infrastructure for the plugin, work queue, and environment abstraction.

### 1.1 Plugin Scaffolding
- Initialize as Claude Code plugin with manifest.json
- Define skill stubs (status, add-work, prioritize)
- Set up config directory and source configuration format
- Initialize git repo

### 1.2 Environment Configuration
- Define `config/environment.yml` for site-specific values (see [Environment Config](#environment-configuration) below)
- All CLAUDE.md instructions, scripts, and skills reference config keys rather than hardcoded paths
- Provide a default environment template for new users
- Validate environment config on startup and surface missing/invalid values clearly

### 1.3 Work Queue System
- Define work item schema (source, title, description, priority, status, metadata)
- Implement queue storage (start with JSON file, path from environment config)
- Implement priority sorting logic (explicit priority + user overrides + orchestrator judgment)
- Create dashboard markdown generator — temporary UI until web dashboard is built

### 1.4 Worktree + Session Management
- Formalize the create/spawn/teardown workflow using environment config for CLI paths
- Add queue-aware activation: pick highest priority queued item when a slot opens
- Implement concurrency limiter (default from environment config)
- Add health monitoring: detect zombie sessions and auto-recover

## Phase 2: Work Discovery

Polling infrastructure to automatically discover new work items.

### 2.1 Poller Script
- Create `scripts/poller.sh` (or Python equivalent)
- Run manually first; optionally schedule via cron later
- Parse configured sources and extract work items
- Deduplicate against existing queue entries
- Log new discoveries

### 2.2 Source Adapters
- **Markdown files**: Parse plan files for actionable items
- **Jira**: Query boards/filters via Jira MCP or API for assigned/prioritized tickets
- **GitHub Issues**: Query repos for labeled issues
- **Google Docs**: Parse documents via API for structured work items
- Each adapter returns normalized work items matching the queue schema

### 2.3 Source Configuration
- Define `config/sources.yml` format for specifying:
  - Source type (markdown, jira, github, google-docs, etc.)
  - Connection details (paths, board IDs, labels, filters)
  - Polling interval (if scheduled)
  - Priority mapping rules
  - Priority import: pull priorities directly from source or manually override

## Phase 3: Delegator System

The delegator is the quality assurance brain — a digital clone of the user's review process.

### 3.1 User Profile Training System

The delegator's effectiveness depends on accurately modeling how the user thinks about code quality, communicates with workers, and prioritizes issues. This is achieved through a training system that observes real interactions and distills them into a living profile.

#### Training Mode
- Activated via environment config flag (`delegator.training_mode: true`)
- A hook fires after every voice relay exchange between the user and a worker session
- The hook triggers a lightweight Claude instance (can be spun up and torn down per interaction)
- The training agent receives the interaction context and updates the user profile

#### Data Sources for Training
- **Voice relay transcripts**: Every message exchanged between user and worker sessions
- **Claude session transcripts**: The full JSONL session files at `~/.claude/projects/*/` contain the complete back-and-forth including tool calls, code changes, and reasoning — these are the richest data source
- **Commit history**: What the user asked for vs. what was actually committed
- **PR review comments**: The user's review feedback on worker-generated PRs

#### Profile Distillation Process
1. After each interaction (or periodically), the training agent reads the latest transcript data
2. Extracts patterns: what the user asks about, what they care about, how they communicate, what they flag as issues, what they praise
3. Checks the existing profile for redundancy — only adds genuinely new insights
4. Updates the profile document with structured, actionable instructions
5. Maintains an honest, accurate representation — not aspirational, but reflective of actual behavior

#### Profile Document
- Location: `~/.claude/orchestrator/profile.md` (user-specific, not committed to repo)
- Structured sections: communication style, quality priorities, common review patterns, domain-specific concerns, things the user always checks, things the user rarely cares about
- Designed to be read by the delegator agent as its behavioral instructions
- Can be manually edited by the user to correct or refine

#### Pre-seeding
- On first setup, the training system can mine existing Claude session transcripts to bootstrap the profile
- Scans all available JSONL session files for patterns in user messages
- Generates an initial profile draft for user review and approval

### 3.2 Delegator Agent

The delegator is a Claude instance that acts as the user's proxy reviewer for each project work stream.

#### Communication with Workers
- **Text-based messaging** via the relay CLI or direct tmux injection — not voice (avoids Whisper/Kokoro overhead)
- The delegator can send messages to workers the same way the user would
- Workers see delegator messages as standard relay input and respond naturally
- The orchestrator can optionally allow the user to "cut in" on any delegator-worker conversation at will

#### What the Delegator Does
- Reviews commits as the worker makes them
- Validates implementations against the approved plan
- Asks the worker clarifying questions (just like the user would)
- Checks PRs for correctness, completeness, and style
- Runs targeted tests to verify changes
- Reports blocking issues back to the orchestrator
- Uses Conventional Comments for all structured feedback

#### What the Delegator Does NOT Do
- Make code changes directly (it's a reviewer, not an implementer)
- Approve PRs without user sign-off (unless configured to auto-approve)
- Override the user's explicit instructions to a worker

#### Delegator Lifecycle
1. Orchestrator activates a project work stream
2. Orchestrator spins up a delegator instance for that stream
3. Delegator loads the user profile + the implementation plan for the work item
4. Delegator monitors the worker's activity (git commits, session transcripts, relay messages)
5. Delegator intervenes when needed (questions, issues, feedback)
6. When the worker signals completion, delegator performs a final review
7. Delegator reports its assessment to the orchestrator (approve / needs-work / blocked)
8. Orchestrator tears down the delegator when the work stream completes

#### Toggling Delegators
- User can enable/disable delegators per work stream via the dashboard or CLI skills
- Default behavior configurable in environment config (`delegator.enabled_by_default: true`)
- Delegators can be toggled on/off per work stream without losing context

### 3.3 Plan Generation
- When activating a queued item, generate an implementation plan
- Present plan for user approval (or auto-approve if configured)
- Pass approved plan to both worker session and delegator as initial context

### 3.4 Progress Monitoring
- Track work stream progress (commits made, tests passing, PR status)
- Update dashboard with real-time status
- Detect stalled streams and alert user
- Auto-complete streams when PR is merged

### 3.5 User Interaction Points
- Orchestrator can ask user questions via voice relay when needed
- Priority changes can be made via dashboard or skill commands
- User can move work streams to review or complete/cancel them
- User can cut into any delegator-worker conversation
- Configurable autonomy level (ask before activating vs. auto-activate)

## Phase 4: Web Dashboard

A dedicated web interface for the orchestrator — the user's command center.

### 4.1 Core Dashboard
- Standalone web app (separate from voice multiplexer, potential future integration)
- Real-time view of all work streams: queued, active, review, completed
- Visual priority ordering with drag-and-drop reordering
- Work stream detail view: plan, commits, PR links, delegator status, worker status

### 4.2 Work Management
- Add new work items manually (title, description, priority, type)
- Import priorities from any configured source (Jira, Google Docs, GitHub)
- Bulk operations: activate all, complete all, reprioritize
- Filter and search across all work items

### 4.3 Delegator Controls
- Toggle delegators on/off per work stream
- View delegator-worker conversation transcripts
- Cut into any conversation (sends message as the user)
- See delegator's assessment of each work stream

### 4.4 PR & Review Surface
- List of work streams in "review" status with direct PR links
- Delegator's review summary for each PR
- One-click to open PR in browser
- Status indicators: ready for review, changes requested, approved, merged

### 4.5 Metrics & History
- Time-to-completion per work type
- Work stream history with full lifecycle timeline
- Delegator accuracy metrics (did it catch what the user would have caught?)

## Phase 5: Polish & Scale

Refinement and scaling capabilities.

### 5.1 Scheduling
- Convert poller to cron job or launchd daemon
- Add configurable polling intervals per source
- Add quiet hours / work hours configuration

### 5.2 Voice Multiplexer Integration (Future)
- Optionally embed orchestrator dashboard into voice multiplexer web app
- Unified interface for both communication and work management
- Deep linking between voice sessions and work streams

### 5.3 Multi-Repo Support *(partially implemented)*
- ~~Support work items across different repositories~~ ✓ metadata.repo_path
- ~~Configure worktree manager targets per work item~~ ✓ activate-stream.sh cross-repo
- Handle cross-repo dependencies
- Configurable worktree commands (defaults to git worktree, overridable in environment.local.yml)

### 5.5 Worker Completion Automation
- Workers self-report completion via API endpoint or vmux message
- Orchestrator auto-marks work items as complete when worker reports done
- Optional: detect git push events and auto-complete quick fixes
- Optional: webhook-based completion for CI/CD integration

### 5.4 Learning & Optimization
- Track time-to-completion per work type
- Optimize concurrency limits based on system resources
- Learn priority patterns from user overrides
- Continuously refine delegator profile from ongoing interactions

---

## Environment Configuration

All site-specific values are abstracted into environment config rather than hardcoded. This makes the orchestrator portable across different setups.

```yaml
# config/environment.yml

# Identity
user:
  initials: me
  name: Your Name

# Repository
repo:
  path: ~/my-project                    # Main repository path
  worktree_prefix: ~/my-project-        # Worktree directory pattern

# CLI Tools
tools:
  vmux: ~/.local/bin/vmux                 # Voice session management CLI
  graphite: gt                            # Stacked PR CLI (optional)

# Orchestrator State
state:
  queue_file: ~/.claude/orchestrator/queue.json
  dashboard_file: ~/.claude/orchestrator/dashboard.md
  profile_file: ~/.claude/orchestrator/profile.md

# Concurrency
concurrency:
  max_active_projects: 2
  quick_fix_limit: unlimited
  queue_strategy: priority                # priority | fifo

# Autonomy
autonomy:
  auto_activate: false
  auto_approve_plans: false
  ask_before_teardown: true

# Delegator
delegator:
  enabled_by_default: true                # Spin up delegator for new projects
  training_mode: true                     # Capture interactions for profile training
  communication: text                     # text | voice (text recommended)

# Branch Naming
branches:
  pattern: "{initials}/{domain}/{project}/{position}/{description}"
```

## Source Configuration

```yaml
# config/sources.yml
sources:
  react-18-plan:
    type: markdown
    path: ~/Desktop/Plans/react-18-upgrade-plan.md
    polling: manual  # or "cron: */30 * * * *"

  team-board:
    type: jira
    board: CONSUMER
    filter: "assignee = currentUser() AND status != Done"
    priority_mapping:
      Highest: 1
      High: 2
      Medium: 3
      Low: 4

  github-issues:
    type: github
    repo: owner/repo
    labels: ["agent/claude-code"]
    priority_mapping:
      P0: 1
      P1: 2

concurrency:
  max_active_projects: 2
  quick_fix_limit: unlimited
  queue_strategy: priority
```

## Work Item Schema (Draft)

```json
{
  "id": "uuid",
  "source": "react-18-plan",
  "title": "Enzyme Migration - Consumer Registry",
  "description": "Convert 30 enzyme test files to RTL in registry/",

  "priority": 1,
  "status": "queued",
  "branch": "me/react-18/enzyme-migration/1/consumer-registry",
  "worktree_path": null,
  "session_id": null,
  "delegator_id": null,
  "delegator_enabled": true,
  "created_at": "2026-02-28T00:00:00Z",
  "activated_at": null,
  "completed_at": null,
  "metadata": {
    "source_ref": "## Enzyme Files by Code Owner > @myorg/team-name",
    "estimated_files": 30,
    "reviewer": "@myorg/team-name"
  }
}
```

## User Profile Schema (Draft)

```markdown
# User Profile — {user.name}

## Communication Style
- [Observed patterns in how the user communicates with workers]

## Quality Priorities
- [What the user consistently checks and cares about]

## Common Review Patterns
- [Recurring feedback themes across sessions]

## Domain-Specific Concerns
- [Per-project or per-area things the user always looks for]

## Things Always Checked
- [Invariants the user never skips]

## Things Rarely Flagged
- [Areas the user trusts and doesn't micro-manage]

## Interaction Examples
- [Representative exchanges that capture the user's style]
```
