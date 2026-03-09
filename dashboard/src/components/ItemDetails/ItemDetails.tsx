import { useState, useEffect, useMemo, useRef } from "react";
import classnames from "classnames";
import styles from "./ItemDetails.module.scss";
import { StatusBadge } from "../StatusBadge/StatusBadge.tsx";
import { PriorityBadge } from "../PriorityBadge/PriorityBadge.tsx";
import { ActivityLog } from "../ActivityLog/ActivityLog.tsx";
import { MessageComposer } from "../MessageComposer/MessageComposer.tsx";
import { InlineEdit } from "../InlineEdit/InlineEdit.tsx";
import { ItemNotes } from "../ItemNotes/ItemNotes.tsx";
import { timeAgo, formatDate } from "../../utils/time.ts";
import { usePrStatus, usePrStack } from "../../hooks/usePrStatus.ts";
import type { StackPr } from "../../hooks/usePrStatus.ts";
import type {
  WorkItem,
  WorkItemStatus,
  SessionInfo,
  MessageEntry,
  StackStep,
} from "../../types.ts";
import type { DelegatorStatus } from "../../hooks/useDelegators.ts";

export interface ItemDetailsProps {
  item: WorkItem;

  /** 'inline' = expanded card in list view; 'panel' = sidebar drawer */
  variant: "inline" | "panel";

  /* Data */
  allItems?: WorkItem[];
  sessions?: SessionInfo[];
  sessionInfo?: SessionInfo;
  messages?: MessageEntry[];
  delegator?: DelegatorStatus;

  /* Callbacks — status & lifecycle */
  onStatusChange: (id: string, status: WorkItemStatus) => void;
  onPriorityChange?: (id: string, priority: number) => void;
  onDelegatorToggle?: (id: string, enabled: boolean) => void;
  onEdit?: (
    id: string,
    updates: { title?: string; description?: string },
  ) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onActivateStream?: (id: string) => void;
  onTeardownStream?: (id: string) => void;
  onPrUrlChange?: (id: string, prUrl: string) => void;
  onGeneratePlan?: (id: string) => void;
  onNotesChange?: (id: string, notes: string) => void;
  onSendMessage?: (sessionId: string, text: string) => void;
  onRefresh?: () => void;
  onUpdateBlockedBy?: (id: string, blocked_by: string[]) => void;

  /* State flags */
  activating?: boolean;
  tearingDown?: boolean;
}

