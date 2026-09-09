import { useRef, useState } from "react";
import { APP_VERSION, t, toBnDigits } from "@poipoihisab/core";
import { exportSheets, loadSheetRef, saveSheetRef, sheetRef, useSheetsStatus } from "../lib/sheets";
import { toast } from "../lib/toast";
import { useNavigate } from "react-router";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  PAY_LABELS,
  PAY_ORDER,
} from "../lib/catalog";
import { LangToggle } from "../components/LangToggle";
import { DataSafety } from "../components/DataSafety";
import { InstallChip } from "../components/InstallChip";
import { Segmented } from "../components/Segmented";
import { SessionsCard } from "../components/SessionsCard";
import { useAuthStore } from "../store/auth";
import { useLangStore } from "../store/lang";
import {
  useMotionStore,
  useThemeStore,
  type Motion,
  type Theme,
} from "../store/theme";
import { w } from "../lib/web-i18n";
import { usePageTitle } from "../lib/usePageTitle";

const THEME_OPTIONS = [
  { value: "light", labelKey: "light" },
  { value: "dark", labelKey: "dark" },
  // ADR-0027: third "system" segment honoring prefers-color-scheme — a
  // deliberate divergence from the frozen prototype's 2-option themeSeg.
  { value: "system", labelKey: "themeSystem" },
] as const satisfies ReadonlyArray<{
  value: Theme;
  labelKey: "light" | "dark" | "themeSystem";
}>;

