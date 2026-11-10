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

// --- Weekly meal plan: meals/{monday}.yaml in the task repo. ---
// Mirrors the schema in worker/src/meals.ts, which validates what Claude saves.

export interface Ingredient {
  name: string;
  qty?: number;
  unit?: string;
  note?: string;
  pantry?: boolean;
}

export interface Meal {
  title: string;
  protein?: string;
  active_time?: string;
  total_time?: string;
  est_cost?: string;
  source: { type: "wiki" | "nyt" | "ai" | "other"; label?: string; url?: string };
  description: string;
  serves?: string;
  ingredients: Ingredient[];
  steps: string[];
  decision: "pending" | "approved" | "replace";
  feedback?: string;
}

export interface MealDay {
  date: string;
  availability: "home" | "away";
  reason: string;
  kind: "cook" | "leftover" | "open" | "away";
  title?: string;
  note?: string;
  leftover_of?: string[];
  meal?: Meal;
}

export interface MealPlan {
  week: string;
  status: "draft" | "changes_requested" | "approved" | "executed";
  generated: string | null;
  revised: string | null;
  approved_at: string | null;
  days: MealDay[];
  calendar_notes: string;
  notes: string;
  execution: string;
}
