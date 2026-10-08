import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHubClient } from "./github";
import type { Env, Recurring, ShoppingItem, Task } from "./types";

// Tool names, parameters and result shapes are carried over unchanged from the
// original Python server, so existing Claude habits and prompts keep working.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const priority = z.enum(["low", "normal", "high"]);
const status = z.enum(["pending", "complete", "snoozed"]);
const unit = z.enum(["days", "weeks", "months"]);

// --- dates (all YYYY-MM-DD strings, which compare correctly as strings) ---

export function todayIn(timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

export function addInterval(iso: string, interval: number, u: Recurring["unit"]): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (u === "months") {
    // Like dateutil.relativedelta: clamp to the end of a shorter month (Jan 31 + 1 month = Feb 28).
    const first = new Date(Date.UTC(y, m - 1 + interval, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, lastDay));
    return first.toISOString().slice(0, 10);
  }
  const days = u === "weeks" ? interval * 7 : interval;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function randomHex(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
}

export function makeId(title: string, today: string): string {
  const slug = title.toLowerCase().slice(0, 30).replace(/ /g, "-").replace(/[^\p{L}\p{N}-]/gu, "");
  return `${today}-${slug}-${randomHex(6)}`;
}

function summary(t: Task) {
  return {
    id: t.id,
    title: t.title,
    list: t.list,
    status: t.status,
    priority: t.priority,
    due: t.due,
    recurring: !!t.recurring,
    tags: t.tags,
  };
}

// Python sorts by (due or date.max, priority) where priority is the raw string.
function byDueThenPriority(a: Task, b: Task): number {
  const da = a.due ?? "9999-12-31";
  const db = b.due ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildServer(env: Env): McpServer {
  const gh = new GitHubClient(env.GITHUB_TOKEN, env.GITHUB_REPO);
  const today = () => todayIn(env.TIMEZONE || "UTC");
  const server = new McpServer({ name: "todo", version: "1.0.0" });

  server.registerTool("get_lists", { description: "Return all task lists." }, async () =>
    json(await gh.getLists())
  );

  server.registerTool(
    "get_tasks",
    {
      description: "Return tasks, optionally filtered.",
      inputSchema: {
        list: z.string().optional().describe("Filter by list name (e.g. 'inbox', 'work'). Omit for all lists."),
        status: status
          .nullable()
          .default("pending")
          .describe("Filter by status: 'pending', 'complete', 'snoozed', or null for all."),
        due_before: isoDate.optional().describe("Return tasks due on or before this date (YYYY-MM-DD)."),
        due_after: isoDate.optional().describe("Return tasks due on or after this date (YYYY-MM-DD)."),
      },
    },
    async ({ list, status, due_before, due_after }) => {
      let tasks = (await gh.listTasks()).map((s) => s.task);
      if (list) tasks = tasks.filter((t) => t.list === list);
      if (status) tasks = tasks.filter((t) => t.status === status);
      if (due_before) tasks = tasks.filter((t) => t.due && t.due <= due_before);
      if (due_after) tasks = tasks.filter((t) => t.due && t.due >= due_after);
      tasks.sort(byDueThenPriority);
      return json(tasks.map(summary));
    }
  );

  server.registerTool("get_today", { description: "Return all pending tasks due today or overdue." }, async () => {
    const t0 = today();
    const tasks = (await gh.listTasks())
      .map((s) => s.task)
      .filter((t) => t.status === "pending" && t.due && t.due <= t0)
      .sort((a, b) => a.due!.localeCompare(b.due!));
    return json(tasks.map(summary));
  });

  server.registerTool(
    "get_overdue",
    { description: "Return all pending tasks that are past their due date." },
    async () => {
      const t0 = today();
      const tasks = (await gh.listTasks())
        .map((s) => s.task)
        .filter((t) => t.status === "pending" && t.due && t.due < t0)
        .sort((a, b) => a.due!.localeCompare(b.due!));
      return json(tasks.map(summary));
    }
  );

  server.registerTool(
    "get_task",
    {
      description: "Get full details of a single task including notes.",
      inputSchema: { task_id: z.string().describe("The task ID.") },
    },
    async ({ task_id }) => {
      const stored = await gh.getTask(task_id);
      return json(stored ? stored.task : { error: `Task ${task_id} not found` });
    }
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a new task.",
      inputSchema: {
        title: z.string().describe("Task title."),
        list: z.string().default("inbox").describe("List to add it to (e.g. 'inbox', 'work', 'home')."),
        due: isoDate.optional().describe("Due date (YYYY-MM-DD)."),
        priority: priority.default("normal"),
        notes: z.string().default("").describe("Optional markdown notes body."),
        tags: z.array(z.string()).optional().describe("Optional list of tag strings."),
        recurring_interval: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of days/weeks/months between recurrences."),
        recurring_unit: unit.optional(),
      },
    },
    async (args) => {
      const t0 = today();
      let recurring: Recurring | null = null;
      if (args.recurring_interval && args.recurring_unit) {
        recurring = {
          interval: args.recurring_interval,
          unit: args.recurring_unit,
          next_due: addInterval(args.due ?? t0, args.recurring_interval, args.recurring_unit),
        };
      }
      const task: Task = {
        id: makeId(args.title, t0),
        title: args.title,
        list: args.list,
        status: "pending",
        priority: args.priority,
        due: args.due ?? null,
        created: t0,
        completed: null,
        snoozed_until: null,
        recurring,
        tags: args.tags ?? [],
        subtasks: [],
        notes: args.notes,
      };
      await gh.writeTask(task, `Create task: ${task.title}`);
      return json(summary(task));
    }
  );

  server.registerTool(
    "complete_task",
    {
      description: "Mark a task as complete. If recurring, creates the next instance automatically.",
      inputSchema: { task_id: z.string().describe("The task ID to complete.") },
    },
    async ({ task_id }) => {
      const stored = await gh.getTask(task_id);
      if (!stored) return json({ error: `Task ${task_id} not found` });
      const t0 = today();
      const task = { ...stored.task, status: "complete" as const, completed: t0 };
      await gh.writeTask(task, `Complete task: ${task.title}`, stored.sha);

      let next: Task | null = null;
      if (task.recurring && task.due) {
        const { interval, unit } = task.recurring;
        const nextDue = addInterval(task.due, interval, unit);
        next = {
          ...task,
          id: makeId(task.title, t0),
          status: "pending",
          due: nextDue,
          created: t0,
          completed: null,
          snoozed_until: null,
          recurring: { interval, unit, next_due: addInterval(nextDue, interval, unit) },
          // Fresh checklist for the next occurrence.
          subtasks: task.subtasks.map((s) => ({ ...s, done: false })),
        };
        await gh.writeTask(next, `Create next recurrence: ${task.title}`);
      }
      return json({ completed: summary(task), next_instance: next ? summary(next) : null });
    }
  );

  server.registerTool(
    "update_task",
    {
      description: "Update fields on an existing task.",
      inputSchema: {
        task_id: z.string().describe("The task ID to update."),
        title: z.string().optional(),
        list: z.string().optional().describe("Move to a different list."),
        due: isoDate.optional().describe("New due date (YYYY-MM-DD)."),
        priority: priority.optional(),
        status: status.optional(),
        notes: z.string().optional().describe("Replace the notes body."),
        tags: z.array(z.string()).optional().describe("Replace the tags list."),
      },
    },
    async ({ task_id, ...changes }) => {
      const stored = await gh.getTask(task_id);
      if (!stored) return json({ error: `Task ${task_id} not found` });
      const task: Task = { ...stored.task };
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (task as any)[key] = value;
      }
      if (task.list !== stored.task.list) {
        // Moving lists moves the file: write the new path first so a failure
        // part-way leaves a duplicate rather than losing the task.
        await gh.writeTask(task, `Move task ${task.title} to ${task.list}`);
        await gh.deleteFile(stored.path, `Move task ${task.title} to ${task.list}`, stored.sha);
      } else {
        await gh.writeTask(task, `Update task: ${task.title}`, stored.sha);
      }
      return json(summary(task));
    }
  );

  server.registerTool(
    "snooze_task",
    {
      description: "Snooze a task until a future date.",
      inputSchema: {
        task_id: z.string().describe("The task ID to snooze."),
        until: isoDate.describe("Date (YYYY-MM-DD) to snooze until."),
      },
    },
    async ({ task_id, until }) => {
      const stored = await gh.getTask(task_id);
      if (!stored) return json({ error: `Task ${task_id} not found` });
      const task = { ...stored.task, status: "snoozed" as const, snoozed_until: until };
      await gh.writeTask(task, `Snooze task: ${task.title} until ${until}`, stored.sha);
      return json(summary(task));
    }
  );

  server.registerTool(
    "delete_task",
    {
      description: "Permanently delete a task.",
      inputSchema: { task_id: z.string().describe("The task ID to delete.") },
    },
    async ({ task_id }) => {
      const stored = await gh.getTask(task_id);
      if (!stored) return json({ error: `Task ${task_id} not found` });
      await gh.deleteFile(stored.path, `Delete task: ${stored.task.title}`, stored.sha);
      return json({ deleted: task_id, title: stored.task.title });
    }
  );

  server.registerTool(
    "search_tasks",
    {
      description: "Search tasks by title or notes content (case-insensitive).",
      inputSchema: { query: z.string().describe("Search string.") },
    },
    async ({ query }) => {
      const q = query.toLowerCase();
      const matched = (await gh.listTasks())
        .map((s) => s.task)
        .filter((t) => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
      return json(matched.map(summary));
    }
  );

  server.registerTool("get_shopping_list", { description: "Return all items on the shopping list." }, async () =>
    json((await gh.getShoppingList()).items)
  );

  server.registerTool(
    "add_shopping_item",
    {
      description: "Add an item to the shopping list.",
      inputSchema: {
        name: z.string().describe("Item name (e.g. 'Milk', 'Bread', 'Flour')."),
        qty: z.number().optional().describe("Optional numeric quantity (e.g. 2, 500, 0.5)."),
        unit: z
          .string()
          .optional()
          .describe(
            "Optional unit (e.g. 'g', 'kg', 'ml', 'L', 'tsp', 'tbsp', 'cup', 'oz', 'lb', 'each', 'dozen', 'can', 'bag', 'bunch')."
          ),
        category: z.string().optional().describe("Optional category (e.g. 'dairy', 'produce', 'frozen', 'bakery')."),
      },
    },
    async ({ name, qty, unit, category }) => {
      const { items, sha } = await gh.getShoppingList();
      const item: ShoppingItem = { id: randomHex(8), name };
      if (qty !== undefined) item.qty = qty;
      if (unit) item.unit = unit;
      if (category) item.category = category;
      await gh.saveShoppingList([...items, item], `Add shopping item: ${name}`, sha);
      return json(item);
    }
  );

  server.registerTool(
    "remove_shopping_item",
    {
      description: "Remove an item from the shopping list by ID.",
      inputSchema: { item_id: z.string().describe("The item ID to remove (use get_shopping_list to find IDs).") },
    },
    async ({ item_id }) => {
      const { items, sha } = await gh.getShoppingList();
      const kept = items.filter((i) => i.id !== item_id);
      if (kept.length === items.length) return json({ error: `Item ${item_id} not found` });
      await gh.saveShoppingList(kept, `Remove shopping item ${item_id}`, sha);
      return json({ removed: item_id });
    }
  );

  server.registerTool("clear_shopping_list", { description: "Clear all items from the shopping list." }, async () => {
    const { sha } = await gh.getShoppingList();
    await gh.saveShoppingList([], "Clear shopping list", sha);
    return json({ cleared: true });
  });

  return server;
}
