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

