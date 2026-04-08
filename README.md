# Orchestrator

A Claude Code plugin that autonomously manages parallel development work streams. It discovers work from configurable sources, prioritizes tasks, spins up isolated development environments, coordinates multiple Claude sessions working simultaneously, and deploys AI-powered delegators that mirror the user's own review process to ensure quality.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            ORCHESTRATOR                                  │
│                                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────────────┐   │
│  │  Sources  │→ │  Work Queue  │→ │  Resource Manager                │   │
│  │  (config) │  │  (priority   │  │  - Worktree lifecycle            │   │
│  │           │  │   sorted)    │  │  - Session spawning              │   │
│  └──────────┘  └──────────────┘  │  - Delegator management          │   │
│                                   │  - Concurrency limits            │   │
│  ┌──────────┐                     │  - Dependency resolution         │   │
│  │Scheduler │─────────────────→  └──────────────────────────────────┘   │
│  │(launchd) │                              │                             │
│  └──────────┘                              ↓                             │
│                             ┌──────────────────────────────┐            │
│  ┌──────────┐               │     Active Work Streams      │            │
│  │   Web    │               │  ┌──────────┐ ┌──────────┐   │            │
│  │Dashboard │◄──────────────│  │ Stream 1 │ │ Stream 2 │   │            │
│  │  (PWA)   │               │  │┌────────┐│ │┌────────┐│   │            │
│  └──────────┘               │  ││ Worker ││ ││ Worker ││   │            │
│                              │  │└────────┘│ │└────────┘│   │            │
│  ┌──────────┐               │  │┌────────┐│ │┌────────┐│   │            │
│                              │  ││ Deleg. ││ ││ Deleg. ││   │            │
│                              │  │└────────┘│ │└────────┘│   │            │
│                              │  └──────────┘ └──────────┘   │            │
│                              └──────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────┘
```

### Components

- **Orchestrator (this plugin)**: Central brain. Discovers work, manages the queue, spins up/down environments, monitors progress, and coordinates between all moving parts.
- **Scheduler**: A background Python service (launchd) that continuously reconciles queue state — auto-activates ready items, recovers zombie sessions, triggers delegator cycles, enforces planning timeouts, and cleans up completed streams.
- **Worker Sessions**: Individual Claude Code sessions running in isolated git worktrees. These do the actual implementation work.
- **Delegator** (sub-module): Quality assurance layer that mirrors the user's review process. Uses a two-tier model — Haiku triage for routine checks, escalating to Opus for deep reviews. See [`delegator/`](delegator/).
- **Web Dashboard (PWA)**: Dedicated web interface for managing work streams, priorities, delegators, and PR status.

## Quick Start

```bash
# Install dashboard dependencies
cd dashboard && npm install && cd ..

# Ensure queue directory exists
mkdir -p ~/.claude/orchestrator

# Initialize an empty queue if needed
echo '{"version": 1, "items": []}' > ~/.claude/orchestrator/queue.json

# Install the scheduler as a launchd service
./scripts/install-scheduler.sh

