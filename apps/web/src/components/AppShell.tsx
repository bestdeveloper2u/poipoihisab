import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@poipoihisab/core";
import { useAuthStore } from "../store/auth";
import { useLangStore } from "../store/lang";
import { w } from "../lib/web-i18n";
import { ADMIN_NAV_SECTIONS, ADMIN_TAB_BAR, type NavEntry } from "./adminNav";
import { LangToggle } from "./LangToggle";
import { Logo } from "./Logo";
import { ToastHost } from "./Toast";
import { UserMenu } from "./UserMenu";
import {
  IconBarChart,
  IconCalendar,
  IconHome,
  IconMic,
  IconPencil,
  IconReceipt,
  IconRepeat,
  IconSliders,
  IconSwap,
  IconWallet,
} from "./icons";

/*
 * MEMBER sidebar/tab destinations. Labels resolve per render (t for the core
 * dict, w for web-local keys) — navRecurring lives in web-i18n until it
 * graduates into @poipoihisab/core alongside the others.
 *
 * Prototype sidebar sections (www/index.html @596-633), adjusted by owner
 * 2026-09-08: NO add-expense item in the sidebar (the floating pencil/mic
 * FABs own add), and পুনরাবৃত্ত STAYS in আরও (owner: "/recurring we need
 * this"). Final: "মেনু" = ড্যাশবোর্ড → খরচ তালিকা → মাসিক হিসাব → রিপোর্ট,
 * then "আরও" = বাজেট → ধার-দেনা → পুনরাবৃত্ত → সেটিংস.
 *
 * Owner 2026-09-09: "superadmin no need hisab entry, other user need this."
 * A superadmin gets ADMIN_NAV_SECTIONS (see ./adminNav) INSTEAD of this
 * tree, and no add-expense FABs — they operate the platform rather than
 * keeping a hisab in it. The member routes stay registered so a superadmin
 * can still reach their own screens deliberately via the user-view item in
 * UserMenu; they are simply not in the admin nav.
 */
const NAV_DASHBOARD = {
  to: "/",
  end: true,
  Icon: IconHome,
  label: (l: Lang) => t(l, "navDashboard"),
};
const NAV_LIST = [
  { to: "/expenses", end: false, Icon: IconReceipt, label: (l: Lang) => t(l, "navExpenses") },
  { to: "/month", end: false, Icon: IconCalendar, label: (l: Lang) => t(l, "navMonthly") },
  { to: "/report", end: false, Icon: IconBarChart, label: (l: Lang) => t(l, "navReport") },
];
const NAV_MORE = [
  { to: "/budget", end: false, Icon: IconWallet, label: (l: Lang) => t(l, "navBudget") },
  { to: "/debts", end: false, Icon: IconSwap, label: (l: Lang) => t(l, "navDebts") },
  { to: "/recurring", end: false, Icon: IconRepeat, label: (l: Lang) => w(l, "navRecurring") },
  { to: "/settings", end: false, Icon: IconSliders, label: (l: Lang) => t(l, "navSettings") },
];
/** Bottom tab bar keeps every nav destination, icon-only, sidebar order. */
const NAV = [NAV_DASHBOARD, ...NAV_LIST, ...NAV_MORE];

type NavItem = NavEntry;

