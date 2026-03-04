# Orchestrator

A Claude Code plugin that autonomously manages parallel development work streams. It discovers work from configurable sources, prioritizes tasks, spins up isolated development environments, coordinates multiple Claude sessions working simultaneously, and deploys AI-powered delegators that mirror the user's own review process to ensure quality.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR                                │
│                                                                       │
│  ┌──────────┐  ┌──────────────┐  ┌─────────────────────────────────┐ │
│  │  Poller  │→ │  Work Queue  │→ │  Resource Manager               │ │
│  │ (script) │  │  (priority   │  │  - Worktree lifecycle           │ │
│  │          │  │   sorted)    │  │  - Voice session spawning       │ │
│  └──────────┘  └──────────────┘  │  - Delegator management         │ │
│       ↑                          │  - Concurrency limits           │ │
│       │                          └─────────────────────────────────┘ │
│  ┌──────────┐                              │                          │
│  │  Sources │                              ↓                          │
│  │ (config) │               ┌──────────────────────────────┐         │
│  └──────────┘               │     Active Work Streams      │         │
│                             │  ┌──────────┐ ┌──────────┐   │         │
│  ┌──────────┐               │  │ Stream 1 │ │ Stream 2 │   │         │
│  │   Web    │               │  │┌────────┐│ │┌────────┐│   │         │
│  │Dashboard │◄──────────────│  ││ Worker ││ ││ Worker ││   │         │
│  │  (PWA)  │               │  ││ Claude ││ ││ Claude ││   │         │
│  └──────────┘               │  │└────────┘│ │└────────┘│   │         │
│                             │  │┌────────┐│ │┌────────┐│   │         │
│  ┌──────────┐               │  ││ Deleg. ││ ││ Deleg. ││   │         │
│  │ Profile  │───────────────│  │└────────┘│ │└────────┘│   │         │
│  │Training │               │  └──────────┘ └──────────┘   │         │
│  └──────────┘               └──────────────────────────────┘         │
└───────────────────────────────────────────────────────────────────────┘
```

### Components

- **Orchestrator (this plugin)**: Central brain. Discovers work, manages the queue, spins up/down environments, monitors progress, and coordinates between all moving parts.
- **Worker Sessions**: Individual Claude Code sessions running in isolated git worktrees. These do the actual implementation work.
- **Delegator** (sub-module): Quality assurance layer that mirrors the user's review process. Reviews worker output, checks PRs, validates implementations, and communicates with workers via text-based messaging. See [`delegator/`](delegator/).
- **Profile Training System**: Observes user-worker interactions and distills them into a behavioral profile that instructs the delegator how to act.
- **Web Dashboard (PWA)**: Dedicated web interface for managing work streams, priorities, delegators, and PR status.

## Quick Start

```bash
# Install dashboard dependencies
cd dashboard && npm install && cd ..

# Ensure queue directory exists
mkdir -p ~/.claude/orchestrator

# Initialize an empty queue if needed
echo '{"version": 1, "items": []}' > ~/.claude/orchestrator/queue.json

