/**
 * RFC-4180-ish CSV reader for the admin user importer.
 *
 * Moved out of the monolithic Admin screen during the superadmin role split
 * so the users list and the import page can share it. Behaviour is
 * unchanged: quoted cells, doubled quotes, a BOM, an optional bn/en header
 * row, and rows without a valid email are dropped.
 */
import type { AdminUserImportRow } from "@poipoihisab/api-client";

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
}

export function parseUsersCsv(text: string): AdminUserImportRow[] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const firstCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  let nameIdx = 0;
  let emailIdx = 1;
  let passIdx = 2;
  let startIndex = 0;

  const hasNameHeader = firstCells.some((c) => c === "name" || c === "নাম");
  const hasEmailHeader = firstCells.some((c) => c === "email" || c === "ইমেইল");

  if (hasNameHeader || hasEmailHeader) {
    startIndex = 1;
    firstCells.forEach((c, idx) => {
      if (c === "name" || c === "নাম") nameIdx = idx;
      else if (c === "email" || c === "ইমেইল") emailIdx = idx;
      else if (c === "password" || c === "পাসওয়ার্ড" || c === "pass") passIdx = idx;
    });
  }

  const rows: AdminUserImportRow[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const name = cells[nameIdx]?.trim();
    const email = cells[emailIdx]?.trim();
    const password = cells[passIdx]?.trim() || undefined;
    if (email && email.includes("@")) {
      rows.push({
        name: name || "User",
        email,
        password: password || undefined,
      });
    }
  }

  return rows;
}
