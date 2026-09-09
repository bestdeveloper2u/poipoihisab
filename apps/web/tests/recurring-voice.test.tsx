import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Recurring as RecurringRule } from "@poipoihisab/api-client";
import { VoiceOverlay } from "../src/components/VoiceOverlay";
import { Recurring } from "../src/screens/Recurring";
import { subscribeToasts } from "../src/lib/toast";
import { todayIso } from "../src/lib/catalog";
import {
  makeResponse,
  renderWithProviders,
  resetLang,
  stubFetch,
  type RouteHandler,
} from "./helpers";

/**
 * T29.2 — recurring voice mode end-to-end on-device (ADR-0029): the overlay
 * parses locally (ZERO network — asserted), prefills an always-editable
 * review card, and only an explicit সংরক্ষণ hands the rule to the screen,
 * which POSTs /recurring with sane defaults and toasts.
 */

beforeEach(resetLang);
afterEach(() => vi.unstubAllGlobals());

describe("VoiceOverlay mode=recurring (review card, never auto-save)", () => {
  it("parses on-device, prefills the editable card, and confirms exactly once", async () => {
    // Anything touching the network must FAIL the flow — recurring is 100% local.
    const fetchMock = stubFetch(() =>
      makeResponse(500, { detail: { code: "no_network_allowed", message_bn: "নেটওয়ার্ক নিষিদ্ধ" } }),
    );
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <VoiceOverlay open onClose={onClose} mode="recurring" onConfirm={onConfirm} />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox"), "প্রতি মাসের ৫ তারিখে ভাড়া ৮০০০ টাকা");
    await user.click(screen.getByRole("button", { name: "যোগ করুন" }));

    // Card prefilled by the parser — every field editable, nothing saved.
    expect(await screen.findByRole("group", { name: "কত দিন পর পর" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "মাসিক" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("পরিমাণ (৳)")).toHaveValue("8000");
    expect(screen.getByLabelText("খাত")).toHaveValue("ভাড়া");
    expect(screen.getByLabelText("মাসের তারিখ (১–৩১)")).toHaveValue(5);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // On-device: no /voice/parse, no fetch at all (zero AI/token cost).
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "সংরক্ষণ" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      freq: "monthly",
      amt: "8000",
      cat: "ভাড়া",
      monthDay: 5,
      weekDay: null,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("weekly parse prefills the weekday select; user fixes fields before confirming", async () => {
    stubFetch(() => makeResponse(500, {}));
    const onConfirm = vi.fn();
    renderWithProviders(
      <VoiceOverlay open onClose={() => {}} mode="recurring" onConfirm={onConfirm} />,
    );
    const user = userEvent.setup();

    await user.type(screen.getByRole("textbox"), "প্রতি সপ্তাহে শনিবার বাজার ৫০০");
    await user.click(screen.getByRole("button", { name: "যোগ করুন" }));

    expect(await screen.findByRole("button", { name: "সাপ্তাহিক" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Weekday select prefilled to শনিবার (value 6) with the full name list.
    const wd = screen.getByLabelText("বার");
    expect(wd).toHaveValue("6");
    expect(wd).toContainHTML("শনিবার");

    // Review means review — edit the amount, then confirm the EDITED rule.
    await user.clear(screen.getByLabelText("পরিমাণ (৳)"));
    await user.type(screen.getByLabelText("পরিমাণ (৳)"), "600");
    await user.click(screen.getByRole("button", { name: "সংরক্ষণ" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      freq: "weekly",
      amt: "600",
      cat: "বাজার",
      monthDay: null,
      weekDay: 6,
    });
  });

  it("unparsable transcript parks at the কিছু বোঝা যায়নি hint and never confirms", async () => {
    stubFetch(() => makeResponse(500, {}));
    const onConfirm = vi.fn();
    renderWithProviders(
      <VoiceOverlay open onClose={() => {}} mode="recurring" onConfirm={onConfirm} />,
    );
    const user = userEvent.setup();

    // Amount missing → null → same "nothing recognized" path as other modes.
    await user.type(screen.getByRole("textbox"), "প্রতি মাসে ভাড়া");
    await user.click(screen.getByRole("button", { name: "যোগ করুন" }));

    expect(await screen.findByText("কিছু বোঝা যায়নি — আবার লিখুন")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("প্রতি মাসে ভাড়া");
    expect(screen.getByRole("button", { name: "যোগ করুন" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "সংরক্ষণ" })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/* ------------------------------- the screen ------------------------------- */

const NEW_RULE: RecurringRule = {
  id: "r9",
  cat: "বাজার",
  grp: "other",
  amt: "500.00",
  pay: "cash",
  desc: null,
  freq: "weekly",
  start_date: todayIso(),
  next_run: todayIso(),
  active: true,
  created_at: "2026-09-07T00:00:00Z",
  updated_at: "2026-09-07T00:00:00Z",
  user_id: "u1",
};

/** Local Date → YYYY-MM-DD (mirrors the screen's voiceStartDate mapping). */
function nextWeekdayIso(weekDay: number): string {
  const t = todayIso().split("-").map(Number);
  const target = new Date(t[0], t[1] - 1, t[2]);
  target.setDate(target.getDate() + ((weekDay - target.getDay() + 7) % 7));
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${target.getFullYear()}-${mm}-${dd}`;
}

describe("Recurring screen mic → voice rule (POST + toast)", () => {
  it("mic opens the overlay; confirmed rule POSTs with sane defaults and toasts", async () => {
    const posts: Array<Record<string, unknown>> = [];
    const handler: RouteHandler = (req, url) => {
      if (req.method === "GET" && url.pathname === "/api/v1/recurring") {
        return makeResponse(200, { items: [], next_cursor: null });
      }
      if (req.method === "POST" && url.pathname === "/api/v1/recurring") {
        return req.json().then((body) => {
          posts.push(body as Record<string, unknown>);
          return makeResponse(201, { ...NEW_RULE, ...(body as object) });
        });
      }
      return makeResponse(404, { detail: { code: "not_found", message_bn: "নেই", message_en: "missing" } });
    };
    stubFetch(handler);
    const seen: string[] = [];
    const unsubscribe = subscribeToasts((s) => s && seen.push(s.text));

    const qc = (await import("@tanstack/react-query")).QueryClient;
    render(
      <QueryClientProvider
        client={new qc({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
      >
        <Recurring />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    // Mic button on the recurring screen opens the voice overlay.
    await screen.findByRole("button", { name: "ভয়েসে বলুন" });
    await user.click(screen.getByRole("button", { name: "ভয়েসে বলুন" }));
    expect(await screen.findByRole("dialog", { name: "ভয়েসে পুনরাবৃত্ত যোগ করুন" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "প্রতি সপ্তাহে শনিবার বাজার ৫০০");
    await user.click(screen.getByRole("button", { name: "যোগ করুন" }));
    await user.click(await screen.findByRole("button", { name: "সংরক্ষণ" }));

    // The SCREEN owns the POST: RecurringIn with grp other / pay cash and
    // start_date mapped to the next matching weekday (শনিবার = 6).
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      cat: "বাজার",
      grp: "other",
      amt: "500.00",
      pay: "cash",
      freq: "weekly",
      desc: null,
      start_date: nextWeekdayIso(6),
    });
    await waitFor(() => expect(seen).toContain("পুনরাবৃত্ত সংরক্ষিত"));
    unsubscribe();
  });
});
