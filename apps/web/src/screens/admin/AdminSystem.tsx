/**
 * /admin/system — the runtime facts behind the rest of the dashboard.
 *
 * The reason this page exists: with POIPOIHISAB_KV_URL unset the API
 * silently falls back to in-process MemoryKV. On a serverless deploy that
 * means every cold start signs everybody out and resets the brute-force
 * counters — a production-breaking condition with no symptom anywhere else
 * in the product. Warnings are listed first and in plain language, because
 * the point is to be actionable, not to look like a status board.
 */
import { useEffect, useState } from "react";
import type { AdminSystem as AdminSystemData } from "@poipoihisab/api-client";
import { apiAdminSystem } from "@poipoihisab/api-client";
import { IconActivity } from "../../components/icons";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import { formatDateTime, formatTtl, num } from "./format";
import {
  AdminBanner,
  AdminCard,
  AdminHeader,
  AdminLoading,
} from "./shared";

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  const valueClass = {
    neutral: "text-ink",
    good: "text-emerald",
    bad: "text-danger",
    warn: "text-warning",
  }[tone];
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/25 py-2 last:border-0">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={`break-all text-right text-xs font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}

export function AdminSystem() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminSystem"));

  const [data, setData] = useState<AdminSystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminSystem(lang);
      if (!active) return;
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.detail);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [lang]);

  if (loading && !data) return <AdminLoading lang={lang} />;

  return (
    <div className="w-full space-y-5 pb-12 pt-2">
      <AdminHeader
        icon={IconActivity}
        title={w(lang, "navAdminSystem")}
        subtitle={w(lang, "adminSystemSub")}
      />

      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {data && (
        <>
          {(data.warnings ?? []).length > 0 ? (
            <AdminBanner tone="warn">
              <p className="font-bold">{w(lang, "adminSystemWarnings")}</p>
              <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-xs font-medium">
                {(data.warnings ?? []).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AdminBanner>
          ) : (
            <AdminBanner tone="success">✓ {w(lang, "adminSystemHealthy")}</AdminBanner>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <AdminCard title={w(lang, "adminSystemDatabase")}>
              <Row
                label={w(lang, "adminSystemConnected")}
                value={data.dbOk ? "✓" : w(lang, "adminSystemFailed")}
                tone={data.dbOk ? "good" : "bad"}
              />
              <Row label="Dialect" value={data.dbDialect} />
              <Row
                label={w(lang, "adminSystemMigration")}
                value={data.migrationCurrent ?? "—"}
                tone={data.migrationCurrent ? "neutral" : "warn"}
              />
              <Row
                label={w(lang, "adminSystemAuditTable")}
                value={
                  data.auditTablePresent
                    ? w(lang, "adminSystemPresent")
                    : w(lang, "adminSystemMissing")
                }
                tone={data.auditTablePresent ? "good" : "bad"}
              />
              {data.dbError && <Row label="Error" value={data.dbError} tone="bad" />}
            </AdminCard>

            <AdminCard title={w(lang, "adminSystemSessionStore")}>
              <Row label="Backend" value={data.kvBackend} />
              <Row
                label="Mode"
                value={
                  data.kvEphemeral
                    ? w(lang, "adminSystemEphemeral")
                    : w(lang, "adminSystemShared")
                }
                tone={data.kvEphemeral ? "bad" : "good"}
              />
              <Row
                label="POIPOIHISAB_KV_URL"
                value={data.kvConfigured ? "✓" : "—"}
                tone={data.kvConfigured ? "good" : "warn"}
              />
              <Row
                label={lang === "bn" ? "অ্যাক্সেস টোকেন মেয়াদ" : "Access token TTL"}
                value={formatTtl(data.accessTtl, lang)}
              />
              <Row
                label={lang === "bn" ? "রিফ্রেশ মেয়াদ" : "Refresh TTL"}
                value={formatTtl(data.refreshTtl, lang)}
              />
            </AdminCard>
          </div>

          <AdminCard title={w(lang, "adminSystemConfig")}>
            <Row label="POIPOIHISAB_ENV" value={data.env} />
            <Row label="Version" value={data.version} />
            <Row
              label="REFRESH_COOKIE_SECURE"
              value={data.refreshCookieSecure ? "✓" : "off"}
              tone={data.refreshCookieSecure ? "good" : "warn"}
            />
            <Row
              label={lang === "bn" ? "লগইন রেট লিমিট" : "Auth rate limit"}
              value={`${num(data.authRateLimit, lang)}/min`}
            />
            <Row label="CORS_ORIGINS" value={data.corsOrigins.join(", ") || "—"} />
            <Row
              label="SUPERADMIN_EMAILS"
              value={data.superadminEmails.join(", ") || "—"}
              tone={data.superadminEmails.length > 0 ? "neutral" : "warn"}
            />
            <Row
              label={w(lang, "adminSystemServerTime")}
              value={formatDateTime(data.serverTime, lang)}
            />
          </AdminCard>
        </>
      )}
    </div>
  );
}
