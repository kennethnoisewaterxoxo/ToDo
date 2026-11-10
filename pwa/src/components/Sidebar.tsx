import { useState } from "react";
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
  onOpenSettings: () => void;
}

const LISTS_OPEN_KEY = "sidebar_lists_open";

function count(tasks: Task[], predicate: (t: Task) => boolean) {
  return tasks.filter(predicate).length;
}

export function Sidebar({ view, onViewChange, lists, tasks, isOpen, onClose, onOpenSettings }: Props) {
  const today = new Date().toISOString().split("T")[0];

  const todayCount = count(tasks, (t) => t.status === "pending" && !!t.due && t.due <= today);
  const overdueCount = count(tasks, (t) => t.status === "pending" && !!t.due && t.due < today);

  // Folding the lists is remembered between visits.
  const [listsOpen, setListsOpen] = useState(() => {
    try {
      return localStorage.getItem(LISTS_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  function toggleLists() {
    setListsOpen((open) => {
      try {
        localStorage.setItem(LISTS_OPEN_KEY, open ? "0" : "1");
      } catch {
        // Not remembered, but still folds for this visit.
      }
      return !open;
    });
  }
  // When folded, keep the list you are looking at visible.
  const shownLists = listsOpen ? lists : lists.filter((list) => isActive({ list }));

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

      {/* To-dos scroll; the kitchen tools stay pinned below them. */}
      <div className={styles.todos}>
        <section className={styles.section}>
          <NavItem label="Today" badge={todayCount} active={isActive("today")} onClick={() => onViewChange("today")} />
          <NavItem label="Overdue" badge={overdueCount} active={isActive("overdue")} onClick={() => onViewChange("overdue")} badgeDanger />
          <NavItem label="All Tasks" active={isActive("all")} onClick={() => onViewChange("all")} />
        </section>

        {lists.length > 0 && (
          <section className={styles.section}>
            <button className={styles.sectionToggle} onClick={toggleLists} aria-expanded={listsOpen}>
              <span>Lists{listsOpen ? "" : ` (${lists.length})`}</span>
              <span className={styles.chevron}>{listsOpen ? "▾" : "▸"}</span>
            </button>
            {shownLists.map((list) => {
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
      </div>

      <section className={styles.kitchen}>
        <div className={styles.sectionLabel}>Kitchen</div>
        <div className={styles.tiles}>
          <Tile icon="🛒" label="Shopping" active={isActive("shopping")} onClick={() => onViewChange("shopping")} />
          <Tile icon="🍽️" label="Meal Plan" active={isActive("meals")} onClick={() => onViewChange("meals")} />
        </div>
      </section>

      <section className={`${styles.section} ${styles.footer}`}>
        <NavItem label="GitHub connection" active={false} onClick={onOpenSettings} />
      </section>
    </nav>
  );
}

function Tile({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`${styles.tile} ${active ? styles.tileActive : ""}`} onClick={onClick}>
      <span className={styles.tileIcon} aria-hidden="true">{icon}</span>
      <span className={styles.tileLabel}>{label}</span>
    </button>
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
