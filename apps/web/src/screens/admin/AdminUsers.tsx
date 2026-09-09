/**
 * /admin/users — the registered-user roster.
 *
 * Split out of the pre-2026-09-09 monolithic Admin screen. What used to be
 * one page is now: KPI tiles on /admin, CSV import/export on /admin/data,
 * and the per-user inspector at /admin/users/:userId (a real route, so an
 * admin can link a colleague straight at a user). What stays here is the
 * roster itself, its search, and the single + bulk moderation actions.
 */
import { useEffect, useState, useTransition } from "react";
import { Link, useNavigate } from "react-router";
import type { AdminUserItem } from "@poipoihisab/api-client";
import {
  apiAdminBulkDeleteUsers,
  apiAdminBulkSuspendUsers,
  apiAdminDeleteUser,
  apiAdminListUsers,
  apiAdminSuspendUser,
} from "@poipoihisab/api-client";
import { Modal } from "../../components/Modal";
import { IconSearch, IconShield, IconTrash, IconUsers } from "../../components/icons";
import { fmtTaka } from "../../lib/money";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useAuthStore } from "../../store/auth";
import { useLangStore } from "../../store/lang";
import { formatDate, num } from "./format";
import { AdminBanner, AdminEmpty, AdminHeader } from "./shared";

const PAGE_SIZE = 50;

type ActionType = "suspend" | "unsuspend" | "delete";

interface ConfirmState {
  type: ActionType;
  user: { id: string; name: string; email: string | null };
}

interface BulkConfirmState {
  type: ActionType;
  userIds: string[];
  userNames: string[];
}

