import { describe, expect, it } from "vitest";
import {
  bnToEnDigits,
  extractAmount,
  parseBudgetAmount,
  parseDebtText,
} from "../src/lib/parseDebt";

/**
 * Prototype VOICE_CTX.debt parity: "করিমকে ৫০০ টাকা ধার দিলাম, বাজারের বাকি"
 * → party করিম, dir lend, amt 500, note "বাজারের বাকি". All parsing happens
 * on-device (regex) — no AI call, no token cost.
 */
describe("parseDebtText (voice debt parser, on-device)", () => {
  it("parses the prototype lend sentence with note", () => {
    expect(parseDebtText("করিমকে ৫০০ টাকা ধার দিলাম, বাজারের বাকি")).toEqual({
      party: "করিম",
      dir: "lend",
      amt: "500",
      note: "বাজারের বাকি",
    });
  });

  it("parses a spaced borrow sentence", () => {
    expect(parseDebtText("রহিম থেকে ২০০ ধার নিলাম")).toEqual({
      party: "রহিম",
      dir: "borrow",
      amt: "200",
      note: "",
    });
  });

  it("parses glued কাছে borrow with ASCII digits", () => {
    const parsed = parseDebtText("সেলিমকাছে 1,250 টাকা ধার নিয়েছি");
    expect(parsed?.party).toBe("সেলিম");
    expect(parsed?.dir).toBe("borrow");
    expect(parsed?.amt).toBe("1250");
  });

  it("keeps the note clean when the amount carries a thousands comma", () => {
    // Regression: the separator comma used to leak into the note because
    // note extraction read the RAW string ("250 টাকা ধার নিয়েছি").
    const parsed = parseDebtText("সেলিমকাছে 1,250 টাকা ধার নিয়েছি");
    expect(parsed?.amt).toBe("1250");
    expect(parsed?.note).toBe("");
  });

  it("defaults to lend when both দিলাম and নিলাম appear", () => {
    expect(parseDebtText("করিমকে ৫০০ দিলাম আগে নিলাম ছিল")?.dir).toBe("lend");
  });

  it("strips a leading ধার/দেনা keyword from the party word", () => {
    expect(parseDebtText("ধাররহিমকে ৩০০ টাকা দিলাম")?.party).toBe("রহিম");
    expect(parseDebtText("দেনাসেলিম থেকে ২৫০ নিলাম")?.party).toBe("সেলিম");
  });

  it("parses a spaced borrow sentence that carries a note", () => {
    // Regression: the glued regex used to match inside "থেকে" itself
    // (prefix "থে" + suffix "কে"), so the real name never won.
    expect(parseDebtText("রহিম থেকে ২০০ ধার নিলাম, আগের বাকি")).toEqual({
      party: "রহিম",
      dir: "borrow",
      amt: "200",
      note: "আগের বাকি",
    });
  });

  it("defaults direction to lend when only দিলাম appears", () => {
    expect(parseDebtText("করিমকে ৫০০ দিলাম")?.dir).toBe("lend");
  });

  it("returns null without an amount", () => {
    expect(parseDebtText("করিমকে ধার দিলাম")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseDebtText("   ")).toBeNull();
  });

  it("bnToEnDigits converts all Bengali digits", () => {
    expect(bnToEnDigits("৫০০.২৫")).toBe("500.25");
  });

  it("parses a spaced কাছে party too", () => {
    expect(parseDebtText("রহিম কাছে ১০০ নিলাম")?.party).toBe("রহিম");
  });
});

/**
 * Bengali number-word amounts — parity with the server expense voice parser
 * (apps/api/app/routers/voice.py _NUMBER_WORDS): "করিমকে পাঁচশো টাকা ধার
 * দিলাম" → 500, "এই মাসের বাজেট আট হাজার টাকা" → 8000.
 */
