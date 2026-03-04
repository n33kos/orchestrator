import { useState, useEffect, useRef } from "react";
import styles from "./SettingsPanel.module.scss";
import type { OrchestratorSettings } from "../../hooks/useSettings.ts";
import { parseClipboardItems } from "../../utils/clipboard-import.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";

interface SettingsPanelProps {
  settings: OrchestratorSettings;
  onUpdate: <K extends keyof OrchestratorSettings>(
    key: K,
    value: OrchestratorSettings[K],
  ) => void;
  onReset: () => void;
  onClose: () => void;
  onExportQueue?: () => void;
  onExportCsv?: () => void;
  onImportQueue?: (file: File) => void;
  onClipboardImport?: (
    items: {
      title: string;
      description?: string;
      type?: string;
      priority?: number;
    }[],
  ) => void;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.Row}>
      <div className={styles.RowInfo}>
        <span className={styles.RowLabel}>{label}</span>
        {description && (
          <span className={styles.RowDescription}>{description}</span>
        )}
      </div>
      <div className={styles.RowControl}>{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`${styles.Toggle} ${checked ? styles.ToggleOn : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={styles.ToggleKnob} />
    </button>
  );
}

export function SettingsPanel({
  settings,
  onUpdate,
  onReset,
  onClose,
  onExportQueue,
  onExportCsv,
  onImportQueue,
  onClipboardImport,
}: SettingsPanelProps) {
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const pollOptions = [
    { label: "1s", value: 1000 },
    { label: "3s", value: 3000 },
    { label: "5s", value: 5000 },
    { label: "10s", value: 10000 },
    { label: "30s", value: 30000 },
  ];

  return (
    <div className={styles.Overlay}>
      <div className={styles.Panel} ref={panelRef}>
        <div className={styles.Header}>
          <h2 className={styles.Title}>Settings</h2>
          <button
            className={styles.CloseButton}
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className={styles.Content}>
          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Concurrency</h3>
            <SettingRow
              label="Max active"
              description="Maximum concurrent work streams"
            >
              <div className={styles.NumberControl}>
                <button
                  className={styles.NumberButton}
                  onClick={() =>
                    onUpdate(
                      "maxConcurrentProjects",
                      Math.max(1, settings.maxConcurrentProjects - 1),
                    )
                  }
                  disabled={settings.maxConcurrentProjects <= 1}
                >
                  -
                </button>
                <span className={styles.NumberValue}>
                  {settings.maxConcurrentProjects}
                </span>
                <button
                  className={styles.NumberButton}
                  onClick={() =>
                    onUpdate(
                      "maxConcurrentProjects",
                      Math.min(16, settings.maxConcurrentProjects + 1),
                    )
                  }
                  disabled={settings.maxConcurrentProjects >= 16}
                >
                  +
                </button>
              </div>
            </SettingRow>
          </div>

          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Polling</h3>
            <SettingRow
              label="Refresh interval"
              description="How often to poll the queue for updates"
            >
              <div className={styles.SegmentControl}>
                {pollOptions.map((opt) => (
                  <button
                    key={opt.value}
                    className={`${styles.Segment} ${settings.pollIntervalMs === opt.value ? styles.SegmentActive : ""}`}
                    onClick={() => onUpdate("pollIntervalMs", opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
          </div>

          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Automation</h3>
            <SettingRow
              label="Auto-activate"
              description="Automatically start queued items when a slot opens"
            >
              <Toggle
                checked={settings.autoActivate}
                onChange={(v) => onUpdate("autoActivate", v)}
              />
            </SettingRow>
            <SettingRow
              label="Require approved plan"
              description="Only auto-activate items with an approved plan file"
            >
              <Toggle
                checked={settings.requireApprovedPlan}
                onChange={(v) => onUpdate("requireApprovedPlan", v)}
              />
            </SettingRow>
            <SettingRow
              label="Plans directory"
              description="Where plan files are stored"
            >
              <input
                className={styles.TextInput}
                type="text"
                value={settings.plansDirectory}
                onChange={(e) => onUpdate("plansDirectory", e.target.value)}
                placeholder="~/.claude/orchestrator/plans"
              />
            </SettingRow>
            <SettingRow
              label="Delegator by default"
              description="Enable delegator for new work items"
            >
              <Toggle
                checked={settings.defaultDelegatorEnabled}
                onChange={(v) => onUpdate("defaultDelegatorEnabled", v)}
              />
            </SettingRow>
            <SettingRow
              label="Scheduler poll interval"
              description="How often the scheduler checks for work"
            >
              <div className={styles.SegmentControl}>
                {[
                  { label: "1m", value: 60 },
                  { label: "2m", value: 120 },
                  { label: "3m", value: 180 },
                  { label: "5m", value: 300 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    className={`${styles.Segment} ${settings.schedulerPollInterval === opt.value ? styles.SegmentActive : ""}`}
                    onClick={() =>
                      onUpdate("schedulerPollInterval", opt.value)
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow
              label="Delegator cycle"
              description="How often delegators check on workers"
            >
              <div className={styles.SegmentControl}>
                {[
                  { label: "2m", value: 120 },
                  { label: "5m", value: 300 },
                  { label: "10m", value: 600 },
                  { label: "15m", value: 900 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    className={`${styles.Segment} ${settings.delegatorCycleInterval === opt.value ? styles.SegmentActive : ""}`}
                    onClick={() =>
                      onUpdate("delegatorCycleInterval", opt.value)
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow
              label="Stall threshold"
              description="Minutes before a stream is flagged as stalled"
            >
              <div className={styles.NumberControl}>
                <button
                  className={styles.NumberButton}
                  onClick={() =>
                    onUpdate(
                      "stallThresholdMinutes",
                      Math.max(10, settings.stallThresholdMinutes - 10),
                    )
                  }
                  disabled={settings.stallThresholdMinutes <= 10}
                  aria-label="Decrease stall threshold"
                >
                  -
                </button>
                <span className={styles.NumberValue}>
                  {settings.stallThresholdMinutes}m
                </span>
                <button
                  className={styles.NumberButton}
                  onClick={() =>
                    onUpdate(
                      "stallThresholdMinutes",
                      Math.min(120, settings.stallThresholdMinutes + 10),
                    )
                  }
                  disabled={settings.stallThresholdMinutes >= 120}
                  aria-label="Increase stall threshold"
                >
                  +
                </button>
              </div>
            </SettingRow>
            <SettingRow
              label="Archive after"
              description="Auto-archive completed items older than this"
            >
              <div className={styles.NumberControl}>
                <button
                  className={styles.NumberButton}
                  onClick={() =>
                    onUpdate(
                      "archiveAfterDays",
                      Math.max(1, settings.archiveAfterDays - 1),
                    )
                  }
                  disabled={settings.archiveAfterDays <= 1}
                  aria-label="Decrease archive age"
                >
                  -
                </button>
                <span className={styles.NumberValue}>
                  {settings.archiveAfterDays}d
                </span>
                <button
                  className={styles.NumberButton}
                  onClick={() =>
                    onUpdate(
                      "archiveAfterDays",
                      Math.min(30, settings.archiveAfterDays + 1),
                    )
                  }
                  disabled={settings.archiveAfterDays >= 30}
                  aria-label="Increase archive age"
                >
                  +
                </button>
              </div>
            </SettingRow>
          </div>

          <div className={styles.Group}>
            <h3 className={styles.GroupTitle}>Notifications</h3>
            <SettingRow
              label="Sound effects"
              description="Play sounds on important events"
            >
              <Toggle
                checked={settings.soundEnabled}
                onChange={(v) => onUpdate("soundEnabled", v)}
              />
            </SettingRow>
          </div>

          {(onExportQueue || onImportQueue) && (
            <div className={styles.Group}>
              <h3 className={styles.GroupTitle}>Data</h3>
              {onExportQueue && (
                <SettingRow
                  label="Export queue"
                  description="Download the current queue as a JSON file"
                >
                  <button
                    className={styles.ExportButton}
                    onClick={onExportQueue}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export JSON
                  </button>
                </SettingRow>
              )}
              {onExportCsv && (
                <SettingRow
                  label="Export as CSV"
                  description="Download queue data in spreadsheet-compatible format"
                >
                  <button className={styles.ExportButton} onClick={onExportCsv}>
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
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    Export CSV
                  </button>
                </SettingRow>
              )}
              {onImportQueue && (
                <SettingRow
                  label="Import queue"
                  description="Load work items from a JSON file"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onImportQueue(file);
                        e.target.value = "";
                      }
                    }}
                  />
                  <button
                    className={styles.ExportButton}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Import JSON
                  </button>
                </SettingRow>
              )}
              {onClipboardImport && (
                <SettingRow
                  label="Import from clipboard"
                  description="Paste JSON, CSV, or newline-separated titles"
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      alignItems: "flex-end",
                    }}
                  >
                    <button
                      className={styles.ExportButton}
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          const items = parseClipboardItems(text);
                          if (items.length === 0) {
                            setClipboardStatus("No items found in clipboard");
                          } else {
                            onClipboardImport(items);
                            setClipboardStatus(
                              `Imported ${items.length} item${items.length !== 1 ? "s" : ""}`,
                            );
                          }
                        } catch {
                          setClipboardStatus("Clipboard access denied");
                        }
                        setTimeout(() => setClipboardStatus(null), 3000);
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                      </svg>
                      Paste from Clipboard
                    </button>
                    {clipboardStatus && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-muted)",
                        }}
                      >
                        {clipboardStatus}
                      </span>
                    )}
                  </div>
                </SettingRow>
              )}
            </div>
          )}

          <TrainingSection />

          <div className={styles.Footer}>
            <button className={styles.ResetButton} onClick={onReset}>
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrainingSection() {
  const [profileContent, setProfileContent] = useState<string | null>(null);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [training, setTraining] = useState(false);
  const [preseeding, setPreseeding] = useState(false);
  const [trainingOutput, setTrainingOutput] = useState("");

  useEffect(() => {
    fetch("/api/training/profile")
      .then((res) => res.json())
      .then((data) => setProfileContent(data.content))
      .catch(() => {
        /* ignore */
      });
  }, []);

  async function handleTrain() {
    setTraining(true);
    setTrainingOutput("");
    try {
      const res = await fetch("/api/training/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastN: 30 }),
      });
      const data = await res.json();
      setTrainingOutput(data.output || data.error || "Done");
      // Refresh profile
      const profileRes = await fetch("/api/training/profile");
      const profileData = await profileRes.json();
      setProfileContent(profileData.content);
    } catch {
      setTrainingOutput("Training failed");
    } finally {
      setTraining(false);
    }
  }

  async function handlePreseed() {
    setPreseeding(true);
    setTrainingOutput("");
    try {
      const res = await fetch("/api/training/preseed", { method: "POST" });
      const data = await res.json();
      setTrainingOutput(data.output || data.error || "Done");
      // Refresh profile
      const profileRes = await fetch("/api/training/profile");
      const profileData = await profileRes.json();
      setProfileContent(profileData.content);
    } catch {
      setTrainingOutput("Preseed failed");
    } finally {
      setPreseeding(false);
    }
  }

  return (
    <div className={styles.Group}>
      <h3 className={styles.GroupTitle}>Training</h3>
      <div className={styles.TrainingActions}>
        {profileContent === null ? (
          <button
            className={styles.ExportButton}
            onClick={handlePreseed}
            disabled={preseeding}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            {preseeding ? "Bootstrapping..." : "Bootstrap Profile"}
          </button>
        ) : (
          <>
            <button
              className={styles.ExportButton}
              onClick={handleTrain}
              disabled={training}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
              {training ? "Training..." : "Train from latest session"}
            </button>
            <button
              className={styles.ProfileToggle}
              onClick={() => setProfileExpanded(!profileExpanded)}
            >
              {profileExpanded ? "Hide profile" : "View profile"}
            </button>
          </>
        )}
      </div>
      {trainingOutput && (
        <pre className={styles.TrainingOutput}>{trainingOutput}</pre>
      )}
      {profileExpanded &&
        profileContent &&
        (editingProfile ? (
          <div className={styles.ProfileEdit}>
            <textarea
              className={styles.ProfileTextarea}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={20}
            />
            <div className={styles.ProfileEditActions}>
              <button
                className={styles.ExportButton}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await fetch("/api/training/profile", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: editText }),
                    });
                    setProfileContent(editText);
                    setEditingProfile(false);
                  } catch {
                    /* ignore */
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                className={styles.ProfileToggle}
                onClick={() => {
                  setEditingProfile(false);
                  setEditText("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.ProfileViewWrap}>
            <button
              className={styles.ProfileEditButton}
              onClick={() => {
                setEditingProfile(true);
                setEditText(profileContent);
              }}
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
            <pre className={styles.ProfilePreview}>{profileContent}</pre>
          </div>
        ))}
    </div>
  );
}
