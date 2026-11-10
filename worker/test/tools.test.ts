import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { addInterval, buildServer, makeId } from "../src/tools";
import { parseTask, serializeTask } from "../src/github";
import { serializePlan } from "../src/meals";
import type { Env } from "../src/types";

// --- A fake GitHub: GraphQL tree read + REST contents API over an in-memory repo ---

let files: Map<string, { text: string; sha: number }>;
let shaCounter: number;
let calls: string[];

function put(path: string, text: string) {
  files.set(path, { text, sha: ++shaCounter });
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  calls.push(`${method} ${url.pathname}`);
  expect(new Headers(init.headers).get("user-agent")).toBeTruthy();

  if (url.pathname === "/graphql") {
    const lists = new Map<string, any[]>();
    for (const [path, f] of files) {
      const m = path.match(/^tasks\/([^/]+)\/([^/]+)$/);
      if (!m) continue;
      if (!lists.has(m[1])) lists.set(m[1], []);
      lists.get(m[1])!.push({
        name: m[2],
        path,
        type: "blob",
        object: { oid: String(f.sha), text: f.text, isTruncated: false, isBinary: false },
      });
    }
    const entries = [...lists].map(([name, es]) => ({ name, type: "tree", object: { entries: es } }));
    return Response.json({ data: { repository: { object: lists.size ? { entries } : null } } });
  }

  const path = decodeURIComponent(url.pathname.replace(/^\/repos\/owner\/repo\/contents\//, ""));
  const file = files.get(path);
  if (method === "GET") {
    if (!file) {
      // A folder: list the files directly inside it, like the contents API does.
      const names = [...files.keys()]
        .filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/"))
        .map((p) => ({ name: p.slice(path.length + 1), type: "file" }));
      return names.length ? Response.json(names) : new Response("", { status: 404 });
    }
    return Response.json({ content: b64(file.text), sha: String(file.sha) });
  }
  const body = JSON.parse(String(init.body));
  if ((file ? String(file.sha) : undefined) !== body.sha) return new Response("conflict", { status: 409 });
  if (method === "PUT") put(path, unb64(body.content));
  if (method === "DELETE") files.delete(path);
  return Response.json({});
}

const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "owner/repo", TIMEZONE: "America/Los_Angeles" } as Env;

async function connect() {
  const server = buildServer(env);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res: any = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(res.content[0].text);
    return JSON.parse(res.content[0].text);
  };
}

function taskFile(over: Record<string, unknown> = {}) {
  return serializeTask({
    id: "t1", title: "Water plants", list: "home", status: "pending", priority: "normal",
    due: "2026-10-01", created: "2026-09-01", completed: null, snoozed_until: null,
    recurring: null, tags: [], subtasks: [], notes: "Use the green can — 2L",
    ...over,
  } as any);
}

