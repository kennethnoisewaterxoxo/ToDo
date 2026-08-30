import { useState, useCallback } from "react";
import { fetchAllTasks, writeTask, deleteTask as ghDeleteTask } from "../github";
import type { Task } from "../types";
import { addDays, addWeeks, addMonths } from "date-fns";

function nextDue(due: string, interval: number, unit: string): string {
  const d = new Date(due + "T12:00:00");
  if (unit === "days") return addDays(d, interval).toISOString().split("T")[0];
  if (unit === "weeks") return addWeeks(d, interval).toISOString().split("T")[0];
  if (unit === "months") return addMonths(d, interval).toISOString().split("T")[0];
  return due;
}

function makeId(title: string): string {
  const slug = title.toLowerCase().slice(0, 30).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const short = Math.random().toString(36).slice(2, 8);
  return `${new Date().toISOString().split("T")[0]}-${slug}-${short}`;
}

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchAllTasks();
      all.sort((a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      });
      setTasks(all);
    } catch (e) {
      // Don't clear the last good list — show what we have plus a warning.
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  const completeTask = useCallback(async (task: Task) => {
    const completed = { ...task, status: "complete" as const, completed: new Date().toISOString().split("T")[0] };
    await writeTask(completed, `Complete task: ${task.title}`);

    const updates: Task[] = [completed];

    if (task.recurring && task.due) {
      const nextDueDate = nextDue(task.due, task.recurring.interval, task.recurring.unit);
      const nextNextDue = nextDue(nextDueDate, task.recurring.interval, task.recurring.unit);
      const next: Task = {
        ...task,
        id: makeId(task.title),
        status: "pending",
        due: nextDueDate,
        created: new Date().toISOString().split("T")[0],
        completed: null,
        subtasks: task.subtasks.map((st) => ({ ...st, done: false })),
        recurring: { ...task.recurring, next_due: nextNextDue },
      };
      await writeTask(next, `Create next recurrence: ${task.title}`);
      updates.push(next);
    }

    setTasks((prev) => {
      const filtered = prev.filter((t) => t.id !== task.id);
      return [...filtered, ...updates].sort((a, b) =>
        (a.due ?? "9999").localeCompare(b.due ?? "9999")
      );
    });
  }, []);

  const updateTask = useCallback(async (task: Task) => {
    await writeTask(task, `Update task: ${task.title}`);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
  }, []);

  const addTask = useCallback((task: Task) => {
    setTasks((prev) =>
      [...prev, task].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    );
  }, []);

  const deleteTask = useCallback(async (task: Task) => {
    await ghDeleteTask(task, `Delete task: ${task.title}`);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }, []);

  return { tasks, loading, error, refresh, completeTask, updateTask, addTask, deleteTask };
}