/** One sidebar row (prototype .sb-item): icon + label, emerald when active. */
function SidebarLink({ item, lang }: { item: NavItem; lang: Lang }) {
  const { to, end, Icon, label } = item;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold transition-colors ${
          isActive ? "bg-emerald text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
        }`
      }
    >
      <Icon className="h-[19px] w-[19px] shrink-0" />
      {label(lang)}
    </NavLink>
  );
}

/**
 * App shell mirroring the frozen prototype (www/index.html):
 * app bar with brand + version chip + compact language toggle,
 * 236px sidebar ≥1024px, 6-item icon-only bottom tab bar <1024px
 * with safe-area inset, and an emerald floating add button.
 */
export function AppShell() {
  const lang = useLangStore((s) => s.lang);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  /*
   * T14.6 — route-change focus management (WCAG 2.2 SC 2.4.3 Focus Order).
   * In an SPA the URL changes but focus stays put: after a route swap the
   * keyboard/screen-reader user is still anchored to the sidebar link they
   * just activated and gets NO announcement of the new page. Moving focus to
   * the <main> landmark (tabIndex=-1) on every pathname change restores a
   * sensible reading order. The initial mount is skipped so a fresh page
   * load keeps the browser default; query-string-only changes (e.g. opening
   * the add form on /expenses) do NOT re-trigger — only real route swaps.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  /*
   * T21.4 — prototype fabcol scroll-hide (@1781-1783): scrolling DOWN more
   * than 6px while past the 90px app bar hides the FAB column; ANY scroll-up
   * beyond the 6px hysteresis shows it again. The hysteresis stops touch
   * jitter from flapping the FABs. The real scroll container here is the
   * window (main has no overflow of its own), unlike the prototype's
   * scrollable <main> — so we track window.scrollY. The listener is passive:
   * it must never block the scroll thread.
   */
  const [fabHidden, setFabHidden] = useState(false);
  const lastScrollY = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const last = lastScrollY.current;
      if (y > last + 6 && y > 90) setFabHidden(true);
      else if (y < last - 6) setFabHidden(false);
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /*
   * T21.2 — context-aware FAB targets (prototype fabMode @1374 / addFab
   * @1772-1780): on /debts the pencil focuses the debt-party input, on
   * /budget the monthly-limit input, elsewhere it opens the add-expense
   * form; the mic opens the matching voice overlay.
   */
  const pencilTarget = pathname.startsWith("/debts")
    ? "/debts?focus=party"
    : pathname.startsWith("/budget")
      ? "/budget?focus=total"
      : "/expenses?add=1";
  const micTarget = pathname.startsWith("/debts")
    ? "/debts?voice=1"
    : pathname.startsWith("/budget")
      ? "/budget?voice=1"
      : "/expenses?voice=1";

  /*
   * The shell is one component with two navigation trees. Splitting it into
   * two shells would duplicate the header, skip link, focus management and
   * scroll handling above — all of which are role-independent.
   */
  const isAdminShell = Boolean(user?.isSuperadmin);

  return (
    <div className={`relative min-h-dvh bg-ivory text-ink ${lang === "bn" ? "font-bn" : "font-en"}`}>
      {/* Ambient background mesh providing depth for frosted glass surfaces */}
      <div className="ambient-mesh" aria-hidden="true" />

      {/* T14.4 — skip link (WCAG 2.2 SC 2.4.1 Bypass Blocks): the header,
          sidebar and tab bar repeat on every route; keyboard users can jump
          straight to the content landmark. Visually hidden until focused. */}
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault(); // keep the SPA URL clean — focus instead of hash-nav
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-emerald focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink focus:shadow-card"
      >
        {t(lang, "skipToContent")}
      </a>
      <ToastHost />
      <header className="glass-header sticky top-0 z-40 flex h-16 items-center gap-3 px-4 sm:px-6">
        <Logo withVersion />
        <div className="flex-1" />
        <LangToggle size="compact" />
        <UserMenu />
      </header>

      {/* Fluid full-width layout like the frozen prototype (no max-w cap). */}
      <div className="relative z-10 flex w-full">
        <aside className="glass-sidebar sticky top-16 hidden h-[calc(100dvh-4rem)] w-[236px] shrink-0 flex-col px-2.5 py-3 lg:flex">
          <nav aria-label="Main" className="flex flex-col gap-1 overflow-y-auto">
            {isAdminShell ? (
              ADMIN_NAV_SECTIONS.map((section) => (
                <div key={section.title("en")} className="flex flex-col gap-1">
                  <p className="px-[18px] pb-1 pt-3.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
                    {section.title(lang)}
                  </p>
                  {section.items.map((item) => (
                    <SidebarLink key={item.to} item={item} lang={lang} />
                  ))}
                </div>
              ))
            ) : (
              <>
                <p className="px-[18px] pb-1 pt-3.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
                  {w(lang, "menuMain")}
                </p>
                <SidebarLink item={NAV_DASHBOARD} lang={lang} />
                {/* Owner 2026-09-08: NO add-expense row in the sidebar — the
                    floating pencil FAB owns manual add, the mic FAB owns voice. */}
                {NAV_LIST.map((item) => (
                  <SidebarLink key={item.to} item={item} lang={lang} />
                ))}
                <p className="px-[18px] pb-1 pt-3.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">
                  {w(lang, "menuMore")}
                </p>
                {NAV_MORE.map((item) => (
                  <SidebarLink key={item.to} item={item} lang={lang} />
                ))}
              </>
            )}
          </nav>
        </aside>

        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-[clamp(16px,3.5vw,40px)] pb-[130px] pt-2 focus:outline-none"
        >
          <Outlet />
        </main>
      </div>

      {/* Prototype fabcol: small pencil FAB (নিজে লিখুন) above the big mic FAB —
          voice stays visually separate, exactly like the frozen prototype.
          Scroll-hide (.fadhide parity): slides out of the way while reading
          down, springs back on scroll-up; reduced motion keeps the toggle but
          drops the transition via the app-wide CSS kill-switch. `inert` keeps
          the hidden buttons out of the tab order.

          Both FABs exist only to create a hisab entry, which is precisely
          what a superadmin does not do — so the admin shell renders no FAB
          column rather than a disabled one. */}
      {!isAdminShell && (
      <div
        inert={fabHidden}
        aria-hidden={fabHidden}
        className={`fab-pos fixed right-4 z-40 flex flex-col items-center gap-2.5 transition-[transform,opacity] duration-300 ease-out lg:right-8 ${
          fabHidden ? "pointer-events-none translate-y-[160%] opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <button
          type="button"
          aria-label={w(lang, "qaManual")}
          title={w(lang, "qaManual")}
          onClick={() => navigate(pencilTarget)}
          className="glass-fab flex h-11 w-11 items-center justify-center rounded-full text-ink transition-[filter] hover:brightness-105"
        >
          <IconPencil className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label={w(lang, "voiceTitle")}
          title={w(lang, "voiceTitle")}
          onClick={() =>
            // Prototype fabMode(): the mic is context-aware — debts ledger,
            // budget screen, or expense-voice everywhere else.
            navigate(micTarget)
          }
          className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald text-accent-ink shadow-card shadow-[0_8px_24px_rgba(14,107,80,0.32)] dark:shadow-[0_8px_24px_rgba(47,185,143,0.32)] transition-transform active:scale-95"
        >
          <IconMic className="h-6 w-6" />
        </button>
      </div>
      )}

      <nav
        aria-label="Tabs"
        className="glass-tabbar pb-safe fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around lg:hidden"
      >
        {/* All NAV items fit <1024px by going icon-only:
            labels live in the accessible name (aria-label) + title tooltip.
            The admin tree has eleven rows, which does not fit a phone tab
            bar, so it shows its four busiest (ADMIN_TAB_BAR) and the rest
            stay one tap away from /admin's quick-links grid. */}
        {(isAdminShell ? ADMIN_TAB_BAR : NAV).map(({ to, end, Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label(lang)}
            title={label(lang)}
            className={({ isActive }) =>
              `flex min-h-11 min-w-0 flex-1 items-center justify-center ${
                isActive ? "text-emerald" : "text-muted"
              }`
            }
          >
            <Icon className="h-6 w-6" />
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