beforeEach(() => {
  files = new Map();
  shaCounter = 0;
  calls = [];
  vi.stubGlobal("fetch", fakeFetch);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T18:00:00Z")); // 11:00 in Los Angeles
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("helpers", () => {
  it("adds months like relativedelta, clamping to month end", () => {
    expect(addInterval("2026-01-31", 1, "months")).toBe("2026-02-28");
    expect(addInterval("2026-11-15", 3, "months")).toBe("2027-02-15");
    expect(addInterval("2026-12-30", 2, "days")).toBe("2027-01-01");
    expect(addInterval("2026-10-08", 2, "weeks")).toBe("2026-10-22");
  });

  it("makes ids like the Python server", () => {
    expect(makeId("Call Mum re: Café!", "2026-10-08")).toMatch(/^2026-10-08-call-mum-re-café-[0-9a-f]{6}$/);
  });

  it("parses files written by the Python server (unquoted dates, CRLF)", () => {
    const raw = "---\r\ncreated: 2026-09-01\r\ndue: 2026-10-01\r\nid: x\r\nlist: inbox\r\ntitle: Hi\r\n---\r\nBody\r\n";
    const t = parseTask("tasks/inbox/x.md", raw);
    expect(t).toMatchObject({ id: "x", due: "2026-10-01", created: "2026-09-01", status: "pending", notes: "Body" });
  });

  it("round-trips non-ASCII through serialize/parse", () => {
    const t = parseTask("p", taskFile());
    expect(t.notes).toBe("Use the green can — 2L");
    expect(serializeTask(t)).toContain("due: '2026-10-01'");
  });
});

describe("tools", () => {
  it("lists all tasks with a single GitHub request", async () => {
    for (let i = 0; i < 80; i++) put(`tasks/inbox/t${i}.md`, taskFile({ id: `t${i}`, list: "inbox" }));
    const call = await connect();
    calls = [];
    const tasks = await call("get_tasks", { status: null });
    expect(tasks).toHaveLength(80);
    expect(calls).toEqual(["POST /graphql"]);
  });

  it("filters get_today / get_overdue using the configured timezone", async () => {
    put("tasks/home/a.md", taskFile({ id: "a", due: "2026-10-07" }));
    put("tasks/home/b.md", taskFile({ id: "b", due: "2026-10-08" }));
    put("tasks/home/c.md", taskFile({ id: "c", due: "2026-10-09" }));
    put("tasks/home/d.md", taskFile({ id: "d", due: "2026-10-01", status: "complete" }));
    const call = await connect();
    expect((await call("get_today")).map((t: any) => t.id)).toEqual(["a", "b"]);
    expect((await call("get_overdue")).map((t: any) => t.id)).toEqual(["a"]);
  });

  it("creates a recurring task and rolls it forward on completion", async () => {
    const call = await connect();
    const created = await call("create_task", {
      title: "Pay rent", list: "home", due: "2026-10-31", recurring_interval: 1, recurring_unit: "months",
    });
    expect(created).toMatchObject({ list: "home", due: "2026-10-31", recurring: true });
    expect(created.id).toMatch(/^2026-10-08-pay-rent-/);

    const done = await call("complete_task", { task_id: created.id });
    expect(done.completed.status).toBe("complete");
    expect(done.next_instance.due).toBe("2026-11-30");
    const next = await call("get_task", { task_id: done.next_instance.id });
    expect(next.recurring).toEqual({ interval: 1, unit: "months", next_due: "2026-12-30" });
    expect(files.size).toBe(2);
  });

  it("moves a task between lists without leaving the old file", async () => {
    put("tasks/home/t1.md", taskFile());
    const call = await connect();
    await call("update_task", { task_id: "t1", list: "work", priority: "high" });
    expect([...files.keys()]).toEqual(["tasks/work/t1.md"]);
    expect((await call("get_task", { task_id: "t1" })).priority).toBe("high");
  });

  it("refuses to overwrite a task changed since it was read", async () => {
    put("tasks/home/t1.md", taskFile());
    const call = await connect();
    const realFetch = fakeFetch;
    vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
      // Simulate an edit from the PWA landing between our read and our write.
      if (init?.method === "PUT") put("tasks/home/t1.md", taskFile({ title: "Edited elsewhere" }));
      return realFetch(input, init);
    });
    await expect(call("update_task", { task_id: "t1", title: "Mine" })).rejects.toThrow(/changed since/);
  });

  it("snoozes and deletes", async () => {
    put("tasks/home/t1.md", taskFile());
    const call = await connect();
    expect(await call("snooze_task", { task_id: "t1", until: "2026-11-01" })).toMatchObject({ status: "snoozed" });
    expect((await call("get_task", { task_id: "t1" })).snoozed_until).toBe("2026-11-01");
    expect(await call("delete_task", { task_id: "t1" })).toEqual({ deleted: "t1", title: "Water plants" });
    expect(files.size).toBe(0);
    expect(await call("get_task", { task_id: "t1" })).toEqual({ error: "Task t1 not found" });
  });

  it("searches title and notes", async () => {
    put("tasks/home/t1.md", taskFile());
    put("tasks/home/t2.md", taskFile({ id: "t2", title: "Other", notes: "" }));
    const call = await connect();
    expect((await call("search_tasks", { query: "GREEN" })).map((t: any) => t.id)).toEqual(["t1"]);
  });

  it("returns an empty list when the repo has no tasks folder", async () => {
    const call = await connect();
    expect(await call("get_lists")).toEqual([]);
    expect(await call("get_tasks")).toEqual([]);
  });

  it("rejects malformed dates before touching GitHub", async () => {
    const call = await connect();
    await expect(call("create_task", { title: "x", due: "next tuesday" })).rejects.toThrow();
    expect(files.size).toBe(0);
  });

  it("manages the shopping list", async () => {
    const call = await connect();
    const milk = await call("add_shopping_item", { name: "Milk", qty: 2, unit: "L", category: "dairy" });
    await call("add_shopping_item", { name: "Crème fraîche" });
    let items = await call("get_shopping_list");
    expect(items.map((i: any) => i.name)).toEqual(["Milk", "Crème fraîche"]);
    await call("remove_shopping_item", { item_id: milk.id });
    items = await call("get_shopping_list");
    expect(items.map((i: any) => i.name)).toEqual(["Crème fraîche"]);
    expect(await call("remove_shopping_item", { item_id: "nope" })).toEqual({ error: "Item nope not found" });
    await call("clear_shopping_list");
    expect(await call("get_shopping_list")).toEqual([]);
  });
});