describe("Bengali number-word amounts (server voice.py parity)", () => {
  it("parses the prototype word-amount debt sentence", () => {
    expect(parseDebtText("করিমকে পাঁচশো টাকা ধার দিলাম")).toEqual({
      party: "করিম",
      dir: "lend",
      amt: "500",
      note: "",
    });
  });

  it("multiplies a word amount by হাজার (দুই হাজার → 2000)", () => {
    expect(parseDebtText("রহিম থেকে দুই হাজার টাকা ধার নিলাম")).toEqual({
      party: "রহিম",
      dir: "borrow",
      amt: "2000",
      note: "",
    });
  });

  it("matches longest-first (একশো → 100, not এক → 1)", () => {
    expect(parseDebtText("করিমকে একশো টাকা দিলাম")?.amt).toBe("100");
  });

  it("keeps digit precedence and multiplies digits by হাজার (১ হাজার → 1000)", () => {
    // Server parity: test_parse_thousand_multiplier "বই ১ হাজার" → 1000.
    expect(parseDebtText("করিমকে ১ হাজার টাকা দিলাম")?.amt).toBe("1000");
  });

  it("treats a bare হাজার as 1000", () => {
    expect(parseDebtText("করিমকে হাজার টাকা দিলাম")?.amt).toBe("1000");
  });

  it("budget parses আট হাজার (the task example)", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট আট হাজার টাকা")).toBe("8000");
  });

  it("budget parses পাঁচ হাজার without grabbing হাজার as the base", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট পাঁচ হাজার টাকা")).toBe("5000");
  });

  it("budget parses নব্বই হাজার (longest-first: নব্বই → 90)", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট নব্বই হাজার টাকা")).toBe("90000");
  });

  it("budget accepts a plain word amount with no multiplier (পঞ্চাশ → 50)", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট পঞ্চাশ টাকা")).toBe("50");
  });

  it("budget still combines ASCII digits with হাজার", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট ২ হাজার টাকা")).toBe("2000");
  });

  it("returns null when only non-number words appear", () => {
    expect(parseDebtText("করিমকে ধার দিলাম")).toBeNull();
  });
});

/**
 * Prototype VOICE_CTX.budget: "এই মাসের বাজেট ২৫০০০ টাকা" → 25000. No
 * number → null keeps the transcript editable instead of saving nonsense.
 */
describe("parseBudgetAmount (voice budget parser, on-device)", () => {
  it("parses the prototype budget sentence", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট ২৫০০০ টাকা")).toBe("25000");
  });

  it("strips a thousands comma from the budget amount", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট 25,000 টাকা")).toBe("25000");
  });

  it("returns null without any number", () => {
    expect(parseBudgetAmount("বাজেট সেট করো")).toBeNull();
  });
});

/**
 * T33.1 — Bengali scale words (লাখ ×100000, কোটি ×10000000) plus compound
 * numbers, IDENTICAL algorithm to the server expense voice parser.
 * Cycle-33 server baseline, captured live: "এক লাখ পঁচিশ হাজার টাকা বইয়ে"
 * parses as 1000 (bug) / 125000 (fixed); "দুই লাখ টাকা বাসা ভাড়া" as 2
 * (bug) / 200000 (fixed). Web must match the fixed server exactly.
 */
describe("Bengali scale words লাখ/কোটি + compounds (server parity, T33.1)", () => {
  it("parses the cycle-33 baseline debt sentence: এক লাখ পঁচিশ হাজার → 125000", () => {
    const parsed = parseDebtText("রহিমকে এক লাখ পঁচিশ হাজার টাকা ধার দিলাম");
    expect(parsed?.amt).toBe("125000");
    expect(parsed?.party).toBe("রহিম");
    expect(parsed?.dir).toBe("lend");
  });

  it("এক লাখ → 100000", () => {
    expect(extractAmount("এক লাখ")).toBe(100000);
  });

  it("লাখ টাকা → 100000 (a bare multiplier counts as ×1)", () => {
    expect(extractAmount("লাখ টাকা")).toBe(100000);
  });

  it("দশ লাখ → 1000000", () => {
    expect(extractAmount("দশ লাখ")).toBe(1000000);
  });

  it("এক কোটি → 10000000", () => {
    expect(extractAmount("এক কোটি")).toBe(10000000);
  });

  it("এক কোটি পঁচিশ লাখ → 12500000 (two scales in one walk)", () => {
    expect(extractAmount("এক কোটি পঁচিশ লাখ")).toBe(12500000);
  });

  it("৫ লাখ → 500000 (digits × the largest multiplier present)", () => {
    expect(extractAmount("৫ লাখ")).toBe(500000);
  });

  it("দুই লাখ পঁচিশ হাজার → 225000 (server baseline #2)", () => {
    expect(extractAmount("দুই লাখ পঁচিশ হাজার")).toBe(225000);
  });

  it("উনিশ হাজার → 19000 (compound base: উনিশ=19)", () => {
    expect(extractAmount("উনিশ হাজার")).toBe(19000);
  });

  it("পঁচানব্বই হাজার → 95000 (per-token longest: পঁচানব্বই=95 over নব্বই=90)", () => {
    expect(extractAmount("পঁচানব্বই হাজার")).toBe(95000);
  });

  it("একশ পঞ্চাশ টাকা → 150 (base words SUM — new in T33.1)", () => {
    expect(extractAmount("একশ পঞ্চাশ টাকা")).toBe(150);
  });

  it("budget parses দুই লাখ → 200000 (the server baseline budget case)", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট দুই লাখ টাকা")).toBe("200000");
  });

  it("budget parses এক কোটি → 10000000", () => {
    expect(parseBudgetAmount("এই মাসের বাজেট এক কোটি টাকা")).toBe("10000000");
  });
});
