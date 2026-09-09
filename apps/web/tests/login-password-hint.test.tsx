import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@poipoihisab/core";
import { Login } from "../src/screens/Login";
import { l } from "../src/screens/login.i18n";
import { useLangStore } from "../src/store/lang";

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("../src/store/auth", () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));

type AuthResult = { ok: true } | { ok: false; detail: string };

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

describe.each([
  { lang: "bn" as const, hint: "৮–১২৮ অক্ষরের পাসওয়ার্ড দিন।" },
  { lang: "en" as const, hint: "Use 8–128 characters." },
])("registration password instructions ($lang)", ({ lang, hint }) => {
  beforeEach(() => useLangStore.setState({ lang }));

  it.each(["login", "register"] as const)("exposes password-manager semantics in %s mode", async (mode) => {
    const user = userEvent.setup();
    mount();
    if (mode === "register") {
      await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
    }

    function expectSemantics(currentMode: "login" | "register") {
      const email = screen.getByLabelText(t(lang, "email"));
      const password = screen.getByLabelText(t(lang, "password"));
      expect(email).toHaveAttribute("type", "email");
      expect(email).toHaveAttribute("name", "email");
      expect(email).toHaveAttribute("autocomplete", currentMode === "login" ? "username" : "email");
      expect(email).toBeRequired();
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("name", "password");
      expect(password).toHaveAttribute("autocomplete", currentMode === "login" ? "current-password" : "new-password");
      expect(password).toBeRequired();
    }

    expectSemantics(mode);
    await user.click(screen.getByRole("button", { name: l(lang, mode === "login" ? "registerQ" : "backToLoginQ") }));
    expectSemantics(mode === "login" ? "register" : "login");
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("shows a visible description before input only in register mode and preserves fields across toggles", async () => {
    const user = userEvent.setup();
    mount();
    const password = screen.getByLabelText(t(lang, "password"));
    const email = screen.getByLabelText(t(lang, "email"));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(password).not.toHaveAttribute("aria-describedby");
    expect(password).not.toHaveAccessibleDescription();
    expect(password).not.toHaveAttribute("minlength");
    expect(password).toHaveAttribute("autocomplete", "current-password");

    await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
    const description = screen.getByText(hint);
    expect(description).toBeVisible();
    expect(password).toHaveValue("");
    expect(password).toHaveAttribute("aria-describedby", description.id);
    expect(document.getElementById(description.id)).toBe(description);
    expect(password).toHaveAccessibleDescription(hint);
    expect(password).toHaveAttribute("minlength", "8");
    expect(password).not.toHaveAttribute("maxlength"); // Disclosure, not a validation rewrite.
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toBeRequired();
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(description).not.toHaveAttribute("role");
    expect(description).not.toHaveAttribute("aria-live");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(email).toBeRequired();
    expect(email).toHaveAttribute("autocomplete", "email");
    const name = screen.getByLabelText(l(lang, "name"));
    expect(name).toHaveAttribute("autocomplete", "name");
    await user.type(name, "Test Person");
    await user.type(email, "test@example.com");
    await user.type(password, "test-password");

    await user.click(screen.getByRole("button", { name: l(lang, "backToLoginQ") }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(document.getElementById(description.id)).toBeNull();
    expect(password).not.toHaveAttribute("aria-describedby");
    expect(password).not.toHaveAccessibleDescription();
    expect(password).not.toHaveAttribute("minlength");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toBeRequired();
    expect(password).toHaveValue("test-password");
    expect(email).toHaveValue("test@example.com");

    await user.click(screen.getByRole("button", { name: l(lang, "registerQ") }));
    expect(screen.getByText(hint)).toBeVisible();
    expect(screen.getByText(hint).id).toBe(description.id);
    expect(password).toHaveAccessibleDescription(hint);
    expect(password).toHaveValue("test-password");
    expect(email).toHaveValue("test@example.com");
    expect(screen.getByLabelText(l(lang, "name"))).toHaveValue("Test Person");
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it.each(["login", "register"] as const)("preserves %s pending, error and successful redirect behavior", async (mode) => {
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
    const password = screen.getByLabelText(t(lang, "password"));
    await user.type(password, "test-password");
    await user.keyboard("{Enter}");
    const submit = screen.getByRole("button", { name: mode === "login" ? t(lang, "loginBtn") : l(lang, "registerBtn") });
    expect(submit).toBeDisabled();
    expect(submit.closest("form")).toHaveAttribute("aria-busy", "true");
    fireEvent.submit(submit.closest("form")!);
    expect(auth[mode]).toHaveBeenCalledTimes(1);
    if (mode === "register") {
      expect(auth.register).toHaveBeenCalledWith({ email: "test@example.com", password: "test-password", name: "Test Person" });
      expect(password).toHaveAccessibleDescription(hint);
    } else {
      expect(auth.login).toHaveBeenCalledWith("test@example.com", "test-password");
      expect(password).not.toHaveAccessibleDescription();
    }
    await act(async () => resolve({ ok: false, detail: "Test auth rejection" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Test auth rejection");
    expect(submit).not.toBeDisabled();
    expect(submit.closest("form")).toHaveAttribute("aria-busy", "false");
    await user.click(submit);
    expect(await screen.findByRole("heading", { name: mode === "register" ? "Expenses destination" : "Dashboard destination" })).toBeVisible();
    expect(auth[mode]).toHaveBeenCalledTimes(2);
    expect(auth[mode === "register" ? "login" : "register"]).not.toHaveBeenCalled();
  });
});

it("updates the visible and accessible instruction when language changes without remounting", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: l("bn", "registerQ") }));
  const password = screen.getByLabelText(t("bn", "password"));
  await user.type(password, "test-password");
  const id = password.getAttribute("aria-describedby");
  act(() => useLangStore.setState({ lang: "en" }));
  expect(screen.queryByText("৮–১২৮ অক্ষরের পাসওয়ার্ড দিন।")).not.toBeInTheDocument();
  expect(screen.getByText("Use 8–128 characters.")).toBeVisible();
  expect(screen.getByLabelText(t("en", "password"))).toBe(password);
  expect(password).toHaveAttribute("aria-describedby", id);
  expect(password).toHaveAccessibleDescription("Use 8–128 characters.");
  expect(password).toHaveValue("test-password");
});
