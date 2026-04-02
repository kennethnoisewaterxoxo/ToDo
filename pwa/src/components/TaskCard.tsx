import type { Task } from "../types";
import styles from "./TaskCard.module.css";

interface Props {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  onComplete: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  return due < new Date().toISOString().split("T")[0];
}

export function TaskCard({ task, selected, onSelect, onComplete }: Props) {
  const overdue = isOverdue(task.due);

  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ""}`}
      onClick={onSelect}
    >
      <button
        className={styles.check}
        onClick={(e) => { e.stopPropagation(); onComplete(); }}
        title="Complete"
        aria-label="Complete task"
      >
        <span className={styles.checkInner} />
      </button>

      <div className={styles.body}>
        <div className={styles.title}>{task.title}</div>
        <div className={styles.meta}>
          {task.list && <span className={styles.list}>{task.list}</span>}
          {task.due && (
            <span className={`${styles.due} ${overdue ? styles.overdue : ""}`}>
              {formatDate(task.due)}
            </span>
          )}
          {task.recurring && <span className={styles.recurring}>↻</span>}
          {task.tags.map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      </div>

      <div
        className={styles.priority}
        data-priority={task.priority}
        title={task.priority}
      />
    </div>
  );
}
