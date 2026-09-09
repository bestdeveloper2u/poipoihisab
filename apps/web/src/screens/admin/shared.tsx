/**
 * Shared building blocks for the /admin/* pages.
 *
 * Extracted when the single 1700-line Admin screen was split into the
 * superadmin shell (owner 2026-09-09: "superadmin no need hisab entry") —
 * every admin page needs the same header, KPI tile, card, and number
 * formatting, and duplicating them would let them drift apart.
 */
import type { ReactNode } from "react";
import { toBnDigits, type Lang } from "@poipoihisab/core";
import { w, type WebKey } from "../../lib/web-i18n";

/** Localised integer: Bengali digits in bn, Latin in en. */
export function num(n: number, lang: Lang): string {
  return lang === "bn" ? toBnDigits(String(n)) : String(n);
}

/** Localised date, matching the users table's format. */
export function formatDate(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Localised date + time, for audit rows and session expiries. */
export function formatDateTime(iso: string, lang: Lang): string {
  try {
    return new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Coarse "in 12 days" style duration for a session TTL in seconds. */
export function formatTtl(seconds: number, lang: Lang): string {
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return `${num(days, lang)}${lang === "bn" ? " দিন" : "d"}`;
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return `${num(hours, lang)}${lang === "bn" ? " ঘণ্টা" : "h"}`;
  return `${num(Math.max(0, Math.floor(seconds / 60)), lang)}${lang === "bn" ? " মিনিট" : "m"}`;
}

export type Accent = "emerald" | "amber" | "sky" | "violet" | "danger";

const ACCENT_ICON: Record<Accent, string> = {
  emerald: "bg-emerald/10 text-emerald",
  amber: "bg-warning/10 text-warning",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  danger: "bg-danger/10 text-danger",
};

/** KPI tile (unchanged from the pre-split Admin screen). */
export function StatTile({
  label,
  value,
  icon: Icon,
  lang,
  accentColor = "emerald",
  hint,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  lang: Lang;
  accentColor?: Accent;
  hint?: string;
}) {
  return (
    <div className="glass-card rounded-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control ${ACCENT_ICON[accentColor]}`}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <p
        className={`mt-2.5 text-2xl font-extrabold tabular-nums tracking-tight text-ink ${
          lang === "bn" ? "font-bn" : "font-en"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/** Page header: emerald badge + title + one-line subtitle. */
export function AdminHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-emerald text-accent-ink shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {subtitle && <p className="text-xs text-muted sm:text-sm">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Titled panel used by every admin page that is not a bare table. */
export function AdminCard({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-card rounded-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Inline banner. `tone` picks the colour; `role` makes errors announce. */
export function AdminBanner({
  tone,
  children,
}: {
  tone: "success" | "error" | "warn" | "info";
  children: ReactNode;
}) {
  const styles = {
    success: "border-emerald/25 bg-emerald/10 text-emerald",
    error: "border-danger/25 bg-danger/10 text-danger",
    warn: "border-warning/30 bg-warning/10 text-warning",
    info: "border-line/60 bg-surface-2/60 text-muted",
  }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-card border p-3.5 text-sm font-medium shadow-sm ${styles}`}
    >
      {children}
    </div>
  );
}

/** Centred spinner used while an admin page's first fetch is in flight. */
export function AdminLoading({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-muted" role="status">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-muted/30 border-t-emerald"
      />
      <span className="text-sm">{w(lang, "loading")}</span>
    </div>
  );
}

/** Empty state for a table or list that legitimately has nothing in it. */
export function AdminEmpty({
  icon: Icon,
  messageKey,
  lang,
}: {
  icon: React.ComponentType<{ className?: string }>;
  messageKey: WebKey;
  lang: Lang;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2/70 text-muted">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{w(lang, messageKey)}</p>
    </div>
  );
}

/**
 * Horizontal share bar for an analytics slice. Deliberately CSS-only —
 * the admin bundle should not pull a charting library for four lists.
 */
export function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-emerald"
        style={{ width: `${Math.max(1, Math.min(100, pct))}%` }}
      />
    </div>
  );
}
