import { useState, useRef, useEffect } from 'react'
import styles from './PlanEditor.module.scss'

export interface PlanStep {
  id: string
  text: string
  done: boolean
}

export interface Plan {
  summary: string
  steps: PlanStep[]
  approved: boolean
  created_at: string
  approved_at: string | null
}

interface PlanEditorProps {
  plan: Plan | null
  onSave: (plan: Plan) => void
  readOnly?: boolean
}

function createEmptyPlan(): Plan {
  return {
    summary: '',
    steps: [{ id: `step-${Date.now()}`, text: '', done: false }],
    approved: false,
    created_at: new Date().toISOString(),
    approved_at: null,
  }
}

export function PlanEditor({ plan, onSave, readOnly }: PlanEditorProps) {
  const [editing, setEditing] = useState(!plan)
  const [draft, setDraft] = useState<Plan>(plan || createEmptyPlan())
  const summaryRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && summaryRef.current && !plan) {
      summaryRef.current.focus()
    }
  }, [editing, plan])

  function handleSummaryChange(summary: string) {
    setDraft(prev => ({ ...prev, summary }))
  }

  function handleStepChange(id: string, text: string) {
    setDraft(prev => ({
      ...prev,
      steps: prev.steps.map(s => s.id === id ? { ...s, text } : s),
    }))
  }

  function handleStepToggle(id: string) {
    const updated = {
      ...draft,
      steps: draft.steps.map(s => s.id === id ? { ...s, done: !s.done } : s),
    }
    setDraft(updated)
    onSave(updated)
  }

  function handleAddStep() {
    setDraft(prev => ({
      ...prev,
      steps: [...prev.steps, { id: `step-${Date.now()}`, text: '', done: false }],
    }))
  }

  function handleRemoveStep(id: string) {
    setDraft(prev => ({
      ...prev,
      steps: prev.steps.filter(s => s.id !== id),
    }))
  }

  function handleSave() {
    if (!draft.summary.trim()) return
    const cleaned = {
      ...draft,
      steps: draft.steps.filter(s => s.text.trim()),
    }
    onSave(cleaned)
    setEditing(false)
  }

  function handleApprove() {
    const approved = {
      ...draft,
      approved: true,
      approved_at: new Date().toISOString(),
    }
    setDraft(approved)
    onSave(approved)
  }

  function handleUnapprove() {
    const unapproved = {
      ...draft,
      approved: false,
      approved_at: null,
    }
    setDraft(unapproved)
    onSave(unapproved)
  }

  if (!editing && plan) {
    const completedSteps = plan.steps.filter(s => s.done).length
    const totalSteps = plan.steps.length
    const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

    return (
      <div className={styles.Root}>
        <div className={styles.PlanHeader}>
          <div className={styles.PlanStatus}>
            {plan.approved ? (
              <span className={styles.ApprovedBadge}>Approved</span>
            ) : (
              <span className={styles.DraftBadge}>Draft</span>
            )}
            {totalSteps > 0 && (
              <span className={styles.Progress}>
                {completedSteps}/{totalSteps} steps ({progressPct}%)
              </span>
            )}
          </div>
          {!readOnly && (
            <button className={styles.EditButton} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        <p className={styles.Summary}>{plan.summary}</p>
        {plan.steps.length > 0 && (
          <div className={styles.Steps}>
            {plan.steps.map(step => (
              <label key={step.id} className={styles.Step}>
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={() => !readOnly && handleStepToggle(step.id)}
                  disabled={readOnly}
                />
                <span className={step.done ? styles.StepDone : styles.StepText}>
                  {step.text}
                </span>
              </label>
            ))}
          </div>
        )}
        {!readOnly && !plan.approved && (
          <button className={styles.ApproveButton} onClick={handleApprove}>
            Approve Plan
          </button>
        )}
        {!readOnly && plan.approved && (
          <button className={styles.UnapproveButton} onClick={handleUnapprove}>
            Revoke Approval
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.Root}>
      <div className={styles.EditorForm}>
        <label className={styles.Label}>
          Summary
          <textarea
            ref={summaryRef}
            className={styles.SummaryInput}
            value={draft.summary}
            onChange={e => handleSummaryChange(e.target.value)}
            placeholder="Describe the implementation approach..."
            rows={3}
          />
        </label>
        <div className={styles.StepsEditor}>
          <span className={styles.Label}>Steps</span>
          {draft.steps.map((step, i) => (
            <div key={step.id} className={styles.StepRow}>
              <span className={styles.StepNumber}>{i + 1}.</span>
              <input
                className={styles.StepInput}
                value={step.text}
                onChange={e => handleStepChange(step.id, e.target.value)}
                placeholder="Implementation step..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddStep()
                  }
                }}
              />
              {draft.steps.length > 1 && (
                <button
                  className={styles.RemoveStep}
                  onClick={() => handleRemoveStep(step.id)}
                  title="Remove step"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className={styles.AddStep} onClick={handleAddStep}>
            + Add step
          </button>
        </div>
        <div className={styles.EditorActions}>
          <button className={styles.SaveButton} onClick={handleSave} disabled={!draft.summary.trim()}>
            Save Plan
          </button>
          {plan && (
            <button className={styles.CancelButton} onClick={() => { setDraft(plan); setEditing(false) }}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
