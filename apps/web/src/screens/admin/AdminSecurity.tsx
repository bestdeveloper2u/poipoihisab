/**
 * /admin/security — live sessions across every user.
 *
 * GET /auth/sessions is self-scoped, so before this page the only way to
 * end someone else's session was to suspend their account — which also
 * locks them out of their own hisab. Revoking sessions is the right tool
 * for a lost or shared device; suspension is a moderation decision.
 *
 * When the deployment falls back to in-process KV this list describes one
 * server instance, so the page says so rather than presenting it as truth.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { AdminSessionUser, AdminSessions } from "@poipoihisab/api-client";
import { apiAdminRevokeUserSessions, apiAdminSessions } from "@poipoihisab/api-client";
import { Modal } from "../../components/Modal";
import { IconActivity, IconLock, IconUsers } from "../../components/icons";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import {
  AdminBanner,
  AdminEmpty,
  AdminHeader,
  AdminLoading,
  StatTile,
  formatTtl,
  num,
} from "./shared";

export function AdminSecurity() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminSecurity"));

  const [data, setData] = useState<AdminSessions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminSessionUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminSessions(200, lang);
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
  }, [lang, reloadKey]);

  const revoke = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const res = await apiAdminRevokeUserSessions(pending.userId, lang);
    if (res.ok) {
      setSuccess(res.data.message);
      setTimeout(() => setSuccess(null), 4000);
      setReloadKey((k) => k + 1);
    } else {
      setError(res.detail);
    }
    setBusy(false);
    setPending(null);
  };

  if (loading && !data) return <AdminLoading lang={lang} />;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-1 pb-12 pt-2">
      <AdminHeader
        icon={IconLock}
        title={w(lang, "navAdminSecurity")}
        subtitle={w(lang, "adminSecuritySub")}
      />

      {success && <AdminBanner tone="success">{success}</AdminBanner>}
      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {data?.kvEphemeral && (
        <AdminBanner tone="warn">
          <div className="flex items-start gap-2.5">
            <IconActivity className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {lang === "bn"
                ? `সেশন স্টোর ${data.kvBackend} — প্রতিটি সার্ভার ইনস্ট্যান্স আলাদা, তাই এই তালিকা শুধু একটি ইনস্ট্যান্সের। POIPOIHISAB_KV_URL সেট করুন।`
                : `Session store is ${data.kvBackend}, which is per-process — this list reflects one server instance only. Set POIPOIHISAB_KV_URL.`}
            </p>
          </div>
        </AdminBanner>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <StatTile
            label={w(lang, "adminSessionsLive")}
            value={num(data.totalSessions, lang)}
            icon={IconLock}
            lang={lang}
            accentColor="emerald"
            hint={`${num(data.usersScanned, lang)} ${w(lang, "adminSessionsScanned")}`}
          />
          <StatTile
            label={w(lang, "adminSessionsUsers")}
            value={num(data.items.length, lang)}
            icon={IconUsers}
            lang={lang}
            accentColor="sky"
          />
        </div>
      )}

      <div className="glass-card overflow-hidden rounded-card">
        {!data || data.items.length === 0 ? (
          <AdminEmpty icon={IconLock} messageKey="adminSessionsEmpty" lang={lang} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line/40 bg-surface-2/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">{w(lang, "adminUserName")}</th>
                  <th className="hidden px-4 py-3 md:table-cell">{w(lang, "adminUserEmail")}</th>
                  <th className="px-4 py-3 text-center">{w(lang, "adminStatus")}</th>
                  <th className="px-4 py-3 text-right">{w(lang, "adminSessionCount")}</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">
                    {w(lang, "adminSessionExpiry")}
                  </th>
                  <th className="px-4 py-3 text-center">{w(lang, "adminUserActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {data.items.map((row) => (
                  <tr key={row.userId} className="transition-colors hover:bg-surface-2/40">
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <Link
                        to={`/admin/users/${row.userId}`}
                        className="font-semibold text-ink hover:text-emerald hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.isSuperadmin && (
                        <span className="ml-1.5 rounded-full bg-emerald/15 px-2 py-0.5 text-[10px] font-bold text-emerald">
                          {w(lang, "adminSuperAdminBadge")}
                        </span>
                      )}
                    </td>
                    <td className="hidden max-w-[16rem] truncate px-4 py-3.5 font-en text-xs text-muted md:table-cell">
                      {row.email ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      {row.isSuspended ? (
                        <span className="rounded-full bg-danger/15 px-2.5 py-0.5 text-[11px] font-bold text-danger">
                          {w(lang, "adminStatusSuspended")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald">
                          {w(lang, "adminStatusActive")}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-bold tabular-nums text-ink">
                      {num(row.sessionCount, lang)}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3.5 text-right text-xs text-muted sm:table-cell">
                      {formatTtl(row.maxExpiresIn, lang)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => setPending(row)}
                        className="inline-flex items-center gap-1.5 rounded-control border border-line/70 bg-surface/80 px-2.5 py-1 text-xs font-semibold text-ink transition-all hover:border-emerald/40 hover:bg-surface-2 active:scale-95"
                      >
                        <IconLock className="h-3.5 w-3.5 text-emerald" />
                        {w(lang, "adminRevokeSessions")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={Boolean(pending)}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        label={w(lang, "adminRevokeSessions")}
      >
        {pending && (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-emerald">
                <IconLock className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">{w(lang, "adminRevokeSessions")}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {w(lang, "adminRevokeConfirm")}
                </p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  {pending.name}
                  <span className="ml-1.5 text-xs font-normal text-muted">
                    ({num(pending.sessionCount, lang)} {w(lang, "adminSessionCount")})
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busy}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void revoke()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-control bg-emerald px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60"
              >
                {busy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {busy ? w(lang, "loading") : w(lang, "adminRevokeSessions")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
