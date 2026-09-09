/**
 * Superadmin shell tests.
 *
 * Owner decision 2026-09-09: "superadmin no need hisab entry, other user
 * need this." The single Admin screen became an operator shell — its own
 * navigation tree, no add-expense FABs, and the old one-page dashboard
 * split across /admin, /admin/users, /admin/users/:id and /admin/data.
 * These tests pin that split, plus the screens added with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const TARGET = "target-user-42";

function targetRow(suspended = false) {
  return {
    id: TARGET,
    name: "Rahim Mia",
    email: "rahim@example.com",
    createdAt: "2026-08-01T10:00:00Z",
    isSuperadmin: false,
    isSuspended: suspended,
    expenseCount: 45,
    totalExpense: "78000.00",
    debtCount: 3,
    budgetCount: 1,
    recurringCount: 2,
    theme: "light",
    lang: "bn",
  };
}

/**
 * One handler for every admin endpoint the shell touches. Keys off the
 * camelCase wire format the API actually emits (the pre-split fixture used
 * snake_case for /admin/stats, so the KPI values were silently undefined).
 */
function adminHandler(): RouteHandler {
  let userDeleted = false;
  return (req, url) => {
    const p = url.pathname;

    if (p === "/api/v1/admin/stats") {
      return makeResponse(200, {
        totalUsers: userDeleted ? 14 : 15,
        totalExpenses: 120,
        totalAmount: "350000.00",
        totalDebts: 8,
        activeRecurring: 5,
        activeUsers30d: 9,
        newUsers30d: 4,
        suspendedUsers: 1,
        superadminCount: 2,
        monthAmount: "42000.00",
      });
    }
    if (p === "/api/v1/admin/system") {
      return makeResponse(200, {
        env: "prod",
        version: "0.28.0",
        dbDialect: "postgresql",
        dbOk: true,
        dbError: null,
        kvBackend: "MemoryKV",
        kvEphemeral: true,
        kvConfigured: false,
        migrationCurrent: "0007",
        auditTablePresent: true,
        corsOrigins: ["https://poipoihisab.app"],
        superadminEmails: ["admin@poipoihisab.com"],
        refreshCookieSecure: true,
        accessTtl: 900,
        refreshTtl: 2592000,
        authRateLimit: 5,
        serverTime: "2026-09-09T09:00:00Z",
        warnings: ["Set POIPOIHISAB_KV_URL — sessions are lost on restart."],
      });
    }
    if (p === "/api/v1/admin/audit") {
      return makeResponse(200, {
        items: [
          {
            id: "audit-1",
            actorId: SUPER_ADMIN.id,
            actorEmail: SUPER_ADMIN.email,
            action: "user.bulk_delete",
            targetType: "user",
            targetId: TARGET,
            targetLabel: "Rahim Mia <rahim@example.com>",
            affected: 3,
            detail: "cascade over 3 accounts",
            ip: "203.0.113.9",
            createdAt: "2026-09-09T08:30:00Z",
          },
        ],
        total: 1,
        actions: ["user.bulk_delete", "user.suspend"],
      });
    }
    if (p === "/api/v1/admin/sessions") {
      return makeResponse(200, {
        items: [
          {
            userId: TARGET,
            name: "Rahim Mia",
            email: "rahim@example.com",
            isSuperadmin: false,
            isSuspended: false,
            sessionCount: 3,
            maxExpiresIn: 2592000,
          },
        ],
        totalSessions: 3,
        usersScanned: 15,
        kvBackend: "MemoryKV",
        kvEphemeral: true,
      });
    }
    if (p === `/api/v1/admin/users/${TARGET}/revoke-sessions`) {
      return makeResponse(200, {
        success: true,
        revoked: 3,
        message: "Revoked 3 session(s) for Rahim Mia",
      });
    }
    if (p === `/api/v1/admin/users/${TARGET}/role`) {
      return makeResponse(200, { success: true, message: "Superadmin granted to Rahim Mia" });
    }
    if (p === "/api/v1/admin/categories") {
      return makeResponse(200, {
        items: [
          { cat: "রিক্সা", grp: "transport", count: 12, amount: "600.00", userCount: 4 },
          { cat: "রিকশা", grp: "transport", count: 3, amount: "180.00", userCount: 1 },
        ],
        total: 2,
      });
    }
    if (p === "/api/v1/admin/categories/merge") {
      return makeResponse(200, {
        success: true,
        affectedCount: 12,
        message: "Merged 'রিক্সা' into 'রিকশা' across 12 expense(s)",
      });
    }
    if (p === "/api/v1/admin/analytics") {
      return makeResponse(200, {
        byGroup: [{ label: "food", count: 80, amount: "200000.00" }],
        byCategory: [{ label: "বাজার", count: 40, amount: "120000.00" }],
        byPayment: [{ label: "cash", count: 100, amount: "300000.00" }],
        trend: [
          { month: "2026-08", expenses: 60, amount: "45356.00", newUsers: 2 },
          { month: "2026-09", expenses: 60, amount: "42000.00", newUsers: 4 },
        ],
        topUsers: [
          {
            userId: TARGET,
            name: "Rahim Mia",
            email: "rahim@example.com",
            expenseCount: 45,
            totalExpense: "78000.00",
          },
        ],
        debtLend: "2000.00",
        debtBorrow: "2500.00",
      });
    }
    if (p === "/api/v1/admin/integrations") {
      return makeResponse(200, {
        sheetsConfigured: true,
        sheetsSaFile: "(inline JSON)",
        sheetsSaEmail: "svc@example.iam.gserviceaccount.com",
        sheetsDetail: null,
        voiceParser: "on-device (browser SpeechRecognition)",
        usersTotal: 15,
      });
    }
    if (p === "/api/v1/admin/users") {
      return makeResponse(200, {
        items: userDeleted ? [] : [targetRow()],
        total: userDeleted ? 0 : 1,
      });
    }
    if (p === `/api/v1/admin/users/${TARGET}/suspend`) {
      return makeResponse(200, { success: true, message: "User suspended successfully" });
    }
    if (p === `/api/v1/admin/users/${TARGET}` && req.method === "DELETE") {
      userDeleted = true;
      return makeResponse(200, { success: true, message: "User deleted successfully" });
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
      return new Response("﻿User ID,Name,Email\r\n1,Rahim,rahim@example.com", {
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
    if (p === `/api/v1/admin/users/${TARGET}`) {
      return makeResponse(200, {
        user: targetRow(),
        currentMonthExpense: "12000.00",
        netDebt: "-500.00",
        totalBorrow: "2500.00",
        totalLend: "2000.00",
        budget: {
          total: "30000.00",
          cats: { food: "15000.00" },
          updatedAt: "2026-08-01T12:00:00Z",
        },
      });
    }
    if (p === `/api/v1/admin/users/${TARGET}/expenses`) {
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
            user_id: TARGET,
          },
        ],
        total: 1,
      });
    }
    if (p === `/api/v1/admin/users/${TARGET}/debts`) {
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
            user_id: TARGET,
          },
        ],
        total: 1,
      });
    }
    if (p === `/api/v1/admin/users/${TARGET}/recurring`) {
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
            user_id: TARGET,
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

function asSuperAdmin() {
  useAuthStore.setState({
    status: "authed",
    user: SUPER_ADMIN,
    accessToken: "admin-jwt-token",
    refreshToken: null,
  });
  stubFetch(adminHandler());
}

// ---------------------------------------------------------------------------
// The shell itself
// ---------------------------------------------------------------------------

describe("superadmin shell", () => {
  it("gives a superadmin the operator nav instead of the hisab nav", async () => {
    asSuperAdmin();
    renderApp("/admin");

    const sidebar = await screen.findByRole("navigation", { name: "Main" });
    // Operator sections, in sidebar order.
    for (const section of ["তত্ত্বাবধান", "পরিচালনা", "সিস্টেম"]) {
      expect(within(sidebar).getByText(section)).toBeInTheDocument();
    }
    for (const item of [
      "ওভারভিউ",
      "ব্যবহারকারী",
      "বিশ্লেষণ",
      "অডিট লগ",
      "অ্যাডমিন ও রোল",
      "সেশন ও নিরাপত্তা",
    ]) {
      expect(within(sidebar).getByRole("link", { name: item })).toHaveAttribute("href");
    }
    // Owner: superadmin keeps no hisab, so none of the member destinations
    // appear in their navigation.
    for (const memberItem of ["ড্যাশবোর্ড", "খরচ", "মাসিক হিসাব", "বাজেট", "ধার", "পুনরাবৃত্ত"]) {
      expect(within(sidebar).queryByRole("link", { name: memberItem })).toBeNull();
    }
  });

  it("renders no add-expense FABs for a superadmin", async () => {
    asSuperAdmin();
    renderApp("/admin");

    await screen.findByRole("navigation", { name: "Main" });
    // Both FABs exist only to create a hisab entry.
    expect(screen.queryByRole("button", { name: w("bn", "qaManual") })).toBeNull();
    expect(screen.queryByRole("button", { name: w("bn", "voiceTitle") })).toBeNull();
  });

  it("sends a superadmin landing on / to the admin overview", async () => {
    asSuperAdmin();
    renderApp("/");

    expect(await screen.findByText(w("bn", "adminOverviewSub"))).toBeInTheDocument();
  });

  it("denies a regular user the admin area", async () => {
    useAuthStore.setState({
      status: "authed",
      user: REGULAR_USER,
      accessToken: "user-jwt-token",
      refreshToken: null,
    });
    stubFetch(adminHandler());
    renderApp("/admin");

    expect(await screen.findByText(w("bn", "adminAccessDenied"))).toBeInTheDocument();
    expect(screen.queryByText("সুপার অ্যাডমিন ড্যাশবোর্ড")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// /admin — overview
// ---------------------------------------------------------------------------

describe("/admin overview", () => {
  it("shows platform KPIs and surfaces deployment warnings first", async () => {
    asSuperAdmin();
    renderApp("/admin");

    expect(await screen.findByText("সুপার অ্যাডমিন ড্যাশবোর্ড")).toBeInTheDocument();
    // KPI values (bn digits) — the pre-split fixture never asserted these.
    expect(await screen.findByText("১৫")).toBeInTheDocument();
    expect(screen.getByText("৯")).toBeInTheDocument();
    // A MemoryKV fallback is the one condition with no other symptom.
    expect(
      screen.getByText(/Set POIPOIHISAB_KV_URL/),
    ).toBeInTheDocument();
  });

  it("lists the most recent admin actions", async () => {
    asSuperAdmin();
    renderApp("/admin");

    expect(await screen.findByText("user.bulk_delete")).toBeInTheDocument();
    expect(screen.getByText("Rahim Mia <rahim@example.com>")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// /admin/users — roster + moderation
// ---------------------------------------------------------------------------

describe("/admin/users", () => {
  it("lists registered users", async () => {
    asSuperAdmin();
    renderApp("/admin/users");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    expect(screen.getByText(w("bn", "adminStatusActive"))).toBeInTheDocument();
  });

  it("suspends a user behind a confirmation", async () => {
    asSuperAdmin();
    renderApp("/admin/users");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: w("bn", "adminSuspend") }));

    expect(await screen.findByText(w("bn", "adminConfirmSuspend"))).toBeInTheDocument();
    const confirms = screen.getAllByRole("button", { name: w("bn", "adminSuspend") });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(w("bn", "adminStatusSuspended"))).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: w("bn", "adminUnsuspend") })).toBeInTheDocument();
  });

  it("permanently deletes a user behind a confirmation", async () => {
    asSuperAdmin();
    renderApp("/admin/users");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /মুছুন — Rahim Mia/ }));

    expect(await screen.findByText(w("bn", "adminConfirmDelete"))).toBeInTheDocument();
    const confirms = screen.getAllByRole("button", { name: w("bn", "adminDelete") });
    fireEvent.click(confirms[confirms.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText("Rahim Mia")).not.toBeInTheDocument();
    });
  });

  it("bulk-suspends the selected users", async () => {
    asSuperAdmin();
    renderApp("/admin/users");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Rahim Mia"));

    expect(screen.getByText(w("bn", "adminBulkSuspend"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(w("bn", "adminBulkSuspend")));

    expect(await screen.findByText(w("bn", "adminBulkConfirmSuspend"))).toBeInTheDocument();
    const modalButtons = screen.getAllByRole("button", { name: w("bn", "adminBulkSuspend") });
    fireEvent.click(modalButtons[modalButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(w("bn", "adminStatusSuspended"))).toBeInTheDocument();
    });
  });

  it("bulk-deletes the selected users", async () => {
    asSuperAdmin();
    renderApp("/admin/users");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Rahim Mia"));
    fireEvent.click(screen.getByText(w("bn", "adminBulkDelete")));

    expect(await screen.findByText(w("bn", "adminBulkConfirmDelete"))).toBeInTheDocument();
    const modalButtons = screen.getAllByRole("button", { name: w("bn", "adminBulkDelete") });
    fireEvent.click(modalButtons[modalButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText("Rahim Mia")).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// /admin/users/:userId — the inspector, now a route
// ---------------------------------------------------------------------------

describe("/admin/users/:userId", () => {
  it("opens from the roster and shows the user's records by tab", async () => {
    asSuperAdmin();
    renderApp("/admin/users");

    fireEvent.click(await screen.findByRole("button", { name: w("bn", "adminInspect") }));

    // Expenses tab is the default.
    expect(await screen.findByText("সবজি ও মাছ")).toBeInTheDocument();
    expect(screen.getByText("বাজার")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /ধার-দেনা/ }));
    expect(await screen.findByText("Karim")).toBeInTheDocument();
    expect(screen.getByText("জরুরি ধার")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /পুনরাবৃত্ত/ }));
    expect(await screen.findByText("বাসা ভাড়া")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /বাজেট/ }));
    expect(await screen.findByText("৳৩০,০০০")).toBeInTheDocument();
  });

  it("is deep-linkable, which the old modal was not", async () => {
    asSuperAdmin();
    renderApp(`/admin/users/${TARGET}`);

    expect(await screen.findByRole("heading", { name: "Rahim Mia" })).toBeInTheDocument();
  });

  it("signs a user out of every device without suspending the account", async () => {
    asSuperAdmin();
    renderApp(`/admin/users/${TARGET}`);

    await screen.findByRole("heading", { name: "Rahim Mia" });
    fireEvent.click(screen.getByRole("button", { name: w("bn", "adminRevokeSessions") }));

    expect(await screen.findByText(w("bn", "adminRevokeConfirm"))).toBeInTheDocument();
    const confirms = screen.getAllByRole("button", { name: w("bn", "adminRevokeSessions") });
    fireEvent.click(confirms[confirms.length - 1]);

    expect(await screen.findByText(/Revoked 3 session/)).toBeInTheDocument();
    // Still active: revoking sessions is not a moderation action.
    expect(screen.getByText(w("bn", "adminStatusActive"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// /admin/data — CSV import & export
// ---------------------------------------------------------------------------

describe("/admin/data", () => {
  it("offers the export and the import dropzone", async () => {
    asSuperAdmin();
    renderApp("/admin/data");

    expect(await screen.findByText(w("bn", "adminDataExportTitle"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: w("bn", "adminExportCsv") })).toBeInTheDocument();
    expect(screen.getByText(w("bn", "adminImportUploadPrompt"))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(w("bn", "adminImportTemplate"))),
    ).toBeInTheDocument();
  });

  it("says the export is audited, because it dumps the whole user table", async () => {
    asSuperAdmin();
    renderApp("/admin/data");

    expect(await screen.findByText(w("bn", "adminDataExportDesc"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// New oversight screens
// ---------------------------------------------------------------------------

describe("/admin/audit", () => {
  it("shows the trail with actor, target and affected row count", async () => {
    asSuperAdmin();
    renderApp("/admin/audit");

    // Each verb appears twice on this page — once as a filter option and
    // once as the row's badge — so assertions are scoped to the table.
    expect(await screen.findByText("cascade over 3 accounts")).toBeInTheDocument();
    const row = screen.getByText("cascade over 3 accounts").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("user.bulk_delete")).toBeInTheDocument();
    expect(cells.getByText(/admin@poipoihisab\.com/)).toBeInTheDocument();
    expect(cells.getByText("৩")).toBeInTheDocument();
    expect(cells.getByText("Rahim Mia <rahim@example.com>")).toBeInTheDocument();

    // The filter select offers only the verbs actually present.
    const filter = screen.getByLabelText(w("bn", "adminAuditAction"));
    expect(within(filter).getByRole("option", { name: "user.suspend" })).toBeInTheDocument();
  });
});

describe("/admin/security", () => {
  it("lists another user's live sessions and offers to revoke them", async () => {
    asSuperAdmin();
    renderApp("/admin/security");

    expect(await screen.findByText("Rahim Mia")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: w("bn", "adminRevokeSessions") }),
    ).toBeInTheDocument();
    // An in-process KV means this list is one instance's view, not truth.
    expect(screen.getByText(/MemoryKV/)).toBeInTheDocument();
  });
});

describe("/admin/roles", () => {
  it("separates database-flagged admins from env-granted ones", async () => {
    asSuperAdmin();
    renderApp("/admin/roles");

    expect(await screen.findByText(w("bn", "adminRoleEnvNote"))).toBeInTheDocument();
    // No account carries the DB flag in this fixture — the silent-lockout
    // warning must fire.
    expect(screen.getByText(w("bn", "adminRoleNoAdmins"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: w("bn", "adminRoleGrant") })).toBeInTheDocument();
  });
});

describe("/admin/system", () => {
  it("reports the KV fallback that has no other symptom", async () => {
    asSuperAdmin();
    renderApp("/admin/system");

    expect(await screen.findByText(w("bn", "adminSystemWarnings"))).toBeInTheDocument();
    expect(screen.getByText(/Set POIPOIHISAB_KV_URL/)).toBeInTheDocument();
    expect(screen.getByText(w("bn", "adminSystemEphemeral"))).toBeInTheDocument();
    expect(screen.getByText("postgresql")).toBeInTheDocument();
    expect(screen.getByText("0007")).toBeInTheDocument();
  });
});

describe("/admin/categories", () => {
  it("surfaces two spellings of one category and merges them", async () => {
    asSuperAdmin();
    renderApp("/admin/categories");

    expect(await screen.findByText("রিক্সা")).toBeInTheDocument();
    expect(screen.getByText("রিকশা")).toBeInTheDocument();

    const [firstMerge] = screen.getAllByRole("button", {
      name: w("bn", "adminCategoryMerge"),
    });
    fireEvent.click(firstMerge);

    expect(await screen.findByText(w("bn", "adminCategoryMergeHint"))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(w("bn", "adminCategoryMergeTo")), {
      target: { value: "রিকশা" },
    });
    fireEvent.click(screen.getByRole("button", { name: w("bn", "adminCategoryMergeCta") }));

    expect(await screen.findByText(/Merged/)).toBeInTheDocument();
  });
});

describe("/admin/analytics", () => {
  it("shows aggregate distributions and no individual expense rows", async () => {
    asSuperAdmin();
    renderApp("/admin/analytics");

    expect(await screen.findByText(w("bn", "adminByGroup"))).toBeInTheDocument();
    expect(screen.getByText("food")).toBeInTheDocument();
    expect(screen.getByText("বাজার")).toBeInTheDocument();
    expect(screen.getByText("2026-09")).toBeInTheDocument();
    // Aggregate-only: the per-user records live behind /admin/users/:id.
    expect(screen.queryByText("সবজি ও মাছ")).toBeNull();
  });
});

describe("/admin/integrations", () => {
  it("reports the deployment's Sheets service account without echoing the credential", async () => {
    asSuperAdmin();
    renderApp("/admin/integrations");

    expect(
      await screen.findByText("svc@example.iam.gserviceaccount.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("(inline JSON)")).toBeInTheDocument();
  });
});