export function AdminUsers() {
  const lang = useLangStore((s) => s.lang);
  const currentUser = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  usePageTitle(w(lang, "navAdminUsers"));

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirmState | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminListUsers(
        { q: searchQuery.trim() || undefined, limit: PAGE_SIZE },
        lang,
      );
      if (!active) return;
      if (res.ok) {
        setUsers(res.data.items);
        setTotal(res.data.total);
        setError(null);
      } else {
        setError(res.detail);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [lang, searchQuery]);

  const flash = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 4000);
  };

  const runAction = async () => {
    if (!confirm) return;
    setActionBusy(true);
    setError(null);
    const { type, user: target } = confirm;

    if (type === "delete") {
      const res = await apiAdminDeleteUser(target.id, lang);
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== target.id));
        setTotal((c) => Math.max(0, c - 1));
        flash(res.data.message);
      } else {
        setError(res.detail);
      }
    } else {
      const suspended = type === "suspend";
      const res = await apiAdminSuspendUser(target.id, suspended, lang);
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === target.id ? { ...u, isSuspended: suspended } : u)),
        );
        flash(res.data.message);
      } else {
        setError(res.detail);
      }
    }
    setActionBusy(false);
    setConfirm(null);
  };

  const runBulkAction = async () => {
    if (!bulkConfirm) return;
    setBulkBusy(true);
    setError(null);
    const { type, userIds } = bulkConfirm;
    const targets = new Set(userIds);

    if (type === "delete") {
      const res = await apiAdminBulkDeleteUsers(userIds, lang);
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => !targets.has(u.id)));
        setTotal((c) => Math.max(0, c - res.data.affectedCount));
        setSelectedIds(new Set());
        flash(res.data.message);
      } else {
        setError(res.detail);
      }
    } else {
      const suspended = type === "suspend";
      const res = await apiAdminBulkSuspendUsers(userIds, suspended, lang);
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (targets.has(u.id) ? { ...u, isSuspended: suspended } : u)),
        );
        setSelectedIds(new Set());
        flash(res.data.message);
      } else {
        setError(res.detail);
      }
    }
    setBulkBusy(false);
    setBulkConfirm(null);
  };

  /* Own account is never selectable: the API refuses self-suspend and
     self-delete, so offering the checkbox would only mislead. */
  const isSelf = (u: AdminUserItem) =>
    u.id === currentUser?.id || (!!u.email && u.email === currentUser?.email);
  const selectable = users.filter((u) => !isSelf(u));
  const allSelected = selectable.length > 0 && selectable.every((u) => selectedIds.has(u.id));
  const indeterminate = selectedIds.size > 0 && !allSelected;

  const openBulk = (type: ActionType) =>
    setBulkConfirm({
      type,
      userIds: Array.from(selectedIds),
      userNames: users.filter((u) => selectedIds.has(u.id)).map((u) => u.name),
    });

  const actionLabel = (type: ActionType) =>
    type === "delete"
      ? w(lang, "adminDelete")
      : type === "suspend"
        ? w(lang, "adminSuspend")
        : w(lang, "adminUnsuspend");

  const bulkLabel = (type: ActionType) =>
    type === "delete"
      ? w(lang, "adminBulkDelete")
      : type === "suspend"
        ? w(lang, "adminBulkSuspend")
        : w(lang, "adminBulkUnsuspend");

  return (
    <div className="w-full space-y-5 pb-12 pt-2">
      <AdminHeader
        icon={IconUsers}
        title={w(lang, "adminUsersTable")}
        subtitle={
          lang === "bn"
            ? `মোট ${num(total, lang)} জন নিবন্ধিত ব্যবহারকারী`
            : `${total} registered users total`
        }
        actions={
          <div className="relative min-w-[220px]">
            <IconSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="search"
              placeholder={w(lang, "adminSearchPlaceholder")}
              defaultValue={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                startTransition(() => setSearchQuery(val));
              }}
              className="w-full rounded-control border border-line/60 bg-surface/70 py-2 pl-9 pr-3 text-sm text-ink outline-none transition-all placeholder:text-muted focus:border-emerald focus:bg-surface focus:ring-2 focus:ring-emerald/20"
            />
          </div>
        }
      />

      {success && <AdminBanner tone="success">{success}</AdminBanner>}
      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      <div className="glass-card overflow-hidden rounded-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line/40 bg-surface-2/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = indeterminate;
                    }}
                    onChange={() =>
                      setSelectedIds(
                        allSelected ? new Set() : new Set(selectable.map((u) => u.id)),
                      )
                    }
                    disabled={selectable.length === 0}
                    aria-label={w(lang, "adminSelectAll")}
                    className="h-4 w-4 cursor-pointer rounded border-line accent-emerald text-emerald focus:ring-emerald disabled:cursor-not-allowed disabled:opacity-30"
                  />
                </th>
                <th className="px-4 py-3">{w(lang, "adminUserName")}</th>
                <th className="hidden px-4 py-3 md:table-cell">{w(lang, "adminUserEmail")}</th>
                <th className="px-4 py-3 text-center">{w(lang, "adminStatus")}</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">
                  {w(lang, "adminUserExpensesCount")}
                </th>
                <th className="px-4 py-3 text-right">{w(lang, "adminUserTotalSpent")}</th>
                <th className="hidden px-4 py-3 lg:table-cell">{w(lang, "adminUserJoined")}</th>
                <th className="px-4 py-3 text-center">{w(lang, "adminUserActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2 text-muted" role="status">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted/30 border-t-emerald" />
                      <span className="text-sm">{w(lang, "loading")}</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-4">
                    <AdminEmpty icon={IconUsers} messageKey="adminNoData" lang={lang} />
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const self = isSelf(u);
                  const initial = (u.name.trim()[0] ?? "U").toUpperCase();
                  return (
                    <tr
                      key={u.id}
                      className={`group transition-colors hover:bg-surface-2/40 ${
                        selectedIds.has(u.id) ? "bg-emerald/5" : ""
                      }`}
                    >
                      <td className="w-10 whitespace-nowrap px-4 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(u.id)}
                          disabled={self}
                          onChange={() =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(u.id)) next.delete(u.id);
                              else next.add(u.id);
                              return next;
                            })
                          }
                          aria-label={`Select ${u.name}`}
                          title={self ? w(lang, "adminSelfActionDenied") : undefined}
                          className="h-4 w-4 cursor-pointer rounded border-line accent-emerald text-emerald focus:ring-emerald disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <Link
                            to={`/admin/users/${u.id}`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-xs font-bold text-emerald transition-transform hover:scale-105"
                            aria-hidden="true"
                            tabIndex={-1}
                          >
                            {initial}
                          </Link>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link
                                to={`/admin/users/${u.id}`}
                                className="text-left font-semibold text-ink hover:text-emerald hover:underline"
                              >
                                {u.name}
                              </Link>
                              {u.isSuperadmin && (
                                <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-[10px] font-bold text-emerald">
                                  {w(lang, "adminSuperAdminBadge")}
                                </span>
                              )}
                            </div>
                            <span className="block truncate text-[11px] text-muted md:hidden">
                              {u.email ?? "—"}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="hidden whitespace-nowrap px-4 py-3.5 font-en text-xs text-muted md:table-cell">
                        {u.email ?? "—"}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        {u.isSuspended ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-0.5 text-[11px] font-bold text-danger">
                            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                            {w(lang, "adminStatusSuspended")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                            {w(lang, "adminStatusActive")}
                          </span>
                        )}
                      </td>

                      <td className="hidden whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-ink sm:table-cell">
                        {num(u.expenseCount, lang)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-ink">
                        {fmtTaka(u.totalExpense, lang)}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3.5 text-xs text-muted lg:table-cell">
                        {formatDate(u.createdAt, lang)}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/admin/users/${u.id}`)}
                            className="inline-flex items-center gap-1 rounded-control bg-emerald px-2.5 py-1 text-xs font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-95"
                          >
                            {w(lang, "adminInspect")}
                          </button>
                          {!self && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirm({
                                  type: u.isSuspended ? "unsuspend" : "suspend",
                                  user: { id: u.id, name: u.name, email: u.email },
                                })
                              }
                              className={`rounded-control px-2 py-1 text-xs font-semibold transition-all hover:brightness-105 active:scale-95 ${
                                u.isSuspended
                                  ? "bg-emerald/15 text-emerald hover:bg-emerald/25"
                                  : "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                              }`}
                            >
                              {u.isSuspended ? w(lang, "adminUnsuspend") : w(lang, "adminSuspend")}
                            </button>
                          )}
                          {!self && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirm({
                                  type: "delete",
                                  user: { id: u.id, name: u.name, email: u.email },
                                })
                              }
                              className="rounded-control p-1 text-danger/80 hover:bg-danger/10 hover:text-danger active:scale-95"
                              title={w(lang, "adminDelete")}
                              aria-label={`${w(lang, "adminDelete")} — ${u.name}`}
                            >
                              <IconTrash className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {total > users.length && (
          <p className="border-t border-line/40 px-4 py-2.5 text-xs text-muted">
            {lang === "bn"
              ? `${num(users.length, lang)} / ${num(total, lang)} জন দেখানো হচ্ছে — খুঁজে নির্দিষ্ট করুন`
              : `Showing ${users.length} of ${total} — narrow with search`}
          </p>
        )}
      </div>

      {/* Single-user confirmation */}
      <Modal open={Boolean(confirm)} onClose={() => setConfirm(null)} label={confirm ? actionLabel(confirm.type) : ""}>
        {confirm && (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  confirm.type === "delete"
                    ? "bg-danger/15 text-danger"
                    : confirm.type === "suspend"
                      ? "bg-warning/15 text-warning"
                      : "bg-emerald/15 text-emerald"
                }`}
              >
                {confirm.type === "delete" ? (
                  <IconTrash className="h-5 w-5" />
                ) : (
                  <IconShield className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">{actionLabel(confirm.type)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {confirm.type === "delete"
                    ? w(lang, "adminConfirmDelete")
                    : confirm.type === "suspend"
                      ? w(lang, "adminConfirmSuspend")
                      : w(lang, "adminConfirmUnsuspend")}
                </p>
              </div>
            </div>

            <div className="rounded-card border border-line/60 bg-surface-2/50 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-xs font-bold text-emerald">
                  {(confirm.user.name.trim()[0] ?? "U").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{confirm.user.name}</p>
                  {confirm.user.email && (
                    <p className="truncate font-en text-xs text-muted">{confirm.user.email}</p>
                  )}
                </div>
              </div>
              <p className="mt-2 border-t border-line/40 pt-2 font-mono text-[11px] text-muted">
                ID: {confirm.user.id}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={actionBusy}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void runAction()}
                disabled={actionBusy}
                className={`inline-flex items-center gap-2 rounded-control px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60 ${
                  confirm.type === "delete"
                    ? "bg-danger"
                    : confirm.type === "suspend"
                      ? "bg-warning"
                      : "bg-emerald"
                }`}
              >
                {actionBusy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {actionBusy ? w(lang, "loading") : actionLabel(confirm.type)}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Floating bulk bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-card border border-line/70 bg-surface/95 px-4 py-2.5 shadow-2xl backdrop-blur-md sm:gap-3.5 sm:rounded-full sm:px-5 sm:py-3 lg:bottom-6">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald text-xs font-bold text-accent-ink">
              {num(selectedIds.size, lang)}
            </span>
            <span className="text-xs font-semibold text-ink sm:text-sm">
              {w(lang, "adminSelectedCount")}
            </span>
          </div>
          <div className="hidden h-4 w-px bg-line/60 sm:block" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => openBulk("suspend")}
              className="rounded-control bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning transition-all hover:bg-warning/25 active:scale-95"
            >
              {w(lang, "adminBulkSuspend")}
            </button>
            <button
              type="button"
              onClick={() => openBulk("unsuspend")}
              className="rounded-control bg-emerald/15 px-3 py-1.5 text-xs font-semibold text-emerald transition-all hover:bg-emerald/25 active:scale-95"
            >
              {w(lang, "adminBulkUnsuspend")}
            </button>
            <button
              type="button"
              onClick={() => openBulk("delete")}
              className="rounded-control bg-danger px-3 py-1.5 text-xs font-semibold text-accent-ink transition-all hover:bg-danger/90 active:scale-95"
            >
              {w(lang, "adminBulkDelete")}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="rounded-control px-2.5 py-1.5 text-xs font-medium text-muted transition-all hover:bg-surface-2 hover:text-ink"
            >
              ✕ {w(lang, "adminClearSelection")}
            </button>
          </div>
        </div>
      )}

      {/* Bulk confirmation */}
      <Modal
        open={Boolean(bulkConfirm)}
        onClose={() => {
          if (!bulkBusy) setBulkConfirm(null);
        }}
        label={bulkConfirm ? bulkLabel(bulkConfirm.type) : ""}
      >
        {bulkConfirm && (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  bulkConfirm.type === "delete"
                    ? "bg-danger/15 text-danger"
                    : bulkConfirm.type === "suspend"
                      ? "bg-warning/15 text-warning"
                      : "bg-emerald/15 text-emerald"
                }`}
              >
                {bulkConfirm.type === "delete" ? (
                  <IconTrash className="h-5 w-5" />
                ) : (
                  <IconShield className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">{bulkLabel(bulkConfirm.type)}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {bulkConfirm.type === "delete"
                    ? w(lang, "adminBulkConfirmDelete")
                    : bulkConfirm.type === "suspend"
                      ? w(lang, "adminBulkConfirmSuspend")
                      : w(lang, "adminBulkConfirmUnsuspend")}
                </p>
              </div>
            </div>

            <div className="rounded-card border border-line/60 bg-surface-2/50 p-3">
              <div className="flex items-center justify-between border-b border-line/40 pb-2">
                <span className="text-xs font-semibold text-muted">
                  {lang === "bn" ? "প্রভাবিত ব্যবহারকারী তালিকা" : "Affected users"}
                </span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold tabular-nums text-ink">
                  {num(bulkConfirm.userIds.length, lang)}
                </span>
              </div>
              <div className="mt-2 max-h-44 divide-y divide-line/30 overflow-y-auto pr-1 text-xs">
                {bulkConfirm.userNames.map((name, i) => (
                  <div key={bulkConfirm.userIds[i]} className="flex items-center justify-between py-1.5">
                    <span className="font-semibold text-ink">{name}</span>
                    <span className="max-w-[140px] truncate font-mono text-[10px] text-muted">
                      {bulkConfirm.userIds[i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
              <button
                type="button"
                onClick={() => setBulkConfirm(null)}
                disabled={bulkBusy}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void runBulkAction()}
                disabled={bulkBusy}
                className={`inline-flex items-center gap-2 rounded-control px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60 ${
                  bulkConfirm.type === "delete"
                    ? "bg-danger"
                    : bulkConfirm.type === "suspend"
                      ? "bg-warning"
                      : "bg-emerald"
                }`}
              >
                {bulkBusy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {bulkBusy ? w(lang, "loading") : bulkLabel(bulkConfirm.type)}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
