import { useState } from "react";
import type { Task } from "../types";
import type { View } from "../App";
import { TaskCard } from "./TaskCard";
import { AddTask } from "./AddTask";
import styles from "./TaskList.module.css";

interface Props {
  tasks: Task[];
  loading: boolean;
  error?: string | null;
  view: View;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onComplete: (task: Task) => void;
  onRefresh: () => void;
  onAddTask: (task: Task) => void;
  /** Set only when this view is a list with no open tasks. */
  removable?: { completed: number; remove: () => Promise<void> };
  onToggleSidebar: () => void;
}

function viewTitle(view: View): string {
  if (view === "today") return "Today";
  if (view === "overdue") return "Overdue";
  if (view === "all") return "All Tasks";
  if (typeof view === "object") return view.list;
  return view;
}

export function TaskList({ tasks, loading, error, view, selectedId, onSelect, onComplete, onRefresh, onAddTask, removable, onToggleSidebar }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  // Removing a list: idle -> confirm (asked in the page, not a browser dialog) -> removing.
  const [removeStep, setRemoveStep] = useState<"idle" | "confirm" | "removing">("idle");
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function removeList() {
    if (!removable) return;
    setRemoveStep("removing");
    setRemoveError(null);
    try {
      await removable.remove();
      setRemoveStep("idle");
    } catch (e) {
      setRemoveError(`Couldn't remove the whole list (${e instanceof Error ? e.message : "unknown error"}).`);
      setRemoveStep("idle");
    }
  }

  const defaultList = typeof view === "object" ? view.list : "inbox";
  // On the Today view, prefill the due date so new tasks land in Today.
  const defaultDue = view === "today" ? new Date().toISOString().split("T")[0] : "";

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <button className={styles.hamburger} onClick={onToggleSidebar} title="Menu">☰</button>
          <h2 className={styles.title}>{viewTitle(view)}</h2>
        </div>
        <div className={styles.actions}>
          <button className={styles.iconBtn} onClick={onRefresh} disabled={loading} title={loading ? "Refreshing…" : "Refresh"}>↺</button>
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ Add Task</button>
        </div>
      </header>

      {showAdd && (
        <AddTask
          defaultList={defaultList}
          defaultDue={defaultDue}
          onAdd={(task) => {
            onAddTask(task);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {error && (
        <div className={styles.error} role="alert">
          Couldn't load the full list ({error}). Showing the last known tasks — hit ↺ to retry.
        </div>
      )}

      <div className={styles.list}>
        {/* Keep showing the tasks we already have while a refresh is in flight. */}
        {tasks.length === 0 && (
          <div className={styles.empty}>
            {loading && !removable ? "Loading..." : "No tasks here."}
            {removable && removeStep === "idle" && (
              <button className={styles.removeListBtn} onClick={() => setRemoveStep("confirm")}>
                Remove this list
              </button>
            )}
            {removable && removeStep !== "idle" && (
              <div className={styles.removeConfirm}>
                <div>
                  This permanently deletes the list and its {removable.completed} completed task
                  {removable.completed === 1 ? "" : "s"}.
                </div>
                <div className={styles.removeActions}>
                  <button className={styles.removeListBtn} disabled={removeStep === "removing"} onClick={removeList}>
                    {removeStep === "removing" ? "Removing…" : "Yes, remove it"}
                  </button>
                  <button
                    className={styles.cancelBtn}
                    disabled={removeStep === "removing"}
                    onClick={() => setRemoveStep("idle")}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {removeError && <div className={styles.removeError} role="alert">{removeError}</div>}
          </div>
        )}
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            selected={task.id === selectedId}
            onSelect={() => onSelect(task)}
            onComplete={() => onComplete(task)}
          />
        ))}
      </div>
    </div>
  );
}
