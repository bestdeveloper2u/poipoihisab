import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiResult, Recurring as Rule } from "@poipoihisab/api-client";
import { Recurring } from "../src/screens/Recurring";
import { useLangStore } from "../src/store/lang";
import { subscribeToasts } from "../src/lib/toast";
import { w } from "../src/lib/web-i18n";

// Render the real screen/rows; isolate all query and mutation hooks from the API.
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  update: { isPending: false, mutate: vi.fn() },
  create: { isPending: false, mutate: vi.fn() },
  remove: { isPending: false, mutate: vi.fn() },
  run: { isPending: false, mutate: vi.fn() },
}));
vi.mock("../src/lib/queries", () => ({
  useRecurringInfinite: mocks.query,
  useRecurringMutations: () => mocks,
  // VoiceOverlay mounts with the Recurring screen (T29.2 mic FAB); its
  // hooks are irrelevant here and must never fire (afterEach asserts no
  // network) — inert stubs keep this partial mock complete.
  useVoiceParse: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useExpenseMutations: () => ({ bulkCreate: { isPending: false, mutateAsync: vi.fn() } }),
  useDebtMutations: () => ({ create: { isPending: false, mutateAsync: vi.fn() } }),
  useBudgetMutation: () => ({ put: { isPending: false, mutateAsync: vi.fn() } }),
}));

const rule: Rule = {
  id: "r1", user_id: "u1", cat: "বাসা ভাড়া", grp: "housing",
  amt: "8000.00", pay: "cash", desc: null, freq: "monthly",
  start_date: "2026-09-01", next_run: "2026-09-05", active: true,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
function serverRows(items: Rule[]) {
  mocks.query.mockReturnValue({
    data: { pages: [{ ok: true, data: { items, next_cursor: null } }] },
    isPending: false, isError: false, hasNextPage: false,
  });
}
type Callbacks = {
  onSuccess: (result: ApiResult<Rule>) => void;
  onError: () => void;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.isPending = false;
  serverRows([{ ...rule }]);
  // Fail closed: even unrelated startup effects must not reach a real backend.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => {
  cleanup();
  expect(mocks.create.mutate).not.toHaveBeenCalled();
  expect(mocks.remove.mutate).not.toHaveBeenCalled();
  expect(mocks.run.mutate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  useLangStore.setState({ lang: "bn" });
});

for (const lang of ["bn", "en"] as const) {
  const label = lang === "bn" ? "চালু" : "Active";
  const paused = lang === "bn" ? "বন্ধ" : "Paused";
  const name = `${rule.cat} — ${label}`;
  describe(`Recurring switch identity (${lang})`, () => {
    beforeEach(() => useLangStore.setState({ lang }));

    it.each([true, false])("names an initially active=%s rule independently of state", (active) => {
      serverRows([{ ...rule, active }, { ...rule, id: "r2", cat: "ইন্টারনেট", active: !active }]);
      render(<Recurring />);
      const sw = screen.getByRole("switch", { name });
      expect(sw).toHaveAttribute("type", "button");
      expect(sw).toHaveAttribute("aria-checked", String(active));
      expect(within(sw.closest("li")!).getByText(active ? label : paused)).toBeVisible();
      expect(screen.getByRole("switch", { name: `ইন্টারনেট — ${label}` }))
        .toHaveAttribute("aria-checked", String(!active));
      expect(mocks.update.mutate).not.toHaveBeenCalled();
    });

    it("retains name, DOM identity and focus through active → paused → active", () => {
      const view = render(<Recurring />);
      const sw = screen.getByRole("switch", { name });
      sw.focus();
      for (const active of [false, true]) {
        serverRows([{ ...rule, active }]);
        view.rerender(<Recurring />);
        expect(screen.getByRole("switch", { name })).toBe(sw);
        expect(sw).toHaveFocus();
        expect(sw).toHaveAttribute("aria-checked", String(active));
        expect(within(sw.closest("li")!).getByText(active ? label : paused)).toBeVisible();
      }
      expect(mocks.update.mutate).not.toHaveBeenCalled();
    });

    it.each(["click", "Space", "Enter"])("%s sends exactly one existing PATCH intent in each state", async (method) => {
      const user = userEvent.setup();
      const view = render(<Recurring />);
      for (const active of [true, false]) {
        serverRows([{ ...rule, active }]);
        view.rerender(<Recurring />);
        mocks.update.mutate.mockClear();
        const sw = screen.getByRole("switch", { name });
        sw.focus();
        if (method === "click") await user.click(sw);
        else await user.keyboard(method === "Space" ? " " : "{Enter}");
        expect(mocks.update.mutate).toHaveBeenCalledExactlyOnceWith(
          { id: rule.id, body: { active: !active } },
          { onSuccess: expect.any(Function), onError: expect.any(Function) },
        );
        // This UI remains backed by query data, not an optimistic local flip.
        expect(sw).toHaveAttribute("aria-checked", String(active));
      }
    });

    it.each([true, false])("pending disables an active=%s switch and prevents repeated activation", async (active) => {
      const user = userEvent.setup();
      serverRows([{ ...rule, active }]);
      const view = render(<Recurring />);
      const sw = screen.getByRole("switch", { name });
      sw.focus();
      mocks.update.isPending = true;
      view.rerender(<Recurring />);
      expect(sw).toBeDisabled();
      await user.click(sw);
      await user.keyboard(" {Enter}");
      expect(mocks.update.mutate).not.toHaveBeenCalled();
      expect(sw).toHaveAttribute("aria-checked", String(active));
    });

    it.each(["detail", "fallback", "network"])("%s failure preserves server state and existing toast feedback", async (failure) => {
      const seen: string[] = [];
      const unsubscribe = subscribeToasts((s) => { if (s) seen.push(s.text); });
      try {
        mocks.update.mutate.mockImplementationOnce((_intent: unknown, callbacks: Callbacks) => {
          if (failure === "network") callbacks.onError();
          else callbacks.onSuccess({ ok: false, status: 500, detail: failure === "detail" ? "Cannot save rule" : "" });
        });
        render(<Recurring />);
        const sw = screen.getByRole("switch", { name });
        await userEvent.setup().click(sw);
        expect(mocks.update.mutate).toHaveBeenCalledTimes(1);
        expect(sw).toBeChecked();
        expect(sw).toHaveAccessibleName(name);
        expect(within(sw.closest("li")!).getByText(label)).toBeVisible();
        expect(seen).toContain(failure === "detail" ? "Cannot save rule" : w(lang, "rErrSave"));
      } finally {
        unsubscribe();
      }
    });
  });
}

it("language changes relabel the same focused paused switch without dangling references", () => {
  serverRows([{ ...rule, active: false }]);
  useLangStore.setState({ lang: "bn" });
  render(<Recurring />);
  const sw = screen.getByRole("switch", { name: `${rule.cat} — চালু` });
  sw.focus();
  for (const lang of ["en", "bn"] as const) {
    act(() => useLangStore.setState({ lang }));
    expect(screen.getByRole("switch", { name: `${rule.cat} — ${lang === "bn" ? "চালু" : "Active"}` })).toBe(sw);
    expect(sw).toHaveFocus();
    expect(sw).not.toBeChecked();
    expect(sw).not.toHaveAttribute("aria-labelledby");
    expect(within(sw.closest("li")!).getByText(lang === "bn" ? "বন্ধ" : "Paused")).toBeVisible();
  }
  expect(mocks.update.mutate).not.toHaveBeenCalled();
});
