import { useState } from "react";
import { writeTask } from "../github";
import type { Task } from "../types";
import styles from "./AddTask.module.css";

interface Props {
  defaultList: string;
  onAdd: (task: Task) => Promise<void>;
  onCancel: () => void;
}

function makeId(title: string): string {
  const slug = title.toLowerCase().slice(0, 30).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const short = Math.random().toString(36).slice(2, 8);
  return `${new Date().toISOString().split("T")[0]}-${slug}-${short}`;
}

export function AddTask({ defaultList, onAdd, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [list, setList] = useState(defaultList);
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("normal");
  const [recurringInterval, setRecurringInterval] = useState("");
  const [recurringUnit, setRecurringUnit] = useState<"days" | "weeks" | "months">("weeks");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);

    const task: Task = {
      id: makeId(title),
      title: title.trim(),
      list: list.trim() || "inbox",
      status: "pending",
      priority,
      due: due || null,
      created: new Date().toISOString().split("T")[0],
      completed: null,
      snoozed_until: null,
      recurring: recurringInterval
        ? { interval: Number(recurringInterval), unit: recurringUnit, next_due: null }
        : null,
      tags: [],
      notes: "",
    };

    await writeTask(task, `Create task: ${task.title}`);
    await onAdd(task);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        autoFocus
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <div className={styles.row}>
        <input
          placeholder="List (e.g. inbox)"
          value={list}
          onChange={(e) => setList(e.target.value)}
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </div>
      <div className={styles.row}>
        <input
          type="number"
          placeholder="Repeat every"
          min={1}
          value={recurringInterval}
          onChange={(e) => setRecurringInterval(e.target.value)}
          style={{ width: 120 }}
        />
        <select
          value={recurringUnit}
          onChange={(e) => setRecurringUnit(e.target.value as "days" | "weeks" | "months")}
          disabled={!recurringInterval}
        >
          <option value="days">Days</option>
          <option value="weeks">Weeks</option>
          <option value="months">Months</option>
        </select>
      </div>
      <div className={styles.btns}>
        <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.save} disabled={saving}>
          {saving ? "Saving..." : "Add Task"}
        </button>
      </div>
    </form>
  );
}
