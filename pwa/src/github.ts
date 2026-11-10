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

// GitHub returns file contents as base64 of the raw UTF-8 bytes. atob() alone
// yields a Latin-1 byte string, so any multi-byte char (—, curly quotes, °, ≥…)
// turns into C1 control chars that js-yaml rejects as non-printable. Decode the
// bytes as UTF-8 instead.
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
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

// Every list folder and every task file's text in ONE request (same query the
// MCP worker uses). The REST contents API needs a request per folder plus a
// request per file, which made startup time grow with the number of tasks.
const TASKS_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: "HEAD:tasks") {
      ... on Tree {
        entries {
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

type GqlBlob = { oid: string; text: string | null; isTruncated: boolean; isBinary: boolean | null } | null;
type GqlFile = { name: string; path: string; type: string; object: GqlBlob };
type GqlFolder = { type: string; object: { entries?: GqlFile[] } | null };

// What we knew about each task file after the last sync, keyed by path. A file's
// blob sha changes whenever its content does, so a matching sha means the parsed
// task is still current and the file doesn't need downloading again. `task` is
// null for a malformed file, remembered so it isn't re-fetched on every launch.
type SyncedFile = { sha: string; task: Task | null };
type SyncedFiles = Record<string, SyncedFile>;

const SYNC_KEY = "tasks_sync_v1";
// Above this many changed files, one bulk GraphQL request beats per-file fetches.
const MAX_INCREMENTAL_FETCHES = 24;

function loadSyncedFiles(repo: string): SyncedFiles {
  try {
    const cached = JSON.parse(localStorage.getItem(SYNC_KEY) ?? "null");
    if (cached?.repo === repo && cached.files && typeof cached.files === "object") {
      return cached.files;
    }
  } catch {
    // Corrupt or unavailable cache: sync from scratch.
  }
  return {};
}

function saveSyncedFiles(repo: string, files: SyncedFiles) {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ repo, files }));
  } catch {
    // Quota exceeded etc. — the cache is only an optimisation.
  }
}

function parseSynced(path: string, sha: string, text: string): SyncedFile {
  try {
    return { sha, task: parseTask(path, text) };
  } catch (err) {
    console.warn(`Skipping malformed task file ${path}:`, err);
    return { sha, task: null };
  }
}

// List every file in the repo with its blob sha in one cheap request (no file
// contents), then download only the task files whose sha we haven't seen. On a
// typical launch that is zero to a handful of files, however many tasks exist.
async function syncTasksIncremental(known: SyncedFiles): Promise<SyncedFiles> {
  const { repo } = getConfig();
  const resp = await ghFetch(`${GITHUB_API}/repos/${repo}/git/trees/HEAD?recursive=1`);
  if (!resp.ok) throw new Error(`Tree request failed: ${resp.status} ${resp.statusText}`);
  const json = (await resp.json()) as {
    truncated?: boolean;
    tree?: { path: string; type: string; sha: string }[];
  };
  if (json.truncated || !json.tree) throw new Error("Repository tree was truncated");

  const taskFiles = json.tree.filter(
    (e) => e.type === "blob" && /^tasks\/[^/]+\/[^/]+\.md$/.test(e.path)
  );
  const changed = taskFiles.filter((e) => known[e.path]?.sha !== e.sha);
  if (changed.length > MAX_INCREMENTAL_FETCHES) return fetchAllTasksGraphQL();

  const fetched = await mapWithConcurrency(changed, FETCH_CONCURRENCY, async (e) => {
    const blobResp = await ghFetch(`${GITHUB_API}/repos/${repo}/git/blobs/${e.sha}`);
    if (!blobResp.ok) {
      throw new Error(`Failed to fetch ${e.path}: ${blobResp.status} ${blobResp.statusText}`);
    }
    const blob = await blobResp.json();
    return parseSynced(e.path, e.sha, decodeBase64Utf8(blob.content));
  });

  const files: SyncedFiles = {};
  for (const e of taskFiles) files[e.path] = known[e.path];
  changed.forEach((e, i) => (files[e.path] = fetched[i]));
  return files;
}

