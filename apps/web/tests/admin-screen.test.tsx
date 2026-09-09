import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import App from "../src/App";
import { useAuthStore } from "../src/store/auth";
import { w } from "../src/lib/web-i18n";
import {
  makeQueryClient,
  makeResponse,
  resetLang,
  stubFetch,
  type RouteHandler,
} from "./helpers";

const after = () => vi.unstubAllGlobals();
beforeEach(resetLang);
afterEach(after);

const SUPER_ADMIN = {
  id: "admin-uuid-1",
  email: "admin@poipoihisab.com",
  name: "Super Admin",
  isSuperadmin: true,
  isSuspended: false,
};

const REGULAR_USER = {
  id: "user-uuid-1",
  email: "user@poipoihisab.com",
  name: "Regular User",
  isSuperadmin: false,
  isSuspended: false,
};

function adminHandler(): RouteHandler {
  let userDeleted = false;
  return (_req, url) => {
    const p = url.pathname;
    if (p === "/api/v1/admin/stats") {
      return makeResponse(200, {
        total_users: userDeleted ? 14 : 15,
        total_expenses: 120,
        total_amount: "350000.00",
        total_debts: 8,
        active_recurring: 5,
      });
    }
    if (p === "/api/v1/admin/users") {
      return makeResponse(200, {
        items: userDeleted
          ? []
          : [
              {
                id: "target-user-42",
                name: "Rahim Mia",
                email: "rahim@example.com",
                createdAt: "2026-08-01T10:00:00Z",
                isSuperadmin: false,
                isSuspended: false,
                expenseCount: 45,
                totalExpense: "78000.00",
                debtCount: 3,
                budgetCount: 1,
                recurringCount: 2,
                theme: "system",
                lang: "bn",
              },
            ],
        total: userDeleted ? 0 : 1,
      });
    }
    if (p === "/api/v1/admin/users/target-user-42/suspend") {
      return makeResponse(200, {
        success: true,
        message: "User suspended successfully",
      });
    }
    if (p === "/api/v1/admin/users/target-user-42" && _req.method === "DELETE") {
      userDeleted = true;
      return makeResponse(200, {
        success: true,
        message: "User deleted successfully",
      });
    }
    if (p === "/api/v1/admin/users/bulk-suspend") {
      return makeResponse(200, {
        success: true,
        affectedCount: 1,
        message: "Successfully suspended 1 user(s)",
      });
    }
    if (p === "/api/v1/admin/users/bulk-delete") {
      userDeleted = true;
      return makeResponse(200, {
        success: true,
        affectedCount: 1,
        message: "Successfully deleted 1 user(s)",
      });
    }
    if (p === "/api/v1/admin/export/users.csv") {
      return new Response("\uFEFFUser ID,Name,Email\r\n1,Rahim,rahim@example.com", {
        status: 200,
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      });
    }
    if (p === "/api/v1/admin/import/users") {
      return makeResponse(200, {
        success: true,
        createdCount: 2,
        skippedCount: 0,
        errors: [],
      });
    }
    if (p === "/api/v1/admin/users/target-user-42") {
      return makeResponse(200, {
        user: {
          id: "target-user-42",
          name: "Rahim Mia",
          email: "rahim@example.com",
          createdAt: "2026-08-01T10:00:00Z",
          isSuperadmin: false,
          isSuspended: false,
          expenseCount: 45,
          totalExpense: "78000.00",
          debtCount: 3,
          budgetCount: 1,
          recurringCount: 2,
          theme: "system",
          lang: "bn",
        },
        current_month_expense: "12000.00",
        net_debt: "-500.00",
        total_borrow: "2500.00",
        total_lend: "2000.00",
        budget: {
          total: "30000.00",
          cats: { food: "15000.00" },
          updated_at: "2026-08-01T12:00:00Z",
        },
      });
    }
    if (p === "/api/v1/admin/users/target-user-42/expenses") {
      return makeResponse(200, {
        items: [
          {
            id: "exp-1",
            iso: "2026-09-01",
            cat: "বাজার",
            amt: "1200.00",
            grp: "food",
            pay: "cash",
            desc: "সবজি ও মাছ",
            created_at: "2026-09-01T08:00:00Z",
            user_id: "target-user-42",
          },
        ],
        total: 1,
      });
    }
    if (p === "/api/v1/admin/users/target-user-42/debts") {
      return makeResponse(200, {
        items: [
          {
            id: "debt-1",
            party: "Karim",
            dir: "lend",
            amt: "2000.00",
            iso: "2026-09-01",
            note: "জরুরি ধার",
            settled_at: null,
            created_at: "2026-09-01T08:00:00Z",
            user_id: "target-user-42",
          },
        ],
        total: 1,
      });
    }
    if (p === "/api/v1/admin/users/target-user-42/recurring") {
      return makeResponse(200, {
        items: [
          {
            id: "rec-1",
            cat: "বাসা ভাড়া",
            amt: "15000.00",
            grp: "housing",
            freq: "monthly",
            start_date: "2026-01-01",
            next_run: "2026-10-01",
            active: true,
            pay: "bank",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            user_id: "target-user-42",
          },
        ],
        total: 1,
      });
    }
    return makeResponse(404, { detail: "not found" });
  };
}

