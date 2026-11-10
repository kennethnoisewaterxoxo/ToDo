import yaml from "js-yaml";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubClient } from "./github";

// The weekly meal plan: one YAML file per week at meals/{monday}.yaml in the task
// repo. Claude drafts and revises it through these tools; the PWA reads the same
// file to show the plan and writes the approve / replace / remove decisions back.
// pwa/src/types.ts mirrors these shapes.

const MEALS_DIR = "meals";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const ingredientSchema = z.object({
  name: z.string().min(1).describe("Ingredient name without the amount, e.g. 'salmon fillet'."),
  qty: z.number().optional().describe("Numeric amount, e.g. 600. Omit for 'salt and pepper'."),
  unit: z.string().optional().describe("Unit for qty, e.g. 'g', 'ml', 'can', 'bunch'. Omit for plain counts."),
  note: z.string().optional().describe("Prep or clarification, e.g. 'diced' or 'about 2 large'."),
  pantry: z.boolean().optional().describe("true for a pantry staple that does not need buying."),
});

const mealSchema = z.object({
  title: z.string().min(1),
  protein: z.string().optional().describe("Main protein, e.g. 'Salmon' or 'Meatless (cheddar)'."),
  active_time: z.string().optional().describe("Hands-on time, e.g. '~25 min'."),
  total_time: z.string().optional().describe("Start to finish, e.g. '~65 min'."),
  est_cost: z.string().optional().describe("Estimated protein cost, e.g. '~$17'."),
  source: z
    .object({
      type: z.enum(["wiki", "nyt", "ai", "other"]),
      label: z.string().optional().describe("Where it came from, e.g. 'recipes/lemon-herb-baked-salmon'."),
      url: z.string().optional(),
    })
    .describe("Where the recipe came from."),
  description: z.string().default(""),
  serves: z.string().optional().describe("e.g. '4, plus leftovers for Thursday'."),
  ingredients: z.array(ingredientSchema),
  steps: z.array(z.string()),
  decision: z
    .enum(["pending", "approved", "replace"])
    .default("pending")
    .describe("The reviewer's decision, set from the app. New and replacement meals are 'pending'."),
  feedback: z.string().optional().describe("The reviewer's reason when decision is 'replace'."),
});

const daySchema = z.object({
  date: isoDate,
  availability: z.enum(["home", "away"]).default("home"),
  reason: z.string().default("").describe("Calendar reason for the availability, e.g. 'No events'."),
  kind: z
    .enum(["cook", "leftover", "open", "away"])
    .describe("cook: a new dinner (needs meal). leftover: eat earlier meals. open: nothing planned. away: not home."),
  title: z.string().optional().describe("Label for a non-cook night, e.g. 'Leftover curry'."),
  note: z.string().optional(),
  leftover_of: z.array(isoDate).optional().describe("For a leftover night: dates of the meals it relies on."),
  meal: mealSchema.optional().describe("Required when kind is 'cook', omitted otherwise."),
});

const planSchema = z.object({
  week: isoDate.describe("The Monday the plan starts on."),
  status: z
    .enum(["draft", "changes_requested", "approved", "executed"])
    .default("draft")
    .describe(
      "draft: awaiting review. changes_requested: a meal is marked 'replace'. approved: reviewer approved the whole plan. executed: shopping done."
    ),
  generated: isoDate.nullable().default(null),
  revised: isoDate.nullable().default(null),
  approved_at: isoDate.nullable().default(null),
  days: z.array(daySchema).min(1).max(7),
  calendar_notes: z.string().default("").describe("Markdown: what the calendar check found."),
  notes: z.string().default("").describe("Markdown: notes and assumptions."),
  execution: z.string().default("").describe("Markdown: shopping and cart summary, written after execution."),
});

export type MealPlan = z.infer<typeof planSchema>;
type MealDay = z.infer<typeof daySchema>;

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function checkDay(day: MealDay): string | null {
  if (day.kind === "cook" && !day.meal) return `${day.date}: a 'cook' night needs a meal`;
  if (day.kind !== "cook" && day.meal) return `${day.date}: only a 'cook' night can have a meal`;
  return null;
}

// Rules the schema alone can't express. Returns a problem description, or null.
function checkPlan(plan: MealPlan): string | null {
  const [y, m, d] = plan.week.split("-").map(Number);
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 1) return `week ${plan.week} is not a Monday`;
  const last = addDays(plan.week, 6);
  const seen = new Set<string>();
  for (const day of plan.days) {
    if (day.date < plan.week || day.date > last) return `${day.date} is outside the week of ${plan.week}`;
    if (seen.has(day.date)) return `${day.date} appears twice`;
    seen.add(day.date);
    const problem = checkDay(day);
    if (problem) return problem;
  }
  return null;
}

function planPath(week: string): string {
  return `${MEALS_DIR}/${week}.yaml`;
}

export function serializePlan(plan: MealPlan): string {
  return yaml.dump(plan, { lineWidth: -1 });
}

export function parsePlan(text: string): MealPlan {
  // CORE_SCHEMA keeps 2026-11-09 a string even if a hand edit drops the quotes.
  return planSchema.parse(yaml.load(text, { schema: yaml.CORE_SCHEMA }));
}

