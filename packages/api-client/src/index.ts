/**
 * @poipoihisab/api-client — typed client for the Poi Poi Hisab API.
 *
 * The `paths`/`components` types are generated from apps/api/openapi.json by
 * `pnpm generate` (src/schema.gen.d.ts — do not edit by hand).
 *
 * Runtime behaviour:
 *  - `Authorization: Bearer <accessToken>` is injected on every protected
 *    call (login/register/refresh are excluded — they never carry a stale
 *    token).
 *  - A 401 on a protected call triggers ONE silent refresh (single-flight,
 *    rotation-aware) and retries the original request with the new token.
 *    The retry uses raw `fetch` so it can never re-enter this middleware —
 *    no loops.
 *  - The refresh itself is JSON-first (ADR-0008, T12.3): it rotates the
 *    persisted token via `/auth/refresh`, and only when that transport has
 *    nothing to answer with (no persisted token, or a 401/403 rejection) it
 *    falls back ONCE to the configured `refreshFromCookie` callback (the web
 *    app registers the httpOnly-cookie transport; mobile leaves it unset).
 *  - If the refresh fails (revoked/unknown token), `poipoihisab:auth-expired`
 *    is dispatched on `window` and the original 401 is returned; the app
 *    store listens for the event and drops the session.
 */
import createClient from "openapi-fetch";
import type { Middleware } from "openapi-fetch";
import type { components, paths } from "./schema.gen";

export type { components, paths };

export type User = components["schemas"]["UserOut"];
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
export type AuthSession = { user: User } & AuthTokens;

/** Normalised result: `detail` carries the backend `{ detail: string }` message. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; detail: string };

/** Window event dispatched when a 401 could not be recovered via refresh. */
export const AUTH_EXPIRED_EVENT = "poipoihisab:auth-expired";

/** Endpoints whose 401s are final answers — refreshing on them would loop. */
const PUBLIC_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  "/api/v1/auth/refresh",
  // Cookie transports (T12.3): authenticated by the HttpOnly `kh_refresh`
  // cookie, never a Bearer header — and their own 401s are final answers
  // (a failing cookie probe must not recurse into refresh handling).
  "/api/v1/auth/refresh-cookie",
  "/api/v1/auth/logout-cookie",
]);

/**
 * Auth plumbing provided by the app (the client must not import the store —
 * that would be a circular dependency). Registered via `configureAuth`.
 */
interface AuthHandlers {
  getAccessToken: () => string | null | undefined;
  getRefreshToken: () => string | null | undefined;
  /** Called with the rotated pair after a successful silent refresh. */
  onTokenRefresh?: (tokens: AuthTokens) => void;
  /**
   * ADR-0008 (T12.3): cookie-transport fallback, tried ONCE per refresh when
   * the JSON transport has nothing to answer with (no persisted refresh
   * token, or the server rejected it with 401/403). Resolves the rotated
   * session, or `null` on any failure — must never throw. Registered by the
   * web app (`configureCookieAuth`); unset on mobile → behaviour unchanged.
   */
  refreshFromCookie?: () => Promise<AuthSession | null>;
}

const auth: AuthHandlers = {
  getAccessToken: () => null,
  getRefreshToken: () => null,
};

export function configureAuth(handlers: Partial<AuthHandlers>): void {
  Object.assign(auth, handlers);
}

export type Lang = "bn" | "en";

/**
 * Extract the human-readable message from a FastAPI error body (ADR-0004 §7):
 *  - string `detail` → verbatim (auth endpoints);
 *  - domain errors  → `{ code, message_bn, message_en }` triple, resolved by
 *    `lang` (bn-first product, so bn wins ties by default);
 *  - 422 validation → `{ detail: [...] }` array, flattened to `msg` strings.
 */
