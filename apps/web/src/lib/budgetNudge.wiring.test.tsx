import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T32.1 — the budget-nudge WIRING in lib/queries.ts (the pure decision
 * helper has its own unit tests in budgetNudge.test.ts). The api-client
 * module is mocked; the budgets query cache is seeded/queried with the SAME
 * key useBudget uses. Pins: warn at >=80%, over at >=100%, silence below,
 * cache-first with at most ONE GET /budgets on a miss, one nudge per
 * submission (bulk included), and NO nudge for an offline outbox enqueue.
 */

const { createExpenseMock, bulkCreateMock, getBudgetMock } = vi.hoisted(() => ({
  createExpenseMock: vi.fn(),
  bulkCreateMock: vi.fn(),
  getBudgetMock: vi.fn(),
}));

vi.mock("@poipoihisab/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poipoihisab/api-client")>()),
  apiCreateExpense: createExpenseMock,
  apiBulkCreateExpenses: bulkCreateMock,
  apiGetBudget: getBudgetMock,
}));

import { useExpenseMutations } from "./queries";
import { makeInMemoryOutboxBackend, setOutboxBackendForTests } from "./outbox";
import { currentToast, subscribeToasts } from "./toast";
import { W } from "./web-i18n";
import { useLangStore } from "../store/lang";
import type { Expense, ExpenseCreateInput } from "@poipoihisab/api-client";

const YM = "2026-09";

const BODY: ExpenseCreateInput = {
  amt: "100",
  cat: "মাছ",
  grp: "food",
  pay: "cash",
  iso: `${YM}-06`,
  desc: null,
};

/** Server row returned by the mocked POST /expenses. */
const SERVER_ROW: Expense = {
  id: "srv-1",
  user_id: "u1",
  amt: "100.00",
  cat: "মাছ",
  grp: "food",
  pay: "cash",
  desc: null,
  iso: `${YM}-06`,
  created_at: "2026-09-06T09:00:00Z",
};

/** Cache-first: seed the SAME key qk.budget(ym, lang) populates. */
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

const nudgeWarn = (cat: string, pct: string) =>
  W.bn.budgetNudgeWarn.replace("{cat}", cat).replace("{pct}", pct);
const nudgeOver = (cat: string, pct: string) =>
  W.bn.budgetNudgeOver.replace("{cat}", cat).replace("{pct}", pct);

/* ---------------- navigator.onLine mock plumbing (outbox.test.ts) -------- */

const onLineDescriptor =
  Object.getOwnPropertyDescriptor(window.navigator, "onLine") ??
  Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

/* ---------------- toast capture ---------------- */

let texts: string[] = [];
let unsubscribe: (() => void) | null = null;

function renderMutations(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useExpenseMutations(), { wrapper });
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  texts = [];
  unsubscribe = subscribeToasts((state) => {
    if (state) texts.push(state.text);
  });
  useLangStore.setState({ lang: "bn" });
  setOnline(true);
  createExpenseMock.mockReset();
  bulkCreateMock.mockReset();
  getBudgetMock.mockReset();
  createExpenseMock.mockResolvedValue({ ok: true, data: SERVER_ROW });
});

afterEach(() => {
  unsubscribe?.();
  setOutboxBackendForTests(null);
  if (onLineDescriptor) Object.defineProperty(window.navigator, "onLine", onLineDescriptor);
  else Reflect.deleteProperty(window.navigator, "onLine");
  vi.restoreAllMocks();
});

describe("budget nudge wiring (T32.1)", () => {
  it("(1) confirmed create with warm cache crossing 80% toasts the warn nudge exactly once", async () => {
    const qc = makeClient();
    seedBudgets(qc, "750", 75); // pre-create: 75% + 100/1000 → 85%
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.create.mutateAsync(BODY);
    });

    await waitFor(() =>
      expect(texts.filter((text) => text === nudgeWarn("মাছ", "৮৫"))).toHaveLength(1),
    );
    expect(getBudgetMock).not.toHaveBeenCalled(); // cache was fresh — no fetch
    // The nudge owns the single toast slot at the end (see the defer note in
    // lib/queries.ts) — one nudge per submission, never repeated.
    expect(currentToast()?.text).toBe(nudgeWarn("মাছ", "৮৫"));
  });

  it("(2) below the 80% line after the fold → no nudge at all", async () => {
    const qc = makeClient();
    seedBudgets(qc, "600", 60); // 60% + 100/1000 → 70%
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.create.mutateAsync(BODY);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(createExpenseMock).toHaveBeenCalledTimes(1);
    expect(texts).not.toContain(nudgeWarn("মাছ", "৭০"));
    expect(texts.every((text) => !text.includes("বাজেটের"))).toBe(true);
  });

  it("(3) exactly 100% and beyond toasts the over-budget variant", async () => {
    const qc = makeClient();
    seedBudgets(qc, "950", 95); // + 100/1000 → 105%
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.create.mutateAsync(BODY);
    });

    await waitFor(() => expect(currentToast()?.text).toBe(nudgeOver("মাছ", "১০৫")));
  });

  it("(4) cache miss → exactly ONE GET /budgets, whose fresh by_cat already includes the add", async () => {
    const qc = makeClient(); // no seed
    getBudgetMock.mockResolvedValue({
      ok: true,
      data: {
        ym: YM,
        total: "1000",
        spent: "900", // POST committed before the GET → post-create usage
        usage_pct: 90,
        cats: { মাছ: "1000" },
        by_cat: { মাছ: { budget: "1000", spent: "900", usage_pct: 90 } },
      },
    });
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.create.mutateAsync(BODY);
    });

    await waitFor(() => expect(currentToast()?.text).toBe(nudgeWarn("মাছ", "৯০")));
    expect(getBudgetMock).toHaveBeenCalledTimes(1);
    expect(getBudgetMock).toHaveBeenCalledWith(YM, "bn");
  });

  it("(5) offline create is queued, never nudged", async () => {
    setOutboxBackendForTests(makeInMemoryOutboxBackend());
    setOnline(false);
    createExpenseMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const qc = makeClient();
    seedBudgets(qc, "750", 75);
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.create.mutateAsync(BODY).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(texts).toContain(W.bn.offlineQueued);
    expect(texts.every((text) => !text.includes("বাজেটের"))).toBe(true);
  });

  it("(6) bulk (voice) submission nudges ONCE with the severest category", async () => {
    bulkCreateMock.mockResolvedValue({ ok: true, data: { count: 2, items: [SERVER_ROW] } });
    const qc = makeClient();
    seedBudgets(qc, "950", 95); // মাছ: 950+100 → 105% over
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.bulkCreate.mutateAsync([
        BODY, // মাছ → over 105%
        { ...BODY, amt: "50", cat: "চিপস" }, // unbudgeted → nothing
      ]);
    });

    await waitFor(() => expect(currentToast()?.text).toBe(nudgeOver("মাছ", "১০৫")));
    expect(texts.filter((text) => text.includes("বাজেট"))).toHaveLength(1);
  });

  it("(7) a bulk ok:false is not a save — no nudge", async () => {
    bulkCreateMock.mockResolvedValue({ ok: false, status: 500, detail: "boom" });
    const qc = makeClient();
    seedBudgets(qc, "750", 75);
    const { result } = renderMutations(qc);

    await act(async () => {
      await result.current.bulkCreate.mutateAsync([BODY]);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(texts.every((text) => !text.includes("বাজেটের"))).toBe(true);
  });
});
