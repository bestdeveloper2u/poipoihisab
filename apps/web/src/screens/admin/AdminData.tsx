/**
 * /admin/data — bulk user import and export.
 *
 * Moved off the users table's toolbar in the role split: a full-table CSV
 * dump and a batch account creation are not row actions, and the export in
 * particular now leaves an audit entry, which deserves saying out loud.
 */
import { useRef, useState, type ChangeEvent } from "react";
import type { AdminUserImportRow } from "@poipoihisab/api-client";
import { apiAdminDownloadUsersCsv, apiAdminImportUsers } from "@poipoihisab/api-client";
import { IconDownload, IconUpload } from "../../components/icons";
import { usePageTitle } from "../../lib/usePageTitle";
import { w } from "../../lib/web-i18n";
import { useLangStore } from "../../store/lang";
import { parseUsersCsv } from "./csv";
import { AdminBanner, AdminCard, AdminHeader, num } from "./shared";

export function AdminData() {
  const lang = useLangStore((s) => s.lang);
  usePageTitle(w(lang, "navAdminData"));

  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<AdminUserImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    const res = await apiAdminDownloadUsersCsv(lang);
    if (res.ok && res.data) {
      download(res.data, `users-export-${new Date().toISOString().slice(0, 10)}.csv`);
    } else if (!res.ok) {
      setError(res.detail);
    }
    setExporting(false);
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSuccess(null);
    try {
      const parsed = parseUsersCsv(await file.text());
      if (parsed.length === 0) {
        setRows([]);
        setError(
          lang === "bn"
            ? "ফাইলে কোনো বৈধ ব্যবহারকারী তথ্য পাওয়া যায়নি (নাম এবং সঠিক ইমেইল থাকা আবশ্যক)।"
            : "No valid user rows found in CSV (name and valid email required).",
        );
        return;
      }
      setError(null);
      setRows(parsed);
    } catch {
      setError(lang === "bn" ? "CSV ফাইল পড়া যায়নি।" : "Failed to read CSV file.");
    }
  };

  const handleSample = () => {
    const sample =
      "﻿name,email,password\r\nRahim Uddin,rahim@example.com,RahimPass123!\r\nKarim Hossain,karim@example.com,";
    download(new Blob([sample], { type: "text/csv;charset=utf-8" }), "users-sample.csv");
  };

  const handleImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setError(null);
    const res = await apiAdminImportUsers(rows, lang);
    if (res.ok) {
      const { createdCount, skippedCount } = res.data;
      let message = `${num(createdCount, lang)} ${w(lang, "adminImportSuccess")}`;
      if (skippedCount > 0) {
        message += `, ${num(skippedCount, lang)} ${w(lang, "adminImportSkipped")}`;
      }
      setSuccess(message);
      setRows([]);
    } else {
      setError(res.detail);
    }
    setImporting(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-1 pb-12 pt-2">
      <AdminHeader
        icon={IconDownload}
        title={w(lang, "navAdminData")}
        subtitle={w(lang, "adminDataSub")}
      />

      {success && <AdminBanner tone="success">{success}</AdminBanner>}
      {error && <AdminBanner tone="error">{error}</AdminBanner>}

      <AdminCard title={w(lang, "adminDataExportTitle")}>
        <p className="text-sm text-muted">{w(lang, "adminDataExportDesc")}</p>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting}
          className="mt-3 inline-flex items-center gap-2 rounded-control bg-emerald px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60"
        >
          {exporting ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
          ) : (
            <IconDownload className="h-4 w-4" />
          )}
          {exporting ? w(lang, "loading") : w(lang, "adminExportCsv")}
        </button>
      </AdminCard>

      <AdminCard title={w(lang, "adminDataImportTitle")}>
        <p className="text-sm text-muted">
          {lang === "bn"
            ? "CSV ফাইল আপলোড করে এক সাথে একাধিক ব্যবহারকারী যোগ করুন। কলাম: name, email, password। পাসওয়ার্ড খালি রাখলে একটি র‍্যান্ডম পাসওয়ার্ড তৈরি হবে।"
            : "Add several users at once from a CSV. Columns: name, email, password. Leave a password blank and a random one is generated."}
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          ref={fileInputRef}
          onChange={(e) => void handleFile(e)}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 flex w-full flex-col items-center justify-center rounded-card border-2 border-dashed border-line/80 bg-surface-2/30 p-6 text-center transition-all hover:border-emerald/60 hover:bg-emerald/5"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald/10 text-emerald">
            <IconUpload className="h-6 w-6" />
          </div>
          <p className="mt-2.5 text-xs font-semibold text-ink">
            {w(lang, "adminImportUploadPrompt")}
          </p>
        </button>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={handleSample}
            className="text-xs font-semibold text-emerald transition-colors hover:underline"
          >
            ↓ {w(lang, "adminImportTemplate")}
          </button>
          {rows.length > 0 && (
            <span className="rounded-full bg-emerald/15 px-2.5 py-0.5 text-xs font-bold text-emerald">
              {num(rows.length, lang)} {lang === "bn" ? "জন তৈরি হবে" : "users ready"}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="text-xs font-bold text-ink">
              {lang === "bn" ? "আমদানি প্রিভিউ" : "Import preview"}
            </h3>
            <div className="max-h-52 overflow-y-auto rounded-card border border-line/60 bg-surface">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 border-b border-line/40 bg-surface-2 text-[10px] uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">{w(lang, "adminUserName")}</th>
                    <th className="px-3 py-2">{w(lang, "adminUserEmail")}</th>
                    <th className="px-3 py-2 text-right">Password</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/30">
                  {rows.slice(0, 50).map((row) => (
                    <tr key={row.email} className="hover:bg-surface-2/40">
                      <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                      <td className="max-w-[180px] truncate px-3 py-2 font-en text-muted">
                        {row.email}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-muted">
                        {row.password ? "••••••••" : "(Auto)"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 50 && (
              <p className="text-right text-[11px] text-muted">
                {lang === "bn"
                  ? `আরও ${num(rows.length - 50, lang)} জন নিচে আছে…`
                  : `+ ${rows.length - 50} more users…`}
              </p>
            )}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setRows([])}
                disabled={importing}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded-control bg-emerald px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
              >
                {importing && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {importing ? w(lang, "adminImporting") : w(lang, "adminImportUsers")}
              </button>
            </div>
          </div>
        )}
      </AdminCard>
    </div>
  );
}
