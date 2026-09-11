/**
 * /admin/analytics — platform-wide spending shape.
 *
 * Aggregate-only on purpose. This is the one admin screen that reads every
 * user's expenses at once, so it shows distributions and totals and never
 * individual rows; looking at one person's records is a separate,
 * deliberate act at /admin/users/:userId.
 *
 * The charts are CSS bars rather than a charting library: four ranked lists
 * and a 12-month series do not justify shipping one into the bundle.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { AdminAnalytics as AdminAnalyticsData, AdminSlice } from "@poipoihisab/api-client";
import { apiAdminAnalytics } from "@poipoihisab/api-client";
import { IconBarChart, IconReceipt } from "../../components/icons";
import { groupName, payName } from "../../lib/catalog";
import { fmtTaka } from "../../lib/money";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import { num } from "./format";
import {
  AdminBanner,
  AdminCard,
  AdminEmpty,
  AdminHeader,
  AdminLoading,
  ShareBar,
} from "./shared";

/** Ranked breakdown with a share bar per row. */
function SliceList({ slices, lang, label = (value) => value }: { slices: AdminSlice[]; lang: "bn" | "en"; label?: (value: string, lang: "bn" | "en") => string }) {
  const top = Math.max(0, ...slices.map((slice) => Number(slice.amount))) || 1;
  if (slices.length === 0) {
    return <AdminEmpty icon={IconReceipt} messageKey="adminCategoriesEmpty" lang={lang} />;
  }
  return (
    <ul className="space-y-2.5">
      {slices.map((slice) => (
        <li key={`${slice.label}-${slice.count}`}>
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span className="min-w-0 break-words text-sm font-semibold text-ink">{label(slice.label, lang)}</span>
            <span className="min-w-0 break-words text-xs font-bold tabular-nums text-ink sm:shrink-0">
              {fmtTaka(slice.amount, lang)}
              <span className="ml-1.5 font-normal text-muted">
                ({num(slice.count, lang)})
              </span>
            </span>
          </div>
          <div className="mt-1" aria-hidden="true">
            <ShareBar pct={(Number(slice.amount) / top) * 100} minPct={0} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AdminAnalytics() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminAnalytics"));

  const [data, setData] = useState<AdminAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminAnalytics(12, lang);
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

  const peak = data ? Math.max(0, ...data.trend.map((p) => Number(p.amount))) || 1 : 1;
  const trendHint = data && data.trend.length > 0
    ? w(lang, "adminTrendScope").replace("{start}", num(data.trend[0].month, lang)).replace("{end}", num(data.trend[data.trend.length - 1].month, lang))
    : w(lang, "adminNoData");

  return (
    <div className="w-full space-y-5 pb-12 pt-2">
      <AdminHeader
        icon={IconBarChart}
        title={w(lang, "navAdminAnalytics")}
        subtitle={w(lang, "adminAnalyticsSub")}
      />

      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {data && (
        <>
          <AdminCard title={w(lang, "adminTrend")} hint={trendHint}>
            {/* Column chart: one bar per month, height relative to the peak.
                The table below supplies exact values and accessible labels.
                Zero months must not acquire the old minimum-height bar. */}
            <div className="flex h-44 items-end gap-1.5 border-b border-line/50 sm:gap-2.5" aria-hidden="true">
              {data.trend.map((point) => {
                const amount = Number(point.amount);
                const pct = Math.max(0, (amount / peak) * 100);
                return (
                  <div key={point.month} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5">
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t bg-emerald/80 transition-all hover:bg-emerald"
                        style={{ height: `${pct}%` }}
                        title={`${num(point.month, lang)}: ${fmtTaka(point.amount, lang)} · ${num(point.expenses, lang)} · +${num(point.newUsers, lang)}`}
                      />
                    </div>
                    <span className="w-full truncate text-center text-[10px] text-muted">
                      <span className="sm:hidden">{num(point.month.slice(5), lang)}</span>
                      <span className="hidden sm:inline">{num(point.month.slice(2), lang)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <caption className="sr-only">{w(lang, "adminTrend")}</caption>
                <thead className="border-b border-line/40 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-2 pr-3">{w(lang, "adminMonth")}</th>
                    <th className="py-2 pr-3 text-right">{w(lang, "adminTotalVolume")}</th>
                    <th className="py-2 pr-3 text-right">{w(lang, "adminTotalExpenses")}</th>
                    <th className="py-2 text-right">{w(lang, "adminNewUsersShort")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/20">
                  {data.trend.map((point) => (
                    <tr key={point.month}>
                      <td className="py-1.5 pr-3 font-mono text-muted">{num(point.month, lang)}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink">
                        {fmtTaka(point.amount, lang)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted">
                        {num(point.expenses, lang)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted">
                        {num(point.newUsers, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AdminCard title={w(lang, "adminByGroup")} hint={w(lang, "adminRankingScope")} className="min-w-0">
              <SliceList slices={data.byGroup} lang={lang} label={groupName} />
            </AdminCard>
            <AdminCard title={w(lang, "adminByCategory")} hint={w(lang, "adminRankingScope")} className="min-w-0">
              <SliceList slices={data.byCategory} lang={lang} />
            </AdminCard>
            <AdminCard title={w(lang, "adminByPayment")} hint={w(lang, "adminRankingScope")} className="min-w-0">
              <SliceList slices={data.byPayment} lang={lang} label={payName} />
            </AdminCard>
            <AdminCard title={w(lang, "adminTabDebts")} hint={w(lang, "adminAnalyticsDebtScope")} className="min-w-0">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 break-words rounded-control bg-emerald/10 p-3">
                  <span className="text-[11px] font-semibold text-muted">
                    {w(lang, "adminRecordedLend")}
                  </span>
                  <p className="mt-1 text-lg font-extrabold tabular-nums text-emerald">
                    {fmtTaka(data.debtLend, lang)}
                  </p>
                </div>
                <div className="min-w-0 break-words rounded-control bg-danger/10 p-3">
                  <span className="text-[11px] font-semibold text-muted">
                    {w(lang, "adminRecordedBorrow")}
                  </span>
                  <p className="mt-1 text-lg font-extrabold tabular-nums text-danger">
                    {fmtTaka(data.debtBorrow, lang)}
                  </p>
                </div>
              </div>
            </AdminCard>
          </div>

          <AdminCard title={w(lang, "adminTopSpenders")} hint={w(lang, "adminTopSpendersScope")}>
            {data.topUsers.length === 0 ? (
              <AdminEmpty icon={IconReceipt} messageKey="adminCategoriesEmpty" lang={lang} />
            ) : (
              <ol className="divide-y divide-line/30">
                {data.topUsers.map((row, i) => (
                  <li key={row.userId} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]">
                    <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-muted">
                      {num(i + 1, lang)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/admin/users/${row.userId}`}
                        className="break-words font-semibold text-ink hover:text-emerald hover:underline"
                      >
                        {row.name}
                      </Link>
                      <p className="break-all font-en text-[11px] text-muted">{row.email ?? "—"}</p>
                    </div>
                    <div className="col-start-2 min-w-0 break-words sm:col-start-3 sm:text-right">
                      <p className="text-sm font-bold tabular-nums text-ink">
                        {fmtTaka(row.totalExpense, lang)}
                      </p>
                      <p className="text-[11px] text-muted">
                        {w(lang, "entries")}: {num(row.expenseCount, lang)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </AdminCard>
        </>
      )}
    </div>
  );
}
