import { useCallback, useEffect, useState } from 'react'
import classnames from 'classnames'
import styles from './DirectiveRuns.module.scss'
import type { DirectiveRun, WorkItem } from '../../types'

interface DirectiveRunsProps {
  item: WorkItem
}

/** Live runs poll often enough to feel current without hammering the API. */
const LIVE_POLL_MS = 5000
const IDLE_POLL_MS = 30000

function badgeFor(run: DirectiveRun): { label: string; cls: string; live: boolean } {
  if (run.alive) return { label: 'Running', cls: styles.BadgeLive, live: true }
  switch (run.status) {
    case 'completed':
      return { label: 'Completed', cls: styles.BadgeOk, live: false }
    case 'timed_out':
      return { label: 'Timed out', cls: styles.BadgeWarn, live: false }
    case 'killed':
      return { label: 'Stopped', cls: styles.BadgeWarn, live: false }
    case 'failed':
      return { label: 'Failed', cls: styles.BadgeError, live: false }
    case 'running':
      // Recorded as running but the process is gone: the run died without
      // writing a result. Say so rather than implying work is happening.
      return { label: 'Died', cls: styles.BadgeError, live: false }
    default:
      return { label: run.status, cls: styles.BadgeWarn, live: false }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Directive runs for one work item: what is running against this branch right
 * now, how long it has been going, how much it has produced, and a way to stop
 * it. A run is a detached subprocess that can spend real money, so its state is
 * shown here rather than left for someone to discover in a process table.
 */
export function DirectiveRuns({ item }: DirectiveRunsProps) {
  const [runs, setRuns] = useState<DirectiveRun[]>(
    item.runtime?.directive_runs?.runs ?? [],
  )
  const [expanded, setExpanded] = useState<string | null>(null)
  const [output, setOutput] = useState<Record<string, string>>({})
  const [stopping, setStopping] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/directives/runs?item=${encodeURIComponent(item.id)}`)
      if (!res.ok) return
      const data = await res.json()
      setRuns(data.runs ?? [])
    } catch {
      // A failed poll is not worth surfacing; the next one will likely succeed.
    }
  }, [item.id])

  const anyLive = runs.some((r) => r.alive)

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, anyLive ? LIVE_POLL_MS : IDLE_POLL_MS)
    return () => clearInterval(interval)
  }, [refresh, anyLive])

  const loadOutput = useCallback(
    async (directive: string) => {
      try {
        const res = await fetch(
          `/api/directives/output?item=${encodeURIComponent(item.id)}` +
            `&directive=${encodeURIComponent(directive)}&lines=200`,
        )
        if (!res.ok) return
        const data = await res.json()
        setOutput((prev) => ({ ...prev, [directive]: data.output || '(no output yet)' }))
      } catch {
        setOutput((prev) => ({ ...prev, [directive]: '(could not read output)' }))
      }
    },
    [item.id],
  )

  const toggle = useCallback(
    (directive: string) => {
      setExpanded((prev) => {
        const next = prev === directive ? null : directive
        if (next) loadOutput(next)
        return next
      })
    },
    [loadOutput],
  )

  // Keep an open output view current while its run is still going.
  useEffect(() => {
    if (!expanded) return
    const run = runs.find((r) => r.directive === expanded)
    if (!run?.alive) return
    const interval = setInterval(() => loadOutput(expanded), LIVE_POLL_MS)
    return () => clearInterval(interval)
  }, [expanded, runs, loadOutput])

  const stop = useCallback(
    async (directive: string) => {
      setStopping((prev) => ({ ...prev, [directive]: true }))
      try {
        await fetch('/api/directives/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: item.id,
            directive,
            reason: 'stopped from the dashboard',
          }),
        })
        await refresh()
      } finally {
        setStopping((prev) => ({ ...prev, [directive]: false }))
      }
    },
    [item.id, refresh],
  )

  const spend = item.runtime?.spend as { total_usd?: number } | null | undefined
  const totalUsd = typeof spend?.total_usd === 'number' ? spend.total_usd : null

  if (!runs.length) {
    return <div className={styles.Empty}>No directive runs recorded for this item.</div>
  }

  return (
    <div className={styles.Root}>
      {runs.map((run) => {
        const badge = badgeFor(run)
        const rowCls = classnames(
          styles.Run,
          run.alive && styles.RunLive,
          (run.status === 'timed_out' || run.status === 'killed') && styles.RunStopped,
          (run.status === 'failed' || (run.status === 'running' && !run.alive)) &&
            styles.RunFailed,
        )
        const overBudget =
          run.timeout_minutes != null &&
          run.runtime_minutes >= run.timeout_minutes * 0.8

        return (
          <div key={run.directive} className={rowCls}>
            <div className={styles.Header}>
              <span className={styles.Name}>{run.directive}</span>
              <span className={classnames(styles.Badge, badge.cls)}>
                <span className={classnames(styles.Dot, badge.live && styles.DotLive)} />
                {badge.label}
              </span>
              <span className={styles.Spacer} />
              <div className={styles.Actions}>
                <button
                  type="button"
                  className={styles.Button}
                  onClick={() => toggle(run.directive)}
                >
                  {expanded === run.directive ? 'Hide output' : 'Output'}
                </button>
                {run.alive && (
                  <button
                    type="button"
                    className={classnames(styles.Button, styles.ButtonStop)}
                    disabled={stopping[run.directive]}
                    onClick={() => stop(run.directive)}
                  >
                    {stopping[run.directive] ? 'Stopping…' : 'Stop'}
                  </button>
                )}
              </div>
            </div>

            <div className={styles.Stats}>
              <span className={styles.Stat}>
                ran <strong>{run.runtime_minutes} min</strong>
                {run.timeout_minutes != null && ` / ${run.timeout_minutes} limit`}
              </span>
              <span className={styles.Stat}>
                output <strong>{formatBytes(run.output_bytes)}</strong>
              </span>
              {run.alive && (
                <span className={styles.Stat}>
                  heartbeat <strong>{run.seconds_since_heartbeat}s ago</strong>
                </span>
              )}
              {run.exit_code != null && (
                <span className={styles.Stat}>
                  exit <strong>{run.exit_code}</strong>
                </span>
              )}
            </div>

            {run.alive && totalUsd != null && (
              <div
                className={classnames(styles.Budget, overBudget && styles.BudgetNear)}
              >
                Item spend so far: ${totalUsd.toFixed(2)}
              </div>
            )}

            {run.stopped_reason && (
              <div className={styles.Reason}>Stopped: {run.stopped_reason}</div>
            )}

            {run.status === 'running' && !run.alive && (
              <div className={styles.Reason}>
                Recorded as running, but the process is gone. It died without writing a
                result, so no artifact was produced.
              </div>
            )}

            {expanded === run.directive && (
              <pre className={styles.Output}>
                {output[run.directive] ?? 'Loading…'}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
