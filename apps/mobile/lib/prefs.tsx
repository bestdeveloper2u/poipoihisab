/**
 * App preferences provider (T11.3) — the mobile ThemeContext.
 *
 * Owns two persisted prefs:
 *   - theme mode: "light" (default) | "dark" | "system" → lib/theme.ts PALETTES.
 *     "system" (T28.2 — mobile twin of the web's ADR-0027) is stored VERBATIM
 *     in the blob and resolved through the OS color scheme via effectiveTheme;
 *     the palette only ever receives the resolved light/dark.
 *   - UI language: "bn" (default) | "en"       → lib/strings.ts STRINGS
 *
 * T29.1 adds the biometric app-lock pref, persisted under its OWN key
 * "poipoihisab.applock" (through lib/appLock.ts helpers) so the versioned prefs
 * blob stays untouched — same degrade-to-default ("off") semantics.
 *
 * Persistence is a tiny JSON blob in expo-secure-store under "poipoihisab.prefs".
 * The app has no AsyncStorage dependency and T11.3 must not add native deps,
 * so SecureStore doubles as the key-value store (the blob is <100 bytes, well
 * under its value limit). Any storage failure degrades to in-memory state —
 * the app renders with defaults instead of crashing.
 */
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import { loadAppLockPref, saveAppLockPref } from "./appLock";
import { STRINGS, type Lang, type MobileStringKey } from "./strings";
import {
  PALETTES,
  type EffectiveTheme,
  type ThemeColors,
  type ThemeMode,
} from "./theme";

const PREFS_KEY = "poipoihisab.prefs";

export interface PrefsContextValue {
  /** True once the stored blob has been read (or failed) at startup. */
  ready: boolean;
  mode: ThemeMode;
  /** Resolved palette key; follows OS changes when mode is "system". */
  resolvedTheme: EffectiveTheme;
  lang: Lang;
  /** Biometric app-lock pref (T29.1) — SecureStore "poipoihisab.applock". */
  appLock: boolean;
  /** Color palette for the RESOLVED mode — light tokens until `ready`. */
  colors: ThemeColors;
  setMode(mode: ThemeMode): void;
  setLang(lang: Lang): void;
  setAppLock(on: boolean): void;
  /** STRINGS lookup for the active language. */
  t(key: MobileStringKey): string;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

/**
 * Pure: theme PREF + OS color scheme → the palette key to render with
 * (T28.2 — mobile twin of the web store's effectiveTheme, ADR-0027).
 * "system" is only ever a stored preference; the resolved light/dark is what
 * reaches PALETTES, so no screen ever sees a "system" color set.
 */
export function effectiveTheme(
  pref: ThemeMode,
  systemScheme: "light" | "dark",
): EffectiveTheme {
  return pref === "system" ? systemScheme : pref;
}

/** Unknown stored value → mode ("dark"/"system" verbatim, anything else light). */
function asMode(value: unknown): ThemeMode {
  return value === "dark" ? "dark" : value === "system" ? "system" : "light";
}

/** Unknown stored value → lang (anything but "en" reads as bn). */
function asLang(value: unknown): Lang {
  return value === "en" ? "en" : "bn";
}

async function loadStoredPrefs(): Promise<{ mode: ThemeMode; lang: Lang }> {
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") {
        const obj = parsed as { theme?: unknown; lang?: unknown };
        return { mode: asMode(obj.theme), lang: asLang(obj.lang) };
      }
    }
  } catch {
    // Corrupt blob / SecureStore unavailable → fall through to defaults.
  }
  return { mode: "light", lang: "bn" };
}

async function persistPrefs(mode: ThemeMode, lang: Lang): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      PREFS_KEY,
      JSON.stringify({ theme: mode, lang }),
    );
  } catch {
    // Storage unavailable → prefs stay session-only.
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [lang, setLangState] = useState<Lang>("bn");
  // Biometric app-lock pref (T29.1) — off until the SecureStore read settles.
  const [appLock, setAppLockState] = useState(false);
  // OS color scheme (T28.2): useColorScheme keeps this provider subscribed to
  // Appearance, so an OS theme flip re-renders and pref="system" tracks it
  // live. null (undetermined / pre-hydration) counts as light.
  const systemScheme: "light" | "dark" = useColorScheme() ?? "light";

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadStoredPrefs(), loadAppLockPref()]).then(
      ([stored, lockOn]) => {
        if (!cancelled) {
          setModeState(stored.mode);
          setLangState(stored.lang);
          setAppLockState(lockOn);
          setReady(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      void persistPrefs(next, lang);
    },
    [lang],
  );

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      void persistPrefs(mode, next);
    },
    [mode],
  );

  // Biometric app-lock pref (T29.1) — persisted under its own SecureStore
  // key via lib/appLock.ts; a storage failure keeps the change session-only.
  const setAppLock = useCallback((on: boolean) => {
    setAppLockState(on);
    void saveAppLockPref(on);
  }, []);

  const value = useMemo<PrefsContextValue>(
    () => ({
      ready,
      mode,
      resolvedTheme: effectiveTheme(mode, systemScheme),
      lang,
      appLock,
      colors: PALETTES[effectiveTheme(mode, systemScheme)],
      setMode,
      setLang,
      setAppLock,
      t: (key: MobileStringKey) => STRINGS[lang][key],
    }),
    [ready, mode, lang, systemScheme, setMode, setLang, setAppLock],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    throw new Error("usePrefs must be used inside <PrefsProvider>");
  }
  return ctx;
}
