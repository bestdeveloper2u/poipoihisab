// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureAuth } from "@poipoihisab/api-client";
import { W } from "../src/lib/web-i18n";
import {
  exportSheets,
  SHEET_STORAGE_KEY,
  loadSheetRef,
  saveSheetRef,
  sheetRef,
  syncReport,
} from "../src/lib/sheets";

const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-abcd";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  configureAuth({ getAccessToken: () => null });
});

describe("Sheets client integration", () => {
  it("uses the shared authenticated client and the sheet/month wire contract", async () => {
    configureAuth({ getAccessToken: () => "sheets-test-token" });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: 4 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await exportSheets(id, null)).toEqual({ ok: true, data: { rows: 4 } });
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toMatch(/\/api\/v1\/export\/sheets$/);
    expect(request.headers.get("Authorization")).toBe("Bearer sheets-test-token");
    expect(await request.json()).toEqual({ sheet: id, month: null });
  });

  it("extracts Bengali error triples from real HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: "sheets_permission_denied", message_bn: "শিট শেয়ার করুন", message_en: "Share the sheet" } }), { status: 403, headers: { "Content-Type": "application/json" } })));
    expect(await exportSheets(id, "2026-09")).toEqual({ ok: false, status: 403, detail: "শিট শেয়ার করুন" });
  });

  it("keeps every Sheets translation key in both languages", () => {
    const keys = Object.keys(W.bn).filter((key) => key.startsWith("sheets"));
    expect(keys.sort()).toEqual(Object.keys(W.en).filter((key) => key.startsWith("sheets")).sort());
    expect(keys).toEqual(expect.arrayContaining(["sheetsTitle", "sheetsDesc", "sheetsUrlLabel", "sheetsSyncMonth", "sheetsSyncAll", "sheetsSaved", "sheetsExported", "sheetsExportErr"]));
  });
});

describe("Google Sheets reference", () => {
  it("accepts a bare ID and trims whitespace", () => {
    expect(sheetRef(`  ${id}  `)).toBe(id);
  });
  it.each([
    `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`,
    `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`,
    `https://docs.google.com/spreadsheets/d/${id}`,
  ])("extracts an ID from %s", (url) => {
    expect(sheetRef(url)).toBe(id);
  });
  it.each(["", "   ", "bad ref", "a/b", "https://evil.example/spreadsheets/d/abc/edit", "https://docs.google.com.evil.example/spreadsheets/d/abc/edit", "https://docs.google.com/document/d/abc/edit", "https://docs.google.com/spreadsheets/d//edit", "https://user:pass@docs.google.com/spreadsheets/d/abc/edit", "x".repeat(201), "https://docs.google.com/spreadsheets/d/abc/evil", "\tabc"])("rejects invalid reference %s", (value) => {
    expect(sheetRef(value)).toBeNull();
  });
});

describe("saved sheet reference", () => {
  it("uses the required key and defaults to empty", () => {
    expect(SHEET_STORAGE_KEY).toBe("dh.sheets.sheet");
    expect(loadSheetRef()).toBe("");
  });
  it("persists the trimmed URL without losing the user's input", () => {
    const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    expect(saveSheetRef(`  ${url} `)).toBe(true);
    expect(window.localStorage.getItem(SHEET_STORAGE_KEY)).toBe(url);
    expect(loadSheetRef()).toBe(url);
  });
  it("removes a cleared reference", () => {
    saveSheetRef(id);
    expect(saveSheetRef(" ")).toBe(true);
    expect(loadSheetRef()).toBe("");
    expect(window.localStorage.getItem(SHEET_STORAGE_KEY)).toBeNull();
  });
  it("does not crash when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadSheetRef()).toBe("");
    expect(saveSheetRef(id)).toBe(false);
  });
});

describe("syncReport", () => {
  it("formats expense rows and ledger counts", () => {
    const report = syncReport("bn", {
      rows: 5,
      months: ["সেপ্টেম্বর ২০২৬"],
      unmapped: [],
      debts: 2,
      budget_categories: 3,
      recurring: 1,
      skipped_tabs: [],
    });
    expect(report).toContain("✓ ৫ সারি এক্সপোর্ট হয়েছে");
    expect(report).toContain("ধার-দেনা ২");
  });

  it("includes bootstrap notice when created_tabs are present", () => {
    const reportBn = syncReport("bn", {
      rows: 0,
      months: [],
      unmapped: [],
      debts: 0,
      budget_categories: 0,
      recurring: 0,
      skipped_tabs: [],
      created_tabs: ["সেটিংস", "সেপ্টেম্বর ২০২৬"],
    });
    expect(reportBn).toContain("স্প্রেডশিট প্রস্তুত করা হয়েছে");

    const reportEn = syncReport("en", {
      rows: 0,
      months: [],
      unmapped: [],
      debts: 0,
      budget_categories: 0,
      recurring: 0,
      skipped_tabs: [],
      created_tabs: ["সেটিংস", "সেপ্টেম্বর ২০২৬"],
    });
    expect(reportEn).toContain("Spreadsheet initialized");
  });
});
