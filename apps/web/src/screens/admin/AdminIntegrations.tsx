/**
 * /admin/integrations — deployment-wide integration wiring.
 *
 * GET /sheets/status answers for whoever calls it; the service account
 * itself is deployment config, and whether it loads decides whether Sheets
 * sync works for ANYBODY. The credential value is never shown — inline
 * JSON is how the serverless deploy receives it, so the API reports only
 * that it is inline plus the derived service-account address users have to
 * share their spreadsheet with.
 */
import { useEffect, useState } from "react";
import type { AdminIntegrations as AdminIntegrationsData } from "@poipoihisab/api-client";
import { apiAdminIntegrations } from "@poipoihisab/api-client";
import { IconMic, IconPlug } from "../../components/icons";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import { AdminBanner, AdminCard, AdminHeader, AdminLoading, num } from "./shared";

function StatusPill({ ok, lang }: { ok: boolean; lang: "bn" | "en" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
        ok ? "bg-emerald/15 text-emerald" : "bg-warning/15 text-warning"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald" : "bg-warning"}`} />
      {ok ? w(lang, "adminIntegrationConfigured") : w(lang, "adminIntegrationNotConfigured")}
    </span>
  );
}

export function AdminIntegrations() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminIntegrations"));

  const [data, setData] = useState<AdminIntegrationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminIntegrations(lang);
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
    <div className="mx-auto max-w-3xl space-y-5 px-1 pb-12 pt-2">
      <AdminHeader
        icon={IconPlug}
        title={w(lang, "navAdminIntegrations")}
        subtitle={w(lang, "adminIntegrationsSub")}
      />

      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {data && (
        <>
          <AdminCard
            title={w(lang, "adminIntegrationSheets")}
            actions={<StatusPill ok={data.sheetsConfigured} lang={lang} />}
          >
            {data.sheetsDetail && (
              <p className="mb-3 rounded-control border border-warning/25 bg-warning/10 p-2.5 text-xs font-medium text-warning">
                {data.sheetsDetail}
              </p>
            )}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4 border-b border-line/25 py-2">
                <span className="text-xs font-semibold text-muted">
                  {w(lang, "adminIntegrationCredential")}
                </span>
                <span className="break-all text-right font-mono text-xs text-ink">
                  {data.sheetsSaFile ?? "—"}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4 py-2">
                <span className="text-xs font-semibold text-muted">
                  {w(lang, "adminIntegrationSaEmail")}
                </span>
                <span className="break-all text-right font-en text-xs font-bold text-ink">
                  {data.sheetsSaEmail ?? "—"}
                </span>
              </div>
            </div>
            {data.sheetsSaEmail && (
              <p className="mt-2 text-xs text-muted">
                {w(lang, "sheetsShare").replace("{email}", data.sheetsSaEmail)}
              </p>
            )}
          </AdminCard>

          <AdminCard
            title={w(lang, "adminIntegrationVoice")}
            actions={
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald">
                <IconMic className="h-3.5 w-3.5" />
                {w(lang, "adminIntegrationConfigured")}
              </span>
            }
          >
            <p className="font-en text-xs text-muted">{data.voiceParser}</p>
            <p className="mt-2 text-xs text-muted">
              {lang === "bn"
                ? "ভয়েস শনাক্তকরণ ব্রাউজারেই চলে — কোনো তৃতীয় পক্ষের API বা প্রতি-অনুরোধ খরচ নেই।"
                : "Recognition runs in the browser — no third-party API and no per-request cost."}
            </p>
          </AdminCard>

          <AdminCard title={w(lang, "adminTotalUsers")}>
            <p className="text-2xl font-extrabold tabular-nums text-ink">
              {num(data.usersTotal, lang)}
            </p>
          </AdminCard>
        </>
      )}
    </div>
  );
}
