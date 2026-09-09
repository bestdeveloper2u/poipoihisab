/**
 * /admin/audit — the admin action trail.
 *
 * Read-only by design. Before this existed, POST /admin/users/bulk-delete
 * cascaded permanent deletes with no record of who ran it or on whom; the
 * rows here are written in the same transaction as the action, so a 4xx
 * leaves no entry and a success cannot fail to leave one. There is no
 * endpoint that edits or deletes an entry — a trail an admin can rewrite
 * is not a trail.
 */
import { useEffect, useState, useTransition } from "react";
import { Link } from "react-router";
import type { AdminAuditList } from "@poipoihisab/api-client";
import { apiAdminAudit } from "@poipoihisab/api-client";
import { IconHistory, IconSearch } from "../../components/icons";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import {
  AdminBanner,
  AdminEmpty,
  AdminHeader,
  AdminLoading,
  formatDateTime,
  num,
} from "./shared";

const PAGE_SIZE = 50;

/** Destructive verbs read danger-red; everything else stays neutral. */
const DESTRUCTIVE = new Set([
  "user.delete",
  "user.bulk_delete",
  "user.suspend",
  "user.bulk_suspend",
  "category.merge",
]);

export function AdminAudit() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminAudit"));

  const [data, setData] = useState<AdminAuditList | null>(null);
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminAudit(
        {
          action: action || undefined,
          q: query.trim() || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
        lang,
      );
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
  }, [lang, action, query, page]);

  if (loading && !data) return <AdminLoading lang={lang} />;

  const total = data?.total ?? 0;
  const shown = data?.items.length ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-1 pb-12 pt-2">
      <AdminHeader
        icon={IconHistory}
        title={w(lang, "navAdminAudit")}
        subtitle={w(lang, "adminAuditSub")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={action}
              onChange={(e) => {
                setPage(0);
                setAction(e.target.value);
              }}
              aria-label={w(lang, "adminAuditAction")}
              className="rounded-control border border-line/60 bg-surface/70 px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-emerald focus:ring-2 focus:ring-emerald/20"
            >
              <option value="">{w(lang, "adminAuditAllActions")}</option>
              {(data?.actions ?? []).map((verb) => (
                <option key={verb} value={verb}>
                  {verb}
                </option>
              ))}
            </select>
            <div className="relative min-w-[220px]">
              <IconSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="search"
                placeholder={w(lang, "adminAuditSearchPh")}
                defaultValue={query}
                onChange={(e) => {
                  const val = e.target.value;
                  startTransition(() => {
                    setPage(0);
                    setQuery(val);
                  });
                }}
                className="w-full rounded-control border border-line/60 bg-surface/70 py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-emerald focus:bg-surface focus:ring-2 focus:ring-emerald/20"
              />
            </div>
          </div>
        }
      />

      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      <div className="glass-card overflow-hidden rounded-card">
        {shown === 0 ? (
          <AdminEmpty icon={IconHistory} messageKey="adminAuditEmpty" lang={lang} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line/40 bg-surface-2/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-3">{w(lang, "adminAuditWhen")}</th>
                    <th className="px-4 py-3">{w(lang, "adminAuditAction")}</th>
                    <th className="hidden px-4 py-3 md:table-cell">
                      {w(lang, "adminAuditActor")}
                    </th>
                    <th className="px-4 py-3">{w(lang, "adminAuditTarget")}</th>
                    <th className="px-4 py-3 text-right">{w(lang, "adminAuditAffected")}</th>
                    <th className="hidden px-4 py-3 lg:table-cell">
                      {w(lang, "adminAuditDetail")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/30">
                  {data?.items.map((entry) => (
                    <tr key={entry.id} className="transition-colors hover:bg-surface-2/40">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                        {formatDateTime(entry.createdAt, lang)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${
                            DESTRUCTIVE.has(entry.action)
                              ? "bg-danger/15 text-danger"
                              : "bg-emerald/15 text-emerald"
                          }`}
                        >
                          {entry.action}
                        </span>
                      </td>
                      <td className="hidden max-w-[14rem] truncate px-4 py-3 font-en text-xs text-muted md:table-cell">
                        {entry.actorEmail ?? "—"}
                        {entry.ip && <span className="ml-1.5 opacity-70">({entry.ip})</span>}
                      </td>
                      <td className="max-w-[16rem] px-4 py-3">
                        <span className="block truncate text-xs font-medium text-ink">
                          {entry.targetLabel ?? entry.targetType ?? "—"}
                        </span>
                        {entry.targetType === "user" && entry.targetId && (
                          /* The target may be deleted; the link is still
                             worth offering for a suspend/revoke row. */
                          <Link
                            to={`/admin/users/${entry.targetId}`}
                            className="font-mono text-[10px] text-emerald hover:underline"
                          >
                            {entry.targetId.slice(0, 8)}…
                          </Link>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">
                        {num(entry.affected, lang)}
                      </td>
                      <td className="hidden max-w-[22rem] px-4 py-3 text-xs text-muted lg:table-cell">
                        <span className="line-clamp-2">{entry.detail ?? "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line/40 px-4 py-2.5 text-xs text-muted">
              <span>
                {lang === "bn"
                  ? `${num(page * PAGE_SIZE + 1, lang)}–${num(page * PAGE_SIZE + shown, lang)} / ${num(total, lang)}`
                  : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + shown} of ${total}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-control border border-line/60 px-2.5 py-1 font-semibold text-ink disabled:opacity-40"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="rounded-control border border-line/60 px-2.5 py-1 font-semibold text-ink disabled:opacity-40"
                >
                  →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
