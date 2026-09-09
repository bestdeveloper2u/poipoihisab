/*
 * Client-side Bengali debt-sentence parser (prototype VOICE_CTX.debt parity):
 * "করিমকে ৫০০ টাকা ধার দিলাম, বাজারের বাকি" → party করিম, dir lend, amt 500,
 * note "বাজারের বাকি". Pure regex on-device — no AI call, zero token cost.
 * Amounts accept digits (৫০০/500) AND Bengali number-words ("পাঁচশো টাকা" →
 * 500, "আট হাজার টাকা" → 8000) plus the লাখ/কোটি scale words ("এক লাখ
 * পঁচিশ হাজার টাকা" → 125000), mirroring the server voice parser
 * (apps/api/app/routers/voice.py _NUMBER_WORDS).
 */

export type ParsedDebt = {
  party: string;
  dir: "lend" | "borrow";
  amt: string;
  note: string;
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Convert Bengali digits (০-৯) to ASCII so amounts parse uniformly. */
export function bnToEnDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/**
 * Shared pre-parse normalization: Bengali digits → ASCII, whitespace
 * collapse, and thousands-separator removal ("1,250" → "1250"). Doing the
 * comma strip ONCE here means every downstream step — party, amount AND the
 * note slice — sees the same clean string; otherwise the separator comma
 * leaks into the note (commaIdx landed after "1,250" → "250 টাকা ধার নিয়েছি").
 */
export function normalizeTranscript(raw: string): string {
  return bnToEnDigits(raw.trim())
    .replace(/\s+/g, " ")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
}

/*
 * Bengali number-words — base vocabulary copied EXACTLY from the server
 * expense voice parser (apps/api/app/routers/voice.py _NUMBER_WORDS, same
 * insertion order; longest-first matching keeps একশ over এক, পাঁচশ over
 * পাঁচ; the sort below is stable, so equal-length ties keep the server's
 * order too). T33.1 extends it with the common compound numbers
 * (এগারো=11 … নিরানব্বই=99, values verified). হাজার is deliberately NOT a
 * base word — scale words live in MULTIPLIER_WORDS below, so a multiplier
 * can never act as its own base ("আট হাজার" → 8000, never 8000000 — the
 * cycle-24 regression rule, now shared by লাখ and কোটি as well).
 */
const NUMBER_WORDS: Record<string, number> = {
  "একশ": 100,
  "পাঁচশ": 500,
  "দুইশ": 200,
  "নব্বই": 90,
  "চল্লিশ": 40,
  "পঞ্চাশ": 50,
  "সত্তর": 70,
  "ত্রিশ": 30,
  "বিশ": 20,
  "ষাট": 60,
  "দশ": 10,
  "পাঁচ": 5,
  "panch": 5,
  "চার": 4,
  "ছয়": 6,
  "সাত": 7,
  "আট": 8,
  "নয়": 9,
  "শত": 100,
  "dui": 2,
  "দুই": 2,
  "তিন": 3,
  "এক": 1,
  "আশি": 80,
  // T33.1: common compound numbers (teens, irregular tens, উন-/এক- forms).
  "এগারো": 11,
  "বারো": 12,
  "তেরো": 13,
  "চৌদ্দ": 14,
  "পনেরো": 15,
  "ষোলো": 16,
  "সতেরো": 17,
  "আঠারো": 18,
  "উনিশ": 19,
  "একুশ": 21,
  "বাইশ": 22,
  "তেইশ": 23,
  "চব্বিশ": 24,
  "পঁচিশ": 25,
  "ছাব্বিশ": 26,
  "সাতাশ": 27,
  "আটাশ": 28,
  "উনত্রিশ": 29,
  "একত্রিশ": 31,
  "বত্রিশ": 32,
  "তেত্রিশ": 33,
  "চৌত্রিশ": 34,
  "পঁয়ত্রিশ": 35,
  "ছত্রিশ": 36,
  "সাঁইত্রিশ": 37,
  "আটত্রিশ": 38,
  "উনচল্লিশ": 39,
  "একচল্লিশ": 41,
  "বিয়াল্লিশ": 42,
  "তেতাল্লিশ": 43,
  "চুয়াল্লিশ": 44,
  "পঁয়তাল্লিশ": 45,
  "ছেচল্লিশ": 46,
  "সাতচল্লিশ": 47,
  "আটচল্লিশ": 48,
  "উনপঞ্চাশ": 49,
  "একান্ন": 51,
  "বায়ান্ন": 52,
  "তিপ্পান্ন": 53,
  "চুয়ান্ন": 54,
  "পঞ্চান্ন": 55,
  "ছাপ্পান্ন": 56,
  "সাতান্ন": 57,
  "আটান্ন": 58,
  "উনষাট": 59,
  "এষষ্টি": 61,
  "বাষট্টি": 62,
  "তেষট্টি": 63,
  "চৌষট্টি": 64,
  "পঁয়ষট্টি": 65,
  "ছেষট্টি": 66,
  "সাতষট্টি": 67,
  "আটষট্টি": 68,
  "উনসত্তর": 69,
  "একাত্তর": 71,
  "বাহাত্তর": 72,
  "তিয়াত্তর": 73,
  "চুয়াত্তর": 74,
  "পঁচাত্তর": 75,
  "ছিয়াত্তর": 76,
  "সাতাত্তর": 77,
  "আটাত্তর": 78,
  "উনআশি": 79,
  "একাশি": 81,
  "বিরাশি": 82,
  "তিরাশি": 83,
  "চুরাশি": 84,
  "পঁচাশি": 85,
  "ছিয়াশি": 86,
  "সাতাশি": 87,
  "আটাশি": 88,
  "উননব্বই": 89,
  "একানব্বই": 91,
  "বিরানব্বই": 92,
  "তিরানব্বই": 93,
  "চুরানব্বই": 94,
  "পঁচানব্বই": 95,
  "ছিয়ানব্বই": 96,
  "সাতানব্বই": 97,
  "আটানব্বই": 98,
  "নিরানব্বই": 99,
};

/*
 * Scale words (T33.1) — each folds the base accumulated so far into the
 * total, exactly as on the server: হাজার ×1000, লাখ ×100000, কোটি
 * ×10000000. "এক লাখ পঁচিশ হাজার" → 1×100000 + 25×1000 = 125000.
 * Multiplier words are NEVER base words (they live here, not in
 * NUMBER_WORDS), so a multiplier can't square itself.
 */
const MULTIPLIER_WORDS: Record<string, number> = {
  "হাজার": 1000,
  "লাখ": 100000,
  "কোটি": 10000000,
};

/*
 * Longest-first vocabulary over base + multiplier words for PER-TOKEN
 * matching inside extractAmount: a token matches the LONGEST vocabulary
 * word contained in it ("পঁচানব্বই" contains নব্বই=90 AND পঁচানব্বই=95 →
 * 95; "চব্বিশ" contains বিশ=20 → 24; "সতেরো" contains তেরো=13 → 17).
 */
const AMOUNT_WORDS_ORDERED = [
  ...Object.keys(NUMBER_WORDS),
  ...Object.keys(MULTIPLIER_WORDS),
].sort((a, b) => b.length - a.length);

/**
 * Vocabulary as a token set — parseRecurring drops these from the category.
 * Scale words are included, so লাখ/কোটি can never leak into the category.
 */
export const NUMBER_WORD_TOKENS: ReadonlySet<string> = new Set([
  ...Object.keys(NUMBER_WORDS),
  ...Object.keys(MULTIPLIER_WORDS),
]);

/**
 * Amount from a normalized transcript, mirroring the server algorithm
 * (T33.1):
 *
 * - Digits win ("৫০০"→500, "120.50"), scaled by the LARGEST multiplier word
 *   present anywhere in the text (কোটি > লাখ > হাজার): "১ হাজার" → 1000,
 *   "৫ লাখ" → 500000; no multiplier word → unchanged.
 * - No digits: tokenize on whitespace and walk left→right. Base number-words
 *   ACCUMULATE ("একশ পঞ্চাশ" → 100+50 = 150 — a sum, deliberately more
 *   correct than the old first-word-only read), and a multiplier token folds
 *   the accumulated base into the total as (acc>0?acc:1)×mult, resetting acc
 *   — so a bare "হাজার"/"লাখ"/"কোটি" still means 1000/100000/10000000.
 *   "আট হাজার" → 8000, "এক লাখ পঁচিশ হাজার" → 125000, "এক কোটি পঁচিশ লাখ"
 *   → 12500000.
 *
 * Per-token matching picks the LONGEST vocabulary word contained in the
 * token, and multiplier words never act as bases. Bengali digits are
 * converted first (idempotent — callers already pass normalized text via
 * normalizeTranscript), so the exported function is safe on raw transcripts
 * too ("৫ লাখ" → 500000). Returns null when nothing usable is found.
 */
export function extractAmount(text: string): number | null {
  const t = bnToEnDigits(text);
  const digitMatch = t.match(/(\d+(?:\.\d{1,2})?)/);
  if (digitMatch) {
    const n = Number(digitMatch[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (t.includes("কোটি")) return n * MULTIPLIER_WORDS["কোটি"];
    if (t.includes("লাখ")) return n * MULTIPLIER_WORDS["লাখ"];
    if (t.includes("হাজার")) return n * MULTIPLIER_WORDS["হাজার"];
    return n;
  }
  let acc = 0;
  let total = 0;
  let matched = false;
  for (const token of t.split(/\s+/)) {
    if (!token) continue;
    let word: string | undefined;
    for (const w of AMOUNT_WORDS_ORDERED) {
      if (token.includes(w)) {
        word = w;
        break;
      }
    }
    if (word === undefined) continue;
    matched = true;
    const mult = MULTIPLIER_WORDS[word];
    if (mult !== undefined) {
      total += (acc > 0 ? acc : 1) * mult;
      acc = 0;
    } else {
      acc += NUMBER_WORDS[word];
    }
  }
  if (!matched) return null;
  if (acc > 0) total += acc;
  return total;
}

/**
 * Party words must not carry a leading money/loan keyword ("ধাররহিম",
 * "দেনাসেলিম") — the keyword belongs to the sentence, not the name.
 */
function stripPartyPrefix(word: string): string {
  return word.replace(/^(ধার|দেনা|টাকা|পয়সা)/, "");
}

/**
 * Parse one debt sentence. Returns null when no amount and no party can be
 * found — the overlay then keeps the transcript editable with a hint.
 */
export function parseDebtText(raw: string): ParsedDebt | null {
  const text = normalizeTranscript(raw);
  if (!text) return null;

  // Direction: "দিলাম/দিয়েছি" = lent out; "নিলাম/নিয়েছি" = borrowed.
  // Saying both defaults to lend (the sentence's subject is what I gave).
  const borrow = /(?:নিলাম|নিয়েছি|নিচ্ছি)/.test(text);
  const lend = /(?:দিলাম|দিয়েছি|দিচ্ছি)/.test(text);
  const dir: "lend" | "borrow" = borrow && !lend ? "borrow" : "lend";

  /*
   * Party: a name before থেকে / কাছে / কে. The SPACED form ("রহিম থেকে") must
   * be tried FIRST: the glued regex otherwise matches INSIDE the word "থেকে"
   * itself (prefix "থে" + suffix "কে") and steals the party from the real
   * name standing in front of it.
   */
  const STOP = new Set(["কারো", "কারও", "সবাই", "সবার"]);
  let party = "";
  const spaced = text.match(/([^\s,।]+)\s+(?:থেকে|কাছে)(?=[\s,।]|$)/u);
  if (spaced) {
    const word = stripPartyPrefix(spaced[1]);
    if (word && !STOP.has(word)) party = word;
  }
  if (!party) {
    const glued = text.match(/([^\s,।]+?)(?:কে|থেকে|কাছে)(?=[\s,।]|$)/u);
    if (glued) {
      const word = stripPartyPrefix(glued[1]);
      if (word && !STOP.has(word)) party = word;
    }
  }
  if (!party) {
    // Fallback: first non-keyword word of the sentence.
    const first = stripPartyPrefix(
      text.split(" ")[0]?.replace(/^(ধার|দেনা|আজ|কাল)[,]*/, "") ?? "",
    );
    if (first) party = first;
  }

  // Amount: explicit digits first (500, 500.50) — thousands commas are
  // already gone (normalizeTranscript), so "1,250" → 1250 — otherwise
  // Bengali number-words with the shared scale-word algorithm ("পাঁচশো
  // টাকা" → 500, "এক লাখ পঁচিশ হাজার টাকা" → 125000), same vocabulary as
  // the server voice parser.
  const amt = extractAmount(text);
  if (!party || amt === null) return null;

  // Note: whatever follows the first comma (e.g. "বাজারের বাকি") of the SAME
  // normalized string — never the raw input's separator commas.
  const commaIdx = text.indexOf(",");
  const note = commaIdx >= 0 ? text.slice(commaIdx + 1).trim() : "";

  return { party, dir, amt: String(amt), note };
}

/**
 * Extract the monthly budget amount from a transcript (prototype
 * VOICE_CTX.budget): "এই মাসের বাজেট ২৫০০০ টাকা" → "25000", words included:
 * "এই মাসের বাজেট আট হাজার টাকা" → "8000" and, since T33.1, "এই মাসের
 * বাজেট দুই লাখ টাকা" → "200000" (same scale-word algorithm as the server).
 * Returns null when no positive number (digits or number-words) is present —
 * the overlay then keeps the transcript editable instead of saving nonsense.
 */
export function parseBudgetAmount(raw: string): string | null {
  const text = normalizeTranscript(raw);
  const n = extractAmount(text);
  return n === null ? null : String(n);
}
