/**
 * /admin/users/:userId — the per-user data inspector.
 *
 * Was a modal inside the monolithic Admin screen. Promoting it to a route
 * buys three things a modal cannot: an admin can link a colleague straight
 * at a user, the browser back button behaves, and the four detail fetches
 * are keyed by the URL instead of by a `selectedUserId` state variable.
 *
 * This is the one admin screen that reads an individual user's records, so
 * it is reached one deliberately chosen user at a time — the platform-wide
 * view on /admin/analytics stays aggregate-only.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type {
  AdminUserDebts,
  AdminUserDetail as AdminUserDetailData,
  AdminUserExpenses,
  AdminUserRecurring,
} from "@poipoihisab/api-client";
import {
  apiAdminDeleteUser,
  apiAdminGetUser,
  apiAdminGetUserDebts,
  apiAdminGetUserExpenses,
  apiAdminGetUserRecurring,
  apiAdminRevokeUserSessions,
  apiAdminSuspendUser,
} from "@poipoihisab/api-client";
import { Modal } from "../../components/Modal";
import {
  IconLock,
  IconReceipt,
  IconRepeat,
  IconShield,
  IconSwap,
  IconTrash,
  IconWallet,
} from "../../components/icons";
import { fmtTaka } from "../../lib/money";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useAuthStore } from "../../store/auth";
import { useLangStore } from "../../store/lang";
import { formatDate, num } from "./format";
import { AdminBanner, AdminCard, AdminEmpty, AdminLoading } from "./shared";

type Tab = "expenses" | "debts" | "budgets" | "recurring";
type PendingAction = "suspend" | "unsuspend" | "delete" | "revoke";

export function AdminUserDetail() {
  const lang = useLangStore((s) => s.lang);
  const currentUser = useAuthStore((s) => s.user);
  const { userId = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AdminUserDetailData | null>(null);
  const [expenses, setExpenses] = useState<AdminUserExpenses | null>(null);
  const [debts, setDebts] = useState<AdminUserDebts | null>(null);
  const [recurring, setRecurring] = useState<AdminUserRecurring | null>(null);
  const [tab, setTab] = useState<Tab>("expenses");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  usePageTitle(detail?.user.name ?? w(lang, "adminInspectTitle"));

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      setLoading(true);
      const [d, e, db, r] = await Promise.all([
        apiAdminGetUser(userId, lang),
        apiAdminGetUserExpenses(userId, { limit: 50 }, lang),
        apiAdminGetUserDebts(userId, lang),
        apiAdminGetUserRecurring(userId, lang),
      ]);
      if (!active) return;
      if (d.ok) setDetail(d.data);
      else setError(d.detail);
      if (e.ok) setExpenses(e.data);
      if (db.ok) setDebts(db.data);
      if (r.ok) setRecurring(r.data);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId, lang]);

  const flash = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 4000);
  };

  const runPending = async () => {
    if (!pending || !detail) return;
    setBusy(true);
    setError(null);

    if (pending === "delete") {
      const res = await apiAdminDeleteUser(userId, lang);
      setBusy(false);
      setPending(null);
      if (res.ok) {
        // Nothing left to show on this route — the record is gone.
        navigate("/admin/users", { replace: true });
        return;
      }
      setError(res.detail);
      return;
    }

    if (pending === "revoke") {
      const res = await apiAdminRevokeUserSessions(userId, lang);
      if (res.ok) flash(res.data.message);
      else setError(res.detail);
    } else {
      const suspended = pending === "suspend";
      const res = await apiAdminSuspendUser(userId, suspended, lang);
      if (res.ok) {
        setDetail({ ...detail, user: { ...detail.user, isSuspended: suspended } });
        flash(res.data.message);
      } else {
        setError(res.detail);
      }
    }
    setBusy(false);
    setPending(null);
  };

  if (loading) return <AdminLoading lang={lang} />;

  if (!detail) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-1 pt-6">
        <AdminBanner tone="error">{error ?? w(lang, "adminUserNotFound")}</AdminBanner>
        <Link to="/admin/users" className="text-sm font-semibold text-emerald hover:underline">
          ← {w(lang, "adminUsersTable")}
        </Link>
      </div>
    );
  }

  const u = detail.user;
  const isSelf = u.id === currentUser?.id || (!!u.email && u.email === currentUser?.email);
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "expenses", label: w(lang, "adminTabExpenses"), count: expenses?.items.length ?? 0 },
    { id: "debts", label: w(lang, "adminTabDebts"), count: debts?.items.length ?? 0 },
    { id: "budgets", label: w(lang, "adminTabBudgets") },
    { id: "recurring", label: w(lang, "adminTabRecurring"), count: recurring?.items.length ?? 0 },
  ];

  const confirmCopy: Record<PendingAction, { title: string; body: string; cta: string }> = {
    suspend: {
      title: w(lang, "adminSuspend"),
      body: w(lang, "adminConfirmSuspend"),
      cta: w(lang, "adminSuspend"),
    },
    unsuspend: {
      title: w(lang, "adminUnsuspend"),
      body: w(lang, "adminConfirmUnsuspend"),
      cta: w(lang, "adminUnsuspend"),
    },
    delete: {
      title: w(lang, "adminDelete"),
      body: w(lang, "adminConfirmDelete"),
      cta: w(lang, "adminDelete"),
    },
    revoke: {
      title: w(lang, "adminRevokeSessions"),
      body: w(lang, "adminRevokeConfirm"),
      cta: w(lang, "adminRevokeSessions"),
    },
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-1 pb-12 pt-2">
      <Link to="/admin/users" className="text-sm font-semibold text-emerald hover:underline">
        ← {w(lang, "adminUsersTable")}
      </Link>

      {success && <AdminBanner tone="success">{success}</AdminBanner>}
      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {/* Identity + moderation actions */}
      <div className="glass-card rounded-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-base font-bold text-emerald shadow-sm ring-2 ring-emerald/25">
              {(u.name.trim()[0] ?? "U").toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold text-ink">{u.name}</h1>
                {u.isSuperadmin && (
                  <span className="rounded-full bg-emerald/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald">
                    {w(lang, "adminSuperAdminBadge")}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    u.isSuspended ? "bg-danger/15 text-danger" : "bg-emerald/15 text-emerald"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${u.isSuspended ? "bg-danger" : "bg-emerald"}`}
                  />
                  {u.isSuspended
                    ? w(lang, "adminStatusSuspended")
                    : w(lang, "adminStatusActive")}
                </span>
              </div>
              <p className="mt-0.5 font-en text-xs text-muted">{u.email ?? "No email"}</p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-control border border-line/60 bg-surface-2/60 px-2.5 py-1 text-xs">
                <span className="select-all font-mono text-muted">ID: {u.id}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(u.id).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="font-semibold text-emerald transition-colors hover:underline"
                >
                  {copied
                    ? lang === "bn"
                      ? "✓ কপি হয়েছে!"
                      : "✓ Copied!"
                    : lang === "bn"
                      ? "কপি করুন"
                      : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                {w(lang, "adminUserJoined")}: {formatDate(u.createdAt, lang)}
              </p>
            </div>
          </div>

          {!isSelf && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Sign-out-everywhere sits beside suspend on purpose: it is the
                  right tool for a lost device, where suspending would also
                  lock the user out of their own hisab. */}
              <button
                type="button"
                onClick={() => setPending("revoke")}
                className="inline-flex items-center gap-1.5 rounded-control border border-line/70 bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink shadow-sm transition-all hover:border-emerald/40 hover:bg-surface-2 active:scale-95"
              >
                <IconLock className="h-3.5 w-3.5 text-emerald" />
                {w(lang, "adminRevokeSessions")}
              </button>
              <button
                type="button"
                onClick={() => setPending(u.isSuspended ? "unsuspend" : "suspend")}
                className={`rounded-control px-3 py-1.5 text-xs font-semibold shadow-sm transition-all hover:brightness-105 active:scale-95 ${
                  u.isSuspended
                    ? "bg-emerald/15 text-emerald hover:bg-emerald/25"
                    : "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                }`}
              >
                {u.isSuspended ? w(lang, "adminUnsuspend") : w(lang, "adminSuspend")}
              </button>
              <button
                type="button"
                onClick={() => setPending("delete")}
                className="rounded-control bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 active:scale-95"
              >
                {w(lang, "adminDelete")}
              </button>
            </div>
          )}
        </div>

        {/* Financial summary */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 border-t border-line/40 pt-4 sm:grid-cols-4">
          {[
            { label: w(lang, "adminTabExpenses"), value: num(u.expenseCount, lang) },
            { label: w(lang, "adminUserTotalSpent"), value: fmtTaka(u.totalExpense, lang) },
            { label: w(lang, "adminMonthVolume"), value: fmtTaka(detail.currentMonthExpense, lang) },
            { label: w(lang, "adminTabDebts"), value: num(u.debtCount, lang) },
            { label: w(lang, "adminDebtLend"), value: fmtTaka(detail.totalLend, lang) },
            { label: w(lang, "adminDebtBorrow"), value: fmtTaka(detail.totalBorrow, lang) },
            { label: lang === "bn" ? "নিট" : "Net", value: fmtTaka(detail.netDebt, lang) },
            { label: w(lang, "adminTabRecurring"), value: num(u.recurringCount, lang) },
          ].map((cell) => (
            <div key={cell.label} className="rounded-control bg-surface-2/50 p-2.5">
              <span className="text-[11px] font-semibold text-muted">{cell.label}</span>
              <p className="mt-1 text-base font-extrabold tabular-nums text-ink">{cell.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Record tabs */}
      <div className="glass-card rounded-card">
        <div
          role="tablist"
          aria-label={w(lang, "adminInspectTitle")}
          className="flex gap-1 overflow-x-auto border-b border-line/50 px-3 pt-3"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap rounded-t-control px-3.5 py-2 text-sm font-semibold transition-colors ${
                tab === t.id
                  ? "border-b-2 border-emerald bg-emerald/5 text-emerald"
                  : "text-muted hover:bg-surface-2/60 hover:text-ink"
              }`}
            >
              {t.label}
              {t.count !== undefined && ` (${num(t.count, lang)})`}
            </button>
          ))}
        </div>

        <div className="p-3 sm:p-4">
          {tab === "expenses" &&
            (expenses && expenses.items.length > 0 ? (
              <div className="overflow-x-auto rounded-card border border-line/40">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line/40 bg-surface-2/50 text-[11px] font-bold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3.5 py-2.5">{w(lang, "dateLabel")}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "catLabel")}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "grpLabel")}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "descLabel")}</th>
                      <th className="px-3.5 py-2.5 text-right">{w(lang, "amtLabel")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/20">
                    {expenses.items.map((exp) => (
                      <tr key={exp.id} className="transition-colors hover:bg-surface-2/30">
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-muted">{exp.iso}</td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-medium text-ink">
                          {exp.cat}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-muted">{exp.grp}</td>
                        <td className="max-w-[14rem] truncate px-3.5 py-2.5 text-muted">
                          {exp.desc ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-bold tabular-nums text-ink">
                          {fmtTaka(exp.amt, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AdminEmpty icon={IconReceipt} messageKey="adminNoData" lang={lang} />
            ))}

          {tab === "debts" &&
            (debts && debts.items.length > 0 ? (
              <div className="overflow-x-auto rounded-card border border-line/40">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line/40 bg-surface-2/50 text-[11px] font-bold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3.5 py-2.5">
                        {lang === "bn" ? "ব্যক্তি / প্রতিষ্ঠান" : "Party"}
                      </th>
                      <th className="px-3.5 py-2.5">{lang === "bn" ? "ধরন" : "Direction"}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "descLabel")}</th>
                      <th className="px-3.5 py-2.5">{lang === "bn" ? "স্ট্যাটাস" : "Status"}</th>
                      <th className="px-3.5 py-2.5 text-right">{w(lang, "amtLabel")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/20">
                    {debts.items.map((debt) => (
                      <tr key={debt.id} className="transition-colors hover:bg-surface-2/30">
                        <td className="px-3.5 py-2.5 font-medium text-ink">{debt.party}</td>
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              debt.dir === "lend"
                                ? "bg-emerald/15 text-emerald"
                                : "bg-danger/15 text-danger"
                            }`}
                          >
                            {debt.dir === "lend"
                              ? lang === "bn"
                                ? "পাবো"
                                : "Lend"
                              : lang === "bn"
                                ? "দেবো"
                                : "Borrow"}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-muted">{debt.note ?? "—"}</td>
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              debt.settled_at
                                ? "bg-muted/15 text-muted line-through"
                                : "bg-amber-500/15 font-bold text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {debt.settled_at
                              ? lang === "bn"
                                ? "পরিশোধিত"
                                : "Settled"
                              : lang === "bn"
                                ? "বাকি"
                                : "Pending"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-bold tabular-nums text-ink">
                          {fmtTaka(debt.amt, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AdminEmpty icon={IconSwap} messageKey="adminNoData" lang={lang} />
            ))}

          {tab === "budgets" &&
            (detail.budget ? (
              <div className="space-y-4">
                <div className="rounded-card border border-line/50 bg-surface-2/40 p-4">
                  <span className="text-xs font-semibold text-muted">
                    {lang === "bn" ? "মাসিক মোট বাজেট" : "Monthly total budget"}
                  </span>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">
                    {fmtTaka(detail.budget.total, lang)}
                  </p>
                </div>
                {Object.keys(detail.budget.cats ?? {}).length > 0 && (
                  <div>
                    <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted">
                      {lang === "bn" ? "খাতভিত্তিক বাজেট" : "Category limits"}
                    </h3>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {Object.entries(detail.budget.cats).map(([cat, limit]) => (
                        <div
                          key={cat}
                          className="rounded-control border border-line/40 bg-surface-2/50 p-3"
                        >
                          <span className="text-xs font-medium text-muted">{cat}</span>
                          <p className="mt-1 font-bold tabular-nums text-ink">
                            {fmtTaka(limit, lang)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <AdminEmpty icon={IconWallet} messageKey="noBudget" lang={lang} />
            ))}

          {tab === "recurring" &&
            (recurring && recurring.items.length > 0 ? (
              <div className="overflow-x-auto rounded-card border border-line/40">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line/40 bg-surface-2/50 text-[11px] font-bold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="px-3.5 py-2.5">{w(lang, "catLabel")}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "rFreq")}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "rNext")}</th>
                      <th className="px-3.5 py-2.5">{w(lang, "rActive")}</th>
                      <th className="px-3.5 py-2.5 text-right">{w(lang, "amtLabel")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/20">
                    {recurring.items.map((rule) => (
                      <tr key={rule.id} className="transition-colors hover:bg-surface-2/30">
                        <td className="px-3.5 py-2.5 font-medium text-ink">{rule.cat}</td>
                        <td className="px-3.5 py-2.5 text-muted">{rule.freq}</td>
                        <td className="px-3.5 py-2.5 text-muted">{rule.next_run}</td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              rule.active
                                ? "bg-emerald/15 text-emerald"
                                : "bg-muted/15 text-muted"
                            }`}
                          >
                            {rule.active ? w(lang, "adminStatusActive") : w(lang, "rActive")}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-ink">
                          {fmtTaka(rule.amt, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AdminEmpty icon={IconRepeat} messageKey="adminNoData" lang={lang} />
            ))}
        </div>
      </div>

      {expenses && expenses.total > expenses.items.length && (
        <AdminCard>
          <p className="text-xs text-muted">
            {lang === "bn"
              ? `সাম্প্রতিক ${num(expenses.items.length, lang)}টি এন্ট্রি দেখানো হচ্ছে (মোট ${num(expenses.total, lang)})`
              : `Showing the ${expenses.items.length} most recent entries of ${expenses.total}`}
          </p>
        </AdminCard>
      )}

      <Modal
        open={Boolean(pending)}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        label={pending ? confirmCopy[pending].title : ""}
      >
        {pending && (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  pending === "delete"
                    ? "bg-danger/15 text-danger"
                    : pending === "suspend"
                      ? "bg-warning/15 text-warning"
                      : "bg-emerald/15 text-emerald"
                }`}
              >
                {pending === "delete" ? (
                  <IconTrash className="h-5 w-5" />
                ) : pending === "revoke" ? (
                  <IconLock className="h-5 w-5" />
                ) : (
                  <IconShield className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">{confirmCopy[pending].title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {confirmCopy[pending].body}
                </p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  {u.name}
                  {u.email && <span className="ml-1 font-en text-xs text-muted">{u.email}</span>}
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
                onClick={() => void runPending()}
                disabled={busy}
                className={`inline-flex items-center gap-2 rounded-control px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60 ${
                  pending === "delete"
                    ? "bg-danger"
                    : pending === "suspend"
                      ? "bg-warning"
                      : "bg-emerald"
                }`}
              >
                {busy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {busy ? w(lang, "loading") : confirmCopy[pending].cta}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