function formatItemSummary(item: WorkItem): string {
  const lines = [
    `# ${item.title}`,
    `ID: ${item.id}`,
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    item.environment?.branch ? `Branch: ${item.environment.branch}` : "",
    item.runtime?.pr_url ? `PR: ${item.runtime.pr_url}` : "",
    item.description ? `\nDescription:\n${item.description}` : "",
    item.blocked_by.length > 0
      ? `\nBlocked by: ${item.blocked_by.join(", ")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function ItemDetails({
  item,
  variant,
  allItems = [],
  sessions,
  sessionInfo,
  messages = [],
  delegator,
  onStatusChange,
  onPriorityChange,
  onDelegatorToggle,
  onEdit,
  onDelete,
  onDuplicate,
  onActivateStream,
  onTeardownStream,
  onPrUrlChange,
  onGeneratePlan,
  onNotesChange,
  onSendMessage,
  onRefresh,
  onUpdateBlockedBy,
  activating,
  tearingDown,
}: ItemDetailsProps) {
  const isBusy = activating || tearingDown;
  const isStack = item.worker?.commit_strategy === "graphite_stack";
  const stackSteps = item.worker?.stack_steps ?? [];
  const stackCompletedCount = stackSteps.filter((s) => s.completed).length;
  const itemPlan = item.plan;
  const itemPlanFile = item.plan?.file;
  const hasLiveSession = !!sessionInfo;
  const hasSession = !!item.environment?.session_id;

  const { status: prStatus, loading: prLoading } = usePrStatus(item.runtime?.pr_url ?? null);
  const { stack: prStack, loading: stackLoading } = usePrStack(
    item.runtime?.pr_url ?? null,
    isStack,
  );

  // Editing state (panel variant uses these; inline variant uses InlineEdit)
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [titleText, setTitleText] = useState(item.title);
  const [descriptionText, setDescriptionText] = useState(item.description);
  const [notesText, setNotesText] = useState(notes || "");
  const [copied, setCopied] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [depInput, setDepInput] = useState("");
  const [showDepForm, setShowDepForm] = useState(false);
  const [prStatusFetched, setPrStatusFetched] = useState<{
    state?: string;
    reviewDecision?: string;
    checks?: string;
  } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Sync state when item changes
  useEffect(() => {
    if (!editingTitle) setTitleText(item.title);
  }, [item.title, editingTitle]);
  useEffect(() => {
    if (!editingDescription) setDescriptionText(item.description);
  }, [item.description, editingDescription]);
  useEffect(() => {
    if (!editingNotes) setNotesText(notes || "");
  }, [notes, editingNotes]);

  // Focus inputs when entering edit mode
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.selectionStart = titleRef.current.value.length;
    }
  }, [editingTitle]);
  useEffect(() => {
    if (editingDescription && descRef.current) {
      descRef.current.focus();
      descRef.current.selectionStart = descRef.current.value.length;
    }
  }, [editingDescription]);
  useEffect(() => {
    if (editingNotes && notesRef.current) {
      notesRef.current.focus();
      notesRef.current.selectionStart = notesRef.current.value.length;
    }
  }, [editingNotes]);

  // Fetch PR status for panel variant (DetailPanel's original fetch)
  useEffect(() => {
    if (variant !== "panel" || !item.runtime?.pr_url) return;
    const url = encodeURIComponent(item.runtime.pr_url);
    fetch(`/api/pr-status?url=${url}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setPrStatusFetched(data);
      })
      .catch(() => {});
  }, [item.runtime?.pr_url, variant]);

  // Linked session for panel variant
  const linkedSession =
    sessions?.find(
      (s) =>
        (item.environment?.session_id && s.id === item.environment.session_id) ||
        (item.environment?.worktree_path &&
          (s.cwd === item.environment.worktree_path ||
            item.environment.worktree_path!.startsWith(s.cwd))),
    ) || sessionInfo;

  // Activity entries
  const activityEntries = useMemo(() => {
    const entries: { timestamp: string; action: string; detail?: string }[] =
      [];
    if (item.created_at)
      entries.push({
        timestamp: item.created_at,
        action: "Created",
        detail: `Source: ${item.source}`,
      });
    if (item.activated_at)
      entries.push({ timestamp: item.activated_at, action: "Activated" });
    if (item.completed_at)
      entries.push({ timestamp: item.completed_at, action: "Completed" });
    entries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return entries;
  }, [item]);

  function handleOpenPlanFile() {
    fetch("/api/plan/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id }),
    }).catch((err) => console.error("Failed to open plan file:", err));
  }

  function handleTogglePlanApproval() {
    const planApproved = !!itemPlan?.approved;
    fetch("/api/plan/approve", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id, approved: !planApproved }),
    })
      .then((res) => {
        if (!res.ok)
          console.error("Failed to toggle plan approval:", res.status);
        onRefresh?.();
      })
      .catch((err) => console.error("Failed to toggle plan approval:", err));
  }

  const planApproved = !!itemPlan?.approved;

  const stateLabels: Record<string, string> = {
    standby: "Ready",
    thinking: "Thinking",
    responding: "Responding",
    zombie: "Disconnected",
    unknown: "Unknown",
  };

  const prStateLabels: Record<string, { label: string; cls: string }> = {
    OPEN: { label: "Open", cls: "prOpen" },
    CLOSED: { label: "Closed", cls: "prClosed" },
    MERGED: { label: "Merged", cls: "prMerged" },
  };

  return (
    <div
      className={classnames(styles.Root, styles[variant])}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Dependencies / Blocked By */}
      {item.blocked_by.length > 0 && (
        <div className={styles.Section}>
          <div className={styles.SectionHeader}>
            <h4 className={styles.SectionTitle}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              Blocked By
              <span className={styles.SectionCount}>
                {item.blocked_by.length}
              </span>
            </h4>
            {onUpdateBlockedBy && !showDepForm && (
              <button
                className={styles.EditButton}
                onClick={() => setShowDepForm(true)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add
              </button>
            )}
          </div>
          <div className={styles.DepList}>
            {item.blocked_by.map((depId) => {
              const dep = allItems.find((i) => i.id === depId);
              const isResolved = dep?.status === "completed";
              return (
                <div key={depId} className={styles.DepItem}>
                  <span
                    className={classnames(
                      styles.DepDot,
                      isResolved && styles.DepResolved,
                    )}
                  />
                  <span className={styles.DepText}>
                    <strong>{depId}</strong>
                    {dep ? ` — ${dep.title}` : " (unknown)"}
                    {isResolved ? " (completed)" : ""}
                  </span>
                  {onUpdateBlockedBy && (
                    <button
                      className={styles.DepRemove}
                      onClick={() =>
                        onUpdateBlockedBy(
                          item.id,
                          item.blocked_by.filter((id) => id !== depId),
                        )
                      }
                      title="Remove dependency"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {showDepForm && onUpdateBlockedBy && (
        <div className={styles.InlineForm}>
          <input
            className={styles.FormInput}
            type="text"
            list="dep-items-list"
            value={depInput}
            onChange={(e) => setDepInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && depInput.trim()) {
                const id = depInput.trim();
                if (!item.blocked_by.includes(id)) {
                  onUpdateBlockedBy(item.id, [...item.blocked_by, id]);
                }
                setDepInput("");
                setShowDepForm(false);
              }
              if (e.key === "Escape") {
                setDepInput("");
                setShowDepForm(false);
              }
            }}
            placeholder="Type work item ID (e.g. ws-005)..."
            autoFocus
          />
          <datalist id="dep-items-list">
            {allItems
              .filter(
                (i) => i.id !== item.id && !item.blocked_by.includes(i.id),
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
          </datalist>
          <div className={styles.FormActions}>
            <button
              className={styles.SaveButton}
              onClick={() => {
                if (
                  depInput.trim() &&
                  !item.blocked_by.includes(depInput.trim())
                ) {
                  onUpdateBlockedBy(item.id, [
                    ...item.blocked_by,
                    depInput.trim(),
                  ]);
                }
                setDepInput("");
                setShowDepForm(false);
              }}
            >
              Add
            </button>
            <button
              className={styles.CancelButton}
              onClick={() => {
                setDepInput("");
                setShowDepForm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Implementation Notes */}
      {implementationNotes && implementationNotes.length > 0 && (
        <div className={styles.Section}>
          <h4 className={styles.SectionTitle}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Implementation Notes
          </h4>
          <ul className={styles.NotesList}>
            {implementationNotes.map((note, i) => (
              <li key={i} className={styles.NoteItem}>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stack Steps */}
      {isStack && stackSteps.length > 0 && (
        <div className={styles.Section}>
          <div className={styles.SectionHeader}>
            <h4 className={styles.SectionTitle}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              Stack Steps
              <span
                className={styles.SectionCount}
                style={{
                  background:
                    stackCompletedCount === stackSteps.length
                      ? "var(--color-success-muted, rgba(34,197,94,0.15))"
                      : undefined,
                  color:
                    stackCompletedCount === stackSteps.length
                      ? "var(--color-success)"
                      : undefined,
                }}
              >
                {stackCompletedCount}/{stackSteps.length}
              </span>
            </h4>
          </div>
          <div className={styles.StackStepsList}>
            {[...stackSteps]
              .sort((a, b) => a.position - b.position)
              .map((step) => (
                <div
                  key={step.position}
                  className={classnames(
                    styles.StackStepItem,
                    step.completed && styles.StackStepCompleted,
                  )}
                >
                  <span
                    className={classnames(
                      styles.StackStepDot,
                      step.completed && styles.StackStepDotDone,
                    )}
                  />
                  <div className={styles.StackStepContent}>
                    <span className={styles.StackStepPosition}>
                      Step {step.position}
                    </span>
                    <span className={styles.StackStepDesc}>
                      {step.description}
                    </span>
                    <code className={styles.StackStepBranch}>
                      {item.environment?.branch}/{step.position}/{step.branch_suffix}
                    </code>
                  </div>
                  {step.completed && (
                    <svg
                      className={styles.StackStepCheck}
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Implementation Plan */}
      {(itemPlanFile ||
        onGeneratePlan ||
        item.status === "planning" ||
        item.status === "queued") && (
        <div className={styles.Section}>
          <div className={styles.SectionHeader}>
            <h4 className={styles.SectionTitle}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="15" y2="16" />
              </svg>
              Plan{itemPlanFile ? `: ${itemPlanFile.split("/").pop()}` : ""}
              {planApproved ? " (Approved)" : itemPlanFile ? " (Draft)" : ""}
            </h4>
            <div className={styles.PlanActions}>
              {onGeneratePlan && !itemPlanFile && (
                <button
                  className={styles.EditButton}
                  onClick={() => onGeneratePlan(item.id)}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                  Auto-Generate
                </button>
              )}
              {itemPlanFile && (
                <button
                  className={styles.EditButton}
                  onClick={handleOpenPlanFile}
                  title="Open plan file in editor"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Open File
                </button>
              )}
            </div>
          </div>
          {itemPlanFile && (
            <>
              <div className={styles.PlanApprovalRow}>
                {item.status !== "completed" && (
                  <button
                    className={
                      planApproved
                        ? styles.UnapproveButton
                        : styles.ApproveButton
                    }
                    onClick={handleTogglePlanApproval}
                  >
                    {planApproved ? "Revoke Approval" : "Approve Plan"}
                  </button>
                )}
                <span className={styles.PlanFilePath} title={itemPlanFile}>
                  {itemPlanFile.split("/").pop()}
                </span>
              </div>
              {itemPlan?.summary && (
                <p className={styles.NotesText}>{itemPlan.summary}</p>
              )}
            </>
          )}
          {!itemPlanFile && (
            <div className={styles.PlanEmpty}>
              No plan file yet. Generate one or create manually.
            </div>
          )}
        </div>
      )}

      {/* Description (panel variant only — inline variant renders description outside ItemDetails) */}
      {variant === "panel" && (
        <div className={styles.Section}>
          <div className={styles.SectionHeader}>
            <span className={styles.SectionLabel}>Description</span>
            {onEdit && !editingDescription && (
              <button
                className={styles.EditButton}
                onClick={() => setEditingDescription(true)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            )}
          </div>
          {editingDescription ? (
            <div className={styles.InlineForm}>
              <textarea
                ref={descRef}
                className={styles.FormTextarea}
                value={descriptionText}
                onChange={(e) => setDescriptionText(e.target.value)}
                placeholder="Describe this work item..."
                rows={6}
              />
              <div className={styles.FormActions}>
                <button
                  className={styles.SaveButton}
                  onClick={() => {
                    if (onEdit)
                      onEdit(item.id, { description: descriptionText });
                    setEditingDescription(false);
                  }}
                >
                  Save
                </button>
                <button
                  className={styles.CancelButton}
                  onClick={() => {
                    setEditingDescription(false);
                    setDescriptionText(item.description);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {item.description ? (
                <p className={styles.DescriptionText}>{item.description}</p>
              ) : (
                <span className={styles.EmptyText}>
                  {onEdit
                    ? "Click edit to add a description"
                    : "No description"}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Notes (editable) */}
      <div className={styles.Section}>
        <div className={styles.SectionHeader}>
          <span className={styles.SectionLabel}>Notes</span>
          {onNotesChange && !editingNotes && (
            <button
              className={styles.EditButton}
              onClick={() => setEditingNotes(true)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className={styles.InlineForm}>
            <textarea
              ref={notesRef}
              className={styles.FormTextarea}
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="Add notes about this work item..."
              rows={4}
            />
            <div className={styles.FormActions}>
              <button
                className={styles.SaveButton}
                onClick={() => {
                  if (onNotesChange) onNotesChange(item.id, notesText);
                  setEditingNotes(false);
                }}
              >
                Save
              </button>
              <button
                className={styles.CancelButton}
                onClick={() => {
                  setEditingNotes(false);
                  setNotesText(notes || "");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {notesText ? (
              <p className={styles.NotesText}>{notesText}</p>
            ) : notes ? (
              <p className={styles.NotesText}>{notes}</p>
            ) : (
              <span className={styles.EmptyText}>
                {onNotesChange ? "Click edit to add notes" : "No notes"}
              </span>
            )}
          </>
        )}
      </div>

      {/* Item Notes (localStorage-based) */}
      <div className={styles.Section}>
        <ItemNotes itemId={item.id} />
      </div>

      {/* Delegator Assessment */}
      {delegatorAssessment && (
        <div className={styles.Section}>
          <h4 className={styles.SectionTitle}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Delegator Assessment
          </h4>
          <p className={styles.AssessmentText}>{delegatorAssessment}</p>
        </div>
      )}

      {/* Activity Timeline */}
      <div className={styles.Section}>
        <h4 className={styles.SectionTitle}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Activity
        </h4>
        <ActivityLog entries={activityEntries} />
      </div>

      {/* Pull Request Section */}
      <div className={styles.Section}>
        <h4 className={styles.SectionTitle}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 009 9" />
          </svg>
          {isStack ? "PR Stack (Graphite)" : "Pull Request"}
        </h4>
        {item.runtime?.pr_url ? (
          <div className={styles.PrSection}>
            {/* Graphite stack view */}
            {isStack && prStack ? (
              <>
                {prStack.graphiteStackUrl && (
                  <a
                    className={styles.PrLink}
                    href={prStack.graphiteStackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View full stack on Graphite
                  </a>
                )}
                <div className={styles.StackList}>
                  {[...prStack.prs].reverse().map((pr: StackPr) => (
                    <div key={pr.number} className={styles.StackItem}>
                      <div className={styles.StackItemHeader}>
                        <a
                          className={styles.StackPrLink}
                          href={pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          #{pr.number}
                        </a>
                        <span className={styles.StackPrTitle}>{pr.title}</span>
                        <span
                          className={classnames(
                            styles.PrBadge,
                            styles[`pr_${pr.state.toLowerCase()}`],
                          )}
                        >
                          {pr.state}
                        </span>
                      </div>
                      <div className={styles.StackItemMeta}>
                        {pr.reviewDecision && (
                          <span
                            className={classnames(
                              styles.PrBadge,
                              styles[
                                `pr_review_${pr.reviewDecision.toLowerCase()}`
                              ],
                            )}
                          >
                            {pr.reviewDecision === "APPROVED"
                              ? "Approved"
                              : pr.reviewDecision === "CHANGES_REQUESTED"
                                ? "Changes Req."
                                : "Review Req."}
                          </span>
                        )}
                        <span
                          className={classnames(
                            styles.PrBadge,
                            pr.checksPass && styles.pr_checks_pass,
                            pr.checksFail && styles.pr_checks_fail,
                            !pr.checksPass &&
                              !pr.checksFail &&
                              styles.pr_checks_pending,
                          )}
                        >
                          {pr.checksPass
                            ? "Checks Pass"
                            : pr.checksFail
                              ? "Checks Fail"
                              : "Pending"}
                        </span>
                        <span className={styles.PrStats}>
                          <span className={styles.PrAdditions}>
                            +{pr.additions}
                          </span>
                          <span className={styles.PrDeletions}>
                            -{pr.deletions}
                          </span>
                          <span className={styles.PrFiles}>
                            {pr.changedFiles}f
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {stackLoading && (
                  <span className={styles.PrLoading}>Loading stack...</span>
                )}
              </>
            ) : (
              /* Single PR view */
              <>
                <div className={styles.PrHeader}>
                  <a
                    className={styles.PrLink}
                    href={item.runtime?.pr_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.runtime?.pr_url.replace(/^https?:\/\/github\.com\//, "")}
                  </a>
                  {prLoading && (
                    <span className={styles.PrLoading}>Loading...</span>
                  )}
                </div>
                {prStatus && prStatus.state !== "unknown" && (
                  <div className={styles.PrStatusGrid}>
                    <span
                      className={classnames(
                        styles.PrBadge,
                        styles[`pr_${prStatus.state.toLowerCase()}`],
                      )}
                    >
                      {prStatus.state}
                    </span>
                    {prStatus.reviewDecision && (
                      <span
                        className={classnames(
                          styles.PrBadge,
                          styles[
                            `pr_review_${prStatus.reviewDecision.toLowerCase()}`
                          ],
                        )}
                      >
                        {prStatus.reviewDecision === "APPROVED"
                          ? "Approved"
                          : prStatus.reviewDecision === "CHANGES_REQUESTED"
                            ? "Changes Requested"
                            : "Review Required"}
                      </span>
                    )}
                    {prStatus.checksTotal > 0 && (
                      <span
                        className={classnames(
                          styles.PrBadge,
                          prStatus.checksPass && styles.pr_checks_pass,
                          prStatus.checksFail && styles.pr_checks_fail,
                          prStatus.checksPending && styles.pr_checks_pending,
                        )}
                      >
                        Checks:{" "}
                        {prStatus.checksPass
                          ? "Pass"
                          : prStatus.checksFail
                            ? "Fail"
                            : "Pending"}
                      </span>
                    )}
                    <span className={styles.PrStats}>
                      <span className={styles.PrAdditions}>
                        +{prStatus.additions}
                      </span>
                      <span className={styles.PrDeletions}>
                        -{prStatus.deletions}
                      </span>
                      <span className={styles.PrFiles}>
                        {prStatus.changedFiles} file
                        {prStatus.changedFiles !== 1 ? "s" : ""}
                      </span>
                    </span>
                  </div>
                )}
                {prStatus?.reviews && prStatus.reviews.length > 0 && (
                  <div className={styles.PrReviewers}>
                    {prStatus.reviews.map((r, i) => (
                      <span
                        key={i}
                        className={classnames(
                          styles.PrReviewer,
                          styles[`pr_reviewer_${r.state.toLowerCase()}`],
                        )}
                      >
                        {r.author}
                        {r.state === "APPROVED" && " \u2713"}
                        {r.state === "CHANGES_REQUESTED" && " \u2717"}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : onPrUrlChange ? (
          <div className={styles.PrEmpty}>
            <InlineEdit
              value=""
              onSave={(url) => onPrUrlChange(item.id, url)}
              className={styles.PrUrlInput}
              placeholder="Paste PR URL..."
            />
          </div>
        ) : (
          <span className={styles.EmptyText}>No PR linked</span>
        )}
      </div>

      {/* Spend Breakdown */}
      {(() => {
        const spend = item.runtime?.spend as
          | { total_usd?: number; worker_usd?: number; delegator_usd?: number }
          | undefined;
        if (!spend || !spend.total_usd || spend.total_usd <= 0) return null;
        const hasBreakdown =
          spend.worker_usd != null || spend.delegator_usd != null;
        return (
          <div className={styles.Section}>
            <h4 className={styles.SectionTitle}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
              Token Spend
            </h4>
            <div className={styles.SpendBreakdown}>
              <div className={styles.SpendTotal}>
                <span className={styles.SpendTotalLabel}>Total</span>
                <span className={styles.SpendTotalValue}>
                  ${spend.total_usd.toFixed(2)}
                </span>
              </div>
              {hasBreakdown && (
                <div className={styles.SpendBuckets}>
                  <div className={styles.SpendBucket}>
                    <span className={styles.SpendBucketLabel}>Worker</span>
                    <span className={styles.SpendBucketValue}>
                      ${(spend.worker_usd ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className={styles.SpendBucket}>
                    <span className={styles.SpendBucketLabel}>Delegator</span>
                    <span className={styles.SpendBucketValue}>
                      ${(spend.delegator_usd ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Metadata Grid */}
      <div className={styles.MetaGrid}>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Status</span>
          <StatusBadge status={item.status} />
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Priority</span>
          <PriorityBadge priority={item.priority} size="md" />
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Branch</span>
          <div className={styles.BranchRow}>
            <code className={styles.MetaGridValue}>{item.environment?.branch}</code>
            <button
              className={styles.CopyButton}
              onClick={() => navigator.clipboard.writeText(item.environment?.branch || '')}
              aria-label="Copy branch name"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Source</span>
          <span className={styles.MetaGridValue}>{item.source}</span>
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Created</span>
          <span className={styles.MetaGridValue}>
            {formatDate(item.created_at)}
          </span>
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Activated</span>
          <span className={styles.MetaGridValue}>
            {formatDate(item.activated_at)}
          </span>
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Completed</span>
          <span className={styles.MetaGridValue}>
            {formatDate(item.completed_at)}
          </span>
        </div>
        <div className={styles.MetaGridItem}>
          <span className={styles.MetaGridLabel}>Delegator</span>
          <div className={styles.DelegatorRow}>
            {onDelegatorToggle && (
              <button
                className={classnames(
                  styles.Toggle,
                  item.worker?.delegator_enabled && styles.ToggleOn,
                )}
                onClick={() =>
                  onDelegatorToggle(item.id, !item.worker?.delegator_enabled)
                }
                role="switch"
                aria-checked={item.worker?.delegator_enabled}
              >
                <span className={styles.ToggleKnob} />
              </button>
            )}
            <span className={styles.MetaGridValue}>
              {delegator
                ? `${delegator.health?.status || "unknown"} (${delegator.cycle_count ?? 0} cycles${delegator.cycle_running ? ", running" : ""})`
                : item.worker?.delegator_enabled
                  ? "Enabled"
                  : "Off"}
            </span>
          </div>
        </div>
        {item.environment?.worktree_path && (
          <div className={classnames(styles.MetaGridItem, styles.MetaGridWide)}>
            <span className={styles.MetaGridLabel}>Worktree</span>
            <code className={styles.MetaGridValue}>{item.environment?.worktree_path}</code>
          </div>
        )}
      </div>

      {/* Session Status */}
      {linkedSession && (
        <div className={styles.Section}>
          <span className={styles.SectionLabel}>Linked Session</span>
          <div className={styles.SessionCard}>
            <span
              className={classnames(
                styles.SessionDot,
                styles[`session_${linkedSession.state}`],
              )}
            />
            <div className={styles.SessionInfo}>
              <span className={styles.SessionState}>
                {stateLabels[linkedSession.state] || linkedSession.state}
              </span>
              <code className={styles.SessionId}>
                {linkedSession.id.slice(0, 12)}
              </code>
            </div>
            <code className={styles.SessionCwd}>
              {linkedSession.cwd.split("/").pop()}
            </code>
          </div>
        </div>
      )}

      {/* Session Messaging */}
      {linkedSession && onSendMessage && linkedSession.state !== "zombie" && (
        <div className={styles.Section}>
          <h4 className={styles.SectionTitle}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            Session Messaging
          </h4>
          <MessageComposer
            sessionId={linkedSession.id}
            sessionState={linkedSession.state}
            messages={messages}
            onSend={(text) => onSendMessage(linkedSession.id, text)}
          />
        </div>
      )}

      {/* Actions */}
      <div className={styles.ActionBar}>
        {onPriorityChange && (
          <div className={styles.PriorityActions}>
            <button
              className={styles.ActionButton}
              onClick={() =>
                onPriorityChange(item.id, Math.max(1, item.priority - 1))
              }
              aria-label="Increase priority"
              disabled={item.priority <= 1}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <span className={styles.PriorityLabel}>
              Priority {item.priority}
            </span>
            <button
              className={styles.ActionButton}
              onClick={() => onPriorityChange(item.id, item.priority + 1)}
              aria-label="Decrease priority"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        )}

        <div className={styles.StatusActions}>
          {item.status === "queued" && (
            <button
              className={styles.ActionButtonText}
              onClick={() => onStatusChange(item.id, "planning")}
              disabled={isBusy}
            >
              Start Planning
            </button>
          )}
          {item.status === "queued" && onActivateStream && (
            <button
              className={classnames(
                styles.ActionButtonText,
                styles.ActionPrimary,
              )}
              onClick={() => onActivateStream(item.id)}
              disabled={isBusy}
            >
              Activate Stream
            </button>
          )}
          {item.status === "planning" && planApproved && (
            <button
              className={classnames(
                styles.ActionButtonText,
                onActivateStream && styles.ActionPrimary,
              )}
              onClick={() =>
                onActivateStream
                  ? onActivateStream(item.id)
                  : onStatusChange(item.id, "active")
              }
              disabled={isBusy}
            >
              {activating
                ? "Activating..."
                : onActivateStream
                  ? "Activate Stream"
                  : "Activate"}
            </button>
          )}
          {item.status === "planning" && !planApproved && (
            <button
              className={styles.ActionButtonText}
              onClick={() =>
                onActivateStream
                  ? onActivateStream(item.id)
                  : onStatusChange(item.id, "active")
              }
              disabled={isBusy}
            >
              {activating ? "Activating..." : "Skip Plan & Activate"}
            </button>
          )}
          {item.status === "planning" && !planApproved && (
            <button
              className={styles.ActionButtonText}
              onClick={() => onStatusChange(item.id, "queued")}
              disabled={isBusy}
            >
              Back to Queue
            </button>
          )}
          {item.status === "active" && (
            <>
              <button
                className={styles.ActionButtonText}
                onClick={() => onStatusChange(item.id, "review")}
                disabled={isBusy}
              >
                Move to Review
              </button>
            </>
          )}
          {item.status === "review" && (
            <>
              <button
                className={styles.ActionButtonText}
                onClick={() => onStatusChange(item.id, "completed")}
                disabled={isBusy}
              >
                Complete
              </button>
              <button
                className={styles.ActionButtonText}
                onClick={() => onStatusChange(item.id, "active")}
                disabled={isBusy}
              >
                Back to Active
              </button>
            </>
          )}
          {onTeardownStream &&
            (item.status === "active" || item.status === "review") &&
            (item.environment?.worktree_path || item.environment?.session_id) && (
              <button
                className={classnames(
                  styles.ActionButtonText,
                  styles.ActionDanger,
                )}
                onClick={() => onTeardownStream(item.id)}
                disabled={isBusy}
              >
                {tearingDown ? "Tearing down..." : "Tear Down"}
              </button>
            )}

          {/* Copy Summary */}
          <button
            className={styles.ActionButtonText}
            onClick={() => {
              navigator.clipboard.writeText(formatItemSummary(item));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied!" : "Copy Summary"}
          </button>

          {onDuplicate && (
            <button
              className={styles.ActionButtonText}
              onClick={() => onDuplicate(item.id)}
              disabled={isBusy}
            >
              Duplicate
            </button>
          )}
          <button
            className={classnames(styles.ActionButtonText, styles.ActionDanger)}
            onClick={() => onDelete(item.id)}
            disabled={isBusy}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
