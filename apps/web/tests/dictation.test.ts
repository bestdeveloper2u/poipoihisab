import { describe, expect, it } from "vitest";
import { collapseRepeatedRuns } from "../src/lib/dictation";

describe("collapseRepeatedRuns (bn-BD engine stutter)", () => {
  it("collapses a 4× head-word stutter — owner screenshot 11:31", () => {
    expect(collapseRepeatedRuns("ডিম ডিম ডিম ডিম ১৫০")).toBe("ডিম ১৫০");
  });

  it("collapses a repeated phrase from re-speaking", () => {
    expect(collapseRepeatedRuns("রিক্সা ভাড়া রিক্সা ভাড়া ২০ টাকা")).toBe(
      "রিক্সা ভাড়া ২০ টাকা",
    );
  });

  it("keeps clean text and single words untouched", () => {
    expect(collapseRepeatedRuns("চা ২০ টাকা")).toBe("চা ২০ টাকা");
    expect(collapseRepeatedRuns("ডিম")).toBe("ডিম");
    expect(collapseRepeatedRuns("")).toBe("");
    expect(collapseRepeatedRuns("   ")).toBe("");
  });

  it("collapses repeated english phrases and triple runs", () => {
    expect(collapseRepeatedRuns("bus fare bus fare 40")).toBe("bus fare 40");
    expect(collapseRepeatedRuns("ডিম ডিম ডিম ১৫০")).toBe("ডিম ১৫০");
  });

  it("does not touch non-adjacent repeats", () => {
    expect(collapseRepeatedRuns("ডিম ২০ চা ১০ ডিম ২০")).toBe(
      "ডিম ২০ চা ১০ ডিম ২০",
    );
  });
});
