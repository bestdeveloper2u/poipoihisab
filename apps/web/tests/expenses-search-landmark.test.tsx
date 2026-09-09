import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { t } from "@poipoihisab/core";
import { Expenses } from "../src/screens/Expenses";
import { useLangStore } from "../src/store/lang";
import { w } from "../src/lib/web-i18n";
import { makeExpense, resetLang } from "./helpers";

// Real Expenses + in-memory router; query/mutation hooks and closed overlays
// are isolated. No authenticated app startup or real network is involved.
const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock("../src/lib/queries", () => ({
  useExpensesInfinite: mocks.query,
  useExpenseMutations: () => ({
    bulkCreate: { isPending: false, mutateAsync: mocks.mutate },
    create: { isPending: false, mutateAsync: mocks.mutate },
    remove: { isPending: false, mutate: mocks.mutate },
  }),
}));
vi.mock("../src/components/ExpenseForm", () => ({ ExpenseForm: () => null }));
vi.mock("../src/components/VoiceOverlay", () => ({ VoiceOverlay: () => null }));

function setQuery(state: string) {
  mocks.query.mockReturnValue({
    data: { pages: [{ ok: true, data: { items: state === "populated" ? [makeExpense()] : [], next_cursor: null } }] },
    isPending: state === "loading", isError: state === "error",
    error: state === "error" ? new Error("Mock failure") : null,
    hasNextPage: false,
  });
}
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
function mount() {
  return render(<MemoryRouter initialEntries={["/expenses?keep=1"]}><Expenses /><LocationProbe /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  resetLang();
  setQuery("populated");
  // jsdom has no window scrolling; leave the real virtualizer mounted.
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network"); }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  resetLang();
});

describe("Expenses localized search landmark (isolated component)", () => {
  for (const lang of ["bn", "en"] as const) {
    it.each(["loading", "error", "empty", "populated"])(`${lang}: one named landmark in %s state, only wrapping search`, (state) => {
      useLangStore.setState({ lang });
      setQuery(state);
      mount();
      expect(screen.getAllByRole("search")).toHaveLength(1);
      const region = screen.getByRole("search", { name: t(lang, "navExpenses") });
      const box = within(region).getByRole("searchbox", { name: w(lang, "searchPh") });
      expect(screen.getAllByRole("searchbox")).toHaveLength(1);
      expect(box).toHaveAttribute("type", "search");
      expect(box).toHaveAttribute("placeholder", w(lang, "searchPh"));
      expect(region).toHaveClass("relative", "min-w-[200px]", "flex-1");
      expect(region).not.toHaveAttribute("tabindex");
      expect(region).not.toHaveAttribute("aria-live");
      expect(box.closest("form")).toBeNull();
      expect(within(region).queryByRole("button")).not.toBeInTheDocument();
      for (const name of [t(lang, "addExpense"), w(lang, "voiceBtn"), w(lang, "csvLabel"), w(lang, "importBtn")]) {
        for (const button of screen.getAllByRole("button", { name })) expect(region).not.toContainElement(button);
      }
    });
  }

  it("updates bn → en → bn names without replacing the focused input or its value", () => {
    mount();
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "tea" } });
    box.focus();
    for (const lang of ["en", "bn"] as const) {
      act(() => useLangStore.getState().setLang(lang));
      const region = screen.getByRole("search", { name: t(lang, "navExpenses") });
      expect(within(region).getByRole("searchbox", { name: w(lang, "searchPh") })).toBe(box);
      expect(box).toHaveValue("tea");
      expect(box).toHaveFocus();
      expect(screen.getAllByRole("search")).toHaveLength(1);
    }
  });

  it("preserves 300ms debounce, trimming/80-character limit, month selection and clearing", () => {
    vi.useFakeTimers();
    mount();
    const monthGroup = screen.getByRole("group", { name: w("bn", "filterAll") });
    const month = within(monthGroup).getAllByRole("button")[1]!;
    fireEvent.click(month);
    const selected = mocks.query.mock.lastCall![0];
    expect(selected.from).toEqual(expect.any(String));
    expect(selected.to).toEqual(expect.any(String));
    const box = within(screen.getByRole("search")).getByRole("searchbox");
    fireEvent.change(box, { target: { value: "old" } });
    act(() => vi.advanceTimersByTime(200));
    const raw = `  ${"x".repeat(90)}  `;
    fireEvent.change(box, { target: { value: raw } });
    act(() => vi.advanceTimersByTime(299));
    expect(mocks.query.mock.lastCall![0]).toEqual(selected);
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.query.mock.lastCall![0]).toEqual({ ...selected, q: "x".repeat(80) });
    expect(box).toHaveValue(raw);
    fireEvent.change(box, { target: { value: "" } });
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.query.mock.lastCall![0]).toEqual(selected);
    expect(box).toHaveValue("");
    expect(month).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/expenses?keep=1");
  });

  it("keeps search → Add tab order and Enter does not navigate, open a form or mutate", async () => {
    const user = userEvent.setup();
    mount();
    await user.tab();
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await user.type(screen.getByRole("searchbox"), "tea{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/expenses?keep=1");
    await user.tab();
    expect(screen.getByRole("button", { name: t("bn", "addExpense") })).toHaveFocus();
  });
});