export function errorMessage(err: unknown, lang: Lang = "bn"): string {
  if (typeof err === "object" && err !== null && "detail" in err) {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (
      typeof detail === "object" &&
      detail !== null &&
      ("message_bn" in detail || "message_en" in detail)
    ) {
      const triple = detail as { message_bn?: unknown; message_en?: unknown };
      const preferred = lang === "bn" ? triple.message_bn : triple.message_en;
      const fallback = lang === "bn" ? triple.message_en : triple.message_bn;
      if (typeof preferred === "string" && preferred) return preferred;
      if (typeof fallback === "string" && fallback) return fallback;
      return "Unexpected error";
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) =>
          typeof item === "object" && item !== null && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : String(item),
        )
        .join("; ");
    }
  }
  return "Unexpected error";
}

function emitAuthExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

/**
 * A pristine clone of each request, stashed in onRequest BEFORE `fetch`
 * disturbs the original body — a 401 retry may need to re-send a POST body.
 */
const pristineRequests = new WeakMap<Request, Request>();

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  // Defer globalThis.fetch lookup to call time: openapi-fetch otherwise
  // binds fetch at client creation, which would bypass test doubles
  // installed later with vi.stubGlobal("fetch", …).
  fetch: (...args) => globalThis.fetch(...args),
});

// Single-flight: concurrent 401s share one refresh call.
let refreshInFlight: Promise<AuthSession | null> | null = null;

/**
 * ONE silent refresh, JSON-first (ADR-0008, T12.3):
 *  1. rotate the persisted refresh token via `POST /auth/refresh`;
 *  2. only when the JSON transport has nothing to answer with — no persisted
 *     token, or a definitive server rejection (401/403) — fall back ONCE to
 *     the configured `refreshFromCookie` callback.
 * Single-flight still holds across both paths: concurrent callers share this
 * one promise, so a refresh storm costs one JSON attempt + at most one cookie
 * probe — never one per path per caller.
 *
 * Network-level JSON failures do NOT trigger the cookie probe: if the server
 * is unreachable the probe fails anyway, and probing with a stale tombstoned
 * cookie could trip the server's reuse detection and revoke an otherwise
 * live session family (see apps/web/src/lib/auth-cookie.ts).
 */
