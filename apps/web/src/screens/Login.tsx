import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { t } from "@poipoihisab/core";
import { Logo } from "../components/Logo";
import { useAuthStore } from "../store/auth";
import { useLangStore } from "../store/lang";
import { l } from "./login.i18n";
import { usePageTitle } from "../lib/usePageTitle";

const inputClass =
  "rounded-control border border-line/80 bg-ivory/80 px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-emerald focus:outline-none";

/**
 * Real auth screen: login via the auth API, with a register toggle that
 * auto-logs-in on success. Backend `{ detail }` messages surface verbatim
 * in an error banner. Demo credentials are seeded by apps/api scripts.
 */
export function Login() {
  usePageTitle("লগইন · Poi Poi Hisab");
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Where RequireAuth bounced us from (falls back to the dashboard).
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const res =
      mode === "login"
        ? await login(email, password)
        : await register({ email, password, name: name.trim() || undefined });

    setPending(false);
    if (res.ok) {
      navigate(from, { replace: true });
    } else {
      setError(res.detail || l(lang, "errFallback"));
    }
  }

  return (
    <main
      lang={lang}
      className={`relative flex min-h-dvh items-center justify-center bg-ivory px-4 py-10 text-ink ${
        lang === "bn" ? "font-bn" : "font-en"
      }`}
    >
      <div className="ambient-mesh" aria-hidden="true" />
      <div className="glass-card relative z-10 w-full max-w-sm rounded-card p-6">
        <Logo size={44} />
        <p className="mt-2 text-[13px] text-muted">{t(lang, "tagline")}</p>

        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={handleSubmit}
          aria-busy={pending}
        >
          {error && (
            <p
              role="alert"
              className="rounded-control border border-danger bg-danger/5 px-3.5 py-2.5 text-sm font-medium text-danger"
            >
              {error}
            </p>
          )}

          {mode === "register" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted" htmlFor="login-name">
                {l(lang, "name")}
              </label>
              <input
                id="login-name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={l(lang, "namePlaceholder")}
                className={inputClass}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted" htmlFor="login-email">
              {t(lang, "email")}
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete={mode === "login" ? "username" : "email"}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="demo@poipoihisab.app"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted" htmlFor="login-password">
              {t(lang, "password")}
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 8 : undefined}
              aria-describedby={mode === "register" ? "login-password-hint" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="demo1234"
              className={inputClass}
            />
            {mode === "register" && (
              <p id="login-password-hint" className="text-xs text-muted">
                {l(lang, "passwordHint")}
              </p>
            )}
          </div>
          {mode === "register" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted" htmlFor="register-language">
                {t(lang, "language")}
              </label>
              <select
                id="register-language"
                value={lang}
                disabled={pending}
                onChange={(event) => {
                  if (pending) return;
                  const value = event.target.value;
                  if (value === "bn" || value === "en") setLang(value);
                }}
                className={inputClass}
              >
                <option value="bn" lang="bn">বাংলা</option>
                <option value="en" lang="en">English</option>
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={pending}
            className="mt-1 h-12 rounded-control bg-emerald font-bold text-accent-ink transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mode === "login" ? t(lang, "loginBtn") : l(lang, "registerBtn")}
          </button>
        </form>

        <p className="mt-3 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            className="max-md:flex max-md:min-h-11 max-md:items-center max-md:justify-center text-xs font-semibold text-emerald underline-offset-2 hover:underline"
          >
            {mode === "login" ? l(lang, "registerQ") : l(lang, "backToLoginQ")}
          </button>
        </p>

        <p className="mt-4 text-center text-xs text-muted">Demo: demo@poipoihisab.app / demo1234</p>
      </div>
    </main>
  );
}
