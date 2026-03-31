# Delegator

A quality assurance sub-module of the Orchestrator that mirrors the user's review process to autonomously monitor and validate the work of Claude Code worker sessions.

## Purpose

The Delegator is not a generic code reviewer — it's a quality assurance layer that reviews worker output against the implementation plan, coding standards, and project conventions.

For each active **project** work stream (not quick fixes), a delegator instance runs alongside the worker Claude session to:

- **Communicate with the worker** via text-based messaging, asking questions and providing feedback the way the user would
- **Review code changes** as they're committed, checking for the things the user always checks
- **Validate implementations** against the approved plan
- **Check pull requests** for correctness, completeness, and style
- **Run targeted tests** to verify changes don't break existing functionality
- **Report issues** back to the orchestrator for triage

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
3. Delegator loads the implementation plan
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
