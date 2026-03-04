import { useEffect } from 'react'
import styles from "./AnalyticsView.module.scss";
import { StatusChart } from "../StatusChart/StatusChart.tsx";
import { BarChart } from "../BarChart/BarChart.tsx";
import { useSpend } from "../../hooks/useSpend.ts";
import type { WorkItem, SessionInfo } from "../../types.ts";
import type { DelegatorStatus } from "../../hooks/useDelegators.ts";
import type { OrchestratorEvent } from "../../hooks/useEvents.ts";

// Module-level flag — survives component remounts (tab switches)
let hasRefreshedSpend = false

interface Props {
  items: WorkItem[];
  sessions: SessionInfo[];
  delegators?: DelegatorStatus[];
  events?: OrchestratorEvent[];
}

export function AnalyticsView({
  items,
  sessions,
  delegators = [],
  events = [],
}: Props) {
  // Spend totals — loads from cache instantly, refreshes once per page load
  const { orchestrator: orchestratorSpend, overall: overallSpend, loading: spendLoading, refresh: refreshSpend } = useSpend()

  // Fire live ccusage refresh only once per page load, on first analytics tab focus
  useEffect(() => {
    if (!hasRefreshedSpend) {
      hasRefreshedSpend = true
      refreshSpend()
    }
  }, [refreshSpend])

  // Status counts
  const statusCounts = {
    active: items.filter((i) => i.status === "active").length,
    queued: items.filter((i) => i.status === "queued").length,
    review: items.filter((i) => i.status === "review").length,
    paused: items.filter((i) => i.status === "paused").length,
    completed: items.filter((i) => i.status === "completed").length,
  };

  // Type distribution
  const projects = items.filter((i) => i.type === "project").length;
  const quickFixes = items.filter((i) => i.type === "quick_fix").length;

  // Priority distribution
  const priorityBuckets = [
    {
      label: "1-10",
      value: items.filter((i) => i.priority >= 1 && i.priority <= 10).length,
      color: "var(--color-error)",
    },
    {
      label: "11-25",
      value: items.filter((i) => i.priority >= 11 && i.priority <= 25).length,
      color: "var(--color-warning)",
    },
    {
      label: "26-50",
      value: items.filter((i) => i.priority >= 26 && i.priority <= 50).length,
      color: "var(--color-primary)",
    },
    {
      label: "51-75",
      value: items.filter((i) => i.priority >= 51 && i.priority <= 75).length,
      color: "var(--color-text-muted)",
    },
    {
      label: "76+",
      value: items.filter((i) => i.priority >= 76).length,
      color: "var(--color-border)",
    },
  ];

  // Session state distribution
  const sessionStates = [
    {
      label: "Standby",
      value: sessions.filter((s) => s.state === "standby").length,
      color: "var(--color-success)",
    },
    {
      label: "Thinking",
      value: sessions.filter((s) => s.state === "thinking").length,
      color: "var(--color-warning)",
    },
    {
      label: "Responding",
      value: sessions.filter((s) => s.state === "responding").length,
      color: "var(--color-primary)",
    },
    {
      label: "Zombie",
      value: sessions.filter((s) => s.state === "zombie").length,
      color: "var(--color-error)",
    },
  ];

  // Dependency stats
  const blockedItems = items.filter((i) => (i.blocked_by || []).length > 0);
  const activelyBlocked = blockedItems.filter((i) =>
    i.blocked_by.some((depId) => {
      const dep = items.find((d) => d.id === depId);
      return !dep || dep.status !== "completed";
    }),
  );

  // Average items per day (based on created_at)
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentItems = items.filter(
    (i) => new Date(i.created_at).getTime() > oneWeekAgo,
  );
  const avgPerDay = (recentItems.length / 7).toFixed(1);

  // Completion time metrics
  const completedItems = items.filter((i) => i.completed_at && i.activated_at);
  const completionTimesHours = completedItems
    .map((i) => {
      const activated = new Date(i.activated_at!).getTime();
      const completed = new Date(i.completed_at!).getTime();
      return (completed - activated) / (1000 * 60 * 60);
    })
    .filter((h) => h > 0 && h < 720); // Filter out unreasonable values (>30 days)
  const avgCompletionHours =
    completionTimesHours.length > 0
      ? completionTimesHours.reduce((a, b) => a + b, 0) /
        completionTimesHours.length
      : 0;
  const formatDuration = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)}d`;
  };

  // Source distribution
  const sourceCounts = new Map<string, number>();
  for (const item of items) {
    const source = item.source || "manual";
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }
  const sourceBars = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({
      label,
      value,
      color: [
        "var(--color-primary)",
        "var(--color-success)",
        "var(--color-warning)",
        "var(--color-error)",
      ][i % 4],
    }));

  return (
    <div className={styles.Root}>
      <div className={styles.Grid}>
        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Overall User Spend{spendLoading && !overallSpend ? '' : ''}</h3>
          <div className={styles.SpendGrid}>
            {(['today', 'week', 'month', 'all_time'] as const).map(period => (
              <div key={period} className={styles.SpendItem}>
                <span className={`${styles.SpendValue}${spendLoading && !overallSpend ? ` ${styles.SpendValueLoading}` : ''}`}>
                  {overallSpend ? `$${overallSpend[period].toFixed(2)}` : '--'}
                </span>
                <span className={styles.SpendLabel}>
                  {period === 'today' ? 'Today' : period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Orchestrator Spend</h3>
          <div className={styles.SpendGrid}>
            {(['today', 'week', 'month', 'all_time'] as const).map(period => (
              <div key={period} className={styles.SpendItem}>
                <span className={`${styles.SpendValue}${spendLoading && orchestratorSpend.all_time === 0 ? ` ${styles.SpendValueLoading}` : ''}`}>
                  ${orchestratorSpend[period].toFixed(2)}
                </span>
                <span className={styles.SpendLabel}>
                  {period === 'today' ? 'Today' : period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Status Distribution</h3>
          <div className={styles.ChartCenter}>
            <StatusChart {...statusCounts} />
          </div>
          <div className={styles.Legend}>
            {Object.entries(statusCounts).map(([key, count]) => (
              <div key={key} className={styles.LegendItem}>
                <span className={styles.LegendLabel}>{key}</span>
                <span className={styles.LegendValue}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Priority Distribution</h3>
          <BarChart bars={priorityBuckets} height={100} />
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Type Breakdown</h3>
          <div className={styles.TypeRow}>
            <div className={styles.TypeItem}>
              <span className={styles.TypeValue}>{projects}</span>
              <span className={styles.TypeLabel}>Projects</span>
            </div>
            <div className={styles.TypeItem}>
              <span className={styles.TypeValue}>{quickFixes}</span>
              <span className={styles.TypeLabel}>Quick Fixes</span>
            </div>
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Session Health</h3>
          <BarChart bars={sessionStates} height={80} />
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Dependencies</h3>
          <div className={styles.DepStats}>
            <div className={styles.DepStatItem}>
              <span
                className={styles.DepStatValue}
                style={{ color: "var(--color-error)" }}
              >
                {activelyBlocked.length}
              </span>
              <span className={styles.DepStatLabel}>Blocked</span>
            </div>
            <div className={styles.DepStatItem}>
              <span
                className={styles.DepStatValue}
                style={{ color: "var(--color-success)" }}
              >
                {blockedItems.length - activelyBlocked.length}
              </span>
              <span className={styles.DepStatLabel}>Resolved</span>
            </div>
            <div className={styles.DepStatItem}>
              <span className={styles.DepStatValue}>{blockedItems.length}</span>
              <span className={styles.DepStatLabel}>Total</span>
            </div>
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Velocity</h3>
          <div className={styles.VelocityStat}>
            <span className={styles.VelocityValue}>{avgPerDay}</span>
            <span className={styles.VelocityLabel}>
              items / day (7-day avg)
            </span>
          </div>
          <div className={styles.VelocityStat}>
            <span className={styles.VelocityValue}>{items.length}</span>
            <span className={styles.VelocityLabel}>total items</span>
          </div>
        </div>

        <div className={styles.Card}>
          <h3 className={styles.CardTitle}>Completion Time</h3>
          {completedItems.length > 0 ? (
            <>
              <div className={styles.VelocityStat}>
                <span className={styles.VelocityValue}>
                  {formatDuration(avgCompletionHours)}
                </span>
                <span className={styles.VelocityLabel}>
                  avg time to complete
                </span>
              </div>
              <div className={styles.VelocityStat}>
                <span className={styles.VelocityValue}>
                  {completedItems.length}
                </span>
                <span className={styles.VelocityLabel}>items completed</span>
              </div>
              {completionTimesHours.length > 1 && (
                <div className={styles.VelocityStat}>
                  <span className={styles.VelocityValue}>
                    {formatDuration(Math.min(...completionTimesHours))} —{" "}
                    {formatDuration(Math.max(...completionTimesHours))}
                  </span>
                  <span className={styles.VelocityLabel}>
                    fastest — slowest
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className={styles.VelocityStat}>
              <span className={styles.VelocityLabel}>
                No completed items with timing data
              </span>
            </div>
          )}
        </div>

        {sourceBars.length > 1 && (
          <div className={styles.Card}>
            <h3 className={styles.CardTitle}>Sources</h3>
            <BarChart bars={sourceBars} height={80} />
          </div>
        )}

        {delegators.length > 0 && (
          <div className={styles.Card}>
            <h3 className={styles.CardTitle}>Delegator Performance</h3>
            <div className={styles.DelegatorGrid}>
              {delegators.map((d) => (
                <div key={d.item_id} className={styles.DelegatorRow}>
                  <span className={styles.DelegatorId}>{d.item_id}</span>
                  <div className={styles.DelegatorStats}>
                    <span>{d.cycle_count ?? 0} cycles</span>
                    <span data-status={d.health?.status}>
                      {d.health?.status || "unknown"}
                    </span>
                    {d.cycle_running && <span>running</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {events.length > 0 &&
          (() => {
            const eventTypes = new Map<string, number>();
            for (const e of events) {
              eventTypes.set(e.type, (eventTypes.get(e.type) || 0) + 1);
            }
            const eventBars = Array.from(eventTypes.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([label, value], i) => ({
                label: label.replace(/\./g, " "),
                value,
                color: [
                  "var(--color-primary)",
                  "var(--color-success)",
                  "var(--color-warning)",
                  "var(--color-error)",
                  "var(--color-text-muted)",
                ][i % 5],
              }));
            return (
              <div className={styles.Card}>
                <h3 className={styles.CardTitle}>
                  Event Activity ({events.length} events)
                </h3>
                <BarChart bars={eventBars} height={100} />
              </div>
            );
          })()}
      </div>
    </div>
  );
}