async function refreshSession(): Promise<AuthSession | null> {
  refreshInFlight ??= (async () => {
    let jsonExhausted = !auth.getRefreshToken();
    if (!jsonExhausted) {
      try {
        // Goes through the middleware client, but /auth/refresh is in
        // PUBLIC_AUTH_PATHS so its own 401 can never recurse into here.
        const { data, response } = await api.POST("/api/v1/auth/refresh", {
          body: { refreshToken: auth.getRefreshToken() as string },
        });
        if (data) {
          return {
            user: data.user,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          };
        }
        jsonExhausted = response.status === 401 || response.status === 403;
      } catch {
        // network-level failure — keep the cookie transport out of it
      }
    }
    if (!jsonExhausted) return null;
    try {
      return (await auth.refreshFromCookie?.()) ?? null;
    } catch {
      return null; // a broken cookie callback must not break the contract
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

api.use({
  onRequest({ schemaPath, request }) {
    pristineRequests.set(request, request.clone());
    const token = auth.getAccessToken();
    if (token && !PUBLIC_AUTH_PATHS.has(schemaPath)) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return undefined;
  },
  async onResponse({ schemaPath, request, response }) {
    if (response.status !== 401) return undefined;
    // Final 401s (bad credentials, revoked/unknown refresh token): never refresh.
    if (PUBLIC_AUTH_PATHS.has(schemaPath)) return undefined;

    const tokens = await refreshSession();
    if (!tokens) {
      emitAuthExpired(); // store clears the session → user lands on /login
      return undefined; // original 401 propagates to the caller (its detail wins)
    }
    auth.onTokenRefresh?.(tokens); // persist the ROTATED pair immediately

    const pristine = pristineRequests.get(request) ?? request;
    const headers = new Headers(pristine.headers);
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    // Raw fetch on purpose: outside the middleware pipeline → no retry loops.
    return fetch(new Request(pristine, { headers }));
  },
});

/* ------------------------------------------------------------------ */
/* Typed endpoint helpers                                              */
/* ------------------------------------------------------------------ */

export async function apiLogin(body: components["schemas"]["LoginIn"]): Promise<ApiResult<AuthSession>> {
  const { data, error, response } = await api.POST("/api/v1/auth/login", { body });
  if (data) {
    return {
      ok: true,
      data: { user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken },
    };
  }
  return { ok: false, status: response.status, detail: errorMessage(error) };
}

export async function apiRegister(
  body: components["schemas"]["RegisterIn"],
): Promise<ApiResult<AuthSession>> {
  const { data, error, response } = await api.POST("/api/v1/auth/register", { body });
  if (data) {
    return {
      ok: true,
      data: { user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken },
    };
  }
  return { ok: false, status: response.status, detail: errorMessage(error) };
}

export async function apiRefresh(refreshToken: string): Promise<ApiResult<AuthSession>> {
  const { data, error, response } = await api.POST("/api/v1/auth/refresh", {
    body: { refreshToken },
  });
  if (data) {
    return {
      ok: true,
      data: { user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken },
    };
  }
  return { ok: false, status: response.status, detail: errorMessage(error) };
}

export async function apiLogout(): Promise<ApiResult<null>> {
  const { error, response } = await api.POST("/api/v1/auth/logout", {});
  if (response.ok) return { ok: true, data: null };
  return { ok: false, status: response.status, detail: errorMessage(error) };
}

export async function apiMe(): Promise<ApiResult<User>> {
  const { data, error, response } = await api.GET("/api/v1/auth/me");
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error) };
}

/* ------------------------------------------------------------------ */
/* Expenses / voice / reports (Phase 2 — ticket T2.2)                  */
/* ------------------------------------------------------------------ */

export type Expense = components["schemas"]["ExpenseOut"];
export type ExpenseGroup = Expense["grp"];
export type PayMethod = Expense["pay"];
export type ExpenseCreateInput = components["schemas"]["ExpenseIn"];
export type ExpenseUpdateInput = components["schemas"]["ExpenseUpdate"];
export type ExpensePage = components["schemas"]["ExpenseListOut"];
export type MonthlyReport = components["schemas"]["MonthlyReportOut"];
export type YearlyReport = components["schemas"]["YearlyReportOut"];
export type VoiceParseResult = components["schemas"]["VoiceParseOut"];
export type ParsedExpense = components["schemas"]["ParsedItem"];

export interface ExpenseListParams {
  from?: string | null;
  to?: string | null;
  q?: string | null;
  limit?: number;
  cursor?: string | null;
}

export async function apiListExpenses(
  params: ExpenseListParams,
  lang: Lang = "bn",
): Promise<ApiResult<ExpensePage>> {
  const { data, error, response } = await api.GET("/api/v1/expenses", {
    params: { query: params },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** One distinct khata derived from the caller's history (ADR-0019). */
export type Khata = components["schemas"]["KhataOut"];
/** Envelope for GET /expenses/categories — picker-sized, cursor always null. */
export type KhataListOut = components["schemas"]["KhataListOut"];

/**
 * Distinct khatas for the expense-form picker (ADR-0019): one row per cat,
 * ordered most-used → most-recent → cat. Unpaginated by design.
 */
export async function apiListCategories(
  lang: Lang = "bn",
): Promise<ApiResult<KhataListOut>> {
  const { data, error, response } = await api.GET("/api/v1/expenses/categories");
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

export async function apiCreateExpense(
  body: ExpenseCreateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Expense>> {
  const { data, error, response } = await api.POST("/api/v1/expenses", { body });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

export async function apiUpdateExpense(
  expenseId: string,
  body: ExpenseUpdateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Expense>> {
  const { data, error, response } = await api.PATCH("/api/v1/expenses/{expense_id}", {
    params: { path: { expense_id: expenseId } },
    body,
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

export async function apiDeleteExpense(
  expenseId: string,
  lang: Lang = "bn",
): Promise<ApiResult<null>> {
  const { error, response } = await api.DELETE("/api/v1/expenses/{expense_id}", {
    params: { path: { expense_id: expenseId } },
  });
  if (response.ok) return { ok: true, data: null };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Voice multi-item insert — up to 50 expenses in one flush. */
export async function apiBulkCreateExpenses(
  items: ExpenseCreateInput[],
  lang: Lang = "bn",
): Promise<ApiResult<Expense[]>> {
  const { data, error, response } = await api.POST("/api/v1/expenses/bulk", {
    body: { items },
  });
  if (data) return { ok: true, data: data.items };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Rule-parse a Bengali voice transcript into expense candidates. */
export async function apiVoiceParse(
  text: string,
  lang: Lang = "bn",
): Promise<ApiResult<VoiceParseResult>> {
  const { data, error, response } = await api.POST("/api/v1/voice/parse", {
    body: { text },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Monthly aggregates (`?ym=YYYY-MM`; omit for the current month). */
export async function apiMonthlyReport(
  ym?: string | null,
  lang: Lang = "bn",
): Promise<ApiResult<MonthlyReport>> {
  const { data, error, response } = await api.GET("/api/v1/reports/monthly", {
    params: { query: ym ? { ym } : {} },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Yearly aggregates (`?year=YYYY`; omit for the current year). */
export async function apiYearlyReport(
  year?: number | null,
  lang: Lang = "bn",
): Promise<ApiResult<YearlyReport>> {
  const { data, error, response } = await api.GET("/api/v1/reports/yearly", {
    params: { query: year ? { year: String(year) } : {} },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/* ------------------------------------------------------------------ */
/* Debts (Phase 3 — ticket T3.3)                                       */
/* ------------------------------------------------------------------ */

export type Debt = components["schemas"]["DebtOut"];
export type DebtDir = Debt["dir"];
export type DebtStatus = "open" | "settled" | "all";
export type DebtPage = components["schemas"]["DebtListOut"];
export type DebtCreateInput = components["schemas"]["DebtIn"];
export type DebtUpdateInput = components["schemas"]["DebtUpdate"];
export type DebtPayResult = components["schemas"]["DebtPayOut"];

export interface DebtListParams {
  status?: DebtStatus;
  party?: string;
  limit?: number;
  cursor?: string | null;
}

/** Keyset-paginated debt list; `status=open` (default) hides settled rows. */
export async function apiListDebts(
  params: DebtListParams,
  lang: Lang = "bn",
): Promise<ApiResult<DebtPage>> {
  const { data, error, response } = await api.GET("/api/v1/debts", {
    params: { query: params as Record<string, string | number | undefined> },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Record one debt (201 with the stored row; `iso` defaults to today). */
export async function apiCreateDebt(
  body: DebtCreateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Debt>> {
  const { data, error, response } = await api.POST("/api/v1/debts", { body });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Partially update the caller's debt (omitted fields stay as-is). */
export async function apiUpdateDebt(
  debtId: string,
  body: DebtUpdateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Debt>> {
  const { data, error, response } = await api.PATCH("/api/v1/debts/{debt_id}", {
    params: { path: { debt_id: debtId } },
    body,
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Delete the caller's debt (204; unknown/foreign id → 404). */
export async function apiDeleteDebt(debtId: string, lang: Lang = "bn"): Promise<ApiResult<null>> {
  const { error, response } = await api.DELETE("/api/v1/debts/{debt_id}", {
    params: { path: { debt_id: debtId } },
  });
  if (response.ok) return { ok: true, data: null };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/**
 * Pay back a debt: `amt >= debt.amt` → FULL (settled), smaller → PARTIAL
 * (the returned row carries the shrunken amount). 409 when already settled.
 */
export async function apiPayDebt(
  debtId: string,
  amt: string,
  lang: Lang = "bn",
): Promise<ApiResult<DebtPayResult>> {
  const { data, error, response } = await api.POST("/api/v1/debts/{debt_id}/pay", {
    params: { path: { debt_id: debtId } },
    body: { amt },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

export type PartySummary = components["schemas"]["PartySummaryOut"];
export type PartyList = components["schemas"]["PartyListOut"];

/** Aggregated per-party summaries (receivable / payable / net balance). */
export async function apiListDebtParties(
  lang: Lang = "bn",
): Promise<ApiResult<PartyList>> {
  const { data, error, response } = await api.GET("/api/v1/debts/parties", {});
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/* ------------------------------------------------------------------ */
/* Incomes (TallyKhata-inspired — party ledger & income tracking)      */
/* ------------------------------------------------------------------ */

export type Income = components["schemas"]["IncomeOut"];
export type IncomePage = components["schemas"]["IncomeListOut"];
export type IncomeCreateInput = components["schemas"]["IncomeIn"];
export type IncomeUpdateInput = components["schemas"]["IncomeUpdate"];

export interface IncomeListParams {
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
}

/** Keyset-paginated income list, newest first. */
export async function apiListIncomes(
  params: IncomeListParams,
  lang: Lang = "bn",
): Promise<ApiResult<IncomePage>> {
  const { data, error, response } = await api.GET("/api/v1/incomes", {
    params: { query: params as Record<string, string | number | undefined> },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Record one income entry. */
export async function apiCreateIncome(
  body: IncomeCreateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Income>> {
  const { data, error, response } = await api.POST("/api/v1/incomes", { body });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Update an income entry (partial). */
export async function apiUpdateIncome(
  incomeId: string,
  body: IncomeUpdateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Income>> {
  const { data, error, response } = await api.PATCH("/api/v1/incomes/{income_id}", {
    params: { path: { income_id: incomeId } },
    body,
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Delete an income entry. */
export async function apiDeleteIncome(
  incomeId: string,
  lang: Lang = "bn",
): Promise<ApiResult<null>> {
  const { error, response } = await api.DELETE("/api/v1/incomes/{income_id}", {
    params: { path: { income_id: incomeId } },
  });
  if (response.ok) return { ok: true, data: null };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/* ------------------------------------------------------------------ */
/* Budgets (Phase 3 — ticket T3.3)                                     */
/* ------------------------------------------------------------------ */

export type Budget = components["schemas"]["BudgetOut"];
export type BudgetCatUsage = components["schemas"]["BudgetCatUsage"];
export type BudgetInput = components["schemas"]["BudgetIn"];

/** Budget vs spend for one month (`?ym=YYYY-MM`; default: current). */
export async function apiGetBudget(
  ym?: string | null,
  lang: Lang = "bn",
): Promise<ApiResult<Budget>> {
  const { data, error, response } = await api.GET("/api/v1/budgets", {
    params: { query: ym ? { ym } : {} },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Upsert the budget (total and/or per-category map); returns the GET view. */
export async function apiPutBudget(
  body: BudgetInput,
  lang: Lang = "bn",
): Promise<ApiResult<Budget>> {
  const { data, error, response } = await api.PUT("/api/v1/budgets", { body });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/* ------------------------------------------------------------------ */
/* Recurring expenses (T16.1 — ADR-0014)                               */
/* ------------------------------------------------------------------ */

export type Recurring = components["schemas"]["RecurringOut"];
export type RecurringFreq = Recurring["freq"];
export type RecurringPage = components["schemas"]["RecurringListOut"];
export type RecurringCreateInput = components["schemas"]["RecurringIn"];
export type RecurringUpdateInput = components["schemas"]["RecurringUpdate"];
export type RecurringRunResult = components["schemas"]["RecurringRunOut"];

export interface RecurringListParams {
  active?: boolean;
  limit?: number;
  cursor?: string | null;
}

/** Keyset-paginated rule list; `active` filters running (true) or paused (false). */
export async function apiListRecurring(
  params: RecurringListParams,
  lang: Lang = "bn",
): Promise<ApiResult<RecurringPage>> {
  const { data, error, response } = await api.GET("/api/v1/recurring", {
    params: { query: params as Record<string, string | number | undefined> },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/**
 * Create one rule (201 with the stored row). `start_date` is the FIRST
 * occurrence and defaults to today; `next_run` is server-owned.
 */
export async function apiCreateRecurring(
  body: RecurringCreateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Recurring>> {
  const { data, error, response } = await api.POST("/api/v1/recurring", { body });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Partially update the caller's rule (`next_run` is never client-settable). */
export async function apiUpdateRecurring(
  recurringId: string,
  body: RecurringUpdateInput,
  lang: Lang = "bn",
): Promise<ApiResult<Recurring>> {
  const { data, error, response } = await api.PATCH("/api/v1/recurring/{recurring_id}", {
    params: { path: { recurring_id: recurringId } },
    body,
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Delete the caller's rule (204; expenses already materialized stay). */
export async function apiDeleteRecurring(
  recurringId: string,
  lang: Lang = "bn",
): Promise<ApiResult<null>> {
  const { error, response } = await api.DELETE("/api/v1/recurring/{recurring_id}", {
    params: { path: { recurring_id: recurringId } },
  });
  if (response.ok) return { ok: true, data: null };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/**
 * Materialize every due occurrence into real expenses (idempotent — ADR-0014):
 * a repeat run the same day returns `created: 0` and never duplicates.
 */
export async function apiRunRecurring(
  lang: Lang = "bn",
): Promise<ApiResult<RecurringRunResult>> {
  const { data, error, response } = await api.POST("/api/v1/recurring/run", {});
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/* ------------------------------------------------------------------ */
/* Super Admin (Platform Oversight & User Inspector)                  */
/* ------------------------------------------------------------------ */

export type AdminPlatformStats = components["schemas"]["AdminPlatformStatsOut"];
export type AdminUserItem = components["schemas"]["AdminUserItemOut"];
export type AdminUserList = components["schemas"]["AdminUserListOut"];
export type AdminUserDetail = components["schemas"]["AdminUserDetailOut"];
export type AdminUserExpenses = components["schemas"]["AdminUserExpensesOut"];
export type AdminUserDebts = components["schemas"]["AdminUserDebtsOut"];
export type AdminUserRecurring = components["schemas"]["AdminUserRecurringOut"];
export type AdminUserAction = components["schemas"]["AdminUserActionOut"];
export type AdminUserSuspendIn = components["schemas"]["AdminUserSuspendIn"];

export interface AdminUserListParams {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AdminUserExpensesParams {
  limit?: number;
  offset?: number;
}

/** Fetch platform-wide summary statistics (superadmin only). */
export async function apiAdminStats(
  lang: Lang = "bn",
): Promise<ApiResult<AdminPlatformStats>> {
  const { data, error, response } = await api.GET("/api/v1/admin/stats", {});
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Search and list all registered users with financial metrics (superadmin only). */
export async function apiAdminListUsers(
  params: AdminUserListParams = {},
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserList>> {
  const { data, error, response } = await api.GET("/api/v1/admin/users", {
    params: { query: params },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Fetch complete profile and aggregated stats for a user (superadmin only). */
export async function apiAdminGetUser(
  userId: string,
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserDetail>> {
  const { data, error, response } = await api.GET("/api/v1/admin/users/{user_id}", {
    params: { path: { user_id: userId } },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Fetch paginated expenses for a user (superadmin only). */
export async function apiAdminGetUserExpenses(
  userId: string,
  params: AdminUserExpensesParams = {},
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserExpenses>> {
  const { data, error, response } = await api.GET("/api/v1/admin/users/{user_id}/expenses", {
    params: { path: { user_id: userId }, query: params },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Fetch debts for a user (superadmin only). */
export async function apiAdminGetUserDebts(
  userId: string,
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserDebts>> {
  const { data, error, response } = await api.GET("/api/v1/admin/users/{user_id}/debts", {
    params: { path: { user_id: userId } },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Fetch recurring rules for a user (superadmin only). */
export async function apiAdminGetUserRecurring(
  userId: string,
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserRecurring>> {
  const { data, error, response } = await api.GET("/api/v1/admin/users/{user_id}/recurring", {
    params: { path: { user_id: userId } },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Suspend or reactivate a user account (superadmin only). */
export async function apiAdminSuspendUser(
  userId: string,
  suspended: boolean,
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserAction>> {
  const { data, error, response } = await api.POST(
    "/api/v1/admin/users/{user_id}/suspend",
    {
      params: { path: { user_id: userId } },
      body: { suspended },
    },
  );
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Permanently delete a user account and all their records (superadmin only). */
export async function apiAdminDeleteUser(
  userId: string,
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserAction>> {
  const { data, error, response } = await api.DELETE(
    "/api/v1/admin/users/{user_id}",
    {
      params: { path: { user_id: userId } },
    },
  );
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

export type AdminBulkAction = {
  success: boolean;
  affectedCount: number;
  message: string;
};

export type AdminUserImportRow = {
  name: string;
  email: string;
  password?: string;
};

export type AdminUserImportResult = {
  success: boolean;
  createdCount: number;
  skippedCount: number;
  errors: string[];
};

/** Bulk suspend or unsuspend users (superadmin only). */
export async function apiAdminBulkSuspendUsers(
  userIds: string[],
  suspended: boolean,
  lang: Lang = "bn",
): Promise<ApiResult<AdminBulkAction>> {
  const { data, error, response } = await (api.POST as any)(
    "/api/v1/admin/users/bulk-suspend",
    {
      body: { userIds, suspended },
    },
  );
  if (data) return { ok: true, data: data as AdminBulkAction };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Bulk permanently delete users (superadmin only). */
export async function apiAdminBulkDeleteUsers(
  userIds: string[],
  lang: Lang = "bn",
): Promise<ApiResult<AdminBulkAction>> {
  const { data, error, response } = await (api.POST as any)(
    "/api/v1/admin/users/bulk-delete",
    {
      body: { userIds },
    },
  );
  if (data) return { ok: true, data: data as AdminBulkAction };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Bulk import users from rows (superadmin only). */
export async function apiAdminImportUsers(
  users: AdminUserImportRow[],
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserImportResult>> {
  const { data, error, response } = await (api.POST as any)(
    "/api/v1/admin/import/users",
    {
      body: { users },
    },
  );
  if (data) return { ok: true, data: data as AdminUserImportResult };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Download all users as CSV with UTF-8 BOM (superadmin only). */
export async function apiAdminDownloadUsersCsv(
  lang: Lang = "bn",
): Promise<ApiResult<Blob>> {
  const baseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  const token = auth.getAccessToken();
  try {
    const res = await globalThis.fetch(`${baseUrl}/api/v1/admin/export/users.csv`, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) {
      let errBody;
      try {
        errBody = await res.json();
      } catch {
        errBody = { detail: "Failed to download CSV" };
      }
      return { ok: false, status: res.status, detail: errorMessage(errBody, lang) };
    }
    const blob = await res.blob();
    return { ok: true, data: blob };
  } catch (e) {
    return { ok: false, status: 0, detail: e instanceof Error ? e.message : "Network error" };
  }
}



/* ------------------------------------------------------------------ */
/* Super Admin — oversight (audit, roles, sessions, analytics, system) */
/* ------------------------------------------------------------------ */

export type AdminAuditItem = components["schemas"]["AdminAuditItemOut"];
export type AdminAuditList = components["schemas"]["AdminAuditListOut"];
export type AdminSessions = components["schemas"]["AdminSessionsOut"];
export type AdminSessionUser = components["schemas"]["AdminSessionUserOut"];
export type AdminRevokeSessions = components["schemas"]["AdminRevokeSessionsOut"];
export type AdminAnalytics = components["schemas"]["AdminAnalyticsOut"];
export type AdminSlice = components["schemas"]["AdminSliceOut"];
export type AdminTrendPoint = components["schemas"]["AdminTrendPointOut"];
export type AdminTopUser = components["schemas"]["AdminTopUserOut"];
export type AdminCategoryItem = components["schemas"]["AdminCategoryItemOut"];
export type AdminCategoryList = components["schemas"]["AdminCategoryListOut"];
export type AdminSystem = components["schemas"]["AdminSystemOut"];
export type AdminIntegrations = components["schemas"]["AdminIntegrationsOut"];

export interface AdminAuditParams {
  action?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** Read the admin audit trail, newest first (superadmin only). */
export async function apiAdminAudit(
  params: AdminAuditParams = {},
  lang: Lang = "bn",
): Promise<ApiResult<AdminAuditList>> {
  const { data, error, response } = await api.GET("/api/v1/admin/audit", {
    params: { query: params },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Grant or revoke superadmin on a user (superadmin only). */
export async function apiAdminSetUserRole(
  userId: string,
  superadmin: boolean,
  lang: Lang = "bn",
): Promise<ApiResult<AdminUserAction>> {
  const { data, error, response } = await api.POST(
    "/api/v1/admin/users/{user_id}/role",
    {
      params: { path: { user_id: userId } },
      body: { superadmin },
    },
  );
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Live sessions per user across the platform (superadmin only). */
export async function apiAdminSessions(
  limit = 100,
  lang: Lang = "bn",
): Promise<ApiResult<AdminSessions>> {
  const { data, error, response } = await api.GET("/api/v1/admin/sessions", {
    params: { query: { limit } },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Sign one user out everywhere WITHOUT suspending them (superadmin only). */
export async function apiAdminRevokeUserSessions(
  userId: string,
  lang: Lang = "bn",
): Promise<ApiResult<AdminRevokeSessions>> {
  const { data, error, response } = await api.POST(
    "/api/v1/admin/users/{user_id}/revoke-sessions",
    { params: { path: { user_id: userId } } },
  );
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Platform-wide spending analytics, aggregate only (superadmin only). */
export async function apiAdminAnalytics(
  months = 12,
  lang: Lang = "bn",
): Promise<ApiResult<AdminAnalytics>> {
  const { data, error, response } = await api.GET("/api/v1/admin/analytics", {
    params: { query: { months } },
  });
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Distinct expense cat/grp pairs with platform-wide usage (superadmin only). */
export async function apiAdminCategories(
  lang: Lang = "bn",
): Promise<ApiResult<AdminCategoryList>> {
  const { data, error, response } = await api.GET("/api/v1/admin/categories", {});
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Merge one expense category into another across every user (superadmin only). */
export async function apiAdminMergeCategory(
  fromCat: string,
  toCat: string,
  toGrp: string | undefined,
  lang: Lang = "bn",
): Promise<ApiResult<AdminBulkAction>> {
  const { data, error, response } = await api.POST("/api/v1/admin/categories/merge", {
    body: { fromCat, toCat, toGrp: toGrp ?? null },
  });
  if (data) return { ok: true, data: data as AdminBulkAction };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Runtime facts: DB, KV backend, migration head, config warnings. */
export async function apiAdminSystem(
  lang: Lang = "bn",
): Promise<ApiResult<AdminSystem>> {
  const { data, error, response } = await api.GET("/api/v1/admin/system", {});
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}

/** Deployment-wide integration wiring (superadmin only). */
export async function apiAdminIntegrations(
  lang: Lang = "bn",
): Promise<ApiResult<AdminIntegrations>> {
  const { data, error, response } = await api.GET("/api/v1/admin/integrations", {});
  if (data) return { ok: true, data };
  return { ok: false, status: response.status, detail: errorMessage(error, lang) };
}
