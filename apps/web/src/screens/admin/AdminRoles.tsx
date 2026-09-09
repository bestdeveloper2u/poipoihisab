/**
 * /admin/roles — who can reach the admin area, and from where.
 *
 * Two things grant superadmin, and they behave differently:
 *
 *  - the ``profiles.is_superadmin`` column, which this page can change; and
 *  - ``POIPOIHISAB_SUPERADMIN_EMAILS``, deployment config that outranks the
 *    column and can only be changed by editing the env var and redeploying.
 *
 * Conflating them is how an admin ends up believing they revoked access
 * they did not, so each row states its source explicitly. The page also
 * warns when the database carries NO admin flag at all: everything works
 * until that env var changes, and then nobody can get in.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { AdminSystem, AdminUserItem } from "@poipoihisab/api-client";
import { apiAdminListUsers, apiAdminSetUserRole, apiAdminSystem } from "@poipoihisab/api-client";
import { Modal } from "../../components/Modal";
import { IconShield, IconUsers } from "../../components/icons";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useAuthStore } from "../../store/auth";
import { useLangStore } from "../../store/lang";
import {
  AdminBanner,
  AdminCard,
  AdminEmpty,
  AdminHeader,
  AdminLoading,
  formatDate,
} from "./shared";

interface Pending {
  user: AdminUserItem;
  grant: boolean;
}

export function AdminRoles() {
  const lang = useLangStore((s) => s.lang);
  const currentUser = useAuthStore((s) => s.user);
  usePageTitle(w(lang, "navAdminRoles"));

  const [admins, setAdmins] = useState<AdminUserItem[]>([]);
  const [candidates, setCandidates] = useState<AdminUserItem[]>([]);
  const [system, setSystem] = useState<AdminSystem | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const [list, sys] = await Promise.all([
        apiAdminListUsers({ limit: 200 }, lang),
        apiAdminSystem(lang),
      ]);
      if (!active) return;
      if (list.ok) {
        setAdmins(list.data.items.filter((u) => u.isSuperadmin));
        setCandidates(list.data.items.filter((u) => !u.isSuperadmin));
        setError(null);
      } else {
        setError(list.detail);
      }
      if (sys.ok) setSystem(sys.data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [lang, reloadKey]);

  const envEmails = (system?.superadminEmails ?? []).map((e) => e.toLowerCase());
  const grantedByEnv = (u: AdminUserItem) =>
    !!u.email && envEmails.includes(u.email.toLowerCase());
  /* An admin listed only in the env var has no durable record: if the
     variable changes, their access disappears with it. */
  const dbFlagged = admins.filter((u) => !grantedByEnv(u));

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const res = await apiAdminSetUserRole(pending.user.id, pending.grant, lang);
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

  if (loading && admins.length === 0 && candidates.length === 0) {
    return <AdminLoading lang={lang} />;
  }

  const filtered = search.trim()
    ? candidates.filter((u) => {
        const needle = search.trim().toLowerCase();
        return (
          u.name.toLowerCase().includes(needle) ||
          (u.email ?? "").toLowerCase().includes(needle)
        );
      })
    : candidates.slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-1 pb-12 pt-2">
      <AdminHeader
        icon={IconShield}
        title={w(lang, "navAdminRoles")}
        subtitle={w(lang, "adminRolesSub")}
      />

      {success && <AdminBanner tone="success">{success}</AdminBanner>}
      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {dbFlagged.length === 0 && (
        <AdminBanner tone="warn">{w(lang, "adminRoleNoAdmins")}</AdminBanner>
      )}

      <AdminCard
        title={w(lang, "adminSuperadminCount")}
        hint={w(lang, "adminRoleEnvNote")}
      >
        {admins.length === 0 ? (
          <AdminEmpty icon={IconShield} messageKey="adminNoData" lang={lang} />
        ) : (
          <ul className="divide-y divide-line/30">
            {admins.map((u) => {
              const viaEnv = grantedByEnv(u);
              const self = u.id === currentUser?.id;
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-xs font-bold text-emerald">
                    {(u.name.trim()[0] ?? "U").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                      <Link to={`/admin/users/${u.id}`} className="hover:text-emerald hover:underline">
                        {u.name}
                      </Link>
                      {self && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted">
                          {lang === "bn" ? "আপনি" : "you"}
                        </span>
                      )}
                    </p>
                    <p className="truncate font-en text-xs text-muted">{u.email ?? "—"}</p>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {w(lang, "adminRoleSource")}
                    </span>
                    <span
                      className={`text-xs font-bold ${viaEnv ? "text-warning" : "text-emerald"}`}
                    >
                      {viaEnv ? w(lang, "adminRoleSourceEnv") : w(lang, "adminRoleSourceDb")}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={self || viaEnv}
                    title={
                      viaEnv
                        ? w(lang, "adminRoleEnvNote")
                        : self
                          ? w(lang, "adminSelfActionDenied")
                          : undefined
                    }
                    onClick={() => setPending({ user: u, grant: false })}
                    className="rounded-control bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {w(lang, "adminRoleRevoke")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {envEmails.length > 0 && (
          <div className="mt-3 rounded-control border border-line/50 bg-surface-2/40 p-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
              {w(lang, "adminRoleEnvList")}
            </span>
            <p className="mt-1 break-all font-en text-xs text-ink">{envEmails.join(", ")}</p>
          </div>
        )}
      </AdminCard>

      <AdminCard
        title={w(lang, "adminRoleGrant")}
        actions={
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={w(lang, "adminSearchPlaceholder")}
            className="min-w-[200px] rounded-control border border-line/60 bg-surface/70 px-3 py-1.5 text-sm text-ink outline-none placeholder:text-muted focus:border-emerald focus:ring-2 focus:ring-emerald/20"
          />
        }
      >
        {filtered.length === 0 ? (
          <AdminEmpty icon={IconUsers} messageKey="adminNoData" lang={lang} />
        ) : (
          <ul className="divide-y divide-line/30">
            {filtered.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{u.name}</p>
                  <p className="truncate font-en text-xs text-muted">
                    {u.email ?? "—"} · {formatDate(u.createdAt, lang)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPending({ user: u, grant: true })}
                  className="rounded-control bg-emerald px-3 py-1.5 text-xs font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-95"
                >
                  {w(lang, "adminRoleGrant")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!search.trim() && candidates.length > filtered.length && (
          <p className="mt-2 text-xs text-muted">
            {lang === "bn"
              ? "আরও ব্যবহারকারী দেখতে খুঁজুন।"
              : "Search to reach the other users."}
          </p>
        )}
      </AdminCard>

      <Modal
        open={Boolean(pending)}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        label={pending?.grant ? w(lang, "adminRoleGrant") : w(lang, "adminRoleRevoke")}
      >
        {pending && (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  pending.grant ? "bg-emerald/15 text-emerald" : "bg-danger/15 text-danger"
                }`}
              >
                <IconShield className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">
                  {pending.grant ? w(lang, "adminRoleGrant") : w(lang, "adminRoleRevoke")}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {pending.grant
                    ? w(lang, "adminRoleConfirmGrant")
                    : w(lang, "adminRoleConfirmRevoke")}
                </p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  {pending.user.name}
                  {pending.user.email && (
                    <span className="ml-1 font-en text-xs text-muted">{pending.user.email}</span>
                  )}
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
                onClick={() => void apply()}
                disabled={busy}
                className={`inline-flex items-center gap-2 rounded-control px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60 ${
                  pending.grant ? "bg-emerald" : "bg-danger"
                }`}
              >
                {busy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {busy
                  ? w(lang, "loading")
                  : pending.grant
                    ? w(lang, "adminRoleGrant")
                    : w(lang, "adminRoleRevoke")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
