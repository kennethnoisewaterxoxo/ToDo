// Mirrors pwa/src/types.ts: both read and write the same files in the task repo.
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

export interface ShoppingItem {
  id: string;
  name: string;
  qty?: number;
  unit?: string;
  category?: string;
  checked?: boolean;
}

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  // Passphrase typed on the /authorize page when connecting a new client.
  AUTH_PASSPHRASE: string;
  // Comma-separated hostnames allowed as OAuth redirect targets.
  ALLOWED_REDIRECT_HOSTS: string;
  // IANA zone used for "today" (due-today, overdue, created dates).
  TIMEZONE: string;
  OAUTH_KV: KVNamespace;
}
