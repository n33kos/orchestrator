# Delegator Directives

Per-status instructions evaluated by the delegator on each cycle.

## Directory layout

```
delegator/directives/<status>/<name>.md          # committed shared defaults
delegator/directives.local/<status>/<name>.md    # gitignored local overrides
```

A `<status>` folder exists for every queue status:

- `planning/` — items with a draft plan, not yet ready to start
- `queued/` — approved plans waiting for an open slot
- `active/` — running worker session
- `review/` — PR up, awaiting human review
- `completed/` — merged / archived

`active` and `review` always run the delegator pipeline. The other three only
cycle when an item has at least one applicable directive — see
`scripts/scheduler/directives.py::item_should_cycle`.

## Directive file format

```markdown
---
name: my-directive
enabled: true        # default true; set false to ship a directive disabled
required: false      # if true, blocks status transition until completed
max_retries: 0       # 0 = unlimited
depends_on: null     # name of another directive that must be `completed` first
---

Natural-language instructions for the delegator. Evaluated by the LLM on each
cycle. May reference `~/orchestrator/scripts/run-directive.sh` to launch a
backgrounded command with status tracking.
```

## Local overrides

Drop a same-named file into `delegator/directives.local/<status>/` to replace
the committed default for this machine only. New names there are appended.

## Per-item overrides

A queue item's `worker.directive_overrides` map (e.g.
`{"council-review": false}`) wins over the directive's frontmatter `enabled`
value for that item only.
