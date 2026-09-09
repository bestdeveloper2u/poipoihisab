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
function SliceList({ slices, lang }: { slices: AdminSlice[]; lang: "bn" | "en" }) {
  const top = Number(slices[0]?.amount ?? 0) || 1;
  if (slices.length === 0) {
    return <AdminEmpty icon={IconReceipt} messageKey="adminCategoriesEmpty" lang={lang} />;
  }
  return (
    <ul className="space-y-2.5">
      {slices.map((slice) => (
        <li key={`${slice.label}-${slice.count}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold text-ink">{slice.label}</span>
            <span className="shrink-0 text-xs font-bold tabular-nums text-ink">
              {fmtTaka(slice.amount, lang)}
              <span className="ml-1.5 font-normal text-muted">
                ({num(slice.count, lang)})
              </span>
            </span>
          </div>
          <div className="mt-1">
            <ShareBar pct={(Number(slice.amount) / top) * 100} />
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

  const peak = data ? Math.max(1, ...data.trend.map((p) => Number(p.amount))) : 1;

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
          <AdminCard title={w(lang, "adminTrend")}>
            {/* Column chart: one bar per month, height relative to the peak.
                Values sit in the accessible name, so the shape is decorative
                and the numbers are still readable by a screen reader. */}
            <div className="flex h-44 items-end gap-1.5 sm:gap-2.5">
              {data.trend.map((point) => {
                const amount = Number(point.amount);
                const pct = Math.max(2, (amount / peak) * 100);
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

          <div className="grid gap-4 lg:grid-cols-2">
            <AdminCard title={w(lang, "adminByGroup")}>
              <SliceList slices={data.byGroup} lang={lang} />
            </AdminCard>
            <AdminCard title={w(lang, "adminByCategory")}>
              <SliceList slices={data.byCategory} lang={lang} />
            </AdminCard>
            <AdminCard title={w(lang, "adminByPayment")}>
              <SliceList slices={data.byPayment} lang={lang} />
            </AdminCard>
            <AdminCard title={w(lang, "adminTabDebts")}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-control bg-emerald/10 p-3">
                  <span className="text-[11px] font-semibold text-muted">
                    {w(lang, "adminDebtLend")}
                  </span>
                  <p className="mt-1 text-lg font-extrabold tabular-nums text-emerald">
                    {fmtTaka(data.debtLend, lang)}
                  </p>
                </div>
                <div className="rounded-control bg-danger/10 p-3">
                  <span className="text-[11px] font-semibold text-muted">
                    {w(lang, "adminDebtBorrow")}
                  </span>
                  <p className="mt-1 text-lg font-extrabold tabular-nums text-danger">
                    {fmtTaka(data.debtBorrow, lang)}
                  </p>
                </div>
              </div>
            </AdminCard>
          </div>

          <AdminCard title={w(lang, "adminTopSpenders")}>
            {data.topUsers.length === 0 ? (
              <AdminEmpty icon={IconReceipt} messageKey="adminCategoriesEmpty" lang={lang} />
            ) : (
              <ol className="divide-y divide-line/30">
                {data.topUsers.map((row, i) => (
                  <li key={row.userId} className="flex items-center gap-3 py-2.5">
                    <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-muted">
                      {num(i + 1, lang)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/admin/users/${row.userId}`}
                        className="font-semibold text-ink hover:text-emerald hover:underline"
                      >
                        {row.name}
                      </Link>
                      <p className="truncate font-en text-[11px] text-muted">{row.email ?? "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-ink">
                        {fmtTaka(row.totalExpense, lang)}
                      </p>
                      <p className="text-[11px] text-muted">
                        {num(row.expenseCount, lang)} {w(lang, "entries")}
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
