import { api, errorMessage, type ApiResult } from "@poipoihisab/api-client";
import { toBnDigits, type Lang } from "@poipoihisab/core";
import { useQuery } from "@tanstack/react-query";
import { w } from "./web-i18n";

export interface SheetsStatus { configured: boolean; sa_email: string | null }

/**
 * What one sync did. `rows` counts expenses; the three ledger figures are the
 * whole of what the sheet now holds, not a delta, because those tabs are
 * rewritten in full on every sync. `skipped_tabs` names the ledger tabs this
 * workbook does not have — an older copy of the template, which still syncs
 * its months.
 */
export interface SheetsExport {
  rows: number;
  months: string[];
  unmapped: string[];
  debts: number;
  budget_categories: number;
  recurring: number;
  skipped_tabs: string[];
  created_tabs?: string[];
}

export function useSheetsStatus() {
  return useQuery({
    queryKey: ["export", "sheets", "status"],
    queryFn: async (): Promise<ApiResult<SheetsStatus>> => {
      const { data, error, response } = await api.GET("/api/v1/export/sheets/status");
      if (data) return { ok: true, data };
      return { ok: false, status: response.status, detail: errorMessage(error, "bn") };
    },
  });
}

/** Shared client keeps bearer injection and silent token refresh intact. */
export async function exportSheets(sheet: string, month: string | null): Promise<ApiResult<SheetsExport>> {
  const { data, error, response } = await api.POST("/api/v1/export/sheets", { body: { sheet, month } });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, "bn") };
}

/**
 * What to say after a sync, in one line: the expenses written, what the three
 * ledger tabs now hold, and anything the sheet could not take.
 *
 * The last part is the point. `unmapped` has been in the response since the
 * month-tab rewrite and was shown nowhere, so a category the workbook does not
 * list left its group blank and its amount in the sheet's শ্রেণিবিন্যাসহীন
 * line with nothing in the app ever mentioning it.
 */
export function syncReport(lang: Lang, data: SheetsExport): string {
  const count = (value: number) => (lang === "bn" ? toBnDigits(String(value)) : String(value));
  const said = [w(lang, "sheetsExported").replace("{n}", count(data.rows))];
  if (data.created_tabs && data.created_tabs.length > 0) {
    said.unshift(lang === "bn" ? "স্প্রেডশিট প্রস্তুত করা হয়েছে" : "Spreadsheet initialized");
  }
  // All three skipped means an older copy of the template: the counts would
  // read zero and say nothing true about what the app actually holds.
  if (data.skipped_tabs.length < 3) {
    said.push(
      w(lang, "sheetsLedger")
        .replace("{d}", count(data.debts))
        .replace("{b}", count(data.budget_categories))
        .replace("{r}", count(data.recurring)),
    );
  }
  if (data.skipped_tabs.length > 0) {
    said.push(w(lang, "sheetsSkipped").replace("{tabs}", data.skipped_tabs.join(", ")));
  }
  if (data.unmapped.length > 0) {
    const named = data.unmapped.slice(0, 3).join(", ");
    const rest = data.unmapped.length - 3;
    said.push(
      w(lang, "sheetsUnmapped").replace("{cats}", rest > 0 ? `${named} +${count(rest)}` : named),
    );
  }
  return said.join(" — ");
}

export const SHEET_STORAGE_KEY = "dh.sheets.sheet";

/** Accept only a bare Google ID or an HTTPS Google Sheets URL. */
export function sheetRef(value: string): string | null {
  if (value.length > 2048 || [...value].some((character) => character.charCodeAt(0) < 32)) return null;
  const ref = value.trim();
  if (/^[A-Za-z0-9_-]{1,200}$/.test(ref)) return ref;
  try {
    const url = new URL(ref);
    if (url.protocol !== "https:" || url.host !== "docs.google.com" || url.username || url.password) return null;
    return /^\/spreadsheets\/d\/([A-Za-z0-9_-]{1,200})(?:\/(?:edit|view|preview|copy))?\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function loadSheetRef(): string {
  try {
    return localStorage.getItem(SHEET_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** False means storage was blocked; the current input can still be exported. */
export function saveSheetRef(value: string): boolean {
  try {
    const ref = value.trim();
    if (ref) localStorage.setItem(SHEET_STORAGE_KEY, ref);
    else localStorage.removeItem(SHEET_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
