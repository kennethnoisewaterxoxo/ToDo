import { useState } from "react";
import type { Task } from "../types";
import type { View } from "../App";
import { TaskCard } from "./TaskCard";
import { AddTask } from "./AddTask";
import styles from "./TaskList.module.css";

interface Props {
  tasks: Task[];
  loading: boolean;
  view: View;
  selectedId?: string;
  onSelect: (task: Task) => void;
  onComplete: (task: Task) => void;
  onRefresh: () => void;
  onAddTask: (task: Task) => void;
  onToggleSidebar: () => void;
}

function viewTitle(view: View): string {
  if (view === "today") return "Today";
  if (view === "overdue") return "Overdue";
  if (view === "all") return "All Tasks";
  if (typeof view === "object") return view.list;
  return view;
}

export function TaskList({ tasks, loading, view, selectedId, onSelect, onComplete, onRefresh, onAddTask, onToggleSidebar }: Props) {
  const [showAdd, setShowAdd] = useState(false);

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
          <button className={styles.iconBtn} onClick={onRefresh} title="Refresh">↺</button>
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

      <div className={styles.list}>
        {loading && <div className={styles.empty}>Loading...</div>}
        {!loading && tasks.length === 0 && (
          <div className={styles.empty}>No tasks here.</div>
        )}
        {!loading && tasks.map((task) => (
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