describe("meal plan tools", () => {
  const meal = (title: string, over: Record<string, unknown> = {}) => ({
    title,
    source: { type: "ai" },
    ingredients: [{ name: "crème fraîche", qty: 200, unit: "ml" }, { name: "salt", pantry: true }],
    steps: ["Cook it."],
    ...over,
  });
  const plan = (over: Record<string, unknown> = {}) => ({
    week: "2026-11-09",
    days: [
      { date: "2026-11-09", kind: "cook", meal: meal("Salmon") },
      { date: "2026-11-10", kind: "open", title: "Open" },
      { date: "2026-11-11", kind: "cook", meal: meal("Curry") },
      { date: "2026-11-12", kind: "leftover", title: "Leftover curry", leftover_of: ["2026-11-11"] },
    ],
    ...over,
  });
  // What the app does when the reviewer acts: rewrite the stored file.
  const edit = async (call: any, change: (p: any) => void) => {
    const p = await call("get_meal_plan");
    change(p);
    put("meals/2026-11-09.yaml", serializePlan(p));
  };

  it("saves a draft and returns the most recent plan by default", async () => {
    const call = await connect();
    expect(await call("get_meal_plan")).toEqual({ error: "No meal plans yet" });
    await call("save_meal_plan", { plan: plan({ week: "2026-11-02", days: [{ date: "2026-11-02", kind: "open" }] }) });
    expect(await call("save_meal_plan", { plan: plan() })).toEqual({ saved: "2026-11-09", status: "draft", days: 4 });

    const got = await call("get_meal_plan");
    expect(got).toMatchObject({ week: "2026-11-09", status: "draft", generated: "2026-10-08" });
    expect(got.days[0].meal).toMatchObject({ title: "Salmon", decision: "pending" });
    expect(got.days[0].meal.ingredients[0].name).toBe("crème fraîche");
    expect((await call("get_meal_plan", { week: "2026-11-02" })).days).toHaveLength(1);
    // Dates stay strings in the file, so the app's plain YAML read sees strings too.
    expect(files.get("meals/2026-11-09.yaml")!.text).toContain("week: '2026-11-09'");
  });

  it("rejects plans that break the rules", async () => {
    const call = await connect();
    const bad = async (over: Record<string, unknown>) => (await call("save_meal_plan", { plan: plan(over) })).error;
    expect(await bad({ week: "2026-11-10" })).toMatch(/not a Monday/);
    expect(await bad({ days: [{ date: "2026-11-20", kind: "open" }] })).toMatch(/outside the week/);
    expect(await bad({ days: [{ date: "2026-11-09", kind: "cook" }] })).toMatch(/needs a meal/);
    expect(await bad({ days: [{ date: "2026-11-09", kind: "open" }, { date: "2026-11-09", kind: "open" }] })).toMatch(
      /appears twice/
    );
    expect(files.size).toBe(0);
  });

  it("swaps in a replacement meal and clears the change request", async () => {
    const call = await connect();
    await call("save_meal_plan", { plan: plan() });
    await edit(call, (p) => {
      p.status = "changes_requested";
      p.days[0].meal.decision = "approved";
      p.days[2].meal.decision = "replace";
      p.days[2].meal.feedback = "Too rich";
    });
    expect((await call("get_meal_plan")).days[2].meal).toMatchObject({ decision: "replace", feedback: "Too rich" });

    const res = await call("update_meal_plan_day", {
      week: "2026-11-09",
      day: { date: "2026-11-11", kind: "cook", meal: meal("Stir-fry") },
    });
    expect(res).toEqual({ updated: "2026-11-11", status: "draft" });
    const got = await call("get_meal_plan");
    expect(got.revised).toBe("2026-10-08");
    expect(got.days[2].meal).toMatchObject({ title: "Stir-fry", decision: "pending" });
    expect(got.days[0].meal.decision).toBe("approved");

    expect(
      await call("update_meal_plan_day", { week: "2026-11-09", day: { date: "2026-11-15", kind: "open" } })
    ).toEqual({ error: "2026-11-15 is not a night in the plan for 2026-11-09" });
  });

  it("only records execution for an approved plan, and protects it from being overwritten", async () => {
    const call = await connect();
    await call("save_meal_plan", { plan: plan() });
    expect((await call("record_meal_plan_execution", { week: "2026-11-09", execution: "x" })).error).toMatch(
      /not approved/
    );

    await edit(call, (p) => { p.status = "approved"; });
    expect((await call("save_meal_plan", { plan: plan() })).error).toMatch(/already approved/);
    expect(
      (await call("update_meal_plan_day", { week: "2026-11-09", day: { date: "2026-11-10", kind: "open" } })).error
    ).toMatch(/already approved/);

    expect(await call("record_meal_plan_execution", { week: "2026-11-09", execution: "Cart loaded — 28 items" })).toEqual({
      executed: "2026-11-09",
    });
    expect(await call("get_meal_plan")).toMatchObject({ status: "executed", execution: "Cart loaded — 28 items" });
    expect((await call("save_meal_plan", { plan: plan(), overwrite_approved: true })).saved).toBe("2026-11-09");
  });
});
