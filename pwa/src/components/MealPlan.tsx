import { Fragment, useState, type ReactNode } from "react";
import { useMealPlan } from "../hooks/useMealPlan";
import type { Ingredient, Meal, MealDay, MealPlan as Plan } from "../types";
import styles from "./MealPlan.module.css";

interface Props {
  onToggleSidebar: () => void;
}

const STATUS_LABEL: Record<Plan["status"], string> = {
  draft: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  executed: "Shopping done",
};

const SOURCE_LABEL: Record<Meal["source"]["type"], string> = {
  wiki: "Your wiki",
  nyt: "NYT Cooking",
  ai: "AI-generated",
  other: "Other",
};

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function dayName(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, { weekday: "long" });
}

function shortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ingredientText(i: Ingredient): string {
  const amount = [i.qty != null ? String(i.qty) : "", i.unit ?? ""].filter(Boolean).join(" ");
  return [amount, i.name].filter(Boolean).join(" ") + (i.note ? `, ${i.note}` : "");
}

// A plan is "changes requested" exactly while some meal is marked for replacement.
function reviewStatus(days: MealDay[]): Plan["status"] {
  return days.some((d) => d.meal?.decision === "replace") ? "changes_requested" : "draft";
}

function withDay(plan: Plan, date: string, change: (day: MealDay) => MealDay): Plan {
  const days = plan.days.map((d) => (d.date === date ? change(d) : d));
  return { ...plan, days, status: reviewStatus(days) };
}

// Why a leftover night no longer has a source, if it doesn't.
function leftoverProblem(day: MealDay, plan: Plan): string | null {
  if (day.kind !== "leftover" || !day.leftover_of?.length) return null;
  const sources = day.leftover_of.map((date) => plan.days.find((d) => d.date === date));
  if (sources.some((s) => !s || s.kind !== "cook")) return "A meal these leftovers came from was removed.";
  if (sources.some((s) => s?.meal?.decision === "replace")) {
    return "A meal these leftovers came from is being replaced.";
  }
  return null;
}

// Just enough Markdown for Claude's notes: paragraphs, bullets (nested by
// indent), **bold**, [links](url) and headings.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link && /^https?:\/\//.test(link[2])) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return null;
        const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className={styles.bullet} style={{ marginLeft: Math.floor(bullet[1].length / 2) * 16 }}>
              <span>•</span>
              <span>{inline(bullet[2])}</span>
            </div>
          );
        }
        const heading = line.match(/^#+\s+(.*)$/);
        if (heading) return <div key={i} className={styles.mdHeading}>{inline(heading[1])}</div>;
        return <p key={i}>{inline(line.replace(/^>\s?/, ""))}</p>;
      })}
    </div>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className={styles.section}>
      <button className={styles.sectionToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <span className={styles.chevron}>{open ? "▾" : "▸"}</span>
      </button>
      {open && <Markdown text={text} />}
    </div>
  );
}

