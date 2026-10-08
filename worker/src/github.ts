import yaml from "js-yaml";
import type { ShoppingItem, Task } from "./types";

const GITHUB_API = "https://api.github.com";
const SHOPPING_PATH = "shopping/list.yaml";

const MAX_RETRIES = 3;
// Claude gives up on a tool call long before GitHub's hour-long rate-limit window
// resets, so cap how long a single backoff can stall the request.
const MAX_RETRY_DELAY_MS = 8_000;

// A task as read from the repo, with the blob SHA it was read at. Writing back with
// that SHA makes GitHub reject the write (409) if the file changed in between, rather
// than silently overwriting an edit made from the PWA.
export interface StoredTask {
  task: Task;
  path: string;
  sha: string;
}

export class GitHubError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same throttling rules as pwa/src/github.ts: 429, or 403 with an exhausted primary
// limit or a Retry-After (secondary limit).
function isRateLimited(resp: Response): boolean {
  if (resp.status === 429) return true;
  if (resp.status === 403) {
    return resp.headers.get("x-ratelimit-remaining") === "0" || resp.headers.has("retry-after");
  }
  return false;
}

function retryDelayMs(resp: Response, attempt: number): number {
  const retryAfter = Number(resp.headers.get("retry-after"));
  if (retryAfter > 0) return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS) + Math.random() * 500;
}

// GitHub returns file contents as base64 of the raw UTF-8 bytes; atob() alone would
// yield Latin-1 and mangle any multi-byte character.
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// js-yaml turns an unquoted 2026-10-08 into a Date. Files written by the PWA and the
// Python server quote dates, but normalise anyway so hand-edited files still work.
function dateStr(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export function parseTask(path: string, raw: string): Task {
  const match = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) throw new Error(`Invalid task file: ${path}`);
  const fm = yaml.load(match[1]) as Record<string, any>;
  const r = fm.recurring;
  return {
    id: String(fm.id),
    title: String(fm.title),
    list: String(fm.list),
    status: fm.status ?? "pending",
    priority: fm.priority ?? "normal",
    due: dateStr(fm.due),
    created: dateStr(fm.created),
    completed: dateStr(fm.completed),
    snoozed_until: dateStr(fm.snoozed_until),
    recurring: r ? { interval: Number(r.interval), unit: r.unit, next_due: dateStr(r.next_due) } : null,
    tags: fm.tags ?? [],
    subtasks: fm.subtasks ?? [],
    notes: match[2].trim(),
  };
}

// Same layout as the PWA's serializeTask, so a task written here and then saved
// from the PWA produces a minimal diff.
export function serializeTask(task: Task): string {
  const { notes, ...fm } = task;
  const ordered = {
    id: fm.id,
    title: fm.title,
    list: fm.list,
    status: fm.status,
    priority: fm.priority,
    due: fm.due,
    created: fm.created,
    completed: fm.completed,
    snoozed_until: fm.snoozed_until,
    recurring: fm.recurring,
    tags: fm.tags,
    subtasks: fm.subtasks,
  };
  return `---\n${yaml.dump(ordered, { lineWidth: -1 })}---\n${notes}\n`;
}

export function taskPath(task: Task): string {
  return `tasks/${task.list}/${task.id}.md`;
}

