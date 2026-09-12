import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IconShield } from "./components/icons";
import { OutboxAutoFlush } from "./lib/outbox";
import { RecurringAutoRun } from "./lib/recurringRun";
import { w } from "./lib/web-i18n";
import { useAuthStore } from "./store/auth";
import { useLangStore } from "./store/lang";

/**
 * Route-level code splitting (T15.1a): every page is a lazy chunk so the
 * initial download is only the shell (router + auth + AppShell). Named
 * exports are re-mapped to React's expected `default`.
 */
const Budget = lazy(() =>
  import("./screens/Budget").then((m) => ({ default: m.Budget })),
);
const Dashboard = lazy(() =>
  import("./screens/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Debts = lazy(() =>
  import("./screens/Debts").then((m) => ({ default: m.Debts })),
);
const Expenses = lazy(() =>
  import("./screens/Expenses").then((m) => ({ default: m.Expenses })),
);
const Income = lazy(() =>
  import("./screens/Income").then((m) => ({ default: m.Income })),
);
const Login = lazy(() =>
  import("./screens/Login").then((m) => ({ default: m.Login })),
);
const Month = lazy(() =>
  import("./screens/Month").then((m) => ({ default: m.Month })),
);
const Recurring = lazy(() =>
  import("./screens/Recurring").then((m) => ({ default: m.Recurring })),
);
const Report = lazy(() =>
  import("./screens/Report").then((m) => ({ default: m.Report })),
);
const Settings = lazy(() =>
  import("./screens/Settings").then((m) => ({ default: m.Settings })),
);

/*
 * Admin chunks (superadmin role split, 2026-09-09). Each page is its own
 * lazy chunk, so a member's bundle never downloads the admin dashboard —
 * before the split, the single Admin screen was ~1700 lines in one chunk.
 */
const AdminOverview = lazy(() =>
  import("./screens/admin/AdminOverview").then((m) => ({ default: m.AdminOverview })),
);
const AdminUsers = lazy(() =>
  import("./screens/admin/AdminUsers").then((m) => ({ default: m.AdminUsers })),
);
const AdminUserDetail = lazy(() =>
  import("./screens/admin/AdminUserDetail").then((m) => ({ default: m.AdminUserDetail })),
);
const AdminAnalytics = lazy(() =>
  import("./screens/admin/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })),
);
const AdminCategories = lazy(() =>
  import("./screens/admin/AdminCategories").then((m) => ({ default: m.AdminCategories })),
);
const AdminData = lazy(() =>
  import("./screens/admin/AdminData").then((m) => ({ default: m.AdminData })),
);
const AdminAudit = lazy(() =>
  import("./screens/admin/AdminAudit").then((m) => ({ default: m.AdminAudit })),
);
const AdminRoles = lazy(() =>
  import("./screens/admin/AdminRoles").then((m) => ({ default: m.AdminRoles })),
);
const AdminSecurity = lazy(() =>
  import("./screens/admin/AdminSecurity").then((m) => ({ default: m.AdminSecurity })),
);
const AdminSystem = lazy(() =>
  import("./screens/admin/AdminSystem").then((m) => ({ default: m.AdminSystem })),
);
const AdminIntegrations = lazy(() =>
  import("./screens/admin/AdminIntegrations").then((m) => ({ default: m.AdminIntegrations })),
);

/** Themed Suspense fallback shown while a lazy route chunk is downloading. */
function RouteFallback() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-ivory text-ink"
      role="status"
    >
      <span
        aria-hidden="true"
        className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-emerald"
      />
      <span className="text-sm font-semibold text-muted">লোড হচ্ছে…</span>
    </div>
  );
}

/**
 * Gate for everything under AppShell. While the bootstrap/refresh flow is
 * resolving we show a themed spinner; anonymous visitors are bounced to
 * /login carrying their intended location so Login can send them back.
 */
function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ivory text-ink" role="status">
        <span
          aria-hidden="true"
          className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-emerald"
        />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (status === "anon") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  // T17.1 (ADR-0014 §3): authed tree host for the once-per-local-day
  // recurring boot run. Renders nothing and never blocks the UI — the
  // POST is fire-and-forget inside the effect below <Outlet/>.
  // T23.1 (ADR-0022): the offline outbox flusher shares this mount point —
  // it only runs with a live session. The component also registers
  // Background Sync (best-effort, Chromium-only) inside its effect.
  return (
    <>
      <RecurringAutoRun />
      <OutboxAutoFlush />
      <Outlet />
    </>
  );
}

/**
 * Gate for /admin/*. The API enforces this too (every admin endpoint
 * carries SuperAdminDep and answers 403) — this only spares a member the
 * download of an admin chunk and a screenful of failed requests.
 */
function RequireSuperadmin() {
  const lang = useLangStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);

  if (!user) return null; // RequireAuth above is still resolving.
  if (!user.isSuperadmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger/10 text-danger">
          <IconShield className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-ink">{w(lang, "adminAccessDenied")}</h1>
        <p className="mt-1 text-sm text-muted">{w(lang, "adminAccessDeniedHint")}</p>
      </div>
    );
  }
  return <Outlet />;
}

/**
 * Landing route. Owner 2026-09-09: a superadmin keeps no hisab, so the
 * personal dashboard is not their home — /admin is. The dashboard itself
 * stays reachable through UserMenu's user-view item.
 */
function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  if (user?.isSuperadmin) return <Navigate to="/admin" replace />;
  return <Dashboard />;
}

/**
 * Route tree. BrowserRouter is provided once in main.tsx so that every
 * component here stays MemoryRouter-compatible for tests.
 */
export default function App() {
  return (
    <ErrorBoundary>
      {/* Suspense sits UNDER the ErrorBoundary (T15.1a): a chunk-load
          failure rejects the lazy promise and must hit the boundary. */}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              {/* Member screens. Registered for every authed user: a
                  superadmin reaches them via UserMenu → user view, they are
                  simply absent from the admin navigation. */}
              <Route path="/" element={<HomeRoute />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/income" element={<Income />} />
              <Route path="/month" element={<Month />} />
              <Route path="/report" element={<Report />} />
              <Route path="/debts" element={<Debts />} />
              <Route path="/recurring" element={<Recurring />} />
              <Route path="/budget" element={<Budget />} />
              {/* Shared: a superadmin still owns a profile, password and
                  language, so settings is not part of the split. */}
              <Route path="/settings" element={<Settings />} />

              <Route path="/admin" element={<RequireSuperadmin />}>
                <Route index element={<AdminOverview />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="users/:userId" element={<AdminUserDetail />} />
                <Route path="analytics" element={<AdminAnalytics />} />
                <Route path="categories" element={<AdminCategories />} />
                <Route path="data" element={<AdminData />} />
                <Route path="audit" element={<AdminAudit />} />
                <Route path="roles" element={<AdminRoles />} />
                <Route path="security" element={<AdminSecurity />} />
                <Route path="system" element={<AdminSystem />} />
                <Route path="integrations" element={<AdminIntegrations />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
