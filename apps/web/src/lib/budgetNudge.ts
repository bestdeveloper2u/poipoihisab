/**
 * T32.1 — budget-threshold nudge at add-time (pure decision layer).
 *
 * After a CONFIRMED expense create (never an offline outbox enqueue), the
 * add mutations check the created expense's category against that month's
 * per-category budget: crossing the ticket's "খাতার ৮০% বাজেট শেষ" line
 * (>=80%) shows a warning toast, reaching 100% an over-budget one. Zero AI
 * cost, zero API change — numbers come from the budgets data the caller
 * already holds (see lib/queries.ts for the cache-first data source rule).
 *
 * This module stays pure: no QueryClient, no toast, no fetch. The API
 * contract is mirrored structurally (BudgetCatUsageView = api-client's
 * BudgetCatUsage: usage_pct = spent/budget*100, may exceed 100; only
 * budgeted categories appear in by_cat) so a schema change upstream is a
 * compile error, not a wrong toast.
 */
import { toBnDigits, type Lang } from "@poipoihisab/core";
import { w } from "./web-i18n";

/** GET /budgets `by_cat` entry (structurally = api-client BudgetCatUsage). */
export interface BudgetCatUsageView {
  budget: string;
  spent: string;
  usage_pct: number;
}

export type BudgetNudgeLevel = "warn" | "over";

export interface BudgetNudge {
  /** Raw usage percentage at decision time (may exceed 100). */
  pct: number;
  level: BudgetNudgeLevel;
}

/** Warn threshold: the ticket's 80% budget line. */
export const BUDGET_WARN_PCT = 80;

/**
 * Decide whether ONE add into `cat` warrants a budget nudge, given the
 * month's per-category usage view (post-check usage already folded in by
 * the caller when it came from a stale cache). Null when there is nothing
 * to say: no category, no budget row for it, a non-positive budget, or
 * usage still below the 80% line.
 */
export function decideBudgetNudge(
  byCat: Record<string, BudgetCatUsageView> | undefined,
  cat: string | undefined,
): BudgetNudge | null {
  if (!cat) return null;
  const rec = byCat?.[cat];
  if (!rec) return null;
  const budget = Number(rec.budget);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  const pct = Number(rec.usage_pct);
  if (!Number.isFinite(pct)) return null;
  if (pct >= 100) return { pct, level: "over" };
  if (pct >= BUDGET_WARN_PCT) return { pct, level: "warn" };
  return null;
}

/**
 * Fold ONE just-added amount into a cached (pre-create) per-category usage
 * record: spent' = spent + amt, usage_pct' = spent'/budget*100. Callers use
 * this because a cache hit predates the create — without the fold the
 * crossing this expense caused would only be noticed on the NEXT add. A
 * degenerate record (budget <= 0 / unparseable numbers) is returned as-is;
 * decideBudgetNudge already nulls those.
 */
export function foldAddIntoCatUsage(
  rec: BudgetCatUsageView,
  addAmt: number,
): BudgetCatUsageView {
  const budget = Number(rec.budget);
  const spent = Number(rec.spent);
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(spent)) return rec;
  const next = spent + (Number.isFinite(addAmt) ? addAmt : 0);
  return { budget: rec.budget, spent: String(next), usage_pct: (next / budget) * 100 };
}

/**
 * The single toast for a multi-item submission (voice bulk add): 'over'
 * beats 'warn', higher pct wins within a level. One nudge per submission —
 * never one per expense.
 */
export function severestNudge(
  items: Array<{ cat: string; nudge: BudgetNudge }>,
): ({ cat: string } & BudgetNudge) | null {
  let best: ({ cat: string } & BudgetNudge) | null = null;
  for (const { cat, nudge } of items) {
    if (
      best === null ||
      (nudge.level === "over" && best.level !== "over") ||
      (nudge.level === best.level && nudge.pct > best.pct)
    ) {
      best = { cat, ...nudge };
    }
  }
  return best;
}

/**
 * Localised nudge text: "{cat}: বাজেটের {pct}% খরচ হয়েছে" /
 * "{cat}: বাজেট ছাড়িয়ে গেছে ({pct}%)" in bn (Bengali digits), English
 * equivalents in en. The shown pct is floored so it can never overstate —
 * 99.9% is still "৯৯%", not a claimed 100%.
 */
export function budgetNudgeMessage(
  lang: Lang,
  cat: string,
  pct: number,
  level: BudgetNudgeLevel,
): string {
  const shown = Math.floor(pct).toString();
  const pctText = lang === "bn" ? toBnDigits(shown) : shown;
  return w(lang, level === "over" ? "budgetNudgeOver" : "budgetNudgeWarn")
    .replace("{cat}", cat)
    .replace("{pct}", pctText);
}
