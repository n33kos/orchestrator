# Orchestrator Implementation Plan

## Phase 1: Foundation

Core infrastructure for the plugin and basic work queue management.

### 1.1 Plugin Scaffolding
- Initialize as Claude Code plugin with manifest.json
- Define skill stubs (status, add-work, prioritize)
- Set up config directory and source configuration format
- Initialize git repo

### 1.2 Work Queue System
- Define work item schema (source, title, description, priority, status, metadata)
- Implement queue storage (start with JSON file at `~/.claude/orchestrator/queue.json`)
- Implement priority sorting logic (explicit priority + orchestrator judgment)
- Create dashboard markdown generator (`~/.claude/orchestrator/dashboard.md`) — temporary UI

### 1.3 Worktree + Session Management
- Formalize the create/spawn/teardown workflow already built in CLAUDE.md
- Add queue-aware activation: pick highest priority queued item when a slot opens
- Implement concurrency limiter (default: 2 active streams)
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
- **Markdown files**: Parse plan files (like `~/Desktop/Plans/*.md`) for actionable items
- **Jira**: Query boards/filters via Jira MCP or API for assigned/prioritized tickets
- **GitHub Issues**: Query repos for labeled issues
- Each adapter returns normalized work items matching the queue schema

### 2.3 Source Configuration
- Define `config/sources.yml` format for specifying:
  - Source type (markdown, jira, github, etc.)
  - Connection details (paths, board IDs, labels, filters)
  - Polling interval (if scheduled)
  - Priority mapping rules

## Phase 3: Autonomous Execution

End-to-end autonomous work stream management.

### 3.1 Plan Generation
- When activating a queued item, generate an implementation plan
- Present plan for user approval (or auto-approve if configured)
- Pass approved plan to worker session as initial context

### 3.2 Delegator Integration
- Spin up delegator instance alongside each worker session
- Delegator monitors worker output (commits, PRs, test results)
- Delegator reports quality issues back to orchestrator
- Orchestrator can pause/redirect work streams based on delegator feedback

### 3.3 Progress Monitoring
- Track work stream progress (commits made, tests passing, PR status)
- Update dashboard with real-time status
- Detect stalled streams and alert user
- Auto-complete streams when PR is merged

### 3.4 User Interaction Points
- Orchestrator can ask user questions via voice relay when needed
- Priority changes can be made via skill commands or dashboard edits
- User can pause/resume/cancel work streams
- Configurable autonomy level (ask before activating vs. auto-activate)

## Phase 4: Polish & Scale

Refinement and scaling capabilities.

### 4.1 Scheduling
- Convert poller to cron job or launchd daemon
- Add configurable polling intervals per source
- Add quiet hours / work hours configuration

### 4.2 UI Evolution
- Replace markdown dashboard with richer interface
- Potentially integrate with voice multiplexer web app
- Add work stream history and metrics

### 4.3 Multi-Repo Support
- Support work items across different repositories
- Configure Rostrum targets per work item
- Handle cross-repo dependencies

### 4.4 Learning & Optimization
- Track time-to-completion per work type
- Optimize concurrency limits based on system resources
- Learn priority patterns from user overrides

## Configuration Schema (Draft)

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
  max_active_streams: 2
  queue_strategy: priority  # or "fifo"

autonomy:
  auto_activate: false      # require user approval before starting work
  auto_approve_plans: false  # require user approval of implementation plans
  ask_before_teardown: true  # confirm before tearing down completed streams
```

## Work Item Schema (Draft)

```json
{
  "id": "uuid",
  "source": "react-18-plan",
  "title": "Enzyme Migration - Consumer Registry",
  "description": "Convert 30 enzyme test files to RTL in registry/",
  "priority": 1,
  "status": "queued",         // queued | planning | active | review | completed | paused
  "branch": "me/react-18/enzyme-migration/1/consumer-registry",
  "worktree_path": null,      // set when activated
  "session_id": null,          // set when worker spawned
  "delegator_id": null,        // set when delegator started
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
