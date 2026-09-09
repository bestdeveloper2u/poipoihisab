import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Budget as BudgetData } from "@poipoihisab/api-client";
import { Budget } from "../src/screens/Budget";
import { useLangStore } from "../src/store/lang";
import { fmtTaka } from "../src/lib/money";
import { w } from "../src/lib/web-i18n";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock("../src/lib/queries", () => ({
  useBudget: (...args: unknown[]) => mocks.query(...args),
  useBudgetMutation: () => ({ put: { mutate: mocks.mutate } }),
}));
vi.mock("../src/components/VoiceOverlay", () => ({ VoiceOverlay: () => null }));

let data: BudgetData;
let pending = false;
let failed = false;
beforeEach(() => {
  data = { ym: "2026-09", total: "1000.00", spent: "1250.00", usage_pct: 125, cats: {}, by_cat: {} };
  pending = false;
  failed = false;
  mocks.mutate.mockReset();
  mocks.query.mockImplementation(() => ({ data: pending || failed ? undefined : { ok: true, data }, isPending: pending, isError: failed }));
});
afterEach(() => { cleanup(); useLangStore.setState({ lang: "bn" }); });
const view = () => <MemoryRouter><Budget /></MemoryRouter>;

function descriptions(bar: HTMLElement) {
  const ids = bar.getAttribute("aria-describedby")?.split(" ") ?? [];
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  return ids.map((id) => {
    const matches = Array.from(document.querySelectorAll("[id]")).filter((el) => el.id === id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBeVisible();
    expect(matches[0].tagName).toBe("SPAN");
    return matches[0];
  });
}

for (const lang of ["bn", "en"] as const) {
  describe(`${lang} Budget progress semantics`, () => {
    beforeEach(() => useLangStore.setState({ lang }));
    it.each([
      ["overspend", "1000.00", "1250.00", 125, 100, "100%"],
      ["zero usage", "1000.00", "0.00", 0, 0, "0%"],
      ["normal", "1000.00", "750.00", 75, 75, "75%"],
      ["at limit", "1000.00", "1000.00", 100, 100, "100%"],
      ["fractional", "1000.00", "755.50", 75.55, 76, "75.55%"],
      ["zero limit with spend", "0.00", "12.34", 0, 100, "100%"],
      ["zero limit without spend", "0.00", "0.00", 0, 0, "0%"],
    ])("%s retains exact financial chips", (_label, total, spent, usage, now, width) => {
      data = { ...data, total, spent, usage_pct: usage };
      render(view());
      const bar = screen.getByRole("progressbar", { name: w(lang, "budVsLimit") });
      expect(bar).toHaveAttribute("aria-valuenow", String(now));
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      const over = Number(total) === 0 ? Number(spent) > 0 : usage > 100;
      expect(bar.firstElementChild).toHaveStyle({ width });
      expect(bar.firstElementChild).toHaveClass(over ? "bg-danger" : "bg-emerald");
      const [spentChip, balanceChip] = descriptions(bar);
      const spentText = `${w(lang, "spentLbl")}: ${fmtTaka(spent, lang)} (${Math.round(usage)}%)`;
      const balanceText = over
        ? `${w(lang, "overLim")} ${fmtTaka(Number(spent) - Number(total), lang)}`
        : `${w(lang, "leftLbl")}: ${fmtTaka(Math.max(Number(total) - Number(spent), 0), lang)}`;
      expect(spentChip.textContent).toBe(spentText);
      expect(balanceChip.textContent).toBe(balanceText);
      expect(bar).toHaveAccessibleDescription(`${spentText} ${balanceText}`);
      expect(bar).not.toHaveAttribute("aria-valuetext");
      expect(mocks.mutate).not.toHaveBeenCalled();
    });

    it.each([NaN, Infinity, -Infinity, -12.5])("defensive non-API usage %s only omits/clamps ARIA", (usage) => {
      data = { ...data, usage_pct: usage };
      render(view());
      const bar = screen.getByRole("progressbar");
      if (Number.isFinite(usage)) expect(bar).toHaveAttribute("aria-valuenow", "0");
      else expect(bar).not.toHaveAttribute("aria-valuenow");
      expect(mocks.mutate).not.toHaveBeenCalled();
    });

    it("keeps IDs stable on language rerender, fresh on period, and preserves drafts/categories", () => {
      data = { ...data, cats: { food: "800.00" }, by_cat: { food: { budget: "800.00", spent: "100.00", usage_pct: 12.5 } } };
      const rendered = render(view());
      const bar = screen.getByRole("progressbar");
      const originalIds = bar.getAttribute("aria-describedby");
      descriptions(bar);
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[0], { target: { value: "2222" } });
      fireEvent.change(inputs[1], { target: { value: "333" } });
      const nextLang = lang === "bn" ? "en" : "bn";
      act(() => useLangStore.setState({ lang: nextLang }));
      expect(bar).toHaveAccessibleName(w(nextLang, "budVsLimit"));
      expect(bar).toHaveAttribute("aria-describedby", originalIds);
      expect(descriptions(bar)[0]).toHaveTextContent(`${w(nextLang, "spentLbl")}: ${fmtTaka(data.spent, nextLang)} (125%)`);
      expect(inputs[0]).toHaveValue("2222");
      expect(inputs[1]).toHaveValue("333");
      data = { ...data, ym: "2026-10" };
      fireEvent.click(screen.getByRole("button", { name: w(nextLang, "nextMonth") }));
      rendered.rerender(view());
      expect(mocks.query).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
      const nextBar = screen.getByRole("progressbar");
      descriptions(nextBar);
      expect(nextBar.getAttribute("aria-describedby")).not.toBe(originalIds);
      for (const id of originalIds!.split(" ")) expect(document.getElementById(id)).toBeNull();
      expect(mocks.mutate).not.toHaveBeenCalled();
    });

    it.each(["loading", "error"])("%s has no phantom progressbar", (state) => {
      pending = state === "loading";
      failed = state === "error";
      render(view());
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.getByRole(pending ? "status" : "alert")).toBeVisible();
      expect(mocks.mutate).not.toHaveBeenCalled();
    });
  });
}
