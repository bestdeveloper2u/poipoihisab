import { api, errorMessage, type ApiResult } from "@poipoihisab/api-client";
import { useQuery } from "@tanstack/react-query";

export interface SheetsStatus { configured: boolean; sa_email: string | null }
export interface SheetsExport { rows: number }

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
