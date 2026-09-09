import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t, type Lang } from "@poipoihisab/core";
import { LangToggle } from "../src/components/LangToggle";
import { useLangStore } from "../src/store/lang";

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("../src/store/auth", () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLangStore.setState({ lang: "bn" });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => {
  cleanup();
  expect(auth.login).not.toHaveBeenCalled();
  expect(auth.register).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  useLangStore.setState({ lang: "bn" });
  localStorage.clear();
});

const sizing = {
  compact: "px-2.5 py-1 text-[12px] max-md:flex max-md:min-h-11 max-md:items-center max-md:px-3",
  regular: "px-3.5 py-1.5 text-[13px] max-md:flex max-md:min-h-11 max-md:items-center",
};

function expectControl(lang: Lang, size: keyof typeof sizing) {
  const group = screen.getByRole("group", { name: t(lang, "language") });
  expect(group).toHaveAttribute("lang", lang);
  expect(group.className).toBe("flex items-center gap-0.5 rounded-control bg-surface-2 p-0.5");
  const buttons = within(group).getAllByRole("button");
  expect(buttons).toHaveLength(2);
  for (const [index, value] of (["bn", "en"] as const).entries()) {
    const button = buttons[index];
    const label = value === "bn" ? "বাং" : "EN";
    expect(button.textContent).toBe(label);
    expect(button).toHaveAccessibleName(label);
    expect(button).toHaveAttribute("lang", value);
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-pressed", String(lang === value));
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).not.toHaveAttribute("role");
    expect(button).not.toHaveAttribute("tabindex");
    expect(button).toBeEnabled();
    expect(button.className).toBe(`rounded-[8px] font-semibold transition-colors ${sizing[size]} ${
      lang === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
    }`);
  }
  expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);
  expect(group.querySelector("[aria-live]")).toBeNull();
  return buttons;
}

describe.each(["compact", "regular"] as const)("LangToggle language boundaries (%s)", (size) => {
  it.each(["bn", "en"] as const)("declares independent language metadata from %s through clicks", async (lang) => {
    useLangStore.setState({ lang });
    const user = userEvent.setup();
    const rootLanguage = document.documentElement.lang;
    // Opposite ancestor language demonstrates that shell correctness is not required.
    render(<div lang={lang === "bn" ? "en" : "bn"}><LangToggle size={size} /></div>);
    const buttons = expectControl(lang, size);
    for (const next of [lang === "bn" ? "en" : "bn", lang] as const) {
      const button = buttons[next === "bn" ? 0 : 1];
      await user.click(button);
      expectControl(next, size);
      expect(button).toHaveFocus();
      expect(useLangStore.getState().lang).toBe(next);
      expect(JSON.parse(localStorage.getItem("poipoihisab.lang")!).state.lang).toBe(next);
    }
    expect(document.documentElement.lang).toBe(rootLanguage);
  });

  it("retains native tab order, Enter/Space activation and persisted rehydration", async () => {
    const user = userEvent.setup();
    const view = render(<LangToggle size={size} />);
    const [bn, en] = expectControl("bn", size);
    await user.tab();
    expect(bn).toHaveFocus();
    await user.tab();
    expect(en).toHaveFocus();
    await user.keyboard("{Enter}");
    expectControl("en", size);
    expect(en).toHaveFocus();
    await user.tab({ shift: true });
    expect(bn).toHaveFocus();
    await user.keyboard(" ");
    expectControl("bn", size);
    expect(bn).toHaveFocus();
    await user.tab();
    await user.keyboard(" ");
    expectControl("en", size);
    const persisted = localStorage.getItem("poipoihisab.lang")!;
    expect(JSON.parse(persisted).state.lang).toBe("en");
    view.unmount();
    // Simulate startup hydration with the real persist middleware, not a mocked store.
    act(() => useLangStore.setState({ lang: "bn" }));
    localStorage.setItem("poipoihisab.lang", persisted);
    await act(async () => { await useLangStore.persist.rehydrate(); });
    render(<LangToggle size={size} />);
    expectControl("en", size);
  });
});

it("keeps regular sizing as the default", () => {
  render(<LangToggle />);
  expectControl("bn", "regular");
});
