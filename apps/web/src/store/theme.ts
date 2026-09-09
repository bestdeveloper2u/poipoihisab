import { create } from "zustand";

/**
 * Appearance preferences (prototype www/index.html setTheme @1618 /
 * setMotion @1621, init @1766): raw-string localStorage values so the inline
 * FOUC script in index.html can read them before first paint without JSON.
 *
 *   poipoihisab.theme  → "light" | "dark" | "system"  (default light; "system"
 *                    follows prefers-color-scheme — ADR-0027, a deliberate
 *                    divergence from the prototype's 2-option segment. The
 *                    DOM attribute still only ever receives light/dark.)
 *   poipoihisab.motion → "on" | "off"       (default: prefers-reduced-motion)
 */

export type Theme = "light" | "dark" | "system";
/** What data-theme actually carries — never "system" (index.css tokens). */
export type EffectiveTheme = "light" | "dark";
export type Motion = "on" | "off";

export const THEME_KEY = "poipoihisab.theme";
export const MOTION_KEY = "poipoihisab.motion";

export const isTheme = (v: unknown): v is Theme =>
  v === "light" || v === "dark" || v === "system";
export const isMotion = (v: unknown): v is Motion => v === "on" || v === "off";

/** Pure: stored value → theme PREF. Missing/corrupt values fall back to light. */
export function resolveTheme(stored: unknown): Theme {
  return isTheme(stored) ? stored : "light";
}

/**
 * Pure: theme PREF + OS dark-scheme → the value data-theme carries.
 * "system" is only ever a stored preference; the resolved light/dark is what
 * hits the DOM so the [data-theme="dark"] token overrides in index.css are
 * untouched (ADR-0027).
 */
export function effectiveTheme(pref: Theme, prefersDark: boolean): EffectiveTheme {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

/** Pure: stored value + OS reduced-motion → effective motion setting. */
export function resolveMotion(stored: unknown, prefersReducedMotion: boolean): Motion {
  if (isMotion(stored)) return stored;
  return prefersReducedMotion ? "off" : "on";
}

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function mediaMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

function prefersReducedMotion(): boolean {
  return mediaMatches("(prefers-reduced-motion: reduce)");
}

/** OS dark-scheme probe; environments without matchMedia count as light. */
function prefersDarkScheme(): boolean {
  return mediaMatches("(prefers-color-scheme: dark)");
}

/** Reflect the RESOLVED theme on <html> without touching storage. */
function reflectTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = effectiveTheme(theme, prefersDarkScheme());
  }
}

/**
 * Apply a theme PREF: persist it verbatim ("system" is a legal stored value,
 * read back by the FOUC script) but reflect only the RESOLVED light/dark on
 * <html>. data-theme is what the token overrides in index.css
 * ([data-theme="dark"]) key off, so every utility that references a color
 * token switches at once.
 */
export function applyTheme(theme: Theme): void {
  reflectTheme(theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — keep the in-memory choice only */
  }
}

/** Apply the motion preference: "off" toggles the CSS kill-switch (index.css). */
export function applyMotion(motion: Motion): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.motion = motion;
  }
  try {
    window.localStorage.setItem(MOTION_KEY, motion);
  } catch {
    /* private mode — keep the in-memory choice only */
  }
}

interface ThemeState {
  /** The stored PREF — "system" stays "system" here; resolve with effectiveTheme. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: resolveTheme(readStored(THEME_KEY)),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

interface MotionState {
  motion: Motion;
  setMotion: (motion: Motion) => void;
}

export const useMotionStore = create<MotionState>()((set) => ({
  motion: resolveMotion(readStored(MOTION_KEY), prefersReducedMotion()),
  setMotion: (motion) => {
    applyMotion(motion);
    set({ motion });
  },
}));

/**
 * Live OS-scheme wiring for pref="system" (ADR-0027): while the stored pref
 * is "system", a prefers-color-scheme flip re-applies data-theme with the
 * newly resolved value; explicit light/dark prefs ignore it. Safe in
 * environments without matchMedia/addEventListener/addListener (a no-op
 * unsubscribe is returned). Returns an unsubscribe function.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return () => {};
  }
  const onChange = () => {
    if (useThemeStore.getState().theme === "system") {
      applyTheme("system");
    }
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }
  // Older Safari exposes only the deprecated addListener/removeListener pair.
  if (typeof mql.addListener === "function") {
    mql.addListener(onChange);
    return () => {
      mql.removeListener(onChange);
    };
  }
  return () => {};
}

/**
 * Module init: mirror the stored pref onto the DOM. The inline FOUC script in
 * index.html has normally already done this pre-paint; this covers test
 * environments and loads where the script did not run. Storage is NOT written
 * here — a corrupt/absent value stays exactly as the user left it.
 */
reflectTheme(resolveTheme(readStored(THEME_KEY)));

/** App-lifetime subscription; detachSystemThemeWatcher() undoes it (tests). */
export const detachSystemThemeWatcher: () => void = watchSystemTheme();