# Start the dashboard
cd dashboard && npm run dev
# → http://localhost:3201
```

## Project Structure

```
orchestrator/
├── CLAUDE.md              # Claude Code instructions for the orchestrator agent
├── README.md              # This file
├── manifest.json          # Claude Code plugin manifest (9 skills)
├── plan.md                # Implementation plan
├── config/
│   ├── environment.yml            # Site-specific values (paths, tools, identity)
│   ├── environment.local.yml      # Personal overrides (gitignored)
│   ├── sources.yml                # Work source definitions
│   ├── sources.local.yml          # Personal source overrides (gitignored)
│   └── com.orchestrator.scheduler.plist  # launchd service definition
├── skills/                # CLI skills (slash commands)
│   ├── status.md          # /status — queue overview, sessions, health
│   ├── add-work.md        # /add-work — add item to queue
│   ├── activate.md        # /activate — create worktree + session + delegator
│   ├── teardown.md        # /teardown — kill session, remove worktree
│   ├── discover.md        # /discover — scan sources for new work
│   ├── health.md          # /health — detect zombies and stalls
│   ├── schedule.md        # /schedule — run queue scheduler
│   └── plan.md            # /plan — generate implementation plan
├── scripts/               # Backend scripts
│   ├── activate-stream.sh          # Full stream activation
│   ├── suspend-stream.sh           # Suspend stream (kill session, keep worktree)
│   ├── resume-stream.sh            # Resume suspended stream
│   ├── teardown-stream.sh          # Full stream teardown
│   ├── worker-complete.sh          # Worker self-reports completion
│   ├── spawn-delegator.sh          # Delegator state initialization
│   ├── delegator-preprocess.sh     # Gather monitoring data into JSON payload
│   ├── delegator-postprocess.sh    # Execute actions from delegator output
│   ├── delegator-summarize-transcript.py  # Summarize worker activity for delegator
│   ├── delegator-status.sh         # Delegator instance monitoring
│   ├── health-check.sh             # Zombie/stall/dependency detection
│   ├── status.sh                   # Comprehensive status report
│   ├── discover-work.py            # Work discovery (markdown, GitHub, Jira)
│   ├── generate-plan.sh            # Auto-generate plan for queued item
│   ├── migrate-plans.sh            # Migrate inline plans to markdown files
│   ├── sync-plan-metadata.sh       # Sync metadata headers in plan files
│   ├── read-worker-transcript.py   # Read and summarize session transcripts
│   ├── next-ws-id.sh               # Atomic work stream ID generation
│   ├── emit-event.sh               # Event emission utility
│   ├── parse-config.sh             # Parse environment.yml and export variables
│   ├── validate-env.sh             # Validate environment config
│   ├── setup.sh                    # Initial setup/installation
│   ├── install-scheduler.sh        # Install scheduler as launchd service
│   ├── lib/
│   │   └── queue.py                # Shared queue operations (file-locking)
│   └── scheduler/                  # Background scheduler service
│       ├── __main__.py             # Main loop (continuous or one-shot)
│       ├── config.py               # Configuration loader
│       ├── reconcile.py            # State reconciliation and auto-activation
│       ├── activate.py             # Activation logic
│       ├── delegator.py            # Delegator monitoring and recovery
│       ├── cleanup.py              # Cleanup operations
│       └── events.py               # Event logging
├── delegator/             # Delegator sub-module
│   ├── README.md          # Delegator documentation
│   ├── triage-instructions.md   # Haiku triage agent instructions
│   └── review-instructions.md  # Opus review agent instructions
├── dashboard/             # Web dashboard (Vite + React + TypeScript + Sass)
│   ├── src/
│   │   ├── App.tsx        # Main application
│   │   ├── components/    # 55 UI components
│   │   ├── hooks/         # 32 custom hooks
│   │   ├── api/           # 11 API endpoint modules
│   │   └── utils/         # 7 utility modules
│   ├── public/            # PWA assets (manifest, service worker, icons)
│   ├── vite.config.ts     # Vite config with inline API middleware
│   └── index.html         # Entry point with PWA meta tags
└── knowledge/
    └── cli-reference.md   # Worktree and vmux command reference
