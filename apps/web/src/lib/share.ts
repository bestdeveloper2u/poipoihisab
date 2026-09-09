/**
 * T28.3 — month-report share (MDN Web Share API, files level 2):
 * https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share and
 * https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare —
 * "The navigator.share() method shares files ... after checking
 * navigator.canShare()". The summary is built as a small CSV in the
 * expensesToCsv style (UTF-8 BOM + RFC 4180 quoting) and handed to the OS
 * share sheet when the browser supports sharing files; everywhere else it
 * degrades to the plain downloadCsv attachment, so every browser gets the
 * data one way or another.
 */
import type { components } from "@poipoihisab/api-client";
import { moneyToNumber, type Lang } from "@poipoihisab/core";
import { groupName, monthLabel } from "./catalog";
import { cell, downloadCsv } from "./csv";
import { fmtMoney } from "./money";

export type MonthlyReport = components["schemas"]["MonthlyReportOut"];

/** Section labels — bn when lang bn, en mirror otherwise (csv.ts pattern). */
const LABELS: Record<Lang, { total: string; entries: string; group: string; day: string }> = {
  bn: { total: "মোট", entries: "এন্ট্রি", group: "গ্রুপ অনুযায়ী", day: "দিন অনুযায়ী" },
  en: { total: "Total", entries: "Entries", group: "By group", day: "By day" },
};

/** poipoihisab-report-YYYY-MM.csv — mirrors backupFilename's sortable name. */
export function reportCsvFilename(ym: string): string {
  return `poipoihisab-report-${ym}.csv`;
}

/**
 * Month-summary CSV: title row, KPI rows (মোট/total, এন্ট্রি/entries),
 * by_group rows (amount-descending, like the screen's bars) and by_day rows.
 * Amounts go through the shared fmtMoney grouping engine (no symbol, latin
 * digits) so the file stays Excel/sheets-friendly in both locales.
 */
export function buildReportCsv(report: MonthlyReport, ym: string, lang: Lang): string {
  const lbl = LABELS[lang];
  const lines: string[] = [
    cell(monthLabel(ym, lang)),
    `${cell(lbl.total)},${cell(fmtMoney(report.total))}`,
    `${cell(lbl.entries)},${cell(String(report.count))}`,
    "",
    cell(lbl.group),
    ...Object.entries(report.by_group)
      .sort((a, b) => moneyToNumber(b[1]) - moneyToNumber(a[1]))
      .map(([grp, amt]) => `${cell(groupName(grp, lang))},${cell(fmtMoney(amt))}`),
    "",
    cell(lbl.day),
    ...report.by_day.map((d) => `${cell(d.iso)},${cell(fmtMoney(d.total))}`),
  ];
  return "\uFEFF" + lines.join("\n");
}

/** Discriminated result so the caller can toast share vs download. */
export type ShareCsvResult =
  | { ok: true; via: "share" }
  | { ok: true; via: "download" }
  | { ok: false; via: "share" };

/**
 * Share `content` as a CSV file through the OS share sheet when the browser
 * supports it (canShare({files}) gate, MDN), else download it. A share-sheet
 * rejection — including the user backing out (AbortError) — resolves to
 * {ok:false, via:"share"}: never a rejected promise, the caller decides the
 * copy. jsdom/older browsers (no navigator.share at all) take the download.
 */
export async function shareOrDownloadCsv(
  content: string,
  filename: string,
  title?: string,
): Promise<ShareCsvResult> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  ) {
    const file = new File([content], filename, { type: "text/csv" });
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text: title });
        return { ok: true, via: "share" };
      }
    } catch {
      return { ok: false, via: "share" };
    }
  }
  downloadCsv(content, filename);
  return { ok: true, via: "download" };
}
