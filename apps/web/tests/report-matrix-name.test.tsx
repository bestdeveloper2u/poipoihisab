// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { W } from "../src/lib/web-i18n";
import { Report } from "../src/screens/Report";
import { useLangStore } from "../src/store/lang";
import { makeExpense, makeResponse, makeQueryClient, resetLang, stubFetch, type RouteHandler } from "./helpers";

const after = () => vi.unstubAllGlobals();

afterEach(after);

function mount() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <Report />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function reportHandler(empty = false): RouteHandler {
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

    if (url.pathname === "/api/v1/reports/yearly") {
      const year = url.searchParams.get("year") ?? "";
      if (empty) {
        return makeResponse(200, {
          year: Number(year),
          total: "0.00",
          count: 0,
          by_group: {},
          by_month: [],
        });
      }
      return makeResponse(200, {
        year: Number(year),
        total: "32340.50",
        count: 12,
        by_group: { food: "20340.50", transport: "12000.00" },
        by_month: [
          { ym: `${year}-08`, total: "30000.00" },
          { ym: `${year}-09`, total: "2340.50" },
        ],
      });
    }

    if (url.pathname === "/api/v1/expenses") {
      // Mirror the live API contract: oversized pages must not silently pass mocks.
      if (Number(url.searchParams.get("limit")) > 100) {
        return makeResponse(422, { detail: "limit must be <= 100" });
      }
      if (empty) {
        return makeResponse(200, { items: [], next_cursor: null });
      }
      const year = (url.searchParams.get("from") ?? new Date().getFullYear().toString()).slice(0, 4);
      return makeResponse(200, {
        items: [
          makeExpense({
            cat: "মাছ",
            grp: "food",
            amt: "20340.50",
            iso: `${year}-08-04`,
            created_at: `${year}-08-04T00:00:00Z`,
          }),
          makeExpense({
            id: "33333333-3333-4333-8333-333333333333",
            cat: "রিকশা",
            grp: "transport",
            amt: "12000.00",
            iso: `${year}-09-04`,
            created_at: `${year}-09-04T00:00:00Z`,
          }),
        ],
        next_cursor: null,
      });
    }

    return makeResponse(404, { detail: { code: "not_found", message_bn: "নেই", message_en: "missing" } });
  };
}

beforeEach(() => {
  resetLang();
});

describe("Report yearly matrix accessible name", () => {
  it.each([
    ["bn", W.bn.matrixLbl],
    ["en", W.en.matrixLbl],
  ] as const)("uses the localized heading as the table name in %s", async (lang, matrixLabel) => {
    useLangStore.setState({ lang });
    stubFetch(reportHandler(false));
    const user = userEvent.setup();
    mount();

    await screen.findByRole("button", { name: W[lang].yearly });
    await user.click(screen.getByRole("button", { name: W[lang].yearly }));

    expect(await screen.findByRole("heading", { name: matrixLabel })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: matrixLabel })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: matrixLabel });
    expect(region).toHaveAttribute("tabindex", "0");
    region.focus();
    expect(region).toHaveFocus();
  });

  it("updates the table name when the language switches without remounting", async () => {
    stubFetch(reportHandler(false));
    const user = userEvent.setup();
    mount();

    await screen.findByRole("button", { name: W.bn.yearly });
    await user.click(screen.getByRole("button", { name: W.bn.yearly }));

    expect(await screen.findByRole("table", { name: W.bn.matrixLbl })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: W.bn.matrixLbl })).toBeInTheDocument();

    act(() => useLangStore.setState({ lang: "en" }));

    expect(await screen.findByRole("table", { name: W.en.matrixLbl })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: W.en.matrixLbl })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: W.bn.matrixLbl })).not.toBeInTheDocument();
  });

  it("does not render the yearly matrix table when the yearly report is empty", async () => {
    stubFetch(reportHandler(true));
    const user = userEvent.setup();
    mount();

    await screen.findByRole("button", { name: W.bn.yearly });
    await user.click(screen.getByRole("button", { name: W.bn.yearly }));

    expect(screen.getAllByText(W.bn.noData)).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: W.bn.matrixLbl })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: W.bn.matrixLbl })).not.toBeInTheDocument();
  });
});