// Fetch every list folder and every task file's text in ONE GraphQL request.
// The REST contents API needs one request per file, which both trips GitHub's
// abuse limits and blows through the Workers free plan's 50-subrequest cap.
const TASKS_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: "HEAD:tasks") {
      ... on Tree {
        entries {
          name
          type
          object {
            ... on Tree {
              entries {
                name
                path
                type
                object { ... on Blob { oid text isTruncated isBinary } }
              }
            }
          }
        }
      }
    }
  }
}`;

interface TreeEntry {
  name: string;
  path?: string;
  type: string;
  object: any;
}

export class GitHubClient {
  private owner: string;
  private name: string;

  constructor(private token: string, private repo: string) {
    [this.owner, this.name] = repo.split("/");
    if (!this.owner || !this.name) throw new GitHubError(`GITHUB_REPO must be owner/name, got "${repo}"`);
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let resp!: Response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      resp = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          // GitHub rejects API requests that have no User-Agent.
          "User-Agent": "todo-mcp-worker",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      if (!isRateLimited(resp) || attempt === MAX_RETRIES) return resp;
      await sleep(retryDelayMs(resp, attempt));
    }
    return resp;
  }

  private contentsUrl(path: string): string {
    return `${GITHUB_API}/repos/${this.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async fail(resp: Response, what: string): Promise<never> {
    const body = await resp.text().catch(() => "");
    throw new GitHubError(`${what}: GitHub ${resp.status} ${resp.statusText} ${body.slice(0, 200)}`.trim());
  }

  private async listTree(): Promise<TreeEntry[]> {
    const resp = await this.request(`${GITHUB_API}/graphql`, {
      method: "POST",
      body: JSON.stringify({ query: TASKS_QUERY, variables: { owner: this.owner, name: this.name } }),
    });
    if (!resp.ok) await this.fail(resp, "Failed to list tasks");
    const json = (await resp.json()) as { data?: any; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new GitHubError(`Failed to list tasks: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    const repository = json.data?.repository;
    if (!repository) throw new GitHubError(`Repository ${this.repo} not found or token lacks access`);
    // No tasks/ folder yet: an empty repo, not an error.
    return repository.object?.entries ?? [];
  }

  async getLists(): Promise<string[]> {
    const entries = await this.listTree();
    return entries.filter((e) => e.type === "tree").map((e) => e.name);
  }

  async listTasks(): Promise<StoredTask[]> {
    const stored: StoredTask[] = [];
    for (const folder of await this.listTree()) {
      if (folder.type !== "tree") continue;
      for (const file of (folder.object?.entries ?? []) as TreeEntry[]) {
        const blob = file.object;
        if (file.type !== "blob" || !file.name.endsWith(".md") || !blob || blob.isBinary) continue;
        if (blob.isTruncated || blob.text == null) {
          throw new GitHubError(`Task file too large to read: ${file.path}`);
        }
        try {
          stored.push({ task: parseTask(file.path!, blob.text), path: file.path!, sha: blob.oid });
        } catch (err) {
          // Only genuinely malformed files are skipped, matching the PWA.
          console.warn(`Skipping malformed task file ${file.path}:`, err);
        }
      }
    }
    return stored;
  }

  async getTask(id: string): Promise<StoredTask | null> {
    return (await this.listTasks()).find((s) => s.task.id === id) ?? null;
  }

  // sha: the blob SHA when overwriting an existing file, omitted when creating one.
  async writeFile(path: string, content: string, message: string, sha?: string): Promise<void> {
    const body: Record<string, unknown> = { message, content: encodeUtf8Base64(content) };
    if (sha) body.sha = sha;
    const resp = await this.request(this.contentsUrl(path), { method: "PUT", body: JSON.stringify(body) });
    if (resp.status === 409) {
      throw new GitHubError(`${path} changed since it was read (edited elsewhere?). Try again.`);
    }
    if (!resp.ok) await this.fail(resp, `Failed to write ${path}`);
  }

  async deleteFile(path: string, message: string, sha: string): Promise<void> {
    const resp = await this.request(this.contentsUrl(path), {
      method: "DELETE",
      body: JSON.stringify({ message, sha }),
    });
    if (resp.status === 404) return;
    if (!resp.ok) await this.fail(resp, `Failed to delete ${path}`);
  }

  async writeTask(task: Task, message: string, sha?: string): Promise<void> {
    await this.writeFile(taskPath(task), serializeTask(task), message, sha);
  }

  async getShoppingList(): Promise<{ items: ShoppingItem[]; sha?: string }> {
    const resp = await this.request(this.contentsUrl(SHOPPING_PATH));
    if (resp.status === 404) return { items: [] };
    if (!resp.ok) await this.fail(resp, "Failed to fetch shopping list");
    const data = (await resp.json()) as { content: string; sha: string };
    const parsed = yaml.load(decodeBase64Utf8(data.content)) as { items?: ShoppingItem[] } | null;
    return { items: parsed?.items ?? [], sha: data.sha };
  }

  async saveShoppingList(items: ShoppingItem[], message: string, sha?: string): Promise<void> {
    await this.writeFile(SHOPPING_PATH, yaml.dump({ items }, { lineWidth: -1 }), message, sha);
  }
}