function renderApp(route: string) {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Super Admin Dashboard & User Inspector", () => {
  it("renders Super Admin dashboard, lists users, and opens user inspector on click", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    // Wait for the admin title to render
    expect(await screen.findByText("সুপার অ্যাডমিন ড্যাশবোর্ড")).toBeInTheDocument();

    // Verify user row appears with user's name
    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();

    // Click on the inspect button to open inspector
    const inspectBtn = await screen.findByRole("button", { name: w("bn", "adminInspect") });
    expect(inspectBtn).toBeInTheDocument();
    fireEvent.click(inspectBtn);

    // Inspector modal opens showing user details
    await waitFor(() => {
      expect(screen.getByText("সবজি ও মাছ")).toBeInTheDocument();
    });

    // Check expense details inside the inspector
    expect(screen.getByText("বাজার")).toBeInTheDocument();

    // Click on Debts tab inside inspector
    const debtsTab = screen.getByRole("button", { name: /ধার-দেনা/i });
    fireEvent.click(debtsTab);
    expect(await screen.findByText("Karim")).toBeInTheDocument();
    expect(screen.getByText("জরুরি ধার")).toBeInTheDocument();

    // Click on Recurring tab inside inspector
    const recurringTab = screen.getByRole("button", { name: /পুনরাবৃত্ত/i });
    fireEvent.click(recurringTab);
    expect(await screen.findByText("বাসা ভাড়া")).toBeInTheDocument();
  });

  it("redirects regular non-superadmin user away from /admin", async () => {
    useAuthStore.setState({
      status: "authed",
      user: REGULAR_USER,
      accessToken: "user-jwt-token",
      refreshToken: null,
    });

    stubFetch((_req, url) => {
      if (url.pathname.includes("/reports") || url.pathname.includes("/budgets")) {
        return makeResponse(200, { ym: "2026-09", total: "0.00", count: 0, by_group: {}, by_day: [] });
      }
      return makeResponse(404, { detail: "not found" });
    });

    renderApp("/admin");

    // Non-superadmin redirected to dashboard
    await waitFor(() => {
      expect(screen.queryByText("সুপার অ্যাডমিন ড্যাশবোর্ড")).not.toBeInTheDocument();
    });
  });

  it("allows super admin to suspend and reactivate a user with confirmation", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    // Wait for table to load
    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    expect(screen.getByText(w("bn", "adminStatusActive"))).toBeInTheDocument();

    // Click Suspend button in table
    const suspendBtn = screen.getByRole("button", { name: w("bn", "adminSuspend") });
    fireEvent.click(suspendBtn);

    // Confirmation modal should appear with confirmation warning
    expect(await screen.findByText(w("bn", "adminConfirmSuspend"))).toBeInTheDocument();

    // Click confirmation button in modal (the last button with name adminSuspend)
    const confirmButtons = screen.getAllByRole("button", { name: w("bn", "adminSuspend") });
    const modalConfirmBtn = confirmButtons[confirmButtons.length - 1];
    fireEvent.click(modalConfirmBtn);

    // Badge should update to suspended
    await waitFor(() => {
      expect(screen.getByText(w("bn", "adminStatusSuspended"))).toBeInTheDocument();
    });
    // Button in table should change to Unsuspend
    expect(screen.getByRole("button", { name: w("bn", "adminUnsuspend") })).toBeInTheDocument();
  });

  it("allows super admin to permanently delete a user with confirmation", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();

    // Click Delete button in table
    const deleteBtn = screen.getByRole("button", { name: w("bn", "adminDelete") });
    fireEvent.click(deleteBtn);

    // Confirmation modal should appear
    expect(await screen.findByText(w("bn", "adminConfirmDelete"))).toBeInTheDocument();

    // Click confirmation button in modal
    const confirmDeleteBtns = screen.getAllByRole("button", { name: w("bn", "adminDelete") });
    const modalDeleteBtn = confirmDeleteBtns[confirmDeleteBtns.length - 1];
    fireEvent.click(modalDeleteBtn);

    // User should be removed from table
    await waitFor(() => {
      expect(screen.queryByText("Rahim Mia")).not.toBeInTheDocument();
    });
  });

  it("supports bulk selection, shows floating action bar, and triggers bulk suspend", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();

    // Select row via checkbox
    const rowCheckbox = screen.getByLabelText("Select Rahim Mia");
    expect(rowCheckbox).toBeInTheDocument();
    fireEvent.click(rowCheckbox);

    // Floating action bar should appear with count and action buttons
    expect(screen.getByText(w("bn", "adminBulkSuspend"))).toBeInTheDocument();
    expect(screen.getByText(w("bn", "adminBulkDelete"))).toBeInTheDocument();

    // Click bulk suspend
    fireEvent.click(screen.getByText(w("bn", "adminBulkSuspend")));

    // Bulk modal should open
    expect(await screen.findByText(w("bn", "adminBulkConfirmSuspend"))).toBeInTheDocument();

    // Confirm bulk suspend
    const modalButtons = screen.getAllByRole("button", { name: w("bn", "adminBulkSuspend") });
    const modalConfirmBtn = modalButtons[modalButtons.length - 1];
    fireEvent.click(modalConfirmBtn);

    // User status should update to suspended
    await waitFor(() => {
      expect(screen.getByText(w("bn", "adminStatusSuspended"))).toBeInTheDocument();
    });
  });

  it("allows opening the CSV import modal with dropzone and sample download", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();

    // Open import modal
    const importBtn = screen.getByRole("button", { name: w("bn", "adminImportUsers") });
    fireEvent.click(importBtn);

    // Modal contents should be visible
    expect(await screen.findByText(w("bn", "adminImportModalTitle"))).toBeInTheDocument();
    expect(screen.getByText(w("bn", "adminImportUploadPrompt"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(w("bn", "adminImportTemplate")))).toBeInTheDocument();
  });

  it("renders export CSV button in the admin toolbar", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();

    const exportBtn = screen.getByRole("button", { name: w("bn", "adminExportCsv") });
    expect(exportBtn).toBeInTheDocument();
  });

  it("supports bulk permanent deletion with confirmation modal", async () => {
    useAuthStore.setState({
      status: "authed",
      user: SUPER_ADMIN,
      accessToken: "admin-jwt-token",
      refreshToken: null,
    });

    stubFetch(adminHandler());
    renderApp("/admin");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();

    // Select row via checkbox
    const rowCheckbox = screen.getByLabelText("Select Rahim Mia");
    fireEvent.click(rowCheckbox);

    // Click bulk delete
    const bulkDeleteBtn = screen.getByText(w("bn", "adminBulkDelete"));
    fireEvent.click(bulkDeleteBtn);

    // Bulk delete confirmation modal should appear
    expect(await screen.findByText(w("bn", "adminBulkConfirmDelete"))).toBeInTheDocument();

    // Confirm bulk delete
    const modalButtons = screen.getAllByRole("button", { name: w("bn", "adminBulkDelete") });
    const modalConfirmBtn = modalButtons[modalButtons.length - 1];
    fireEvent.click(modalConfirmBtn);

    // User should be removed from table
    await waitFor(() => {
      expect(screen.queryByText("Rahim Mia")).not.toBeInTheDocument();
    });
  });
});