```

## Work Stream Lifecycle

```
Discover → Queue → Plan → Activate → Execute → Review → Complete
```

1. **Discover** — Poller finds new work from configured sources
2. **Queue** — Item added to priority queue with metadata
3. **Plan** — Create and approve an implementation plan (stored as markdown in `~/.claude/orchestrator/plans/`)
4. **Activate** — Worktree created, worker session spawned, delegator started
5. **Execute** — Worker implements the plan; delegator monitors and reviews
6. **Suspend** *(optional)* — Pause execution, kill session but preserve worktree for user review
7. **Resume** *(optional)* — Respawn session and delegator from suspended state
8. **Review** — Delegator performs final review, surfaces PR for user sign-off
9. **Complete** — PR merged, worktree torn down, slot freed for next item

## Queue Schema

Work items are stored in `~/.claude/orchestrator/queue.json`:

```json
{
  "version": 1,
  "items": [
    {
      "id": "ws-001",
      "source": "manual",
      "description": "Short description of the work",

      "priority": 100,
      "status": "queued",
      "branch": "branch-name",
      "session_id": null,
      "delegator_enabled": true,
      "blocked_by": ["ws-000"],
      "pr_url": null,
      "metadata": {
        "plan_file": "~/.claude/orchestrator/plans/ws-001.md",
        "plan": {
          "summary": "...",
          "approved": true,
          "approved_at": "2026-01-01T00:00:00Z"
        },
        "repo_path": "/path/to/target/repo"
      }
    }
  ]
}
```

**Key fields:**
- `blocked_by` — Array of item IDs that must complete before this item can activate. The scheduler resolves dependencies automatically.
- `delegator_enabled` — Per-item toggle for delegator quality assurance.
- `metadata.plan_file` — Path to the markdown plan file (single source of truth for worker context).
- `metadata.plan.approved` — Items with `require_approved_plan` enabled won't activate without approval.

**Statuses:** `queued` → `planning` → `active` → `review` → `completed`

## Scheduler

The scheduler is a continuous Python service managed by launchd (`com.orchestrator.scheduler`). Each cycle it:

1. Recovers zombie sessions and delegators
2. Triggers delegator monitoring cycles (at configurable intervals)
3. Processes worker completion reports
4. Tears down streams with merged PRs
5. Enforces planning timeouts
6. Generates plans for queued items needing them
7. Reconciles queue state (resolves `blocked_by` dependencies)
8. Auto-activates the highest priority ready item when a slot opens
9. Periodically cleans up completed items and rotates logs

**Important**: The scheduler loads Python code at startup and does NOT hot-reload. After code changes:

```bash
launchctl stop com.orchestrator.scheduler && sleep 2 && launchctl start com.orchestrator.scheduler
```

## Delegator Pipeline

For each project work stream, a delegator monitors the worker through a one-shot invocation pipeline:

```
delegator-preprocess.sh → Claude (triage/review) → delegator-postprocess.sh
```

1. **Preprocess** gathers monitoring data into a JSON payload: worker transcript summary, git diff, PR status (including merge state), plan progress, and session health.
2. **Triage** (Haiku) performs a quick assessment — is the worker on track, stalled, or done? Checks for merge conflicts before anything else.
3. **Review** (Opus) is invoked on escalation for deep code review, PR assessment, and quality validation.
4. **Postprocess** executes the resulting actions: send messages to workers, update queue status, trigger transitions.

See [`delegator/README.md`](delegator/README.md) for the delegator documentation.

## Dashboard

The web dashboard is a PWA built with Vite 7, React 19, TypeScript 5.9, and Sass. It serves as the orchestrator's command center.

### Features

- **Queue Management**: Add, edit, delete, reorder work items with drag-and-drop
- **Dependency Tracking**: Visual `blocked_by` indicators with inline editing
- **4 View Modes**: Cards, compact table, grouped by status, kanban board
- **Planning Workflow**: Create plans with steps, approve before activation
- **Stream Control**: One-click activate, suspend, resume, and teardown
- **Session Management**: View sessions, send messages, kill/reconnect zombies
- **Delegator Panel**: Monitor delegator instances, view assessments, spawn/kill
- **PR Tracking**: GitHub PR status badges with review state and check results
- **Health Monitoring**: Zombie detection, stall alerts, auto-recovery
- **Scheduler Log**: View scheduler events and cycle history
- **Work Discovery**: Scan GitHub Issues and markdown plans for new work
- **Command Palette**: Cmd+K for quick access to all actions
- **Batch Operations**: Multi-select items for bulk status changes
- **Import/Export**: JSON and CSV export, JSON import, file drop support
- **Browser Notifications**: Status change alerts with optional sound effects
- **Keyboard Navigation**: Vim-style J/K, tab switching, shortcut sheet
- **Dark/Light Theme**: System-aware with manual toggle
- **Offline Support**: Service worker with network-first caching

### API Endpoints (vite.config.ts)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/queue` | GET | Read the queue |
| `/api/queue/add` | POST | Add a work item |
| `/api/queue/update` | PATCH | Update item fields (with metadata merge) |
| `/api/queue/delete` | DELETE | Remove a work item |
| `/api/queue/reorder` | PATCH | Drag-reorder with priority renumbering |
| `/api/queue/blocked-by/update` | PATCH | Update blocked_by dependencies |
| `/api/sessions` | GET | List vmux sessions |
| `/api/sessions/send` | POST | Send message to a session |
| `/api/sessions/kill` | POST | Kill a session |
| `/api/sessions/reconnect` | POST | Reconnect a zombie session |
| `/api/stream/activate` | POST | Full stream activation |
| `/api/stream/teardown` | POST | Full stream teardown |
| `/api/health` | GET | Health check (JSON) |
| `/api/discover` | POST | Trigger work discovery |
| `/api/delegators` | GET | Delegator status |
| `/api/delegators/spawn` | POST | Spawn a delegator |
| `/api/pr-status` | GET | Fetch GitHub PR metadata |
| `/api/scheduler/run` | POST | Run the queue scheduler |

## Configuration

### `config/environment.yml`

All site-specific values. Override with `config/environment.local.yml` (gitignored). The `parse-config.sh` script merges both — local values take precedence.

| Section | Key Settings |
|---------|-------------|
| `user` | `initials`, `name` |
| `repo` | `path`, `worktree_prefix` |
| `tools` | `vmux`, `graphite` |
| `worktree` | `setup`, `setup_quick`, `teardown`, `list`, `dev` (command templates) |
| `state` | `queue_file` |
| `concurrency` | `max_active` (2), `queue_strategy` |
| `autonomy` | `auto_activate`, `auto_approve_plans`, `require_approved_plan`, `ask_before_teardown` |
| `artifacts` | `artifacts_directory` |
| `delegator` | `enabled_by_default`, `cycle_interval`, `default_model` (haiku), `review_model` (opus), `transcript_lines_triage`/`_deep` |
| `branches` | `pattern` (naming template) |
| `dashboard` | `port` (3201) |
| `scheduler` | `poll_interval` (120s), `cleanup_every`, `archive_after_days` |
| `stall_detection` | `threshold_minutes` (30) |

### `config/sources.yml`

Defines where the orchestrator discovers work. Supported adapters:
- `markdown` — Parse task items from markdown plan files
- `github` — Poll GitHub Issues via `gh` CLI
- `jira` — Jira integration (requires jira CLI/API)

## Dependencies

- **Worktree commands** — Configurable worktree lifecycle (defaults to `git worktree`, overridable in `environment.local.yml`)
- **vmux** — Claude Code session spawning and management (voice multiplexer)
- **Claude Code** — Worker and delegator sessions
- **gh** — GitHub CLI for PR status and issue discovery
- **Node.js 20+** — Dashboard runtime
- **Python 3.10+** — Scheduler, discovery, and training scripts
- **launchd** — macOS service manager for the scheduler daemon
