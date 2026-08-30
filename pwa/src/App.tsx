import { useState, useEffect, useCallback } from "react";
import { isConfigured } from "./github";
import { Setup } from "./components/Setup";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { TaskDetail } from "./components/TaskDetail";
import { ShoppingList } from "./components/ShoppingList";
import { useTasks } from "./hooks/useTasks";
import type { Task } from "./types";
import styles from "./App.module.css";

export type View = "today" | "overdue" | "all" | "shopping" | { list: string };

export default function App() {
  const [configured, setConfigured] = useState(isConfigured());
  const [view, setView] = useState<View>("today");
  const [selected, setSelected] = useState<Task | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { tasks, loading, error, refresh, completeTask, updateTask, addTask, deleteTask } = useTasks();

  useEffect(() => {
    if (configured) refresh();
  }, [configured]);

  const visibleTasks = tasks.filter((t) => {
    const today = new Date().toISOString().split("T")[0];
    if (view === "today") return t.status === "pending" && t.due && t.due <= today;
    if (view === "overdue") return t.status === "pending" && t.due && t.due < today;
    if (view === "all") return t.status !== "complete";
    if (typeof view === "object") return t.list === view.list && t.status !== "complete";
    return true;
  });

  const lists = [...new Set(tasks.map((t) => t.list))].sort();

  const handleComplete = useCallback(async (task: Task) => {
    await completeTask(task);
    if (selected?.id === task.id) setSelected(null);
  }, [completeTask, selected]);

  const handleDelete = useCallback(async (task: Task) => {
    await deleteTask(task);
    if (selected?.id === task.id) setSelected(null);
  }, [deleteTask, selected]);

  if (!configured) {
    return <Setup onConfigured={() => setConfigured(true)} />;
  }

  return (
    <div className={styles.layout}>
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
        view={view}
        onViewChange={(v) => { setView(v); setSidebarOpen(false); if (v === "shopping") setSelected(null); }}
        lists={lists}
        tasks={tasks}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className={styles.main}>
        {view === "shopping" ? (
          <ShoppingList onToggleSidebar={() => setSidebarOpen((o) => !o)} />
        ) : (
          <TaskList
            tasks={visibleTasks}
            loading={loading}
            error={error}
            view={view}
            onSelect={setSelected}
            selectedId={selected?.id}
            onComplete={handleComplete}
            onRefresh={refresh}
            onAddTask={addTask}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
          />
        )}
      </main>
      {selected && (
        <div className={styles.detailOverlay} onClick={() => setSelected(null)} />
      )}
      {selected && (
        <TaskDetail
          key={selected.id}
          task={selected}
          onClose={() => setSelected(null)}
          onUpdate={async (updated) => {
            await updateTask(updated);
            setSelected(updated);
          }}
          onComplete={handleComplete}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
