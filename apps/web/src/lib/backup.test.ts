import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { backupFilename, downloadBackup, parseBackupFile } from "./backup";
import { todayIso } from "./catalog";
import type { BackupEnvelope } from "./backup";

/**
 * T16.4 — browser half of the ADR-0012 flow: deterministic filenames, a
 * download that carries the envelope through untouched, and strict client
 * side shape-checking so a malformed file can never reach (and wipe via)
 * /import/restore. T28.1b: schema_version 2 (recurring-aware, ADR-0028) is
 * accepted alongside legacy v1 — anything else still rejects.
 */

const ENVELOPE: BackupEnvelope = {
  schema_version: 2,
  exported_at: "2026-09-05T10:00:00Z",
  counts: { expenses: 1, debts: 1, budgets: 1, recurring: 0 },
  expenses: [],
  debts: [],
  budgets: [],
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
  vi.restoreAllMocks();
});

function jsonFile(content: string): File {
  return new File([content], "backup.json", { type: "application/json" });
}

describe("backupFilename", () => {
  it("embeds the given ISO date", () => {
    expect(backupFilename("2026-09-05")).toBe("poipoihisab-backup-2026-09-05.json");
  });

  it("defaults to today", () => {
    expect(backupFilename()).toBe(`poipoihisab-backup-${todayIso()}.json`);
  });
});

describe("downloadBackup", () => {
  it("downloads the envelope verbatim as a .json attachment", async () => {
    downloadBackup(ENVELOPE);

    const anchor = anchorClickSpy.mock.calls.length;
    expect(anchor).toBe(1);
    const blob = createObjectUrlMock.mock.calls[0][0] as Blob;
    expect(JSON.parse(await blobText(blob))).toEqual(ENVELOPE);
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith("blob:mock");
  });
});

describe("parseBackupFile", () => {
  it("accepts a schema_version-1 envelope (backward compatible)", async () => {
    // Raw legacy v1 document: no `recurring` key, version 1 — the CURRENT
    // BackupEnvelope type only models v2, so this stays an untyped literal.
    const V1 = {
      schema_version: 1,
      exported_at: "2026-09-05T10:00:00Z",
      counts: { expenses: 1, debts: 1, budgets: 1 },
      expenses: [],
      debts: [],
      budgets: [],
    };
    const parsed = await parseBackupFile(jsonFile(JSON.stringify(V1)));
    expect(parsed).toEqual({ ok: true, envelope: V1 });
  });

  it("accepts a schema_version-2 envelope (recurring-aware)", async () => {
    const V2 = {
      ...ENVELOPE,
      counts: { expenses: 2, debts: 0, budgets: 0, recurring: 2 },
      recurring: [
        { id: "r1", cat: "বাসা ভাড়া", grp: "home", amt: "8000.00", active: true },
        { id: "r2", cat: "ইন্টারনেট", grp: "utility", amt: "1000.00", active: true },
      ],
    };
    const parsed = await parseBackupFile(jsonFile(JSON.stringify(V2)));
    expect(parsed).toEqual({ ok: true, envelope: V2 });
  });

  it("passes the v2 recurring array through untouched on the parsed object", async () => {
    const V2 = {
      ...ENVELOPE,
      recurring: [{ id: "r1", cat: "বিদ্যুৎ", grp: "utility", amt: "750.00", active: true }],
    };
    const parsed = await parseBackupFile(jsonFile(JSON.stringify(V2)));
    expect(parsed.ok).toBe(true);
    // Raw-object read (not through the typed shape): the extra key survives
    // the cast — the parser validates nothing about it, just passes it on.
    const raw = (parsed as { ok: true; envelope: Record<string, unknown> }).envelope;
    expect(Array.isArray(raw.recurring)).toBe(true);
    expect(raw.recurring).toEqual(V2.recurring);
  });

  it("rejects a future version (v3)", async () => {
    const parsed = await parseBackupFile(
      jsonFile(JSON.stringify({ ...ENVELOPE, schema_version: 3 })),
    );
    expect(parsed).toEqual({ ok: false });
  });

  it("rejects an absent schema_version", async () => {
    const withoutVersion = {
      exported_at: ENVELOPE.exported_at,
      counts: ENVELOPE.counts,
      expenses: ENVELOPE.expenses,
      debts: ENVELOPE.debts,
      budgets: ENVELOPE.budgets,
    };
    expect(await parseBackupFile(jsonFile(JSON.stringify(withoutVersion)))).toEqual({
      ok: false,
    });
  });

  it("rejects a non-numeric schema_version", async () => {
    expect(
      await parseBackupFile(jsonFile(JSON.stringify({ ...ENVELOPE, schema_version: "2" }))),
    ).toEqual({ ok: false });
  });

  it("rejects a JSON array / non-object document", async () => {
    expect(await parseBackupFile(jsonFile("[]"))).toEqual({ ok: false });
  });

  it("rejects a missing row array", async () => {
    const partial = { schema_version: 2, counts: {}, expenses: [], debts: [] };
    expect(await parseBackupFile(jsonFile(JSON.stringify(partial)))).toEqual({ ok: false });
  });

  it("rejects non-JSON content", async () => {
    expect(await parseBackupFile(jsonFile("this is not json"))).toEqual({ ok: false });
  });
});
