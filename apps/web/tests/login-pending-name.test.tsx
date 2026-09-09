import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function deferred() {
  let resolve!: (result: AuthResult) => void;
  const promise = new Promise<AuthResult>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useLangStore.setState({ lang: "bn" });
});
afterEach(cleanup);

// Real Login rendering; only auth is mocked. No real credentials or API writes.
describe.each(["bn", "en"] as const)("auth submit label-in-name (%s)", (lang) => {
  it.each(["login", "register"] as const)("keeps %s action name through pending, failure, retry and success", async (mode) => {
    useLangStore.setState({ lang });
    const user = userEvent.setup();
    const first = deferred();
    const retry = deferred();
    auth[mode].mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: mode === "register" ? { from: { pathname: "/expenses" } } : null }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<h1>Dashboard destination</h1>} />
          <Route path="/expenses" element={<h1>Expenses destination</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    if (mode === "register") {
      await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
      await user.type(screen.getByLabelText(l(lang, "name")), "  Test Person  ");
    }
    const email = screen.getByLabelText(t(lang, "email"));
    const password = screen.getByLabelText(t(lang, "password"));
    await user.type(email, "test@example.com");
    await user.type(password, "test-password");
    const actionName = mode === "login" ? t(lang, "loginBtn") : l(lang, "registerBtn");
    const submit = screen.getByRole("button", { name: actionName });
    const form = submit.closest("form")!;
    function expectState(pending: boolean) {
      expect(submit).toBeVisible();
      expect(submit.textContent).toBe(actionName);
      expect(submit).toHaveAccessibleName(actionName);
      expect(submit).not.toHaveAccessibleName(l(lang, "pending"));
      expect(form).toHaveAttribute("aria-busy", String(pending));
      if (pending) expect(submit).toBeDisabled();
      else expect(submit).toBeEnabled();
    }
    expectState(false);
    await user.click(submit);
    expectState(true);
    await user.click(submit); // Native disabled prevents a second user activation.
    fireEvent.submit(form); // Pending guard also protects programmatic submissions.
    expect(auth[mode]).toHaveBeenCalledTimes(1);
    if (mode === "login") {
      expect(auth.login).toHaveBeenNthCalledWith(1, "test@example.com", "test-password");
    } else {
      expect(auth.register).toHaveBeenNthCalledWith(1, { email: "test@example.com", password: "test-password", name: "Test Person" });
      expect(password).toHaveAccessibleDescription(l(lang, "passwordHint"));
    }
    await act(async () => first.resolve({ ok: false, detail: "Test auth rejection" }));
    expectState(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Test auth rejection");
    expect(email).toHaveValue("test@example.com");
    expect(password).toHaveValue("test-password");
    if (mode === "register") expect(screen.getByLabelText(l(lang, "name"))).toHaveValue("  Test Person  ");
    await user.click(submit);
    expectState(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(auth[mode]).toHaveBeenCalledTimes(2);
    expect(auth[mode].mock.calls[1]).toEqual(auth[mode].mock.calls[0]);
    await act(async () => retry.resolve({ ok: true }));
    expect(screen.getByRole("heading", { name: mode === "register" ? "Expenses destination" : "Dashboard destination" })).toBeVisible();
    expect(auth[mode === "login" ? "register" : "login"]).not.toHaveBeenCalled();
  });

  it("updates action names across mode and language changes without submitting", async () => {
    useLangStore.setState({ lang });
    const user = userEvent.setup();
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByRole("button", { name: t(lang, "loginBtn") })).toHaveTextContent(t(lang, "loginBtn"));
    await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
    const submit = screen.getByRole("button", { name: l(lang, "registerBtn") });
    const other = lang === "bn" ? "en" : "bn";
    act(() => useLangStore.setState({ lang: other }));
    expect(submit).toHaveAccessibleName(l(other, "registerBtn"));
    expect(submit.textContent).toBe(l(other, "registerBtn"));
    await user.click(screen.getByRole("button", { name: l(other, "backToLoginQ") }));
    expect(submit).toHaveAccessibleName(t(other, "loginBtn"));
    expect(submit.textContent).toBe(t(other, "loginBtn"));
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.register).not.toHaveBeenCalled();
  });
});