async function readPlan(gh: GitHubClient, week?: string): Promise<{ plan: MealPlan; sha: string } | null> {
  let target = week;
  if (!target) {
    const weeks = (await gh.listDir(MEALS_DIR))
      .map((name) => name.match(/^(\d{4}-\d{2}-\d{2})\.yaml$/)?.[1])
      .filter((w): w is string => !!w)
      .sort();
    target = weeks[weeks.length - 1];
    if (!target) return null;
  }
  const file = await gh.readFile(planPath(target));
  return file ? { plan: parsePlan(file.text), sha: file.sha } : null;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerMealTools(server: McpServer, gh: GitHubClient, today: () => string): void {
  server.registerTool(
    "get_meal_plan",
    {
      description:
        "Return a weekly meal plan with every meal's recipe and the reviewer's decisions. " +
        "Each cook night's meal.decision is 'pending', 'approved' or 'replace' (with meal.feedback giving the reason). " +
        "Only build a shopping list from a plan whose status is 'approved'.",
      inputSchema: {
        week: isoDate.optional().describe("Monday of the week (YYYY-MM-DD). Omit for the most recent plan."),
      },
    },
    async ({ week }) => {
      const stored = await readPlan(gh, week);
      return json(stored ? stored.plan : { error: week ? `No meal plan for week ${week}` : "No meal plans yet" });
    }
  );

  server.registerTool(
    "save_meal_plan",
    {
      description:
        "Save a whole weekly meal plan as a new draft for review in the app, replacing any plan already saved for that week. " +
        "Use update_meal_plan_day instead to change single nights of a plan that is under review.",
      inputSchema: {
        plan: planSchema,
        overwrite_approved: z
          .boolean()
          .default(false)
          .describe("Must be true to replace a plan the reviewer has already approved or that has been executed."),
      },
    },
    async ({ plan, overwrite_approved }) => {
      const problem = checkPlan(plan);
      if (problem) return json({ error: problem });
      const existing = await readPlan(gh, plan.week);
      if (existing && ["approved", "executed"].includes(existing.plan.status) && !overwrite_approved) {
        return json({
          error: `The plan for ${plan.week} is already ${existing.plan.status}. Pass overwrite_approved: true to replace it.`,
        });
      }
      const saved: MealPlan = { ...plan, generated: plan.generated ?? today() };
      await gh.writeFile(planPath(plan.week), serializePlan(saved), `Save meal plan for ${plan.week}`, existing?.sha);
      return json({ saved: plan.week, status: saved.status, days: saved.days.length });
    }
  );

  server.registerTool(
    "update_meal_plan_day",
    {
      description:
        "Replace one night of a meal plan that is under review, e.g. to swap in a new dinner for one marked 'replace', " +
        "or to fix a leftover night that relied on a changed meal. A replacement meal goes back to the reviewer as 'pending'.",
      inputSchema: {
        week: isoDate.describe("Monday of the plan's week (YYYY-MM-DD)."),
        day: daySchema.describe("The full new content for that night; day.date picks which night."),
      },
    },
    async ({ week, day }) => {
      const stored = await readPlan(gh, week);
      if (!stored) return json({ error: `No meal plan for week ${week}` });
      const { plan, sha } = stored;
      if (plan.status === "approved" || plan.status === "executed") {
        return json({ error: `The plan for ${week} is already ${plan.status}; it has to be reopened in the app first.` });
      }
      const index = plan.days.findIndex((d) => d.date === day.date);
      if (index < 0) return json({ error: `${day.date} is not a night in the plan for ${week}` });
      const problem = checkDay(day);
      if (problem) return json({ error: problem });

      const days = [...plan.days];
      days[index] = day;
      const stillRequested = days.some((d) => d.meal?.decision === "replace");
      const updated: MealPlan = {
        ...plan,
        days,
        revised: today(),
        status: stillRequested ? "changes_requested" : "draft",
      };
      await gh.writeFile(planPath(week), serializePlan(updated), `Update meal plan ${week}: ${day.date}`, sha);
      return json({ updated: day.date, status: updated.status });
    }
  );

  server.registerTool(
    "record_meal_plan_execution",
    {
      description:
        "Mark an approved meal plan as executed and store the shopping / cart summary. Fails unless the reviewer has approved the plan.",
      inputSchema: {
        week: isoDate.describe("Monday of the plan's week (YYYY-MM-DD)."),
        execution: z.string().describe("Markdown summary: shopping list, cart status, substitutions, manual items."),
      },
    },
    async ({ week, execution }) => {
      const stored = await readPlan(gh, week);
      if (!stored) return json({ error: `No meal plan for week ${week}` });
      const { plan, sha } = stored;
      if (plan.status !== "approved" && plan.status !== "executed") {
        return json({ error: `The plan for ${week} is '${plan.status}', not approved. Do not shop for it yet.` });
      }
      const updated: MealPlan = { ...plan, status: "executed", execution };
      await gh.writeFile(planPath(week), serializePlan(updated), `Record meal plan execution for ${week}`, sha);
      return json({ executed: week });
    }
  );
}
