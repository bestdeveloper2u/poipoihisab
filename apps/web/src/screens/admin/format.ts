/**
 * Localisation helpers for the /admin/* pages.
 *
 * Separate from ./shared.tsx purely so that file can export only React
 * components — mixing plain functions into a component module breaks Vite's
 * fast refresh (react-refresh/only-export-components).
 */
import { toBnDigits, type Lang } from "@poipoihisab/core";

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
