import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@poipoihisab/core";
import { Login } from "../src/screens/Login";
import { l } from "../src/screens/login.i18n";
import { useLangStore } from "../src/store/lang";
import type { AuthResult } from "../src/store/auth";

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("../src/store/auth", () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));

function mount(from?: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/login", state: from ? { from: { pathname: from } } : null }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<h1>Dashboard destination</h1>} />
        <Route path="/expenses" element={<h1>Expenses destination</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useLangStore.setState({ lang: "bn" });
});
afterEach(cleanup);

// Real component, dictionaries and persisted language store; no API requests.
describe.each(["bn", "en"] as const)("registration language (%s)", (lang) => {
  it("labels the native picker only in registration and marks main/options languages", async () => {
    useLangStore.getState().setLang(lang);
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("lang", lang);
    await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
    const select = screen.getByRole("combobox", { name: t(lang, "language") });
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveAttribute("id", "register-language");
    expect(screen.getByLabelText(t(lang, "language"))).toBe(select);
    expect(select).toHaveValue(lang);
    const options = within(select).getAllByRole("option");
    expect(options.map((option) => [option.getAttribute("value"), option.textContent, option.getAttribute("lang")]))
      .toEqual([["bn", "বাংলা", "bn"], ["en", "English", "en"]]);
    const password = screen.getByLabelText(t(lang, "password"));
    expect(password).toHaveAccessibleDescription(l(lang, "passwordHint"));
    expect(password).toHaveAttribute("minlength", "8");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toBeRequired();
    const hint = screen.getByText(l(lang, "passwordHint"));
    expect(hint.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const submit = screen.getByRole("button", { name: l(lang, "registerBtn") });
    expect(select.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    password.focus();
    await user.tab();
    expect(select).toHaveFocus();
    await user.tab();
    expect(submit).toHaveFocus();
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it.each(["login", "register"] as const)("preserves exact %s payload, pending guard, failure retry and redirect", async (mode) => {
    useLangStore.getState().setLang(lang);
    const user = userEvent.setup();
    let resolve!: (result: AuthResult) => void;
    auth[mode].mockReturnValueOnce(new Promise<AuthResult>((done) => { resolve = done; }));
    auth[mode].mockResolvedValueOnce({ ok: true });
    mount(mode === "register" ? "/expenses" : undefined);
    if (mode === "register") {
      await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
      await user.type(screen.getByLabelText(l(lang, "name")), "  Test Person  ");
    }
    await user.type(screen.getByLabelText(t(lang, "email")), "test@example.com");
    await user.type(screen.getByLabelText(t(lang, "password")), "test-password");
    const action = mode === "login" ? t(lang, "loginBtn") : l(lang, "registerBtn");
    const submit = screen.getByRole("button", { name: action });
    const form = submit.closest("form")!;
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleName(action);
    expect(submit.textContent).toBe(action);
    expect(form).toHaveAttribute("aria-busy", "true");
    if (mode === "register") {
      const select = screen.getByRole("combobox");
      const stored = localStorage.getItem("poipoihisab.lang");
      expect(select).toBeDisabled();
      await user.selectOptions(select, lang === "bn" ? "en" : "bn");
      // Synthetic change bypasses native disabled behavior: handler must guard too.
      fireEvent.change(select, { target: { value: lang === "bn" ? "en" : "bn" } });
      expect(useLangStore.getState().lang).toBe(lang);
      expect(localStorage.getItem("poipoihisab.lang")).toBe(stored);
      expect(screen.getByRole("main")).toHaveAttribute("lang", lang);
    }
    fireEvent.submit(form);
    expect(auth[mode]).toHaveBeenCalledTimes(1);
    const payload = mode === "login"
      ? ["test@example.com", "test-password"]
      : [{ email: "test@example.com", password: "test-password", name: "Test Person" }];
    expect(auth[mode].mock.calls[0]).toEqual(payload);
    await act(async () => resolve({ ok: false, detail: "Test rejection" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Test rejection");
    expect(submit).toBeEnabled();
    expect(form).toHaveAttribute("aria-busy", "false");
    if (mode === "register") expect(screen.getByRole("combobox")).toBeEnabled();
    await user.click(submit);
    expect(await screen.findByRole("heading", { name: mode === "register" ? "Expenses destination" : "Dashboard destination" })).toBeVisible();
    expect(auth[mode].mock.calls).toEqual([payload, payload]);
    expect(auth[mode === "register" ? "login" : "register"]).not.toHaveBeenCalled();
  });
});

it("switches bn→en→bn immediately, rejects invalid values and retains credentials across modes", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: l("bn", "registerQ") }));
  await user.type(screen.getByLabelText(l("bn", "name")), "Test Person");
  await user.type(screen.getByLabelText(t("bn", "email")), "test@example.com");
  await user.type(screen.getByLabelText(t("bn", "password")), "test-password");
  const select = screen.getByRole("combobox");
  for (const lang of ["en", "bn", "en"] as const) {
    await user.selectOptions(select, lang);
    expect(useLangStore.getState().lang).toBe(lang);
    expect(JSON.parse(localStorage.getItem("poipoihisab.lang")!).state.lang).toBe(lang);
    expect(screen.getByRole("main")).toHaveAttribute("lang", lang);
    expect(select).toHaveAccessibleName(t(lang, "language"));
    expect(select).toHaveValue(lang);
    expect(screen.getByLabelText(t(lang, "password"))).toHaveAccessibleDescription(l(lang, "passwordHint"));
    expect(screen.getByRole("button", { name: l(lang, "registerBtn") })).toBeVisible();
  }
  fireEvent.change(select, { target: { value: "fr" } });
  expect(useLangStore.getState().lang).toBe("en");
  expect(select).toHaveValue("en");
  await user.click(screen.getByRole("button", { name: l("en", "backToLoginQ") }));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("lang", "en");
  expect(screen.getByRole("button", { name: t("en", "loginBtn") })).toBeVisible();
  expect(screen.getByLabelText(t("en", "email"))).toHaveValue("test@example.com");
  expect(screen.getByLabelText(t("en", "password"))).toHaveValue("test-password");
  await user.click(screen.getByRole("button", { name: l("en", "registerQ") }));
  expect(screen.getByRole("combobox")).toHaveValue("en");
  expect(screen.getByLabelText(l("en", "name"))).toHaveValue("Test Person");
  expect(auth.login).not.toHaveBeenCalled();
  expect(auth.register).not.toHaveBeenCalled();
});

it.each(["bn", "en"] as const)("rehydrates picker-selected %s over a different in-memory value", async (lang) => {
  const other = lang === "bn" ? "en" : "bn";
  useLangStore.getState().setLang(other);
  const user = userEvent.setup();
  const view = mount();
  await user.click(screen.getByRole("button", { name: l(other, "registerQ") }));
  await user.selectOptions(screen.getByRole("combobox"), lang);
  const persisted = localStorage.getItem("poipoihisab.lang")!;
  expect(JSON.parse(persisted).state.lang).toBe(lang);
  view.unmount();

  // Model loss of runtime state on reload, retaining the actual picker write.
  // setState also persists, so restore the captured storage before rehydrating.
  useLangStore.setState({ lang: other });
  localStorage.setItem("poipoihisab.lang", persisted);
  expect(useLangStore.getState().lang).toBe(other);
  await useLangStore.persist.rehydrate();
  expect(useLangStore.getState().lang).toBe(lang);
  mount();
  expect(screen.getByRole("main")).toHaveAttribute("lang", lang);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
  expect(screen.getByRole("combobox", { name: t(lang, "language") })).toHaveValue(lang);
  expect(auth.login).not.toHaveBeenCalled();
  expect(auth.register).not.toHaveBeenCalled();
});

it("hydrates persisted English and preserves it after a fresh component remount", async () => {
  localStorage.setItem("poipoihisab.lang", JSON.stringify({ state: { lang: "en" }, version: 0 }));
  await useLangStore.persist.rehydrate();
  const user = userEvent.setup();
  const view = mount();
  expect(screen.getByRole("main")).toHaveAttribute("lang", "en");
  await user.click(screen.getByRole("button", { name: l("en", "registerQ") }));
  expect(screen.getByRole("combobox")).toHaveValue("en");
  view.unmount();
  await useLangStore.persist.rehydrate();
  mount();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("lang", "en");
  await user.click(screen.getByRole("button", { name: l("en", "registerQ") }));
  expect(screen.getByRole("combobox")).toHaveValue("en");
  expect(auth.login).not.toHaveBeenCalled();
  expect(auth.register).not.toHaveBeenCalled();
});
