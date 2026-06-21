import yaml from "js-yaml";
import type { Task, ShoppingItem } from "./types";

const GITHUB_API = "https://api.github.com";

function getConfig() {
  const token = localStorage.getItem("github_token");
  const repo = localStorage.getItem("github_repo");
  if (!token || !repo) throw new Error("GitHub not configured");
  return { token, repo };
}

function headers() {
  const { token } = getConfig();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function repoUrl(path: string) {
  const { repo } = getConfig();
  return `${GITHUB_API}/repos/${repo}/contents/${path}`;
}

function parseTask(path: string, raw: string): Task {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) throw new Error(`Invalid task file: ${path}`);
  const fm = yaml.load(match[1]) as Record<string, unknown>;
  const notes = match[2].trim();
  return {
    id: fm.id as string,
    title: fm.title as string,
    list: fm.list as string,
    status: (fm.status as Task["status"]) ?? "pending",
    priority: (fm.priority as Task["priority"]) ?? "normal",
    due: (fm.due as string) ?? null,
    created: (fm.created as string) ?? null,
    completed: (fm.completed as string) ?? null,
    snoozed_until: (fm.snoozed_until as string) ?? null,
    recurring: fm.recurring
      ? (fm.recurring as Task["recurring"])
      : null,
    tags: (fm.tags as string[]) ?? [],
    subtasks: (fm.subtasks as Task["subtasks"]) ?? [],
    notes,
  };
}

function serializeTask(task: Task): string {
  const { notes, ...fm } = task;
  const frontmatter = yaml.dump(fm, { lineWidth: -1 });
  return `---\n${frontmatter}---\n${notes}\n`;
}

async function getSha(path: string): Promise<string | null> {
  const resp = await fetch(repoUrl(path), { headers: headers() });
  if (resp.status === 404) return null;
  const data = await resp.json();
  return data.sha ?? null;
}

export async function getLists(): Promise<string[]> {
  const resp = await fetch(repoUrl("tasks"), { headers: headers() });
  if (resp.status === 404) return [];
  const items = await resp.json();
  return items.filter((i: { type: string }) => i.type === "dir").map((i: { name: string }) => i.name);
}

export async function fetchAllTasks(): Promise<Task[]> {
  const lists = await getLists();
  const tasks: Task[] = [];

  await Promise.all(
    lists.map(async (list) => {
      const resp = await fetch(repoUrl(`tasks/${list}`), { headers: headers() });
      if (!resp.ok) return;
      const files = await resp.json();
      const mdFiles = files.filter((f: { name: string }) => f.name.endsWith(".md"));

      await Promise.all(
        mdFiles.map(async (file: { url: string; path: string }) => {
          const fileResp = await fetch(file.url, { headers: headers() });
          if (!fileResp.ok) return;
          const data = await fileResp.json();
          const raw = atob(data.content.replace(/\n/g, ""));
          try {
            tasks.push(parseTask(file.path, raw));
          } catch {
            // skip malformed files
          }
        })
      );
    })
  );

  return tasks;
}

export async function writeTask(task: Task, message?: string): Promise<void> {
  const path = `tasks/${task.list}/${task.id}.md`;
  const content = btoa(unescape(encodeURIComponent(serializeTask(task))));
  const sha = await getSha(path);
  const body: Record<string, unknown> = {
    message: message ?? `${sha ? "Update" : "Create"} task: ${task.title}`,
    content,
  };
  if (sha) body.sha = sha;

  const resp = await fetch(repoUrl(path), {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Failed to write task: ${resp.statusText}`);
}

export async function deleteTask(task: Task, message?: string): Promise<void> {
  const path = `tasks/${task.list}/${task.id}.md`;
  const sha = await getSha(path);
  if (!sha) return;

  const resp = await fetch(repoUrl(path), {
    method: "DELETE",
    headers: headers(),
    body: JSON.stringify({ message: message ?? `Delete task: ${task.title}`, sha }),
  });
  if (!resp.ok) throw new Error(`Failed to delete task: ${resp.statusText}`);
}

export function isConfigured(): boolean {
  return !!(localStorage.getItem("github_token") && localStorage.getItem("github_repo"));
}

export function saveConfig(token: string, repo: string) {
  localStorage.setItem("github_token", token);
  localStorage.setItem("github_repo", repo);
}

export async function fetchShoppingList(): Promise<ShoppingItem[]> {
  const resp = await fetch(repoUrl("shopping/list.yaml"), { headers: headers() });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Failed to fetch shopping list: ${resp.statusText}`);
  const data = await resp.json();
  const raw = atob(data.content.replace(/\n/g, ""));
  const parsed = yaml.load(raw) as { items?: ShoppingItem[] } | null;
  return parsed?.items ?? [];
}

export async function saveShoppingList(items: ShoppingItem[], message = "Update shopping list"): Promise<void> {
  const content = btoa(encodeURIComponent(yaml.dump({ items }, { lineWidth: -1 })).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
  const sha = await getSha("shopping/list.yaml");
  const body: Record<string, unknown> = { message, content };
  if (sha) body.sha = sha;
  const resp = await fetch(repoUrl("shopping/list.yaml"), {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Failed to save shopping list: ${resp.statusText}`);
}
