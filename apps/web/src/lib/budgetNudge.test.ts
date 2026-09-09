import { describe, expect, it } from "vitest";
import { toBnDigits } from "@poipoihisab/core";
import {
  budgetNudgeMessage,
  decideBudgetNudge,
  foldAddIntoCatUsage,
  severestNudge,
  type BudgetCatUsageView,
} from "./budgetNudge";
import { W } from "./web-i18n";

/**
 * T32.1 — pure budget-nudge decision layer. The API contract being mirrored:
 * GET /budgets by_cat holds only budgeted categories, usage_pct =
 * spent/budget*100 and CAN exceed 100; budgets are decimal STRINGS.
 */

const usage = (budget: string, spent: string, usage_pct: number): BudgetCatUsageView => ({
  budget,
  spent,
  usage_pct,
});

const BY_CAT: Record<string, BudgetCatUsageView> = {
  মাছ: usage("1000", "799", 79.9),
  চা: usage("500", "400", 80),
  বাসা: usage("2000", "2000", 100),
  রিকশা: usage("300", "450", 150),
};

describe("decideBudgetNudge", () => {
  it("(1) no cat (undefined / empty) → null", () => {
    expect(decideBudgetNudge(BY_CAT, undefined)).toBeNull();
    expect(decideBudgetNudge(BY_CAT, "")).toBeNull();
  });

  it("(2) missing by_cat (undefined) → null", () => {
    expect(decideBudgetNudge(undefined, "মাছ")).toBeNull();
  });

  it("(3) cat not in by_cat (unbudgeted category) → null", () => {
    expect(decideBudgetNudge(BY_CAT, "চিপস")).toBeNull();
  });

  it("(4) budget 0 → null (also negative / non-numeric guards)", () => {
    expect(decideBudgetNudge({ চিপস: usage("0", "50", 0) }, "চিপস")).toBeNull();
    expect(decideBudgetNudge({ চিপস: usage("-100", "50", 50) }, "চিপস")).toBeNull();
    expect(
      decideBudgetNudge({ চিপস: { budget: "abc", spent: "50", usage_pct: 50 } }, "চিপস"),
    ).toBeNull();
  });

  it("(5) pct 79.9 → null (below the 80% line)", () => {
    expect(decideBudgetNudge(BY_CAT, "মাছ")).toBeNull();
  });

  it("(6) pct 80 → warn with the raw pct", () => {
    expect(decideBudgetNudge(BY_CAT, "চা")).toEqual({ pct: 80, level: "warn" });
  });

  it("(7) pct 100 → over", () => {
    expect(decideBudgetNudge(BY_CAT, "বাসা")).toEqual({ pct: 100, level: "over" });
  });

  it("(8) pct 150 → over (usage_pct may exceed 100)", () => {
    expect(decideBudgetNudge(BY_CAT, "রিকশা")).toEqual({ pct: 150, level: "over" });
  });

  it("(9) non-finite usage_pct → null (never a bogus toast)", () => {
    expect(
      decideBudgetNudge({ চিপস: { budget: "100", spent: "10", usage_pct: Number.NaN } }, "চিপস"),
    ).toBeNull();
  });
});

describe("foldAddIntoCatUsage", () => {
  it("(10) folds one add into a cached (pre-create) usage record", () => {
    const folded = foldAddIntoCatUsage(usage("1000", "750", 75), 100);
    expect(folded.budget).toBe("1000");
    expect(Number(folded.spent)).toBe(850);
    expect(folded.usage_pct).toBeCloseTo(85, 10);
    // The folded view crosses the line the raw cached record does not.
    expect(decideBudgetNudge({ মাছ: folded }, "মাছ")).toEqual({ pct: 85, level: "warn" });
  });

  it("(11) degenerate records pass through unchanged (decide nulls them)", () => {
    const zero = usage("0", "10", 0);
    expect(foldAddIntoCatUsage(zero, 500)).toBe(zero);
    expect(foldAddIntoCatUsage(usage("abc", "10", 0), 500)).toEqual(usage("abc", "10", 0));
  });
});

describe("severestNudge", () => {
  it("(12) one result per submission: over beats warn, higher pct wins, empty → null", () => {
    expect(severestNudge([])).toBeNull();
    expect(severestNudge([{ cat: "চা", nudge: { pct: 85, level: "warn" } }])).toEqual({
      cat: "চা",
      pct: 85,
      level: "warn",
    });
    // warn 150 vs over 100 → over wins despite the lower pct.
    expect(
      severestNudge([
        { cat: "রিকশা", nudge: { pct: 150, level: "warn" } },
        { cat: "বাসা", nudge: { pct: 100, level: "over" } },
      ]),
    ).toEqual({ cat: "বাসা", pct: 100, level: "over" });
    // Same level → the higher pct.
    expect(
      severestNudge([
        { cat: "চা", nudge: { pct: 82, level: "warn" } },
        { cat: "মাছ", nudge: { pct: 95, level: "warn" } },
      ]),
    ).toEqual({ cat: "মাছ", pct: 95, level: "warn" });
  });
});

describe("budgetNudgeMessage", () => {
  it("(13) bn: cat + Bengali digits, warn and over templates", () => {
    expect(budgetNudgeMessage("bn", "মাছ", 85.7, "warn")).toBe("মাছ: বাজেটের ৮৫% খরচ হয়েছে");
    expect(budgetNudgeMessage("bn", "বাসা", 105.4, "over")).toBe("বাসা: বাজেট ছাড়িয়ে গেছে (১০৫%)");
    // Floors instead of rounding up — never overstates: 99.9 is still ৯৯%.
    expect(budgetNudgeMessage("bn", "চা", 99.9, "warn")).toBe(
      `চা: বাজেটের ${toBnDigits("99")}% খরচ হয়েছে`,
    );
  });

  it("(14) en: English templates, plain digits", () => {
    expect(budgetNudgeMessage("en", "Fish", 85, "warn")).toBe(
      W.en.budgetNudgeWarn.replace("{cat}", "Fish").replace("{pct}", "85"),
    );
    expect(budgetNudgeMessage("en", "Rent", 120.25, "over")).toBe("Rent: over budget (120%)");
  });
});
