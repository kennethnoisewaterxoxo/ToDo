export interface Recurring {
  interval: number;
  unit: "days" | "weeks" | "months";
  next_due: string | null;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  list: string;
  status: "pending" | "complete" | "snoozed";
  priority: "low" | "normal" | "high";
  due: string | null;
  created: string | null;
  completed: string | null;
  snoozed_until: string | null;
  recurring: Recurring | null;
  tags: string[];
  subtasks: Subtask[];
  notes: string;
}

export type TaskSummary = Omit<Task, "notes">;

export interface ShoppingItem {
  id: string;
  name: string;
  qty?: number;
  unit?: string;
  category?: string;
  checked?: boolean;
}
