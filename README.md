# Orchestrator

A Claude Code plugin that autonomously manages parallel development work streams. It discovers work from configurable sources, prioritizes tasks, spins up isolated development environments, and coordinates multiple Claude sessions working simultaneously.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATOR                             │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  Poller  │→ │  Work Queue  │→ │  Resource Manager         │ │
│  │ (script) │  │  (priority   │  │  - Worktree lifecycle     │ │
│  │          │  │   sorted)    │  │  - Voice session spawning │ │
│  └──────────┘  └──────────────┘  │  - Delegator management   │ │
│       ↑                          │  - Concurrency limits     │ │
│       │                          └───────────────────────────┘ │
│  ┌──────────┐                              │                    │
│  │  Sources │                              ↓                    │
│  │ (config) │               ┌──────────────────────────┐       │
│  └──────────┘               │     Active Work Streams  │       │
│                             │  ┌────────┐ ┌────────┐   │       │
│                             │  │Stream 1│ │Stream 2│   │       │
│                             │  │┌──────┐│ │┌──────┐│   │       │
│                             │  ││Worker││ ││Worker││   │       │
│                             │  ││Claude││ ││Claude││   │       │
│                             │  │└──────┘│ │└──────┘│   │       │
│                             │  │┌──────┐│ │┌──────┐│   │       │
│                             │  ││Deleg.││ ││Deleg.││   │       │
│                             │  │└──────┘│ │└──────┘│   │       │
│                             │  └────────┘ └────────┘   │       │
│                             └──────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Components

- **Orchestrator (this plugin)**: Central brain. Discovers work, manages the queue, spins up/down environments, monitors progress, and coordinates between all moving parts.
- **Worker Sessions**: Individual Claude Code sessions running in isolated git worktrees via Rostrum + vmux. These do the actual implementation work.
- **Delegator** (separate project): Quality assurance layer that reviews worker output, checks PRs, validates implementations against plans, and reports back to the orchestrator. See [`~/delegator`](../delegator/).

## Work Discovery

The orchestrator polls configurable sources for new work items:

- Markdown files (e.g., plan files on Desktop)
- Jira boards (via MCP or API)
- Google Docs (via API)
- GitHub Issues
- Custom sources (extensible)

Sources are configured in the orchestrator config. Polling can run on a cron schedule or be triggered manually.

## Work Queue

Discovered work items are prioritized and queued. Priority is determined by:

1. Explicit priority fields from the source (e.g., Jira priority)
2. User-defined overrides (manual reordering)
3. Orchestrator judgment (dependencies, blocking status, effort estimation)

The queue dashboard is a temporary markdown file at `~/.claude/orchestrator/dashboard.md` until a proper UI is built.

## Concurrency

- **Default limit**: 2 concurrent work streams (configurable, max ~5)
- Each work stream consists of: 1 worktree + 1 worker Claude session + 1 delegator instance
- Queued items wait until a slot opens up

## Work Stream Lifecycle

1. **Discover** — Poller finds new work item from a configured source
2. **Queue** — Item added to priority queue with metadata
3. **Plan** — Orchestrator creates/reviews implementation plan for the item
4. **Activate** — Worktree created via Rostrum, worker session spawned via vmux, delegator started
5. **Execute** — Worker implements the plan, delegator monitors quality
6. **Review** — Delegator validates output, orchestrator checks status
7. **Complete** — PR submitted, worktree torn down, slot freed for next item

## Plugin Structure

```
orchestrator/
├── CLAUDE.md              # Claude Code instructions for this plugin
├── README.md              # This file
├── plan.md                # Implementation plan
├── manifest.json          # Claude Code plugin manifest (TODO)
├── skills/                # Plugin skills (TODO)
│   ├── status.md          # Check queue and work stream status
│   ├── add-work.md        # Add work item to queue
│   └── prioritize.md      # Reorder queue priorities
├── scripts/               # Background scripts (TODO)
│   ├── poller.sh          # Work source polling script
│   └── monitor.sh         # Health check for active streams
└── config/                # Configuration (TODO)
    └── sources.yml        # Work source definitions
```

## Dependencies

- **Rostrum** (`/usr/local/bin/rostrum`) — Git worktree management
- **vmux** (`~/.local/bin/vmux`) — Voice session management
- **Claude Code** — Worker sessions
- **Delegator** (`~/delegator`) — Quality assurance (separate project)

## Status

**Phase**: Early development — defining architecture and building core infrastructure.
