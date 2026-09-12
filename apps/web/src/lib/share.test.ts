import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import type { components } from "@poipoihisab/api-client";
import { buildReportCsv, reportCsvFilename, shareOrDownloadCsv } from "./share";

/**
 * T28.3 — month-report CSV builder + Web Share API share/download split
 * (MDN: navigator.share / navigator.canShare, files level 2).
 */

type MonthlyReport = components["schemas"]["MonthlyReportOut"];

const REPORT: MonthlyReport = {
  ym: "2026-09",
  total: "2340.50",
  count: 2,
  by_group: { food: "2340.50", transport: "340.50" },
  by_day: [
    { iso: "2026-09-04", total: "2000.00" },
    { iso: "2026-09-05", total: "340.50" },
  ],
  total_income: "0.00",
  net_savings: "-2340.50",
};

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

/** jsdom's Blob lacks .text() — read it back through FileReader instead. */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

let createObjectUrlMock: Mock;
let anchorClickSpy: MockInstance;

beforeEach(() => {
  createObjectUrlMock = vi.fn(() => "blob:mock");
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectUrlMock,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
  anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    value: realCreate,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: realRevoke,
    writable: true,
    configurable: true,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stub share/canShare on the (otherwise share-less) jsdom navigator. */
function stubNavigator(shares: {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}): void {
  Object.defineProperty(navigator, "share", {
    value: shares.share,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "canShare", {
    value: shares.canShare,
    writable: true,
    configurable: true,
  });
}

function removeNavProps(): void {
  for (const key of ["share", "canShare"] as const) {
    Reflect.deleteProperty(navigator, key);
  }
}

describe("reportCsvFilename", () => {
  it("mirrors the sortable backup filename pattern", () => {
    expect(reportCsvFilename("2026-09")).toBe("poipoihisab-report-2026-09.csv");
  });
});

describe("buildReportCsv", () => {
  it("carries a BOM, bn headers, the month total and the entry count", () => {
    const csv = buildReportCsv(REPORT, "2026-09", "bn");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"মোট","2,340.5"');
    expect(csv).toContain('"এন্ট্রি","2"');
  });

  it("includes at least one group row and one day row (bn labels, sorted desc)", () => {
    const csv = buildReportCsv(REPORT, "2026-09", "bn");
    // by_group rows: labels localised, amounts fmtMoney-grouped, biggest first.
    const food = csv.indexOf('"খাদ্য ও মুদি","2,340.5"');
    const transport = csv.indexOf('"যাতায়াত","340.5"');
    expect(food).toBeGreaterThan(-1);
    expect(transport).toBeGreaterThan(food);
    // by_day rows keep the ISO date (expensesToCsv date-column style).
    expect(csv).toContain('"2026-09-04","2,000"');
    expect(csv).toContain('"2026-09-05","340.5"');
  });

  it("switches headers to the en mirror when lang is en", () => {
    const csv = buildReportCsv(REPORT, "2026-09", "en");
    expect(csv).toContain('"Total","2,340.5"');
    expect(csv).toContain('"Entries","2"');
    expect(csv).toContain('"By group"');
    expect(csv).toContain('"By day"');
    expect(csv).not.toContain("মোট");
  });
});

describe("shareOrDownloadCsv", () => {
  const CONTENT = '"মোট","2,340.5"';
  const FILENAME = "poipoihisab-report-2026-09.csv";

  it("calls navigator.share with a CSV file when canShare({files}) is true", async () => {
    let shared: ShareData | undefined;
    const share = vi.fn(async (data: ShareData) => {
      shared = data;
    });
    stubNavigator({ share, canShare: vi.fn(() => true) });

    const res = await shareOrDownloadCsv(CONTENT, FILENAME, "রিপোর্ট");

    expect(res).toEqual({ ok: true, via: "share" });
    expect(share).toHaveBeenCalledTimes(1);
    expect(shared?.title).toBe("রিপোর্ট");
    const files = shared?.files ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0]?.name).toBe(FILENAME);
    expect(files[0]?.type).toBe("text/csv");
    // No download happened on the share path.
    expect(createObjectUrlMock).not.toHaveBeenCalled();
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it("falls back to downloadCsv when canShare({files}) is false", async () => {
    stubNavigator({ share: vi.fn(async () => {}), canShare: vi.fn(() => false) });

    const res = await shareOrDownloadCsv(CONTENT, FILENAME);

    expect(res).toEqual({ ok: true, via: "download" });
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectUrlMock.mock.calls[0][0] as Blob;
    expect(await blobText(blob)).toBe(CONTENT);
  });

  it("falls back to downloadCsv when navigator.share is missing entirely", async () => {
    removeNavProps(); // plain jsdom

    const res = await shareOrDownloadCsv(CONTENT, FILENAME);

    expect(res).toEqual({ ok: true, via: "download" });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  });

  it("returns {ok:false} when the share sheet rejects — no unhandled promise", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (err: unknown) => rejections.push(err);
    process.on("unhandledRejection", onUnhandled);
    stubNavigator({
      share: vi.fn(async () => {
        throw new DOMException("share cancelled", "AbortError");
      }),
      canShare: vi.fn(() => true),
    });

    const res = await shareOrDownloadCsv(CONTENT, FILENAME);

    expect(res).toEqual({ ok: false, via: "share" });
    // Give a stray unhandled rejection a tick to surface.
    await new Promise((r) => setTimeout(r, 10));
    expect(rejections).toHaveLength(0);
    process.off("unhandledRejection", onUnhandled);
  });
});
