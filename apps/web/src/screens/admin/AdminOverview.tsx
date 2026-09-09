/**
 * /admin — the superadmin landing page.
 *
 * Superadmin has no hisab of its own (owner 2026-09-09), so this replaces
 * the personal dashboard as the post-login destination. It answers three
 * questions in order of urgency: is anything wrong with the deployment,
 * how is the platform doing, and what did admins do recently.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { AdminAuditList, AdminPlatformStats, AdminSystem } from "@poipoihisab/api-client";
import { apiAdminAudit, apiAdminStats, apiAdminSystem } from "@poipoihisab/api-client";
import { formatDateTime, num } from "./format";
import {
  IconActivity,
  IconHistory,
  IconReceipt,
  IconRepeat,
  IconShield,
  IconSwap,
  IconUsers,
  IconWallet,
} from "../../components/icons";
import { ADMIN_NAV_SECTIONS } from "../../components/adminNav";
import { fmtTaka } from "../../lib/money";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import {
  AdminBanner,
  AdminCard,
  AdminEmpty,
  AdminHeader,
  AdminLoading,
  StatTile,
} from "./shared";

export function AdminOverview() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "adminTitle"));

  const [stats, setStats] = useState<AdminPlatformStats | null>(null);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [audit, setAudit] = useState<AdminAuditList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const [s, sys, a] = await Promise.all([
        apiAdminStats(lang),
        apiAdminSystem(lang),
        apiAdminAudit({ limit: 6 }, lang),
      ]);
      if (!active) return;
      if (s.ok) setStats(s.data);
      else setError(s.detail);
      if (sys.ok) setSystem(sys.data);
      if (a.ok) setAudit(a.data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [lang]);

  if (loading && !stats) return <AdminLoading lang={lang} />;

  return (
    <div className="w-full space-y-5 pb-12 pt-2">
      <AdminHeader
        icon={IconShield}
        title={w(lang, "adminTitle")}
        subtitle={w(lang, "adminOverviewSub")}
      />

      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {/* Deployment problems come first: a KV fallback or a missing audit
          table makes every number below less trustworthy. */}
      {system && (system.warnings ?? []).length > 0 && (
        <AdminBanner tone="warn">
          <div className="flex items-start gap-2.5">
            <IconActivity className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{w(lang, "adminSystemWarnings")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs font-medium">
                {(system.warnings ?? []).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <Link
                to="/admin/system"
                className="mt-2 inline-block text-xs font-bold underline hover:no-underline"
              >
                {w(lang, "navAdminSystem")} →
              </Link>
            </div>
          </div>
        </AdminBanner>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <StatTile
              label={w(lang, "adminTotalUsers")}
              value={num(stats.totalUsers, lang)}
              icon={IconUsers}
              lang={lang}
              accentColor="emerald"
              hint={`${w(lang, "adminNewUsers30d")}: ${num(stats.newUsers30d, lang)}`}
            />
            <StatTile
              label={w(lang, "adminActiveUsers")}
              value={num(stats.activeUsers30d, lang)}
              icon={IconActivity}
              lang={lang}
              accentColor="sky"
              hint={
                lang === "bn"
                  ? "৩০ দিনে অন্তত একটি খরচ লিখেছেন"
                  : "Recorded at least one expense in 30 days"
              }
            />
            <StatTile
              label={w(lang, "adminTotalExpenses")}
              value={num(stats.totalExpenses, lang)}
              icon={IconReceipt}
              lang={lang}
              accentColor="violet"
            />
            <StatTile
              label={w(lang, "adminTotalVolume")}
              value={fmtTaka(stats.totalAmount, lang)}
              icon={IconWallet}
              lang={lang}
              accentColor="amber"
              hint={`${w(lang, "adminMonthVolume")}: ${fmtTaka(stats.monthAmount, lang)}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <StatTile
              label={w(lang, "adminTabDebts")}
              value={num(stats.totalDebts, lang)}
              icon={IconSwap}
              lang={lang}
              accentColor="sky"
            />
            <StatTile
              label={w(lang, "adminActiveRecurring")}
              value={num(stats.activeRecurring, lang)}
              icon={IconRepeat}
              lang={lang}
              accentColor="violet"
            />
            <StatTile
              label={w(lang, "adminSuspendedUsers")}
              value={num(stats.suspendedUsers, lang)}
              icon={IconShield}
              lang={lang}
              accentColor={stats.suspendedUsers > 0 ? "danger" : "emerald"}
            />
            <StatTile
              label={w(lang, "adminSuperadminCount")}
              value={num(stats.superadminCount, lang)}
              icon={IconShield}
              lang={lang}
              accentColor="emerald"
            />
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <AdminCard title={w(lang, "adminQuickLinks")}>
          <nav className="grid grid-cols-2 gap-2">
            {ADMIN_NAV_SECTIONS.flatMap((section) => section.items)
              .filter((item) => item.to !== "/admin")
              .map(({ to, Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-2.5 rounded-control border border-line/50 bg-surface-2/40 px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-emerald/40 hover:bg-emerald/5"
                >
                  <Icon className="h-4 w-4 shrink-0 text-emerald" />
                  <span className="truncate">{label(lang)}</span>
                </Link>
              ))}
          </nav>
        </AdminCard>

        <AdminCard
          title={w(lang, "adminRecentActivity")}
          actions={
            <Link to="/admin/audit" className="text-xs font-bold text-emerald hover:underline">
              {w(lang, "adminViewAll")} →
            </Link>
          }
        >
          {audit && audit.items.length > 0 ? (
            <ul className="divide-y divide-line/30">
              {audit.items.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      <span className="font-mono text-xs text-emerald">{entry.action}</span>
                      {entry.targetLabel && (
                        <span className="ml-1.5 font-normal text-muted">{entry.targetLabel}</span>
                      )}
                    </p>
                    <p className="truncate font-en text-[11px] text-muted">
                      {entry.actorEmail ?? "—"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">
                    {formatDateTime(entry.createdAt, lang)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <AdminEmpty icon={IconHistory} messageKey="adminAuditEmpty" lang={lang} />
          )}
        </AdminCard>
      </div>
    </div>
  );
}