const MOTION_OPTIONS = [
  { value: "on", labelKey: "on" },
  { value: "off", labelKey: "off" },
] as const satisfies ReadonlyArray<{ value: Motion; labelKey: "on" | "off" }>;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <p className="border-b border-line px-4 py-3 text-[13px] font-bold text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function SheetsCard() {
  const lang = useLangStore((s) => s.lang);
  const [sheet, setSheet] = useState(loadSheetRef);
  const [syncing, setSyncing] = useState<"month" | "all" | null>(null);
  const busy = useRef(false);
  const status = useSheetsStatus();
  const config = status.data?.ok ? status.data.data : null;
  const id = sheetRef(sheet);

  async function sync(all: boolean) {
    if (busy.current || !id || !config?.configured) return;
    busy.current = true;
    setSyncing(all ? "all" : "month");
    saveSheetRef(sheet);
    try {
      const now = new Date();
      const month = all ? null : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const result = await exportSheets(id, month);
      if (!result.ok) {
        toast(result.detail || w(lang, "sheetsExportErr"));
        return;
      }
      const n = lang === "bn" ? toBnDigits(String(result.data.rows)) : String(result.data.rows);
      toast(w(lang, "sheetsExported").replace("{n}", n));
    } catch {
      toast(w(lang, "sheetsExportErr"));
    } finally {
      busy.current = false;
      setSyncing(null);
    }
  }

  const disabled = syncing !== null || !id || !config?.configured;
  return (
    <Card title={w(lang, "sheetsTitle")}>
      <div className="space-y-3 p-4">
        <p id="sheets-description" className="text-sm text-muted">{w(lang, "sheetsDesc")}</p>
        {status.isPending && <p role="status" className="text-sm text-muted">{w(lang, "loading")}</p>}
        {(status.isError || (status.data && !status.data.ok)) && (
          <p role="alert" className="text-sm text-danger">
            {status.data && !status.data.ok ? status.data.detail : w(lang, "sheetsExportErr")}
            <button type="button" className="ml-2 min-h-11 underline" onClick={() => void status.refetch()}>{w(lang, "errRetry")}</button>
          </p>
        )}
        {config && !config.configured && <p role="status" className="text-sm text-muted">{w(lang, "sheetsNotConfigured")}</p>}
        {config?.sa_email && <p className="break-words text-sm text-muted">{w(lang, "sheetsShare").replace("{email}", config.sa_email)}</p>}
        <label htmlFor="sheets-url" className="block text-sm font-medium">{w(lang, "sheetsUrlLabel")}</label>
        <input
          id="sheets-url" type="text" inputMode="url" autoComplete="off" spellCheck={false}
          aria-describedby="sheets-description" aria-invalid={Boolean(sheet.trim() && !id)}
          value={sheet} disabled={syncing !== null}
          onChange={(event) => { setSheet(event.target.value); saveSheetRef(event.target.value); }}
          onBlur={() => { if (sheet.trim() && id && saveSheetRef(sheet)) toast(w(lang, "sheetsSaved")); }}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-3 py-2 font-en text-sm"
        />
        {sheet.trim() && !id && <p role="alert" className="text-sm text-danger">{w(lang, "sheetsInvalid")}</p>}
        <div className="flex flex-wrap gap-2" aria-busy={syncing !== null}>
          <button type="button" disabled={disabled} onClick={() => void sync(false)} className="min-h-11 rounded-control border border-line px-3.5 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">
            {syncing === "month" ? w(lang, "loading") : w(lang, "sheetsSyncMonth")}
          </button>
          <button type="button" disabled={disabled} onClick={() => void sync(true)} className="min-h-11 rounded-control border border-line px-3.5 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">
            {syncing === "all" ? w(lang, "loading") : w(lang, "sheetsSyncAll")}
          </button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Settings (prototype screen-settings @843-880): profile + language + theme,
 * voice language, data & backup, payment methods, and the expense-group
 * list. Group/payment catalogs are display-only (they mirror the API's
 * enums); auth profile fields are read-only until a profile API exists.
 */
export function Settings() {
  usePageTitle("সেটিংস · Poi Poi Hisab");
  const lang = useLangStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const motion = useMotionStore((s) => s.motion);
  const setMotion = useMotionStore((s) => s.setMotion);
  const navigate = useNavigate();

  /*
   * Owner 2026-09-09: a superadmin keeps no hisab, so the cards that only
   * make sense for a personal ledger — Google Sheets sync of their own
   * expenses, local backup/restore of their own data, and the payment /
   * expense-group catalogs — are not shown to them. Profile, language,
   * theme, motion and session all still apply: a superadmin owns an account
   * like anyone else, which is why settings itself is not role-split.
   * Deployment-wide Sheets wiring lives on /admin/integrations instead.
   */
  const isSuperadmin = Boolean(user?.isSuperadmin);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <section>
      <h1 className="text-[22px] font-bold sm:text-2xl">{t(lang, "navSettings")}</h1>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {/* প্রোফাইল (prototype profile card @848-856) */}
          <Card title={w(lang, "profileSettings")}>
            <Row label={w(lang, "profName")}>
              <span className="truncate text-sm font-semibold text-ink">
                {user?.name ?? "—"}
              </span>
            </Row>
            <Row label={w(lang, "profEmail")}>
              <span className="truncate font-en text-sm text-muted">{user?.email ?? "—"}</span>
            </Row>
            <Row label={t(lang, "language")}>
              <LangToggle />
            </Row>
            {/* থিম — segmented light/dark (prototype themeSeg @854) + ADR-0027
                "system" segment honoring prefers-color-scheme */}
            <Row label={w(lang, "theme")}>
              <Segmented<Theme>
                label={w(lang, "theme")}
                value={theme}
                onChange={setTheme}
                options={THEME_OPTIONS.map((opt) => ({ value: opt.value, label: w(lang, opt.labelKey) }))}
              />
            </Row>
            {/* ভয়েস ভাষা (prototype @855) — voice input is bn-BD today */}
            <Row label={w(lang, "voiceLang")}>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[12.5px] font-medium text-muted">
                {w(lang, "voiceLangV")}
              </span>
            </Row>
          </Card>

          {!isSuperadmin && (
            <>
              <SheetsCard />
              {/* Download/restore stays available independently of Google Sheets. */}
              <DataSafety />
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {!isSuperadmin && (
            <>
              {/* পেমেন্ট মাধ্যম (prototype payMethods card @867-875) */}
              <Card title={w(lang, "payMethods")}>
                {PAY_ORDER.map((pay) => (
                  <Row key={pay} label={PAY_LABELS[pay][lang]} />
                ))}
              </Card>

              {/* খরচের গ্রুপ তালিকা (prototype khataList @876-877) */}
              <Card title={w(lang, "khataList")}>
                {GROUP_ORDER.map((grp) => (
                  <Row key={grp} label={GROUP_LABELS[grp][lang]} />
                ))}
              </Card>
            </>
          )}

          {/* অ্যাপ + সেশন */}
          <Card title={lang === "bn" ? "অ্যাপ" : "App"}>
            <Row label={w(lang, "motion")}>
              <Segmented<Motion>
                label={w(lang, "motion")}
                value={motion}
                onChange={setMotion}
                options={MOTION_OPTIONS.map((opt) => ({ value: opt.value, label: w(lang, opt.labelKey) }))}
              />
            </Row>
            <Row label={lang === "bn" ? "ভার্সন" : "Version"}>
              <span className="rounded-full border border-line px-2 py-0.5 font-en text-[11px] font-semibold leading-none text-muted">
                v{APP_VERSION}
              </span>
            </Row>
            {/* T26.1 PWA install chip — only renders when the browser
                actually offered beforeinstallprompt (renders null otherwise) */}
            <InstallChip />
            <Row label={
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{user?.name ?? user?.email ?? t(lang, "login")}</span>
                {user?.email && (
                  <span className="block truncate font-en text-xs font-normal text-muted">{user.email}</span>
                )}
              </span>
            }>
              <button
                type="button"
                onClick={handleLogout}
                className="max-md:min-h-11 shrink-0 rounded-control border border-line px-3.5 py-2 text-sm font-semibold text-danger transition-colors hover:bg-surface-2"
              >
                {t(lang, "logout")}
              </button>
            </Row>
          </Card>

          {/* সক্রিয় সেশন (T26.2 — GET /auth/sessions) */}
          <SessionsCard />
        </div>
      </div>
    </section>
  );
}
