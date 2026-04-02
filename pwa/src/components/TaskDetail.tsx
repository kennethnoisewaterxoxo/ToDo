import { useState } from "react";
import type { Task } from "../types";
import styles from "./TaskDetail.module.css";

interface Props {
  task: Task;
  onClose: () => void;
  onUpdate: (task: Task) => Promise<void>;
  onComplete: (task: Task) => Promise<void>;
  onDelete: (task: Task) => Promise<void>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export function TaskDetail({ task, onClose, onUpdate, onComplete, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Task>(task);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onUpdate(draft);
    setSaving(false);
    setEditing(false);
  }

  async function handleComplete() {
    await onComplete(task);
  }

  async function handleDelete() {
    if (confirm(`Delete "${task.title}"?`)) {
      await onDelete(task);
    }
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <button className={styles.close} onClick={onClose}>✕</button>
        <div className={styles.headerActions}>
          {!editing && (
            <button className={styles.actionBtn} onClick={() => setEditing(true)}>Edit</button>
          )}
          {editing && (
            <>
              <button className={styles.actionBtn} onClick={() => { setEditing(false); setDraft(task); }}>Cancel</button>
              <button className={`${styles.actionBtn} ${styles.primary}`} onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {editing ? (
          <div className={styles.editForm}>
            <input
              className={styles.titleInput}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <div className={styles.fieldRow}>
              <label>List</label>
              <input value={draft.list} onChange={(e) => setDraft({ ...draft, list: e.target.value })} />
            </div>
            <div className={styles.fieldRow}>
              <label>Due</label>
              <input type="date" value={draft.due ?? ""} onChange={(e) => setDraft({ ...draft, due: e.target.value || null })} />
            </div>
            <div className={styles.fieldRow}>
              <label>Priority</label>
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Task["priority"] })}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            {draft.recurring && (
              <div className={styles.fieldRow}>
                <label>Repeat every</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    value={draft.recurring.interval}
                    onChange={(e) => setDraft({ ...draft, recurring: { ...draft.recurring!, interval: Number(e.target.value) } })}
                    style={{ width: 80 }}
                  />
                  <select
                    value={draft.recurring.unit}
                    onChange={(e) => setDraft({ ...draft, recurring: { ...draft.recurring!, unit: e.target.value as "days" | "weeks" | "months" } })}
                  >
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                </div>
              </div>
            )}
            <div className={styles.fieldRow}>
              <label>Notes</label>
              <textarea
                rows={6}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
        ) : (
          <>
            <h2 className={styles.title}>{task.title}</h2>
            <div className={styles.fields}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>List</span>
                <span className={styles.fieldValue} style={{ textTransform: "capitalize" }}>{task.list}</span>
              </div>
              {task.due && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Due</span>
                  <span className={styles.fieldValue}>{formatDate(task.due)}</span>
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Priority</span>
                <span className={styles.fieldValue} style={{ textTransform: "capitalize" }}>{task.priority}</span>
              </div>
              {task.recurring && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Repeats</span>
                  <span className={styles.fieldValue}>Every {task.recurring.interval} {task.recurring.unit}</span>
                </div>
              )}
              {task.tags.length > 0 && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Tags</span>
                  <span className={styles.fieldValue}>{task.tags.join(", ")}</span>
                </div>
              )}
            </div>
            {task.notes && (
              <div className={styles.notes}>
                <div className={styles.notesLabel}>Notes</div>
                <pre className={styles.notesBody}>{task.notes}</pre>
              </div>
            )}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <button className={styles.deleteBtn} onClick={handleDelete}>Delete</button>
        {task.status !== "complete" && (
          <button className={styles.completeBtn} onClick={handleComplete}>Mark Complete</button>
        )}
      </div>
    </aside>
  );
}
