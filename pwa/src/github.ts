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

const MAX_RETRIES = 4;
const FETCH_CONCURRENCY = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// GitHub returns 429, or 403 with X-RateLimit-Remaining: 0 (primary limit) or a
// Retry-After header (secondary/abuse limit) when a burst of requests is throttled.
function isRateLimited(resp: Response): boolean {
  if (resp.status === 429) return true;
  if (resp.status === 403) {
    return resp.headers.get("x-ratelimit-remaining") === "0" || resp.headers.has("retry-after");
  }
  return false;
}

function retryDelayMs(resp: Response, attempt: number): number {
  const retryAfter = Number(resp.headers.get("retry-after"));
  if (retryAfter > 0) return retryAfter * 1000;

  const reset = Number(resp.headers.get("x-ratelimit-reset"));
  if (resp.headers.get("x-ratelimit-remaining") === "0" && reset > 0) {
    const untilReset = reset * 1000 - Date.now();
    if (untilReset > 0) return Math.min(untilReset, 60_000);
  }

  return Math.min(1000 * 2 ** attempt, 15_000) + Math.random() * 500;
}

// fetch against the GitHub API with no HTTP caching (so a refresh always sees the
// latest commit) and automatic backoff/retry when a request is rate-limited.
async function ghFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let resp!: Response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    resp = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...headers(), ...(init.headers ?? {}) },
    });
    if (!isRateLimited(resp) || attempt === MAX_RETRIES) return resp;
    await sleep(retryDelayMs(resp, attempt));
  }
  return resp;
}

// Run `fn` over `items` with at most `limit` calls in flight at once, preserving
// order. Unlike Promise.all(items.map(...)) this never floods the API with a
// burst that trips its abuse detection.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
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
  const resp = await ghFetch(repoUrl(path));
  if (resp.status === 404) return null;
  const data = await resp.json();
  return data.sha ?? null;
}

export async function getLists(): Promise<string[]> {
  const resp = await ghFetch(repoUrl("tasks"));
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Failed to list task folders: ${resp.status} ${resp.statusText}`);
  const items = await resp.json();
  return items.filter((i: { type: string }) => i.type === "dir").map((i: { name: string }) => i.name);
}

type TaskFile = { name: string; url: string; path: string };

export async function fetchAllTasks(): Promise<Task[]> {
  const lists = await getLists();

  // Enumerate every task file across all lists first, with bounded concurrency.
  const perList = await mapWithConcurrency(lists, FETCH_CONCURRENCY, async (list) => {
    const resp = await ghFetch(repoUrl(`tasks/${list}`));
    if (resp.status === 404) return [] as TaskFile[];
    if (!resp.ok) {
      throw new Error(`Failed to list tasks/${list}: ${resp.status} ${resp.statusText}`);
    }
    const files = (await resp.json()) as TaskFile[];
    return files.filter((f) => f.name.endsWith(".md"));
  });

  const files = perList.flat();

  // Then fetch each file's content, still bounded. A fetch that fails after all
  // retries throws so the caller can surface an error instead of silently
  // rendering a partial list. Only genuinely malformed files are skipped.
  const parsed = await mapWithConcurrency(files, FETCH_CONCURRENCY, async (file) => {
    const fileResp = await ghFetch(file.url);
    if (!fileResp.ok) {
      throw new Error(`Failed to fetch ${file.path}: ${fileResp.status} ${fileResp.statusText}`);
    }
    const data = await fileResp.json();
    try {
      const raw = atob(data.content.replace(/\n/g, ""));
      return parseTask(file.path, raw);
    } catch (err) {
      console.warn(`Skipping malformed task file ${file.path}:`, err);
      return null;
    }
  });

  return parsed.filter((t): t is Task => t !== null);
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
  const resp = await ghFetch(repoUrl("shopping/list.yaml"));
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
