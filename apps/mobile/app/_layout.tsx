import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { authenticate, nextLockState, type LockState } from "../lib/appLock";
import { createExpense, type Expense, type ExpenseCreateInput } from "../lib/api";
import { AuthProvider, useAuth } from "../lib/auth";
import { ErrorBoundary } from "../lib/ErrorBoundary";
import { flushAll as flushOutbox, hydrate as hydrateOutbox } from "../lib/outbox";
import { PrefsProvider, usePrefs } from "../lib/prefs";
import { maybeRunRecurringBoot } from "../lib/recurringRun";
import { theme } from "../lib/theme";
import { ToastProvider, useToast } from "../lib/toast";

/**
 * Biometric app-lock gate (T29.1).
 *
 * Wraps the router so a themed full-screen overlay can engage OVER the app
 * while the user is AUTHED and the lock pref is on. The pure transition
 * function lives in lib/appLock.ts (nextLockState) — this component only
 * maps real app events onto it:
 *   - AppState background→active (authed + pref on) → "foreground" → locked,
 *     then the OS biometric prompt fires automatically;
 *   - prompt success → "authSuccess" → unlocked (overlay drops);
 *   - prompt fail/cancel → "authFail" → stays locked + আবার চেষ্টা করুন
 *     retry button re-fires the prompt;
 *   - pref switched off → "prefOff" → unlocked, overlay never shows.
 * The login screen is NEVER locked: the overlay renders only for a non-null
 * user (signed-out trees keep rendering underneath untouched).
 */
function AppLockGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { appLock, colors, t } = usePrefs();
  const [lock, setLock] = useState<LockState>("unlocked");
  /** Last prompt failed/cancelled → surface the themed retry button. */
  const [failed, setFailed] = useState(false);
  /** Retry taps re-run the auto-prompt effect (authFail alone stays locked). */
  const [attempt, setAttempt] = useState(0);
  const prevAppState = useRef(AppState.currentState);

  // Signed out (or never signed in) → never lock; drop stale lock state so a
  // later sign-in starts clean.
  useEffect(() => {
    if (!user) {
      setLock("unlocked");
      setFailed(false);
    }
  }, [user]);

  // Pref switched off while locked (or off entirely) → hard invariant:
  // unlocked immediately, no prompt.
  useEffect(() => {
    if (!appLock) {
      setFailed(false);
      setLock((s) => nextLockState(s, "prefOff", true));
    }
  }, [appLock]);

  // The ONLY engaging transition: background → active while authed + pref on
  // (T29.1 — we lock on RETURN, not on leave; a cold launch never locks).
  useEffect(() => {
    if (!user || !appLock) return;
    const sub = AppState.addEventListener("change", (next) => {
      const prev = prevAppState.current;
      prevAppState.current = next;
      if (prev === "background" && next === "active") {
        setFailed(false);
        setLock((s) => nextLockState(s, "foreground", true));
      }
    });
    return () => sub.remove();
  }, [user, appLock]);

  // While locked: fire the OS biometric prompt (on lock, and again on every
  // retry tap). authenticate() resolves false for fail AND cancel → both map
  // to "authFail" → stays locked → themed আবার চেষ্টা করুন button.
  useEffect(() => {
    if (!user || !appLock || lock !== "locked") return;
    let cancelled = false;
    setFailed(false);
    void authenticate(t("appLockPrompt"), t("cancel")).then((ok) => {
      if (cancelled) return;
      setLock((s) => nextLockState(s, ok ? "authSuccess" : "authFail", true));
      if (!ok) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user, appLock, lock, attempt, t]);

  // Overlay only for a signed-in user with the pref on — the login screen
  // and pref-off users never see it.
  if (user === null || !appLock || lock !== "locked") {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <View
        style={[styles.lockOverlay, { backgroundColor: colors.ivory }]}
        accessibilityViewIsModal
        accessibilityLabel={t("appLock")}
      >
        <View style={[styles.lockBadge, { backgroundColor: colors.surface2 }]}>
          <Text style={styles.lockIcon}>🔒</Text>
        </View>
        <Text style={[styles.lockBrand, { color: colors.ink }]}>
          {t("appLockBrand")}
        </Text>
        <Text style={[styles.lockHint, { color: colors.muted }]}>
          {t("appLockPrompt")}
        </Text>
        {failed && (
          <Pressable
            style={({ pressed }) => [
              styles.lockRetry,
              { backgroundColor: colors.emerald },
              pressed && styles.lockPressed,
            ]}
            onPress={() => setAttempt((a) => a + 1)}
            accessibilityRole="button"
            accessibilityLabel={t("retry")}
          >
            <Text style={[styles.lockRetryLabel, { color: colors.onAccent }]}>
              {t("retry")}
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

function RootNavigator() {
  const { loading, user, accessToken } = useAuth();
  const { ready, resolvedTheme, lang, colors } = usePrefs();
  const toast = useToast();

  // T17.1 (ADR-0014 §3): once the bootstrap settles with a live session,
  // materialize due recurring rules — at most one POST per local day per
  // device (SecureStore stamp), fire-and-forget, silent unless created > 0.
  useEffect(() => {
    if (loading || !ready || !user || !accessToken) return;
    void maybeRunRecurringBoot({ accessToken, lang, showToast: toast });
  }, [loading, ready, user, accessToken, lang, toast]);

  // T31.1 — offline outbox boot (mobile twin of the web <OutboxAutoFlush/>):
  // once authed, re-register persisted queue entries as pending rows, then
  // drain the queue on (a) boot, (b) the NetInfo reconnect edge and
  // (c) app-foreground. Fire-and-forget and SILENT everywhere — the outbox
  // must never block UI or crash; single-flight is enforced inside
  // flushAll(). The createExpense sender binds the CURRENT token at flush
  // time (via ref — the effect intentionally doesn't re-run on token
  // rotation, unlike the recurring hook above).
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const prevConnected = useRef<boolean | null>(null);

  useEffect(() => {
    if (loading || !ready || !user) return;
    let alive = true;

    const runFlush = (): void => {
      void (async () => {
        try {
          const token = tokenRef.current; // read at flush time
          if (token === null) return;
          const sender = (input: ExpenseCreateInput): Promise<Expense> =>
            createExpense(token, input);
          await flushOutbox(sender);
        } catch {
          // Silent by design (mirrors the web twin's trigger wrapper).
        }
      })();
    };

    void hydrateOutbox()
      .catch(() => undefined) // unreadable queue file must never break boot
      .finally(() => {
        if (alive) runFlush(); // boot trigger — same as web's mount flush
      });

    // Seed "was connected" so the first listener edge is a TRUE reconnect
    // (disconnected → connected), not just the first reading.
    void NetInfo.fetch()
      .then((state) => {
        if (alive) prevConnected.current = state.isConnected === true;
      })
      .catch(() => undefined);

    const unsubNet = NetInfo.addEventListener((state) => {
      const now = state.isConnected === true;
      const prev = prevConnected.current;
      prevConnected.current = now;
      if (now && prev === false) runFlush(); // reconnect → drain the queue
    });

    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") runFlush(); // foreground → cheap drain attempt
    });

    return () => {
      alive = false;
      unsubNet();
      appSub.remove();
    };
  }, [loading, ready, user]);

  // Session hydration (SecureStore + /me) or prefs hydration in flight →
  // themed blank splash (light tokens until prefs resolve).
  if (loading || !ready) {
    return <View style={[styles.splash, { backgroundColor: colors.ivory }]} />;
  }

  return (
    <>
      <StatusBar
        style={resolvedTheme === "dark" ? "light" : "dark"}
        backgroundColor={colors.ivory}
      />
      {/* T29.1: the biometric lock overlay engages over the whole router —
          gated on authed + pref, so /login is never covered. */}
      <AppLockGate>
        <Stack screenOptions={{ headerShown: false }}>
          {/* Explicit registration keeps these routes in the typed manifest. */}
          <Stack.Screen name="list" />
          <Stack.Screen name="month" />
          <Stack.Screen name="report" />
          <Stack.Screen name="budget" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="recurring" />
        </Stack>
      </AppLockGate>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <PrefsProvider>
        {/* T15.2: ToastProvider lives inside PrefsProvider (the pill uses the
            active palette) and wraps everything below so every screen — and
            the error fallback — can call useToast(). */}
        <ToastProvider>
          <ErrorBoundary>
            <RootNavigator />
          </ErrorBoundary>
        </ToastProvider>
      </PrefsProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: theme.colors.ivory,
  },
  // Biometric lock overlay (T29.1) — full-screen, both palettes via tokens.
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  lockBadge: {
    width: 84,
    height: 84,
    borderRadius: 999, // circle — core RADII has no pill token
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.xs,
  },
  lockIcon: {
    fontSize: 40,
  },
  lockBrand: {
    fontSize: 26,
    fontWeight: "700",
  },
  lockHint: {
    fontSize: 14,
    textAlign: "center",
  },
  lockRetry: {
    borderRadius: theme.radius.control,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  lockRetryLabel: {
    fontSize: 15,
    fontWeight: "700",
  },
  lockPressed: {
    opacity: 0.7,
  },
});