# Start the dashboard
cd dashboard && npm run dev
# → http://localhost:3201
```

## Project Structure

```
orchestrator/
├── CLAUDE.md              # Claude Code instructions for the orchestrator agent
├── README.md              # This file
├── manifest.json          # Claude Code plugin manifest with 8 skills
├── plan.md                # Implementation plan
├── delegator/             # Delegator sub-module
│   ├── CLAUDE.md          # Delegator agent instructions (monitoring loop)
│   └── README.md          # Delegator documentation
├── dashboard/             # Web dashboard (Vite + React + TypeScript + Sass)
│   ├── src/
│   │   ├── App.tsx        # Main application (1000+ lines)
│   │   ├── components/    # 54+ UI components
│   │   ├── hooks/         # 20+ custom hooks
│   │   └── utils/         # Utility functions
│   ├── public/            # PWA assets (manifest, service worker, icons)
│   ├── vite.config.ts     # Vite config with 21 API endpoints
│   └── index.html         # Entry point with PWA meta tags
├── skills/                # CLI skills (slash commands)
│   ├── status.md          # /status — queue overview, sessions, health
│   ├── add-work.md        # /add-work — add item to queue
│   ├── activate.md        # /activate — create worktree + session
│   ├── teardown.md        # /teardown — kill session, remove worktree
│   ├── discover.md        # /discover — scan sources for new work
│   ├── health.md          # /health — detect zombies and stalls
│   ├── schedule.md        # /schedule — auto-activate ready items
│   └── train.md           # /train — update delegator profile
├── scripts/               # Backend scripts
│   ├── activate-stream.sh # Full stream activation (worktree + session + delegator)
│   ├── teardown-stream.sh # Full stream teardown (preserves git branch)
│   ├── spawn-delegator.sh # Delegator session spawning
│   ├── health-check.sh    # Zombie/stall/dependency detection
│   ├── scheduler.sh       # Auto-activation with concurrency management
│   ├── status.sh          # Comprehensive status report
│   ├── delegator-status.sh# Delegator instance monitoring
│   ├── discover-work.py   # Work discovery (markdown, GitHub, Jira)
│   ├── train-profile.py   # Incremental profile training
│   └── preseed-profile.py # Bootstrap profile from session history
└── config/
    ├── environment.yml    # Site-specific values (paths, tools, identity)
    └── sources.yml        # Work source definitions
```

## Dashboard

The web dashboard is a PWA built with Vite 7, React 19, TypeScript 5.9, and Sass. It serves as the orchestrator's command center with 21 REST API endpoints that shell out to the backend scripts.

### Features

- **Queue Management**: Add, edit, delete, reorder work items with drag-and-drop
- **4 View Modes**: Cards, compact table, grouped by status, kanban board
- **Planning Workflow**: Create plans with steps, approve before activation
- **Stream Control**: One-click activate (worktree + session) and teardown
- **Session Management**: View sessions, send messages, kill/reconnect zombies
- **PR Tracking**: GitHub PR status badges with review state and check results
- **Health Monitoring**: Zombie detection, stall alerts, auto-recovery
- **Work Discovery**: Scan GitHub Issues and markdown plans for new work
- **Training Controls**: Bootstrap and incrementally train the delegator profile
- **Scheduler**: Auto-activate highest priority items when slots open
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
| `/api/training/run` | POST | Run incremental training |
| `/api/training/profile` | GET | Read the user profile |
| `/api/training/preseed` | POST | Bootstrap initial profile |
| `/api/scheduler/run` | POST | Run the queue scheduler |

## Work Stream Lifecycle

1. **Discover** — Poller finds new work from configured sources
2. **Queue** — Item added to priority queue with metadata
3. **Plan** — Create and approve an implementation plan
4. **Activate** — Worktree created, worker session spawned, delegator started
5. **Execute** — Worker implements the plan, delegator monitors and reviews
6. **Review** — Delegator performs final review, surfaces PR for user sign-off
7. **Complete** — PR merged, worktree torn down, slot freed for next item

## Two Work Stream Types

**Projects** — Larger-scale work requiring quality oversight:
- Multi-file changes, feature implementations, Graphite stacks
- Gets: worktree + worker session + delegator instance
- Concurrency limit: 2 (configurable)
- Full lifecycle with planning phase

**Quick Fixes** — Small, self-contained changes:
- Bug fixes, config tweaks, one-file adjustments
- Gets: worktree + worker session (no delegator)
- No concurrency limit
- Simplified lifecycle (skip planning)

## Configuration

### `config/environment.yml`

All site-specific values are defined here. The scripts and dashboard reference this config rather than hardcoding paths.

Key sections: identity, repository paths, CLI tool locations, state file paths, concurrency limits, autonomy settings, delegator config, branch naming patterns, and dashboard ports.

### `config/sources.yml`

Defines where the orchestrator discovers work. Supported adapters:
- `markdown` — Parse task items from markdown plan files
- `github` — Poll GitHub Issues via `gh` CLI
- `jira` — Jira integration (stub, requires jira CLI/API)

## Dependencies

- **Rostrum** — Git worktree lifecycle management
- **vmux** — Claude Code session spawning and management
- **Claude Code** — Worker and delegator sessions
- **gh** — GitHub CLI for PR status and issue discovery
- **Node.js 20+** — Dashboard runtime
- **Python 3.10+** — Discovery and training scripts
