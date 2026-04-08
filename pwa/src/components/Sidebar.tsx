import type { Task } from "../types";
import type { View } from "../App";
import styles from "./Sidebar.module.css";

interface Props {
  view: View;
  onViewChange: (v: View) => void;
  lists: string[];
  tasks: Task[];
  isOpen: boolean;
  onClose: () => void;
}

function count(tasks: Task[], predicate: (t: Task) => boolean) {
  return tasks.filter(predicate).length;
}

export function Sidebar({ view, onViewChange, lists, tasks, isOpen, onClose }: Props) {
  const today = new Date().toISOString().split("T")[0];

  const todayCount = count(tasks, (t) => t.status === "pending" && !!t.due && t.due <= today);
  const overdueCount = count(tasks, (t) => t.status === "pending" && !!t.due && t.due < today);

  function isActive(v: View) {
    if (typeof v === "object" && typeof view === "object") return v.list === view.list;
    return v === view;
  }

  return (
    <nav className={`${styles.sidebar} ${isOpen ? styles.open : ""}`}>
      <div className={styles.logoRow}>
        <div className={styles.logo}>ToDo</div>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      <section className={styles.section}>
        <NavItem label="Today" badge={todayCount} active={isActive("today")} onClick={() => onViewChange("today")} />
        <NavItem label="Overdue" badge={overdueCount} active={isActive("overdue")} onClick={() => onViewChange("overdue")} badgeDanger />
        <NavItem label="All Tasks" active={isActive("all")} onClick={() => onViewChange("all")} />
      </section>

      {lists.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionLabel}>Lists</div>
          {lists.map((list) => {
            const listCount = count(tasks, (t) => t.list === list && t.status === "pending");
            return (
              <NavItem
                key={list}
                label={list}
                badge={listCount}
                active={isActive({ list })}
                onClick={() => onViewChange({ list })}
              />
            );
          })}
        </section>
      )}
    </nav>
  );
}

function NavItem({
  label,
  badge,
  active,
  onClick,
  badgeDanger,
}: {
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
  badgeDanger?: boolean;
}) {
  return (
    <button className={`${styles.navItem} ${active ? styles.active : ""}`} onClick={onClick}>
      <span className={styles.navLabel}>{label}</span>
      {badge != null && badge > 0 && (
        <span className={`${styles.badge} ${badgeDanger ? styles.badgeDanger : ""}`}>{badge}</span>
      )}
    </button>
  );
}
