import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLatestMealPlan, saveMealPlan, MealPlanConflictError, type StoredMealPlan } from "../github";
import type { MealPlan } from "../types";

// Last plan we saw, so the view paints immediately and refreshes in the background.
const CACHE_KEY = "meal_plan_cache_v1";

function loadCached(): StoredMealPlan | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (cached?.repo === localStorage.getItem("github_repo") && cached.stored?.plan) return cached.stored;
  } catch {
    // Corrupt or unavailable cache: start empty.
  }
  return null;
}

function saveCached(stored: StoredMealPlan | null) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ repo: localStorage.getItem("github_repo"), stored }));
  } catch {
    // The cache is only an optimisation.
  }
}

export function useMealPlan() {
  const [plan, setPlan] = useState<MealPlan | null>(() => loadCached()?.plan ?? null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The plan and sha as of the latest local edit. Saves run one at a time off
  // these refs, so quick taps each build on the previous edit and its new sha.
  const current = useRef<StoredMealPlan | null>(loadCached());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Let any in-flight saves land first so we don't read a half-updated plan.
      await queue.current;
      const stored = await fetchLatestMealPlan();
      current.current = stored;
      saveCached(stored);
      setPlan(stored?.plan ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the meal plan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Apply an edit straight away, then write it to GitHub in the background.
  const update = useCallback(
    (change: (plan: MealPlan) => MealPlan, message: string) => {
      if (!current.current) return;
      const next = change(current.current.plan);
      current.current = { ...current.current, plan: next };
      setPlan(next);
      pending.current++;
      setSaving(true);

      queue.current = queue.current.then(async () => {
        const stored = current.current;
        if (!stored) return;
        try {
          const sha = await saveMealPlan(next, stored.sha, message);
          // Later edits may already have replaced the plan; only the sha moves on.
          current.current = { plan: current.current!.plan, sha };
          saveCached(current.current);
          setError(null);
        } catch (e) {
          const conflict = e instanceof MealPlanConflictError;
          setError(
            conflict
              ? "The plan was changed elsewhere (a Claude revision?), so your last change wasn't saved. Showing the latest version."
              : `Your last change wasn't saved (${e instanceof Error ? e.message : "unknown error"}). Showing the saved version.`
          );
          // Drop the unsaved edit and show what is actually on GitHub.
          try {
            const fresh = await fetchLatestMealPlan();
            current.current = fresh;
            saveCached(fresh);
            setPlan(fresh?.plan ?? null);
          } catch {
            // Offline: keep showing the local copy; the error banner explains.
          }
        } finally {
          if (--pending.current === 0) setSaving(false);
        }
      });
    },
    []
  );

  return { plan, loading, saving, error, reload: load, update };
}
