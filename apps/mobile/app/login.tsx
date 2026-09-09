import { BRAND_NAME, t } from "@poipoihisab/core";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { usePrefs } from "../lib/prefs";
import type { MobileStringKey } from "../lib/strings";
import { theme, type ThemeColors } from "../lib/theme";

const LOGO_SIZE = 44;

type AuthMode = "login" | "register";

/** Segment labels for the login/register toggle (prototype authscreen parity). */
const MODES: { key: AuthMode; label: MobileStringKey }[] = [
  { key: "login", label: "modeLogin" },
  { key: "register", label: "modeRegister" },
];

/** Bengali-first auth screen: login + register modes (POST /auth/login|register). */
export default function Login() {
  const auth = useAuth();
  const router = useRouter();
  const { colors, lang, setLang, ready, t: tr } = usePrefs();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (e.g. deep link to /login) → straight to the dashboard.
  if (auth.user) {
    return <Redirect href="/" />;
  }

  const isRegister = mode === "register";
  const languageDisabled = pending || auth.loading || !ready;
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !pending && !auth.loading;

  function switchMode(next: AuthMode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      if (isRegister) {
        // register() persists the returned pair in lib/auth — the "/" route
        // then lands on the signed-in dashboard exactly like login does.
        await auth.register({
          email: email.trim(),
          password,
          ...(name.trim().length > 0 ? { name: name.trim() } : {}),
        });
      } else {
        await auth.login(email.trim(), password);
      }
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 0) {
          setError(tr("errNetwork"));
        } else if (isRegister && err.status === 409) {
          setError(tr("errEmailTaken"));
        } else if (isRegister && err.status === 422) {
          setError(
            err.message.length > 0 ? err.message : tr("errWeakPassword"),
          );
        } else if (!isRegister && err.status === 401) {
          setError(tr("errBadCreds"));
        } else {
          setError(err.message || tr("errGeneric"));
        }
      } else {
        setError(tr("errGeneric"));
      }
    } finally {
      setPending(false);
    }
  }

  const submitLabel = pending
    ? isRegister
      ? tr("registering")
      : tr("signingIn")
    : isRegister
      ? tr("registerBtn")
      : t(lang, "loginBtn");

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.logoBox}>
        <Text style={styles.logoGlyph}>৳</Text>
      </View>
      <Text style={styles.brand}>{BRAND_NAME}</Text>
      <Text style={styles.tagline}>{t(lang, "tagline")}</Text>

      <View style={styles.form}>
        <View style={styles.modeRow}>
          {MODES.map((m) => (
            <Pressable
              key={m.key}
              style={({ pressed }) => [
                styles.modeChip,
                pressed && styles.modeChipPressed,
                mode === m.key && styles.modeChipSelected,
              ]}
              onPress={() => switchMode(m.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m.key }}
              accessibilityLabel={tr(m.label)}
            >
              <Text
                style={[
                  styles.modeChipLabel,
                  mode === m.key && styles.modeChipLabelSelected,
                ]}
              >
                {tr(m.label)}
              </Text>
            </Pressable>
          ))}
        </View>

        {isRegister && (
          <TextInput
            style={styles.input}
            placeholder={tr("namePlaceholder")}
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            editable={!pending}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder={t(lang, "email")}
          placeholderTextColor={colors.muted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          editable={!pending}
        />
        <TextInput
          style={styles.input}
          placeholder={t(lang, "password")}
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={isRegister ? "new-password" : "password"}
          editable={!pending}
        />
        {isRegister && (
          <View style={{ gap: theme.spacing.sm }}>
            <Text style={styles.modeChipLabel}>{tr("language")}</Text>
            <View style={styles.modeRow}>
              {(["bn", "en"] as const).map((choice) => (
                <Pressable
                  key={choice}
                  style={({ pressed }) => [
                    styles.modeChip,
                    { minHeight: 44, minWidth: 44, justifyContent: "center" },
                    pressed && styles.modeChipPressed,
                    lang === choice && styles.modeChipSelected,
                    languageDisabled && styles.buttonDisabled,
                  ]}
                  onPress={() => {
                    if (languageDisabled) return;
                    setLang(choice);
                  }}
                  disabled={languageDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={tr(choice === "bn" ? "langBn" : "langEn")}
                  accessibilityState={{
                    selected: lang === choice,
                    disabled: languageDisabled,
                  }}
                >
                  <Text
                    style={[
                      styles.modeChipLabel,
                      lang === choice && styles.modeChipLabelSelected,
                    ]}
                  >
                    {tr(choice === "bn" ? "langBn" : "langEn")}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            (pending || !canSubmit) && styles.buttonDisabled,
            pressed && canSubmit && styles.buttonPressed,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
        >
          <Text style={styles.buttonLabel}>{submitLabel}</Text>
        </Pressable>
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.ivory,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    logoBox: {
      width: LOGO_SIZE,
      height: LOGO_SIZE,
      borderRadius: theme.radius.logo, // ~30% of the 44px mark
      backgroundColor: colors.emerald,
      alignItems: "center",
      justifyContent: "center",
    },
    logoGlyph: {
      color: colors.onAccent,
      fontSize: 24,
      fontWeight: "700",
    },
    brand: {
      color: colors.ink,
      fontSize: 24,
      fontWeight: "700",
    },
    tagline: {
      color: colors.muted,
      fontSize: 14,
    },
    form: {
      alignSelf: "stretch",
      backgroundColor: colors.surface,
      borderRadius: theme.radius.card,
      padding: theme.spacing.lg,
      marginTop: theme.spacing.md,
      gap: theme.spacing.md,
    },
    modeRow: {
      flexDirection: "row",
      gap: theme.spacing.sm,
    },
    modeChip: {
      flex: 1,
      alignItems: "center",
      borderRadius: theme.radius.control,
      paddingVertical: theme.spacing.sm,
      backgroundColor: colors.surface2,
    },
    modeChipSelected: {
      backgroundColor: colors.emerald,
    },
    modeChipPressed: {
      opacity: 0.8,
    },
    modeChipLabel: {
      color: colors.muted,
      fontSize: 14,
      fontWeight: "600",
    },
    modeChipLabelSelected: {
      color: colors.onAccent,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      borderRadius: theme.radius.control,
      backgroundColor: colors.surface2,
      color: colors.ink,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      fontSize: 15,
    },
    button: {
      backgroundColor: colors.emerald,
      borderRadius: theme.radius.control,
      alignItems: "center",
      paddingVertical: theme.spacing.md,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonPressed: {
      backgroundColor: colors.emeraldSoft,
    },
    buttonLabel: {
      color: colors.onAccent,
      fontSize: 16,
      fontWeight: "600",
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      textAlign: "center",
    },
  });
