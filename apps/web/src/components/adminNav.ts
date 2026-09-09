/**
 * The superadmin navigation tree.
 *
 * Owner decision 2026-09-09: "superadmin no need hisab entry, other user
 * need this." A superadmin is an operator, not a user of the expense
 * tracker, so they get this tree INSTEAD of the personal nav — no
 * dashboard, no expense list, no budget, and no add-expense FABs.
 *
 * It lives outside AppShell because two places render it: the sidebar/tab
 * bar, and the quick-links grid on /admin.
 */
import type { Lang } from "@poipoihisab/core";
import { w } from "../lib/web-i18n";
import {
  IconActivity,
  IconBarChart,
  IconDownload,
  IconHistory,
  IconHome,
  IconLock,
  IconPlug,
  IconReceipt,
  IconShield,
  IconSliders,
  IconUsers,
} from "./icons";

export interface NavEntry {
  to: string;
  end: boolean;
  Icon: React.ComponentType<{ className?: string }>;
  label: (l: Lang) => string;
}

export interface NavSection {
  /** Section heading above the group in the sidebar. */
  title: (l: Lang) => string;
  items: NavEntry[];
}

export const ADMIN_NAV_SECTIONS: NavSection[] = [
  {
    title: (l) => w(l, "menuAdminOversight"),
    items: [
      { to: "/admin", end: true, Icon: IconHome, label: (l) => w(l, "navAdminOverview") },
      { to: "/admin/users", end: false, Icon: IconUsers, label: (l) => w(l, "navAdminUsers") },
      {
        to: "/admin/analytics",
        end: false,
        Icon: IconBarChart,
        label: (l) => w(l, "navAdminAnalytics"),
      },
    ],
  },
  {
    title: (l) => w(l, "menuAdminOps"),
    items: [
      {
        to: "/admin/categories",
        end: false,
        Icon: IconReceipt,
        label: (l) => w(l, "navAdminCategories"),
      },
      { to: "/admin/data", end: false, Icon: IconDownload, label: (l) => w(l, "navAdminData") },
      { to: "/admin/audit", end: false, Icon: IconHistory, label: (l) => w(l, "navAdminAudit") },
      { to: "/admin/roles", end: false, Icon: IconShield, label: (l) => w(l, "navAdminRoles") },
    ],
  },
  {
    title: (l) => w(l, "menuAdminSystem"),
    items: [
      {
        to: "/admin/security",
        end: false,
        Icon: IconLock,
        label: (l) => w(l, "navAdminSecurity"),
      },
      {
        to: "/admin/system",
        end: false,
        Icon: IconActivity,
        label: (l) => w(l, "navAdminSystem"),
      },
      {
        to: "/admin/integrations",
        end: false,
        Icon: IconPlug,
        label: (l) => w(l, "navAdminIntegrations"),
      },
      // A superadmin still owns a profile: password, theme and language live
      // on the shared settings screen (its Sheets/khata cards hide for them).
      { to: "/settings", end: false, Icon: IconSliders, label: (l) => w(l, "navSettings") },
    ],
  },
];

/**
 * Bottom tab bar destinations for the admin shell, <1024px.
 *
 * Eleven sidebar rows do not fit a phone tab bar, so it carries the four
 * most-used and the sidebar drawer covers the rest.
 */
export const ADMIN_TAB_BAR: NavEntry[] = [
  ADMIN_NAV_SECTIONS[0].items[0],
  ADMIN_NAV_SECTIONS[0].items[1],
  ADMIN_NAV_SECTIONS[0].items[2],
  ADMIN_NAV_SECTIONS[1].items[2],
];