async function fetchAllTasksGraphQL(): Promise<SyncedFiles> {
  const [owner, name] = getConfig().repo.split("/");
  const resp = await ghFetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    body: JSON.stringify({ query: TASKS_QUERY, variables: { owner, name } }),
  });
  if (!resp.ok) throw new Error(`GraphQL request failed: ${resp.status} ${resp.statusText}`);
  const json = (await resp.json()) as {
    data?: { repository?: { object?: { entries?: GqlFolder[] } | null } | null };
    errors?: { message: string }[];
  };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  const repository = json.data?.repository;
  if (!repository) throw new Error("Repository not found or token lacks access");

  const files: SyncedFiles = {};
  // No tasks/ folder yet: an empty repo, not an error.
  for (const folder of repository.object?.entries ?? []) {
    if (folder.type !== "tree") continue;
    for (const file of folder.object?.entries ?? []) {
      const blob = file.object;
      if (file.type !== "blob" || !file.name.endsWith(".md") || !blob || blob.isBinary) continue;
      if (blob.isTruncated || blob.text == null) {
        throw new Error(`Task file too large for GraphQL: ${file.path}`);
      }
      files[file.path] = parseSynced(file.path, blob.oid, blob.text);
    }
  }
  return files;
}

// Fastest path first: incremental sync against what we already have, then one
// bulk GraphQL request, then the slow per-file REST path as a last resort.
async function syncTasks(known: SyncedFiles): Promise<SyncedFiles> {
  try {
    return await syncTasksIncremental(known);
  } catch (err) {
    console.warn("Incremental task sync failed, trying a full GraphQL fetch:", err);
  }
  try {
    return await fetchAllTasksGraphQL();
  } catch (err) {
    // e.g. a token without GraphQL access.
    console.warn("GraphQL task fetch failed, falling back to REST:", err);
    return fetchAllTasksRest();
  }
}

export async function fetchAllTasks(): Promise<Task[]> {
  const { repo } = getConfig();
  const files = await syncTasks(loadSyncedFiles(repo));
  saveSyncedFiles(repo, files);
  return Object.values(files)
    .map((f) => f.task)
    .filter((t): t is Task => t !== null);
}

async function fetchAllTasksRest(): Promise<SyncedFiles> {
  // getLists treats a 404 as "no tasks folder yet", which is also what a wrong
  // repo name or a revoked token looks like. Rule those out first.
  const { token, repo } = getConfig();
  await checkConnection(token, repo);
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
    return parseSynced(file.path, data.sha, decodeBase64Utf8(data.content));
  });

  const result: SyncedFiles = {};
  files.forEach((file, i) => (result[file.path] = parsed[i]));
  return result;
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

export function getSavedConfig(): { token: string | null; repo: string | null } {
  return { token: localStorage.getItem("github_token"), repo: localStorage.getItem("github_repo") };
}

// Confirm the token works and can see the repo. Throws a readable message if not,
// so a typo or a revoked token is reported instead of looking like an empty repo.
export async function checkConnection(token: string, repo: string): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error("Repository must look like owner/name.");
  }
  let resp: Response;
  try {
    resp = await fetch(`${GITHUB_API}/repos/${repo}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
  } catch {
    throw new Error("Couldn't reach GitHub. Check your internet connection.");
  }
  if (resp.status === 401) throw new Error("GitHub rejected the token. It may be mistyped, expired or revoked.");
  if (resp.status === 404) {
    throw new Error(`Repository ${repo} wasn't found, or the token doesn't have access to it.`);
  }
  if (!resp.ok) throw new Error(`GitHub returned ${resp.status} ${resp.statusText}.`);
}

export async function fetchShoppingList(): Promise<ShoppingItem[]> {
  const resp = await ghFetch(repoUrl("shopping/list.yaml"));
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Failed to fetch shopping list: ${resp.statusText}`);
  const data = await resp.json();
  const parsed = yaml.load(decodeBase64Utf8(data.content)) as { items?: ShoppingItem[] } | null;
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
