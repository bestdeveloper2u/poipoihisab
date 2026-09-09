/**
 * Budget-threshold nudge (T32.2 — mobile twin of the web budget nudge).
 *
 * After a CONFIRMED online expense create (manual + voice paths in
 * app/add.tsx), if the expense's category has a month budget and is already
 * ≥80% used, the add screen toasts one warning + fires hapticWarning().
 * Pure decision + message module: no react-native / expo imports, so the
 * scripts/t32_nudge_check.mjs harness can exercise it under plain node.
 *
 * Semantics (web twin): null when the cat is missing/blank, `by_cat` is
 * missing, the cat is not budgeted (absent from `by_cat`), or its budget
 * is ≤ 0; otherwise pct ≥ 100 → "over", pct ≥ 80 → "warn". `usage_pct` is
 * the server-computed number and can exceed 100 (0.0 when budget == 0 —
 * which the budget ≤ 0 guard already rejects).
 */

import { STRINGS } from "./strings.ts";

/** Per-category budget row from GET /api/v1/budgets `by_cat` (lib/api.ts). */
interface NudgeCatUsage {
  budget: string;
  spent: string;
  usage_pct: number;
}

/** One budget-threshold hit: usage percentage + severity. */
export interface BudgetNudge {
  pct: number;
  level: "warn" | "over";
}

/**
 * Should adding to `cat` warn about its month budget? Mirrors the API's
 * BudgetCatUsage shape structurally (decimal-string money values) so the
 * screen can pass `budget.by_cat` straight in. Fail-safe: anything missing
 * or malformed → null (never nudge on uncertain data).
 */
export function decideBudgetNudge(
  byCat: Record<string, NudgeCatUsage> | undefined,
  cat: string | undefined,
): BudgetNudge | null {
  if (cat === undefined) return null;
  const trimmed = cat.trim();
  if (trimmed.length === 0 || byCat === undefined) return null;
  const row = byCat[trimmed];
  if (row === undefined) return null;
  // "0.00" / "" / garbage → no budget configured → never nudge.
  const budget = Number(row.budget);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  if (!(row.usage_pct >= 80)) return null; // also rejects NaN
  return { pct: row.usage_pct, level: row.usage_pct >= 100 ? "over" : "warn" };
}

/** BN digits ০-৯ — mirror of @poipoihisab/core's toBnDigits (kept local: core's
 *  extensionless internal imports don't resolve under plain-node harnesses). */
const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function toBnDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * The nudge toast text for `lang`. `{cat}`/`{pct}` placeholders in
 * lib/strings.ts budgetNudgeWarn/budgetNudgeOver are interpolated here;
 * the percentage renders as bn digits in the bn locale. The shown pct is
 * FLOORED (web-twin parity) so it can never overstate — 99.9% is still
 * "৯৯%", not a claimed 100%.
 */
export function formatBudgetNudge(
  lang: "bn" | "en",
  cat: string,
  nudge: BudgetNudge,
): string {
  const key = nudge.level === "over" ? "budgetNudgeOver" : "budgetNudgeWarn";
  const pctText = String(Math.floor(nudge.pct));
  return STRINGS[lang][key]
    .replace("{cat}", cat)
    .replace("{pct}", lang === "bn" ? toBnDigits(pctText) : pctText);
}
