// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../src/screens/Settings";
import { useLangStore } from "../src/store/lang";
import { toast } from "../src/lib/toast";

const calls = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("@poipoihisab/api-client", async (original) => ({ ...await original<object>(), api: calls }));
vi.mock("../src/components/DataSafety", () => ({ DataSafety: () => null }));
vi.mock("../src/components/SessionsCard", () => ({ SessionsCard: () => null }));
vi.mock("../src/components/InstallChip", () => ({ InstallChip: () => null }));
vi.mock("../src/lib/toast", () => ({ toast: vi.fn() }));

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
  calls.POST.mockResolvedValue({ data: { rows: 3 } });
});
afterEach(cleanup);

describe("Sheets settings card", () => {
  it("shows sharing instructions, persists input and exports the current month", async () => {
    mount();
    expect(await screen.findByText(/export@example.iam.gserviceaccount.com/)).toBeInTheDocument();
    const input = screen.getByLabelText("Google Sheets URL or ID");
    fireEvent.change(input, { target: { value: "https://docs.google.com/spreadsheets/d/sheet123/edit" } });
    fireEvent.blur(input);
    expect(localStorage.getItem("dh.sheets.sheet")).toContain("sheet123");
    fireEvent.click(screen.getByRole("button", { name: "Sync this month" }));
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    await waitFor(() => expect(calls.POST).toHaveBeenCalledWith("/api/v1/export/sheets", { body: { sheet: "sheet123", month } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("✓ 3 rows exported"));
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
    resolve({ data: { rows: 2 } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("✓ 2 rows exported"));
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
    await waitFor(() => expect(toast).toHaveBeenCalledWith("✓ ৩ সারি এক্সপোর্ট হয়েছে"));
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
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("Could not export to Sheets")));
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
