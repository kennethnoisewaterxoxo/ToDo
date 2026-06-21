import { useState } from "react";
import type { Subtask, Task } from "../types";
import styles from "./TaskDetail.module.css";

function makeSubtaskId(): string {
  return Math.random().toString(36).slice(2, 10);
}

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

  // Subtasks are edited inline (checklist) and kept in local state for a
  // snappy toggle, then persisted in the background. The component is keyed
  // by task id in App, so this re-seeds when a different task is selected.
  const [subtasks, setSubtasks] = useState<Subtask[]>(task.subtasks);
  const [newSubtask, setNewSubtask] = useState("");

  const doneCount = subtasks.filter((s) => s.done).length;

  function persistSubtasks(next: Subtask[]) {
    setSubtasks(next);
    void onUpdate({ ...task, subtasks: next });
  }

  function addSubtask() {
    const title = newSubtask.trim();
    if (!title) return;
    persistSubtasks([...subtasks, { id: makeSubtaskId(), title, done: false }]);
    setNewSubtask("");
  }

  function toggleSubtask(id: string) {
    persistSubtasks(subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  }

  function removeSubtask(id: string) {
    persistSubtasks(subtasks.filter((s) => s.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    // Preserve any inline subtask edits made outside the form.
    await onUpdate({ ...draft, subtasks });
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

        <div className={styles.subtasks}>
          <div className={styles.subtasksHeader}>
            <span className={styles.notesLabel}>Subtasks</span>
            {subtasks.length > 0 && (
              <span className={styles.subtaskProgress}>{doneCount}/{subtasks.length}</span>
            )}
          </div>

          {subtasks.map((st) => (
            <div key={st.id} className={`${styles.subtask} ${st.done ? styles.subtaskDone : ""}`}>
              <button
                className={styles.subtaskCheck}
                onClick={() => toggleSubtask(st.id)}
                aria-label={st.done ? "Mark subtask incomplete" : "Mark subtask complete"}
              >
                {st.done ? "✓" : ""}
              </button>
              <span className={styles.subtaskTitle}>{st.title}</span>
              <button
                className={styles.subtaskDelete}
                onClick={() => removeSubtask(st.id)}
                aria-label="Remove subtask"
              >
                ✕
              </button>
            </div>
          ))}

          <div className={styles.subtaskAdd}>
            <input
              className={styles.subtaskInput}
              placeholder="Add subtask…"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSubtask(); }}
            />
            <button
              className={styles.subtaskAddBtn}
              onClick={addSubtask}
              disabled={!newSubtask.trim()}
            >
              +
            </button>
          </div>
        </div>
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
