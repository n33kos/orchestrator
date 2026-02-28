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
│  │  (UI)   │               │  ││ Claude ││ ││ Claude ││   │         │
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
- **Web Dashboard**: Dedicated web interface for managing work streams, priorities, delegators, and PR status.

## How It Works

### Work Discovery
The orchestrator polls configurable sources for new work items:
- Markdown plan files
- Jira boards (via MCP or API)
- Google Docs (via API)
- GitHub Issues
- Manual additions via dashboard or CLI skills
- Custom sources (extensible adapter system)

### Work Queue
Discovered items are prioritized and queued. Priority is determined by:
1. Explicit priority fields from the source (e.g., Jira priority)
2. User-defined overrides (drag-and-drop in dashboard or manual reordering)
3. Orchestrator judgment (dependencies, blocking status, effort estimation)

Priorities can be imported directly from any configured source.

### Two Work Stream Types

**Projects** — Larger-scale work requiring quality oversight:
- Multi-file changes, Graphite stacks, feature implementations
- Each gets: 1 worktree + 1 worker session + 1 delegator instance
- Concurrency limit: 2 (configurable)
- Full lifecycle: plan → activate → execute → review → complete

**Quick Fixes** — Small, self-contained changes:
- Bug fixes, config tweaks, one-file adjustments
- Each gets: 1 worktree + 1 worker session (no delegator)
- No concurrency limit
- Simplified lifecycle: activate → execute → complete

### Delegator: Your Digital Clone

The delegator is the most distinctive component. Rather than a generic code reviewer, each delegator instance is trained to mirror the user's personal review process:

1. **Training Phase**: A hook captures every user-worker interaction and feeds it to a training agent that builds a behavioral profile — what you check, what you care about, how you communicate, what you flag
2. **Profile Document**: The distilled profile lives at `~/.claude/orchestrator/profile.md` and serves as the delegator's behavioral instructions
3. **Active Review**: During project execution, the delegator uses the profile to interact with workers the way you would — asking questions, checking work, flagging issues
4. **Text-Based Communication**: Delegators talk to workers via text messaging (not voice) for efficiency, through the relay or direct CLI
5. **User Override**: You can cut into any delegator-worker conversation at any time

### Web Dashboard

A dedicated web interface serves as the orchestrator's command center:
- View all work streams (queued, active, review, completed)
- Drag-and-drop priority reordering
- Add work items manually or import from sources
- Toggle delegators on/off per stream
- View delegator-worker conversation transcripts
- Direct links to PRs ready for review
- Work stream metrics and history

## Work Stream Lifecycle

1. **Discover** — Poller finds new work item from a configured source
2. **Queue** — Item added to priority queue with metadata
3. **Plan** — Orchestrator creates/reviews implementation plan for the item
4. **Activate** — Worktree created, worker session spawned, delegator started (projects only)
5. **Execute** — Worker implements the plan, delegator monitors and reviews
6. **Review** — Delegator performs final review, surfaces PR for user sign-off
7. **Complete** — PR submitted/merged, worktree torn down, slot freed for next item

## Project Structure

```
orchestrator/
├── CLAUDE.md              # Claude Code instructions for the orchestrator agent
├── README.md              # This file
├── plan.md                # Implementation plan
├── manifest.json          # Claude Code plugin manifest (TODO)
├── delegator/             # Delegator sub-module
│   ├── CLAUDE.md          # Delegator agent instructions
│   └── README.md          # Delegator documentation
├── dashboard/             # Web dashboard (TODO)
│   ├── server/            # Backend API
│   └── client/            # Frontend UI
├── skills/                # Plugin skills (TODO)
│   ├── status.md          # Check queue and work stream status
│   ├── add-work.md        # Add work item to queue
│   └── prioritize.md      # Reorder queue priorities
├── scripts/               # Background scripts (TODO)
│   ├── poller.sh          # Work source polling script
│   ├── monitor.sh         # Health check for active streams
│   └── train.sh           # Profile training hook
└── config/                # Configuration (TODO)
    ├── environment.yml    # Site-specific values (paths, tools, identity)
    └── sources.yml        # Work source definitions
```

## Environment Configuration

The orchestrator is designed to be portable. All site-specific values (repository paths, CLI tool locations, identity, concurrency settings) are abstracted into `config/environment.yml` rather than hardcoded. See [plan.md](plan.md#environment-configuration) for the full schema.

## Dependencies

- **Worktree Manager** (e.g., Rostrum) — Git worktree lifecycle management
- **Session Manager** (e.g., vmux) — Voice/text session spawning and management
- **Claude Code** — Worker and delegator sessions
- **Voice Relay** (e.g., voice-multiplexer) — Communication layer for user-agent and agent-agent messaging

## Status

**Phase**: Early development — architecture defined, environment abstraction designed, delegator training system planned.
