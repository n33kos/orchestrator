# Delegator

A quality assurance sub-module of the Orchestrator that mirrors the user's review process to autonomously monitor and validate the work of Claude Code worker sessions.

## Purpose

The Delegator is not a generic code reviewer — it's a **digital clone of the user's personal review process**. Through a training system that observes real user-worker interactions, the delegator learns exactly how the user thinks about code quality, what they check, and how they communicate. It then applies this learned behavior to review worker output autonomously.

For each active **project** work stream (not quick fixes), a delegator instance runs alongside the worker Claude session to:

- **Communicate with the worker** via text-based messaging, asking questions and providing feedback the way the user would
- **Review code changes** as they're committed, checking for the things the user always checks
- **Validate implementations** against the approved plan
- **Check pull requests** for correctness, completeness, and style
- **Run targeted tests** to verify changes don't break existing functionality
- **Report issues** back to the orchestrator for triage

## Training System

The delegator's effectiveness comes from its behavioral profile, built through observation of real interactions.

### How Training Works

1. A hook fires after every voice relay exchange between the user and a worker session
2. The hook triggers a lightweight Claude instance (the training agent)
3. The training agent reads the interaction context — including the full Claude session transcripts (JSONL files at `~/.claude/projects/*/`)
4. It extracts patterns: what the user asks about, what they care about, how they phrase feedback, what they flag as issues, what they praise
5. It checks the existing profile for redundancy and only adds new insights
6. It updates the profile document at `~/.claude/orchestrator/profile.md`

### Data Sources

- **Voice relay transcripts**: Every message between user and workers
- **Claude session transcripts**: Full JSONL files with tool calls, code changes, and reasoning
- **Commit history**: What was requested vs. what was actually produced
- **PR review comments**: The user's explicit review feedback

### Pre-seeding

On first setup, the training system can mine existing Claude session transcripts to bootstrap an initial profile. This scans all available session files, extracts patterns from user messages, and generates a draft profile for user review.

### Profile Document

The behavioral profile lives at `~/.claude/orchestrator/profile.md` and contains:

- **Communication style** — How the user talks to workers
- **Quality priorities** — What the user consistently checks
- **Common review patterns** — Recurring themes in feedback
- **Domain-specific concerns** — Per-area things always checked
- **Invariants** — Things the user never skips
- **Trust areas** — Things the user rarely micro-manages
- **Interaction examples** — Representative exchanges

The user can manually edit this file to correct or refine the profile at any time.

## Communication Model

### Text-Based Messaging
The delegator communicates with workers via **text-based messaging** through the relay CLI or direct tmux injection — not voice. This is far more efficient than running messages through Whisper and Kokoro, and functionally equivalent.

Workers see delegator messages as standard relay input and respond naturally. The user can "cut in" on any delegator-worker conversation at will through the orchestrator dashboard.

### Message Flow
```
Delegator → [text relay / CLI] → Worker Session
Worker Session → [text relay / CLI] → Delegator
                                        ↓
                                  Orchestrator (status updates)
                                        ↓
                                  User (can cut in anytime)
```

## Relationship to Orchestrator

The Delegator is a sub-module within the Orchestrator project. The orchestrator manages the delegator lifecycle:

```
orchestrator/
    ├── delegator/          ← this sub-module
    ├── dashboard/
    ├── scripts/
    ├── config/
    └── ...

Runtime:
    Orchestrator
        ├── Project Stream 1
        │   ├── Worker (Claude session in worktree)
        │   └── Delegator (trained clone, reviewing the worker)
        ├── Project Stream 2
        │   ├── Worker
        │   └── Delegator
        └── Quick Fix Stream
            ├── Worker
            └── Delegator
```

### Lifecycle
1. Orchestrator activates a project work stream
2. Orchestrator spins up a delegator instance for that stream
3. Delegator loads the user profile + the implementation plan
4. Delegator monitors worker activity and intervenes when needed
5. Worker signals completion → delegator performs final review
6. Delegator reports assessment to orchestrator (approve / needs-work / blocked)
7. Orchestrator tears down delegator when stream completes

### User Controls
- Toggle delegators on/off per work stream via dashboard or CLI
- Pause/resume a delegator mid-stream without losing context
- Default behavior configurable in environment config (`delegator.enabled_by_default`)

## Capabilities

- PR review using Conventional Comments
- Plan-vs-implementation diff analysis
- Targeted test execution to verify changes
- Code style and convention checking (per project knowledge files)
- Stall detection (worker not making progress)
- Quality gate enforcement (block PR submission if issues found)
- Proactive communication — doesn't just wait for problems, asks questions like the user would

## Boundaries

The delegator does **not**:
- Make code changes directly (it's a reviewer, not an implementer)
- Approve PRs without user sign-off (unless configured for auto-approve)
- Override the user's explicit instructions to a worker
- Run all tests (follows the same targeted-test-only constraints as manual review)

## Status

**Phase**: Production — fully implemented and operational. Delegator sessions spawn for all work streams, run scheduler-driven monitoring cycles, review commits, communicate with workers via vmux, and report assessments to the dashboard.
