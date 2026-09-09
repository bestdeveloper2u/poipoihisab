/*
 * Client-side Bengali recurring-sentence parser (T29.2 — extends ADR-0020's
 * on-device family): "প্রতি মাসের ৫ তারিখে ভাড়া ৮০০০ টাকা" →
 * { freq: "monthly", monthDay: 5, cat: "ভাড়া", amt: "8000" }. Pure regex,
 * ZERO AI/token cost (hard owner rule). The VoiceOverlay ALWAYS prefills an
 * editable review card with the result and nothing is ever saved without an
 * explicit confirm.
 *
 * Amount logic (digits, Bengali number-words, হাজার/লাখ/কোটি scale-word
 * multipliers that never act as bases) is REUSED from parseDebt.ts so the
 * cycle-24 regression fix (হাজার must never count as base AND multiplier —
 * "আট হাজার" → 8000, never 8,000,000) and the T33.1 scale words ("এক লাখ
 * দুই হাজার" → 102000) cannot drift between the two parsers.
 */

import {
  extractAmount,
  normalizeTranscript,
  NUMBER_WORD_TOKENS,
} from "./parseDebt";

export type ParsedRecurring = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  amt: string;
  cat: string | null;
  /** 1–31; only set when freq === "monthly". */
  monthDay: number | null;
  /** 0=Sunday…6=Saturday (JS getDay order); only set when freq === "weekly". */
  weekDay: number | null;
};

/*
 * Freq keywords — first match wins, most specific first ("প্রতিদিন" must be
 * tried before the bare "প্রতি" fallback below, or it would be eaten).
 * A bare "প্রতি" with no cadence word is NOT a recurring sentence → null.
 */
const FREQ_PATTERNS: ReadonlyArray<readonly ["daily" | "weekly" | "monthly" | "yearly", RegExp]> = [
  ["daily", /প্রতিদিন|প্রতি\s*দিন(?:ে)?/],
  ["weekly", /প্রতি\s*সপ্তাহ(?:ে|ের)?|সাপ্তাহিক/],
  ["monthly", /প্রতি\s*মাস(?:ে|ের)?|মাসিক/],
  ["yearly", /প্রতি\s*বছর(?:ে|ের)?|বার্ষিক/],
];

/* Weekday names — full form before short form (regex alternation is
 * ordered). Numbers follow JS getDay(): রবিবার=0 … শনিবার=6. */
const WEEKDAYS: ReadonlyArray<readonly [RegExp, number]> = [
  [/বৃহস্পতিবার|বৃহস্পতি|বৃহঃ/, 4],
  [/শুক্রবার|শুক্র/, 5],
  [/শনিবার|শনি/, 6],
  [/রবিবার|রবি/, 0],
  [/সোমবার|সোম/, 1],
  [/মঙ্গলবার|মঙ্গল/, 2],
  [/বুধবার|বুধ/, 3],
];

/**
 * Parse one recurring sentence. Returns null when the cadence or the amount
 * cannot be found — the overlay then keeps the transcript editable with the
 * "কিছু বোঝা যায়নি" hint instead of saving nonsense.
 */
export function parseRecurringText(raw: string): ParsedRecurring | null {
  let text = normalizeTranscript(raw); // bn digits → ASCII, "1,250" → "1250"
  if (!text) return null;

  // Cadence: required. Bare "প্রতি" (or nothing at all) → null.
  let freq: ParsedRecurring["freq"] | null = null;
  for (const [f, re] of FREQ_PATTERNS) {
    if (re.test(text)) {
      freq = f;
      break;
    }
  }
  if (freq === null) return null;

  // "প্রতি মাসের ৫ তারিখে" → monthDay 5 (monthly only, 1–31 else dropped —
  // the review card's number input is the place to fix an odd day).
  let monthDay: number | null = null;
  if (freq === "monthly") {
    const m = text.match(/মাসের?\s*(\d{1,2})\s*তারিখ/);
    if (m) {
      const d = Number(m[1]);
      if (d >= 1 && d <= 31) monthDay = d;
    }
  }

  // "প্রতি সপ্তাহে শনিবার …" → weekDay 6 (weekly only).
  let weekDay: number | null = null;
  if (freq === "weekly") {
    for (const [re, idx] of WEEKDAYS) {
      if (re.test(text)) {
        weekDay = idx;
        break;
      }
    }
  }

  /*
   * Strip everything structural so the amount extractor and the category
   * words see only "ভাড়া ৮০০০ টাকা". Order matters: the DAY number must go
   * BEFORE amount extraction ("প্রতি মাসের ৫ তারিখে ভাড়া ৮০০০" must amount
   * to 8000, not the 5 of the date), and the day phrase before the freq
   * words (removing "মাসের" first would orphan the phrase).
   */
  text = text.replace(/মাসের?\s*\d{1,2}\s*তারিখ(?:ে)?/g, " ");
  for (const [re] of WEEKDAYS) text = text.replace(new RegExp(re.source, "g"), " ");
  text = text
    .replace(
      /প্রতিদিন|প্রতি\s*দিন(?:ে)?|প্রতি\s*সপ্তাহ(?:ে|ের)?|সাপ্তাহিক|প্রতি\s*মাস(?:ে|ের)?|মাসিক|প্রতি\s*বছর(?:ে|ের)?|বার্ষিক|প্রতি|তারিখ(?:ে|ের)?/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  // Amount REQUIRED — digits ("৮০০০", "1250") and number-words with the
  // হাজার/লাখ/কোটি scale-word rule, exactly as in the debt parser.
  const amt = extractAmount(text);
  if (amt === null) return null;

  /*
   * Category = the surviving words ("বাসা ভাড়া"), with amount digits,
   * number-words and currency words dropped so the amount can never leak
   * into the category (thousands commas are already gone above).
   */
  const cat = text
    .split(" ")
    .map((tok) => tok.replace(/[,.।;:!?"']+$/g, ""))
    .filter(
      (tok) =>
        tok !== "" &&
        !/^\d+(?:\.\d{1,2})?$/.test(tok) &&
        !NUMBER_WORD_TOKENS.has(tok) &&
        tok !== "টাকা" &&
        tok !== "পয়সা",
    )
    .join(" ")
    .slice(0, 120);

  return { freq, amt: String(amt), cat: cat || null, monthDay, weekDay };
}