function Recipe({ meal }: { meal: Meal }) {
  return (
    <div className={styles.recipe}>
      <div className={styles.recipeLabel}>Ingredients{meal.serves ? ` (serves ${meal.serves})` : ""}</div>
      <ul className={styles.ingredients}>
        {meal.ingredients.map((ing, i) => (
          <li key={i} className={ing.pantry ? styles.pantry : ""}>
            {ingredientText(ing)}
            {ing.pantry && <span className={styles.pantryTag}>pantry</span>}
          </li>
        ))}
      </ul>
      <div className={styles.recipeLabel}>Steps</div>
      <ol className={styles.steps}>
        {meal.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function CookCard({
  day,
  locked,
  onDecide,
  onReplace,
  onRemove,
}: {
  day: MealDay;
  locked: boolean;
  onDecide: (decision: "approved" | "pending") => void;
  onReplace: (feedback: string) => void;
  onRemove: () => void;
}) {
  const meal = day.meal!;
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState("");
  // "Remove it" takes two taps; the second confirms.
  const [confirmRemove, setConfirmRemove] = useState(false);

  const meta = [meal.protein, meal.active_time && `${meal.active_time} active`, meal.total_time && `${meal.total_time} total`, meal.est_cost]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className={styles.mealTitle}>{meal.title}</div>
      {meta && <div className={styles.meta}>{meta}</div>}
      <div className={styles.meta}>
        {meal.source.url ? (
          <a href={meal.source.url} target="_blank" rel="noreferrer">
            {SOURCE_LABEL[meal.source.type]}
          </a>
        ) : (
          SOURCE_LABEL[meal.source.type]
        )}
        {meal.source.type === "ai" && " — untested recipe"}
      </div>
      {meal.description && <p className={styles.description}>{meal.description}</p>}

      <button className={styles.linkBtn} onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        {expanded ? "Hide recipe" : "Show recipe"}
      </button>
      {expanded && <Recipe meal={meal} />}

      {meal.decision === "replace" && (
        <div className={styles.replaceNote}>
          Replacement requested{meal.feedback ? `: ${meal.feedback}` : "."} Run the meal planner to get a new dinner.
        </div>
      )}

      {!locked && !rejecting && (
        <div className={styles.decisionRow}>
          {meal.decision === "pending" && (
            <>
              <button className={styles.approveBtn} onClick={() => onDecide("approved")}>Approve</button>
              <button className={styles.rejectBtn} onClick={() => setRejecting(true)}>Reject…</button>
            </>
          )}
          {meal.decision === "approved" && (
            <button className={styles.undoBtn} onClick={() => onDecide("pending")}>Undo approval</button>
          )}
          {meal.decision === "replace" && (
            <button className={styles.undoBtn} onClick={() => onDecide("pending")}>Cancel replacement</button>
          )}
        </div>
      )}

      {!locked && rejecting && (
        <div className={styles.rejectBox}>
          <textarea
            className={styles.feedback}
            placeholder="Why? (optional — helps pick the replacement)"
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className={styles.decisionRow}>
            <button
              className={styles.replaceBtn}
              onClick={() => {
                onReplace(feedback.trim());
                setRejecting(false);
                setFeedback("");
              }}
            >
              Replace it
            </button>
            <button
              className={styles.rejectBtn}
              onClick={() => {
                if (!confirmRemove) {
                  setConfirmRemove(true);
                  return;
                }
                onRemove();
                setRejecting(false);
                setConfirmRemove(false);
              }}
            >
              {confirmRemove ? `Yes, leave ${dayName(day.date)} open` : "Remove it"}
            </button>
            <button
              className={styles.undoBtn}
              onClick={() => {
                setRejecting(false);
                setConfirmRemove(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function MealPlan({ onToggleSidebar }: Props) {
  const { plan, loading, saving, error, reload, update } = useMealPlan();
  const today = localToday();

  const cookDays = plan?.days.filter((d) => d.kind === "cook" && d.meal) ?? [];
  const approved = cookDays.filter((d) => d.meal!.decision === "approved").length;
  const replacing = cookDays.filter((d) => d.meal!.decision === "replace").length;
  const pending = cookDays.length - approved - replacing;
  const locked = plan?.status === "approved" || plan?.status === "executed";
  const canApprove = !!plan && !locked && cookDays.length > 0 && pending === 0 && replacing === 0;

  function decide(day: MealDay, decision: "approved" | "pending") {
    update(
      (p) =>
        withDay(p, day.date, (d) => {
          const { feedback: _dropped, ...meal } = d.meal!;
          return { ...d, meal: { ...meal, decision } };
        }),
      `${decision === "approved" ? "Approve" : "Reset"} meal: ${day.meal!.title}`
    );
  }

  function replace(day: MealDay, feedback: string) {
    update(
      (p) =>
        withDay(p, day.date, (d) => {
          const { feedback: _dropped, ...meal } = d.meal!;
          return { ...d, meal: { ...meal, decision: "replace", ...(feedback ? { feedback } : {}) } };
        }),
      `Request replacement: ${day.meal!.title}`
    );
  }

  function remove(day: MealDay) {
    update(
      (p) =>
        withDay(p, day.date, (d) => ({
          date: d.date,
          availability: d.availability,
          reason: d.reason,
          kind: "open",
          title: "Open",
          note: `Removed in review: ${d.meal!.title}`,
        })),
      `Remove meal: ${day.meal!.title}`
    );
  }

  function approvePlan() {
    update((p) => ({ ...p, status: "approved", approved_at: today }), `Approve meal plan for ${plan!.week}`);
  }

  function reopen() {
    update(
      (p) => ({ ...p, status: reviewStatus(p.days), approved_at: null }),
      `Reopen meal plan for ${plan!.week}`
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <button className={styles.hamburger} onClick={onToggleSidebar} title="Menu">☰</button>
          <h2 className={styles.title}>Meal Plan</h2>
        </div>
        <div className={styles.actions}>
          {saving && <span className={styles.saving}>Saving…</span>}
          <button className={styles.iconBtn} onClick={reload} disabled={loading} title={loading ? "Refreshing…" : "Refresh"}>↺</button>
        </div>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={styles.body}>
        {!plan && <div className={styles.empty}>{loading ? "Loading..." : "No meal plan yet. Ask Claude to draft one."}</div>}

        {plan && (
          <>
            <div className={styles.summary}>
              <div>
                <div className={styles.week}>
                  {shortDate(plan.days[0]?.date ?? plan.week)} – {shortDate(plan.days[plan.days.length - 1]?.date ?? plan.week)}
                </div>
                <div className={styles.counts}>
                  {cookDays.length} dinner{cookDays.length === 1 ? "" : "s"} to cook · {approved} approved
                  {pending > 0 && ` · ${pending} to review`}
                  {replacing > 0 && ` · ${replacing} being replaced`}
                </div>
              </div>
              <span className={`${styles.status} ${styles[`status_${plan.status}`]}`}>{STATUS_LABEL[plan.status]}</span>
            </div>

            {plan.days.map((day) => {
              const problem = leftoverProblem(day, plan);
              return (
                <div
                  key={day.date}
                  className={`${styles.card} ${day.kind !== "cook" ? styles.cardQuiet : ""} ${day.date === today ? styles.cardToday : ""} ${
                    day.meal ? styles[`decision_${day.meal.decision}`] : ""
                  }`}
                >
                  <div className={styles.dayRow}>
                    <span className={styles.day}>
                      {dayName(day.date)} <span className={styles.date}>{shortDate(day.date)}</span>
                      {day.date === today && <span className={styles.todayTag}>Today</span>}
                    </span>
                    {day.meal?.decision === "approved" && <span className={styles.approvedTag}>✓ Approved</span>}
                  </div>

                  {day.kind === "cook" && day.meal ? (
                    <CookCard
                      day={day}
                      locked={locked}
                      onDecide={(decision) => decide(day, decision)}
                      onReplace={(feedback) => replace(day, feedback)}
                      onRemove={() => remove(day)}
                    />
                  ) : (
                    <>
                      <div className={styles.quietTitle}>
                        {day.title ?? (day.kind === "leftover" ? "Leftovers" : day.kind === "away" ? "Away" : "Open")}
                      </div>
                      {day.kind === "away" && day.reason && <div className={styles.meta}>{day.reason}</div>}
                      {day.note && <div className={styles.meta}>{day.note}</div>}
                      {problem && <div className={styles.replaceNote}>{problem}</div>}
                    </>
                  )}
                </div>
              );
            })}

            <div className={styles.approval}>
              {plan.status === "executed" && <p>Shopping has been done for this plan.</p>}
              {plan.status === "approved" && (
                <>
                  <p>
                    Plan approved{plan.approved_at ? ` on ${shortDate(plan.approved_at)}` : ""}. Run the shopping task in Claude to
                    build the list and load the cart.
                  </p>
                  <button className={styles.undoBtn} onClick={reopen}>Reopen review</button>
                </>
              )}
              {!locked && (
                <>
                  <button className={styles.approvePlanBtn} onClick={approvePlan} disabled={!canApprove}>
                    Approve plan
                  </button>
                  {!canApprove && (
                    <p>
                      {cookDays.length === 0
                        ? "There are no dinners to approve."
                        : replacing > 0
                          ? "Waiting on replacements — run the meal planner in Claude, then review the new dinners."
                          : "Approve or reject each dinner first."}
                    </p>
                  )}
                </>
              )}
            </div>

            <Section title="Shopping summary" text={plan.execution} />
            <Section title="Calendar check" text={plan.calendar_notes} />
            <Section title="Notes & assumptions" text={plan.notes} />
          </>
        )}
      </div>
    </div>
  );
}
