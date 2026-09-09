// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../src/screens/Settings";
import { useLangStore } from "../src/store/lang";
import { toast } from "../src/lib/toast";
import type { SheetsExport } from "../src/lib/sheets";

const calls = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("@poipoihisab/api-client", async (original) => ({ ...await original<object>(), api: calls }));
vi.mock("../src/components/DataSafety", () => ({ DataSafety: () => null }));
vi.mock("../src/components/SessionsCard", () => ({ SessionsCard: () => null }));
vi.mock("../src/components/InstallChip", () => ({ InstallChip: () => null }));
vi.mock("../src/lib/toast", () => ({ toast: vi.fn() }));

/**
 * A full sync response. Spelled out rather than partial so a field added to
 * the contract shows up here as a decision, and so the card is never tested
 * against a body the API cannot send.
 */
function synced(overrides: Partial<SheetsExport> = {}): SheetsExport {
  return {
    rows: 0,
    months: [],
    unmapped: [],
    debts: 0,
    budget_categories: 0,
    recurring: 0,
    skipped_tabs: ["ধার-দেনা", "বাজেট", "পুনরাবৃত্ত খরচ"],
    ...overrides,
  };
}

function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><Settings /></MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLangStore.setState({ lang: "en" });
  calls.GET.mockResolvedValue({ data: { configured: true, sa_email: "export@example.iam.gserviceaccount.com" } });
  calls.POST.mockResolvedValue({ data: synced({ rows: 3 }) });
});
afterEach(cleanup);

describe("Sheets settings card", () => {
  it("shows sharing instructions, persists input and exports the current month", async () => {
    mount();
    expect(await screen.findByText(/export@example.iam.gserviceaccount.com/)).toBeInTheDocument();
    expect(screen.getByText(/Sync replaces existing entries/)).toBeInTheDocument();
    const input = screen.getByLabelText("Google Sheets URL or ID");
    fireEvent.change(input, { target: { value: "https://docs.google.com/spreadsheets/d/sheet123/edit" } });
    fireEvent.blur(input);
    expect(localStorage.getItem("dh.sheets.sheet")).toContain("sheet123");
    fireEvent.click(screen.getByRole("button", { name: "Sync this month" }));
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    await waitFor(() => expect(calls.POST).toHaveBeenCalledWith("/api/v1/export/sheets", { body: { sheet: "sheet123", month } }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "✓ 3 rows exported — Not in the sheet: ধার-দেনা, বাজেট, পুনরাবৃত্ত খরচ — use the updated template",
      ),
    );
  });

  it("syncs all time and guards against duplicate clicks while loading", async () => {
    localStorage.setItem("dh.sheets.sheet", "sheet123");
    let resolve!: (value: unknown) => void;
    calls.POST.mockReturnValue(new Promise((done) => { resolve = done; }));
    mount();
    const button = screen.getByRole("button", { name: "Sync all" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(calls.POST).toHaveBeenCalledTimes(1);
    expect(calls.POST).toHaveBeenCalledWith("/api/v1/export/sheets", { body: { sheet: "sheet123", month: null } });
    expect(screen.getByRole("button", { name: "Sync this month" })).toBeDisabled();
    // A workbook with all three ledger tabs: the counts are what the sheet
    // now holds, and nothing is reported as skipped.
    resolve({ data: synced({ rows: 2, debts: 4, budget_categories: 7, recurring: 2, skipped_tabs: [] }) });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("✓ 2 rows exported — Debts 4, budget 7, recurring 2"),
    );
  });

  it("shows the Bengali error triple and Bengali success count", async () => {
    useLangStore.setState({ lang: "bn" });
    localStorage.setItem("dh.sheets.sheet", "sheet123");
    calls.POST.mockResolvedValueOnce({ error: { detail: { code: "sheets_not_shared", message_bn: "শিট শেয়ার করুন", message_en: "Share the sheet" } }, response: { status: 403 } });
    mount();
    const button = screen.getByRole("button", { name: "সব সিঙ্ক করুন" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(toast).toHaveBeenCalledWith("শিট শেয়ার করুন"));
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "✓ ৩ সারি এক্সপোর্ট হয়েছে — শিটে নেই: ধার-দেনা, বাজেট, পুনরাবৃত্ত খরচ — হালনাগাদ টেমপ্লেট ব্যবহার করুন",
      ),
    );
  });

  it("names the ledger counts, the tabs the workbook lacks and the unlisted categories", async () => {
    localStorage.setItem("dh.sheets.sheet", "sheet123");
    calls.POST.mockResolvedValue({
      data: synced({
        rows: 5,
        months: ["সেপ্টেম্বর ২০২৬"],
        debts: 2,
        budget_categories: 3,
        recurring: 1,
        skipped_tabs: ["পুনরাবৃত্ত খরচ"],
        unmapped: ["রিক্সা", "অচেনা খাত", "আরেকটা", "চতুর্থ"],
      }),
    });
    mount();
    const button = screen.getByRole("button", { name: "Sync all" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    // Three categories named and the remainder counted: a toast is one line,
    // and an unlisted-category list has no upper bound.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "✓ 5 rows exported — Debts 2, budget 3, recurring 1 — Not in the sheet: পুনরাবৃত্ত খরচ — use the updated template — Not in the category list: রিক্সা, অচেনা খাত, আরেকটা +1",
      ),
    );
  });

  it("rejects invalid references without making an export request", async () => {
    mount();
    await screen.findByText(/export@example.iam.gserviceaccount.com/);
    fireEvent.change(screen.getByLabelText("Google Sheets URL or ID"), { target: { value: "https://evil.example/sheet" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid Google Sheets URL or sheet ID.");
    expect(screen.getByRole("button", { name: "Sync all" })).toBeDisabled();
    expect(calls.POST).not.toHaveBeenCalled();
  });

  it("handles network failures and restores the sync buttons", async () => {
    localStorage.setItem("dh.sheets.sheet", "sheet123");
    calls.POST.mockRejectedValue(new Error("offline"));
    mount();
    const button = screen.getByRole("button", { name: "Sync all" });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("Could not confirm the Sheets export")));
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("disables sync when not configured", async () => {
    calls.GET.mockResolvedValue({ data: { configured: false, sa_email: null } });
    localStorage.setItem("dh.sheets.sheet", "sheet123");
    mount();
    expect(await screen.findByText("Google Sheets export is not configured on the server.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync all" })).toBeDisabled();
  });
});
