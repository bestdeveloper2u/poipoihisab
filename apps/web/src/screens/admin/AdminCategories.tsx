/**
 * /admin/categories — the expense taxonomy as it actually exists.
 *
 * `expenses.cat` is free text: no foreign key, no check constraint, and the
 * API accepts any 1-80 character string. It is also what the Bengali voice
 * parser writes and what every report groups by, so "রিক্সা" and "রিকশা"
 * are two categories to the database and one thing to a human. This page
 * surfaces that drift and repairs it — the merge rewrites rows for EVERY
 * user, which is why it asks twice and is written to the audit trail.
 */
import { useEffect, useState } from "react";
import type { AdminCategoryItem } from "@poipoihisab/api-client";
import { apiAdminCategories, apiAdminMergeCategory } from "@poipoihisab/api-client";
import { Modal } from "../../components/Modal";
import { IconReceipt } from "../../components/icons";
import { fmtTaka } from "../../lib/money";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import {
  AdminBanner,
  AdminEmpty,
  AdminHeader,
  AdminLoading,
  ShareBar,
  num,
} from "./shared";

export function AdminCategories() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminCategories"));

  const [items, setItems] = useState<AdminCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState<AdminCategoryItem | null>(null);
  const [mergeTo, setMergeTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const res = await apiAdminCategories(lang);
      if (!active) return;
      if (res.ok) {
        setItems(res.data.items);
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

  const runMerge = async () => {
    if (!mergeFrom || !mergeTo.trim()) return;
    setBusy(true);
    setError(null);
    const res = await apiAdminMergeCategory(
      mergeFrom.cat,
      mergeTo.trim(),
      mergeFrom.grp === "—" ? undefined : mergeFrom.grp,
      lang,
    );
    if (res.ok) {
      setSuccess(res.data.message);
      setTimeout(() => setSuccess(null), 5000);
      setReloadKey((k) => k + 1);
      setMergeFrom(null);
      setMergeTo("");
    } else {
      setError(res.detail);
    }
    setBusy(false);
  };

  if (loading && items.length === 0) return <AdminLoading lang={lang} />;

  const busiest = items[0]?.count ?? 1;
  /* Categories whose name appears under more than one group are the clearest
     drift signal, so surface the count in the subtitle. */
  const distinctCats = new Set(items.map((i) => i.cat)).size;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-1 pb-12 pt-2">
      <AdminHeader
        icon={IconReceipt}
        title={w(lang, "navAdminCategories")}
        subtitle={w(lang, "adminCategoriesSub")}
      />

      {success && <AdminBanner tone="success">{success}</AdminBanner>}
      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      {items.length > distinctCats && (
        <AdminBanner tone="info">
          {lang === "bn"
            ? `${num(distinctCats, lang)}টি আলাদা ক্যাটাগরি ${num(items.length, lang)}টি খাত-জোড়ায় ছড়ানো — একই নাম একাধিক খাতে আছে।`
            : `${distinctCats} distinct categories spread across ${items.length} category/group pairs — the same name appears under more than one group.`}
        </AdminBanner>
      )}

      <div className="glass-card overflow-hidden rounded-card">
        {items.length === 0 ? (
          <AdminEmpty icon={IconReceipt} messageKey="adminCategoriesEmpty" lang={lang} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line/40 bg-surface-2/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">{w(lang, "adminCategoryCat")}</th>
                  <th className="px-4 py-3">{w(lang, "adminCategoryGroup")}</th>
                  <th className="px-4 py-3 text-right">{w(lang, "adminCategoryUses")}</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">
                    {w(lang, "adminCategoryUsers")}
                  </th>
                  <th className="px-4 py-3 text-right">{w(lang, "amtLabel")}</th>
                  <th className="px-4 py-3 text-center">{w(lang, "adminUserActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {items.map((item) => (
                  <tr
                    key={`${item.cat}|${item.grp}`}
                    className="transition-colors hover:bg-surface-2/40"
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold text-ink">{item.cat}</span>
                      <div className="mt-1 max-w-[10rem]">
                        <ShareBar pct={(item.count / busiest) * 100} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{item.grp}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">
                      {num(item.count, lang)}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted sm:table-cell">
                      {num(item.userCount, lang)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">
                      {fmtTaka(item.amount, lang)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setMergeFrom(item);
                          setMergeTo("");
                        }}
                        className="rounded-control border border-line/70 bg-surface/80 px-2.5 py-1 text-xs font-semibold text-ink transition-all hover:border-emerald/40 hover:bg-surface-2 active:scale-95"
                      >
                        {w(lang, "adminCategoryMerge")}
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
        open={Boolean(mergeFrom)}
        onClose={() => {
          if (!busy) setMergeFrom(null);
        }}
        label={w(lang, "adminCategoryMergeTitle")}
      >
        {mergeFrom && (
          <div className="space-y-4 p-5">
            <div>
              <h3 className="text-base font-bold text-ink">
                {w(lang, "adminCategoryMergeTitle")}
              </h3>
              <p className="mt-1 text-sm text-muted">{w(lang, "adminCategoryMergeHint")}</p>
            </div>

            <div className="rounded-card border border-line/60 bg-surface-2/50 p-3 text-sm">
              <span className="text-xs font-semibold text-muted">
                {w(lang, "adminCategoryMergeFrom")}
              </span>
              <p className="font-bold text-ink">
                {mergeFrom.cat}
                <span className="ml-2 text-xs font-normal text-muted">
                  {mergeFrom.grp} · {num(mergeFrom.count, lang)} {w(lang, "entries")} ·{" "}
                  {num(mergeFrom.userCount, lang)} {w(lang, "adminCategoryUsers")}
                </span>
              </p>
            </div>

            <div>
              <label
                htmlFor="merge-target"
                className="block text-xs font-semibold text-muted"
              >
                {w(lang, "adminCategoryMergeTo")}
              </label>
              <input
                id="merge-target"
                list="merge-target-options"
                value={mergeTo}
                onChange={(e) => setMergeTo(e.target.value)}
                placeholder={w(lang, "adminCategoryCat")}
                className="mt-1 w-full rounded-control border border-line/60 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-emerald focus:ring-2 focus:ring-emerald/20"
              />
              <datalist id="merge-target-options">
                {[...new Set(items.map((i) => i.cat))]
                  .filter((cat) => cat !== mergeFrom.cat)
                  .map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
              </datalist>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
              <button
                type="button"
                onClick={() => setMergeFrom(null)}
                disabled={busy}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void runMerge()}
                disabled={busy || !mergeTo.trim() || mergeTo.trim() === mergeFrom.cat}
                className="inline-flex items-center gap-2 rounded-control bg-warning px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
              >
                {busy && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {busy ? w(lang, "loading") : w(lang, "adminCategoryMergeCta")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
