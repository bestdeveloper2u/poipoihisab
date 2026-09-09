/**
 * Biometric app-lock (T29.1) — expo-local-authentication wrapper + the PURE
 * lock-state machine.
 *
 * NATIVE SIDE (ADR-0013 pattern, same as lib/voice.ts): the native module is
 * resolved through a DYNAMIC import() inside try/catch — never a static
 * import — so bundling is safe everywhere: in Expo Go / on web / in any build
 * that shipped without the native module, the import itself throws, callers
 * get `null`, and every entry point degrades to "unavailable" instead of
 * crashing. The structural types below intentionally mirror only the slice of
 * the package API we use, so this file compiles without importing its .d.ts.
 *
 * STATE MACHINE: nextLockState() is pure and dependency-free — no React, no
 * native modules, nothing injected — so scripts/t29_applock_check.mjs can
 * import this module directly under plain node (node ≥22 strips TS types
 * natively; the dynamic imports above are never evaluated unless their
 * functions are called, which the harness never does).
 *
 * WIRING (app/_layout.tsx): while the user is AUTHED and the pref is on, a
 * themed full-screen lock overlay engages on the AppState background→active
 * transition. The pref is persisted in expo-secure-store under its own key
 * (poipoihisab.applock — mirrors the poipoihisab.prefs blob convention). The login
 * screen is NEVER locked: the overlay only renders for a signed-in user, and
 * pref off always means unlocked.
 */

/** SecureStore key for the lock pref (sibling of "poipoihisab.prefs" / tokens). */
export const APP_LOCK_PREF_KEY = "poipoihisab.applock";

/** Two-state lock. */
export type LockState = "unlocked" | "locked";

/**
 * Lock lifecycle events.
 *   foreground  — AppState returned background→active (the ONLY event that
 *                 engages the lock; the wiring dispatches it only after a
 *                 real background, so a cold launch never locks).
 *   background  — app went to background (deliberately a no-op: we lock on
 *                 RETURN, not on leave, matching T29.1).
 *   authSuccess — biometric prompt succeeded.
 *   authFail    — biometric prompt failed OR was cancelled by the user
 *                 (authenticate() resolves false for both).
 *   prefOff     — the lock pref was switched off (also the forced-unlock on
 *                 sign-out path).
 */
export type LockEvent =
  | "foreground"
  | "background"
  | "authSuccess"
  | "authFail"
  | "prefOff";

/**
 * Pure transition: (state, event, pref) → next state.
 *   pref off        → ALWAYS unlocked (hard invariant, every event).
 *   background      → stay (locking happens on the foreground return).
 *   foreground      → locked (pref on) — previously backgrounded by contract.
 *   authSuccess     → unlocked.
 *   authFail/cancel → locked.
 *   prefOff         → unlocked, even from locked.
 */
export function nextLockState(
  state: LockState,
  event: LockEvent,
  prefOn: boolean,
): LockState {
  if (!prefOn) return "unlocked";
  switch (event) {
    case "prefOff":
    case "authSuccess":
      return "unlocked";
    case "foreground":
    case "authFail":
      return "locked";
    case "background":
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* expo-local-authentication — guarded dynamic resolution (ADR-0013)   */
/* ------------------------------------------------------------------ */

/** Minimal shape of the package's LocalAuthenticationResult we consume. */
interface LocalAuthResult {
  success: boolean;
}

/** Minimal shape of `expo-local-authentication` used here. */
interface LocalAuthModule {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  authenticateAsync(options?: {
    promptMessage?: string;
    cancelLabel?: string;
    disableDeviceFallback?: boolean;
  }): Promise<LocalAuthResult>;
}

let cachedModule: LocalAuthModule | null | undefined;

/**
 * Resolve the native module once. Returns null in Expo Go / on web / on any
 * build without the native plugin — never throws.
 */
async function loadLocalAuth(): Promise<LocalAuthModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    // DYNAMIC import on purpose (see file header).
    const mod: unknown = await import("expo-local-authentication");
    const candidate = mod as Partial<LocalAuthModule> | null;
    cachedModule =
      candidate &&
      typeof candidate.hasHardwareAsync === "function" &&
      typeof candidate.isEnrolledAsync === "function" &&
      typeof candidate.authenticateAsync === "function"
        ? (candidate as LocalAuthModule)
        : null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * True when the device can prompt for biometrics at all: hardware present
 * AND at least one biometric enrolled. Both probes (and a missing module)
 * resolve to false on any error — callers use this to disable the Settings
 * switch, never to gate the lock itself.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  const mod = await loadLocalAuth();
  if (mod === null) return false;
  try {
    const [hardware, enrolled] = await Promise.all([
      mod.hasHardwareAsync(),
      mod.isEnrolledAsync(),
    ]);
    return hardware === true && enrolled === true;
  } catch {
    return false;
  }
}

/**
 * Show the OS biometric prompt. Resolves true ONLY on success — failure,
 * user cancel, missing module and native errors all resolve false (the
 * caller maps false to the authFail event → stays locked → retry button).
 */
export async function authenticate(
  reason: string,
  cancelLabel = "Cancel",
): Promise<boolean> {
  const mod = await loadLocalAuth();
  if (mod === null) return false;
  try {
    const result = await mod.authenticateAsync({
      promptMessage: reason,
      cancelLabel,
    });
    return result?.success === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Pref persistence — expo-secure-store under "poipoihisab.applock"        */
/* (dynamic import keeps this file node-importable for the harness)    */
/* ------------------------------------------------------------------ */

/**
 * Read the persisted lock pref. Anything but the stored "on" marker (missing
 * key, SecureStore unavailable, corrupt value) reads as OFF — the app must
 * never lock a user out by default.
 */
export async function loadAppLockPref(): Promise<boolean> {
  try {
    const SecureStore: unknown = await import("expo-secure-store");
    const store = SecureStore as {
      getItemAsync?(key: string): Promise<string | null>;
    };
    if (typeof store.getItemAsync !== "function") return false;
    return (await store.getItemAsync(APP_LOCK_PREF_KEY)) === "on";
  } catch {
    return false;
  }
}

/** Persist the lock pref; failures leave the change session-only (no crash). */
export async function saveAppLockPref(on: boolean): Promise<void> {
  try {
    const SecureStore: unknown = await import("expo-secure-store");
    const store = SecureStore as {
      setItemAsync?(key: string, value: string): Promise<void>;
      deleteItemAsync?(key: string): Promise<void>;
    };
    if (on) {
      await store.setItemAsync?.(APP_LOCK_PREF_KEY, "on");
    } else {
      await store.deleteItemAsync?.(APP_LOCK_PREF_KEY);
    }
  } catch {
    // Storage unavailable → pref stays session-only.
  }
}
