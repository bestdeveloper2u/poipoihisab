import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T32.1 — component-level proof that the budget nudge fires at the point of
 * decision: a manual add (ExpenseForm → useExpenseMutations.create) that
 * pushes its category to >=80% of the month budget ends with the warning
 * toast visible (exactly once, AFTER the generic "সংরক্ষণ হয়েছে" — the
 * shared slot's final message), and an add below the line never shows one.
 * The budgets query cache is seeded with the SAME key useBudget populates;
 * api-client is mocked (incl. the T24.1 duplicate-guard list fetch).
 */

const { createExpenseMock, listExpensesMock, listCategoriesMock } = vi.hoisted(() => ({
  createExpenseMock: vi.fn(),
  listExpensesMock: vi.fn(),
  listCategoriesMock: vi.fn(),
}));

vi.mock("@poipoihisab/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poipoihisab/api-client")>()),
  apiCreateExpense: createExpenseMock,
  apiListExpenses: listExpensesMock,
  apiListCategories: listCategoriesMock,
}));

import { ExpenseForm } from "./ExpenseForm";
import { todayIso } from "../lib/catalog";
import { currentToast, subscribeToasts } from "../lib/toast";
import { W } from "../lib/web-i18n";
import { useLangStore } from "../store/lang";
import type { Expense } from "@poipoihisab/api-client";

const YM = todayIso().slice(0, 7); // the form defaults iso to today

const SERVER_ROW: Expense = {
  id: "srv-1",
  user_id: "u1",
  amt: "100.00",
  cat: "মাছ",
  grp: "food",
  pay: "cash",
  desc: null,
  iso: todayIso(),
  created_at: `${YM}-06T09:00:00Z`,
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Warm budgets cache (pre-create usage) under the exact qk.budget key. */
function seedBudgets(qc: QueryClient, spent: string, usagePct: number): void {
  qc.setQueryData(["budgets", YM, "bn"], {
    ok: true,
    data: {
      ym: YM,
      total: "1000",
      spent,
      usage_pct: usagePct,
      cats: { মাছ: "1000" },
      by_cat: { মাছ: { budget: "1000", spent, usage_pct: usagePct } },
    },
  });
}

function renderForm() {
  const qc = makeClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ExpenseForm open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { qc, onClose };
}

/** ৳১০০ into মাছ, submitted through the real form (dup guard passes). */
function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("পরিমাণ (৳)"), { target: { value: "১০০" } });
  fireEvent.change(screen.getByLabelText("খাত"), { target: { value: "মাছ" } });
  fireEvent.submit(document.querySelector("form") as HTMLFormElement);
}

let texts: string[] = [];
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  window.localStorage.clear();
  texts = [];
  unsubscribe = subscribeToasts((state) => {
    if (state) texts.push(state.text);
  });
  useLangStore.setState({ lang: "bn" });
  createExpenseMock.mockReset().mockResolvedValue({ ok: true, data: SERVER_ROW });
  listExpensesMock.mockReset().mockResolvedValue({
    ok: true,
    data: { items: [], next_cursor: null }, // duplicate guard: nothing recent
  });
  listCategoriesMock.mockReset().mockResolvedValue({
    ok: true,
    data: { items: [], next_cursor: null },
  });
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  vi.restoreAllMocks();
  useLangStore.setState({ lang: "bn" });
});

describe("ExpenseForm budget nudge at add-time (T32.1)", () => {
  it("usage crossing 80% ends with the warn toast, shown exactly once", async () => {
    const { qc, onClose } = renderForm();
    seedBudgets(qc, "750", 75); // 75% + ১০০/১০০০ → 85%

    fillAndSubmit();

    // The save completes normally…
    await waitFor(() => expect(texts).toContain(W.bn.tSaved));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // …and the nudge then owns the shared toast slot — exactly one nudge.
    const expected = W.bn.budgetNudgeWarn.replace("{cat}", "মাছ").replace("{pct}", "৮৫");
    await waitFor(() => expect(currentToast()?.text).toBe(expected));
    expect(texts.filter((text) => text === expected)).toHaveLength(1);
  });

  it("usage below 80% never nudges — the save toast stays", async () => {
    const { qc, onClose } = renderForm();
    seedBudgets(qc, "600", 60); // 60% + ১০০/১০০০ → 70%

    fillAndSubmit();

    await waitFor(() => expect(texts).toContain(W.bn.tSaved));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20)); // let any nudge fire

    expect(texts.every((text) => !text.includes("বাজেটের"))).toBe(true);
    expect(currentToast()?.text).toBe(W.bn.tSaved);
  });
});
