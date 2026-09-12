import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
    </Svg>
  );
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </Svg>
  );
}

export function IconReceipt(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3h12v18l-2.4-1.6-2.4 1.6-2.4-1.6L8.4 21 6 19.4Z" />
      <path d="M9 8h6M9 12h6" />
    </Svg>
  );
}

export function IconBarChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V6M17 20v-9" />
    </Svg>
  );
}

/** Debts: money moving both directions. */
export function IconSwap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 7h9m0 0-2.5-2.5M17 7l-2.5 2.5" />
      <path d="M16 17H7m0 0 2.5-2.5M7 17l2.5 2.5" />
    </Svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M15.5 14.75h.01" />
    </Svg>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Svg>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14.5 5.5 4 4L8 20H4v-4Z" />
      <path d="m12.5 7.5 4 4" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6.5 7 7.5 21h9l1-14" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

/** Recurring (T16.4): circular refresh arrows — a schedule that repeats. */
export function IconRepeat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 2.5 20.5 6 17 9.5" />
      <path d="M20.5 6H7A3.5 3.5 0 0 0 3.5 9.5V11" />
      <path d="M7 21.5 3.5 18 7 14.5" />
      <path d="M3.5 18h13.5a3.5 3.5 0 0 0 3.5-3.5V13" />
    </Svg>
  );
}

/** Run-now trigger for the recurring scheduler. */
export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 4.5v15L19 12Z" />
    </Svg>
  );
}

/** Backup restore upload (T16.4 — ADR-0012). */
export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4 20h16" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 20h16" />
    </Svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Svg>
  );
}

/* Admin shell icons (superadmin role split). Same 24px grid, 1.8 stroke. */

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V20" />
      <circle cx="9" cy="8" r="3.2" />
      <path d="M16 11.2a3.2 3.2 0 0 0 0-6.2" />
      <path d="M18 20v-1.5a3.5 3.5 0 0 0-2.2-3.25" />
    </Svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.2 4.2v4h4" />
      <path d="M12 8v4.3l3 1.8" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
      <path d="M12 14.3v2.2" />
    </Svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h3.6l2.2-6 3.4 12 2.6-8 1.6 2H21" />
    </Svg>
  );
}

export function IconPlug(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M6.5 8h11v3.2a5.5 5.5 0 0 1-11 0V8z" />
      <path d="M12 16.7V21" />
    </Svg>
  );
}

export function IconTrendingUp(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </Svg>
  );
}

