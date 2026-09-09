import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Report } from "../src/screens/Report";
import { subscribeToasts } from "../src/lib/toast";
import { makeResponse, renderWithProviders, resetLang, stubFetch, type RouteHandler } from "./helpers";

/**
 * T28.3 — Report শেয়ার button: the month summary rides the Web Share API
 * when the browser supports file sharing; jsdom (no navigator.share) must
 * take the downloadCsv fallback and toast the "downloaded" copy.
 */

const after = () => vi.unstubAllGlobals();

beforeEach(() => {
  resetLang();
  // jsdom has neither URL.createObjectURL nor a working anchor click.
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock"),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(URL, "createObjectURL", { value: undefined, writable: true, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: undefined, writable: true, configurable: true });
  vi.restoreAllMocks();
  after();
});

function monthlyHandler(): RouteHandler {
  return (_req, url) => {
    if (url.pathname === "/api/v1/reports/monthly") {
      const ym = url.searchParams.get("ym") ?? "";
      return makeResponse(200, {
        ym,
        total: "2340.50",
        count: 2,
        by_group: { food: "2340.50" },
        by_day: [{ iso: `${ym}-04`, total: "2000.00" }],
      });
    }
    return makeResponse(404, { detail: { code: "not_found", message_bn: "নেই", message_en: "missing" } });
  };
}

describe("Report শেয়ার button", () => {
  it("renders the share button once the monthly report loads", async () => {
    stubFetch(monthlyHandler());
    renderWithProviders(<Report />);

    // Present from mount but disabled until the report query resolves.
    const btn = screen.getByRole("button", { name: "শেয়ার" });
    expect(btn).toBeDisabled();
    await vi.waitFor(() => expect(btn).toBeEnabled());
  });

  it("takes the download fallback in jsdom and toasts ডাউনলোড হয়েছে", async () => {
    stubFetch(monthlyHandler());
    const seen: string[] = [];
    const unsubscribe = subscribeToasts((s) => s && seen.push(s.text));
    renderWithProviders(<Report />);
    const user = userEvent.setup();

    const btn = screen.getByRole("button", { name: "শেয়ার" });
    await vi.waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);

    // Fallback path = a CSV attachment download, not navigator.share.
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toContain('"মোট","2,340.5"');
    expect(text).toContain('"খাদ্য ও মুদি"');
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith("blob:mock");
    await vi.waitFor(() => expect(seen).toContain("ডাউনলোড হয়েছে"));
    unsubscribe();
  });
});
