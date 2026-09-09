import { describe, expect, it } from "vitest";
import { parseRecurringText } from "../src/lib/parseRecurring";

/**
 * T29.2 — on-device recurring-sentence parser (ADR-0029, extends the
 * ADR-0020 family). Same amount engine as parseDebt (digits + Bengali
 * number-words, হাজার ×1000 multiplier-ONLY), plus cadence / month-day /
 * weekday extraction. Garbage in → null out: the overlay keeps the
 * transcript editable instead of saving nonsense.
 */

describe("parseRecurringText — cadence grammar", () => {
  it("প্রতি মাসের N তারিখে … → monthly with monthDay (day never becomes the amount)", () => {
    expect(parseRecurringText("প্রতি মাসের ৫ তারিখে ভাড়া ৮০০০ টাকা")).toEqual({
      freq: "monthly",
      amt: "8000",
      cat: "ভাড়া",
      monthDay: 5,
      weekDay: null,
    });
  });

  it("প্রতি মাসে … → monthly, monthDay null", () => {
    expect(parseRecurringText("প্রতি মাসে ভাড়া ৮০০০")).toEqual({
      freq: "monthly",
      amt: "8000",
      cat: "ভাড়া",
      monthDay: null,
      weekDay: null,
    });
  });

  it("প্রতি সপ্তাহে শনিবার … → weekly with weekDay 6", () => {
    expect(parseRecurringText("প্রতি সপ্তাহে শনিবার বাজার ৫০০")).toEqual({
      freq: "weekly",
      amt: "500",
      cat: "বাজার",
      monthDay: null,
      weekDay: 6,
    });
  });

  it("প্রতি সপ্তাহে … (no weekday) → weekly, weekDay null", () => {
    expect(parseRecurringText("প্রতি সপ্তাহে বাজার ৫০০")).toEqual({
      freq: "weekly",
      amt: "500",
      cat: "বাজার",
      monthDay: null,
      weekDay: null,
    });
  });

  it("প্রতিদিন … → daily", () => {
    expect(parseRecurringText("প্রতিদিন চা ২০ টাকা")).toEqual({
      freq: "daily",
      amt: "20",
      cat: "চা",
      monthDay: null,
      weekDay: null,
    });
  });

  it("প্রতি বছরে … → yearly", () => {
    expect(parseRecurringText("প্রতি বছরে বিমা ১২০০০ টাকা")).toEqual({
      freq: "yearly",
      amt: "12000",
      cat: "বিমা",
      monthDay: null,
      weekDay: null,
    });
  });

  it("short weekday forms: শুক্র → 5, বৃহঃ → 4", () => {
    expect(parseRecurringText("প্রতি সপ্তাহে শুক্র জুম্মা ১০০")?.weekDay).toBe(5);
    expect(parseRecurringText("প্রতি সপ্তাহে বৃহঃ টিউশন ৩০০")).toEqual({
      freq: "weekly",
      amt: "300",
      cat: "টিউশন",
      monthDay: null,
      weekDay: 4,
    });
  });

  it("out-of-range month day (৩২) is dropped, not fatal", () => {
    const parsed = parseRecurringText("প্রতি মাসের ৩২ তারিখে ভাড়া ৫০০");
    expect(parsed).not.toBeNull();
    expect(parsed?.monthDay).toBeNull();
    expect(parsed?.amt).toBe("500");
  });
});

describe("parseRecurringText — amounts (shared engine parity)", () => {
  it("হাজার regression: number-word ×1000 multiplier-ONLY — আট হাজার → 8000, never 8000000", () => {
    expect(parseRecurringText("বাসা আট হাজার টাকা প্রতি মাসে")).toEqual({
      freq: "monthly",
      amt: "8000",
      cat: "বাসা",
      monthDay: null,
      weekDay: null,
    });
  });

  it("digit + হাজার: ২ হাজার → 2000", () => {
    expect(parseRecurringText("প্রতি মাসে ২ হাজার টাকা ইন্টারনেট")?.amt).toBe("2000");
  });

  it("thousands comma ১,২৫০ must NOT leak into the category", () => {
    expect(parseRecurringText("ভাড়া ১,২৫০ টাকা প্রতি মাসে")).toEqual({
      freq: "monthly",
      amt: "1250",
      cat: "ভাড়া",
      monthDay: null,
      weekDay: null,
    });
  });

  it("ASCII digits and decimals work too (Number() drops trailing zeros — parseDebt parity)", () => {
    expect(parseRecurringText("প্রতি সপ্তাহে ধোয়া 250.50 টাকা")?.amt).toBe("250.5");
  });
});

/**
 * T33.1 — scale words (লাখ ×100000, কোটি ×10000000) ride along through the
 * shared extractAmount engine, and NUMBER_WORD_TOKENS (which now includes
 * the multiplier words) keeps them out of the category.
 */
describe("parseRecurringText — scale words (T33.1, server parity)", () => {
  it("এক লাখ দুই হাজার → 102000 with the day-phrase stripped first", () => {
    expect(
      parseRecurringText("প্রতি মাসের ৫ তারিখে বাসা ভাড়া এক লাখ দুই হাজার টাকা"),
    ).toEqual({
      freq: "monthly",
      amt: "102000",
      cat: "বাসা ভাড়া",
      monthDay: 5,
      weekDay: null,
    });
  });

  it("category keeps বাসা ভাড়া and never leaks লাখ/কোটি", () => {
    const parsed = parseRecurringText(
      "প্রতি মাসের ৫ তারিখে বাসা ভাড়া এক লাখ দুই হাজার টাকা",
    );
    expect(parsed?.cat).toContain("বাসা ভাড়া");
    expect(parsed?.cat).not.toContain("লাখ");
    expect(parsed?.cat).not.toContain("কোটি");
  });

  it("৫ লাখ → 500000 in a recurring sentence too (digits × scale word)", () => {
    expect(parseRecurringText("প্রতি বছরে বিমা ৫ লাখ টাকা")?.amt).toBe("500000");
  });
});

describe("parseRecurringText — refusals (never save nonsense)", () => {
  it("amount missing → null", () => {
    expect(parseRecurringText("প্রতি মাসে ভাড়া")).toBeNull();
  });

  it("bare প্রতি with no cadence word → null", () => {
    expect(parseRecurringText("প্রতি ৫০০ টাকা")).toBeNull();
  });

  it("garbage → null", () => {
    expect(parseRecurringText("আজকের গল্প")).toBeNull();
    expect(parseRecurringText("")).toBeNull();
  });

  it("no cadence word at all → null even with an amount", () => {
    expect(parseRecurringText("চা ২০ টাকা")).toBeNull();
  });
});
