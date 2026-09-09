import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { toBnDigits, type Lang } from "@poipoihisab/core";
import {
  apiAdminStats,
  apiAdminListUsers,
  apiAdminGetUser,
  apiAdminGetUserExpenses,
  apiAdminGetUserDebts,
  apiAdminGetUserRecurring,
  apiAdminSuspendUser,
  apiAdminDeleteUser,
  apiAdminBulkSuspendUsers,
  apiAdminBulkDeleteUsers,
  apiAdminImportUsers,
  apiAdminDownloadUsersCsv,
  type AdminPlatformStats,
  type AdminUserItem,
  type AdminUserDetail,
  type AdminUserExpenses,
  type AdminUserDebts,
  type AdminUserRecurring,
  type AdminUserImportRow,
} from "@poipoihisab/api-client";
import { useAuthStore } from "../store/auth";
import { useLangStore } from "../store/lang";
import { usePageTitle } from "../lib/usePageTitle";
import { w } from "../lib/web-i18n";
import { fmtTaka } from "../lib/money";
import { Modal } from "../components/Modal";
import {
  IconDownload,
  IconReceipt,
  IconRepeat,
  IconSearch,
  IconShield,
  IconSwap,
  IconTrash,
  IconUpload,
  IconWallet,
} from "../components/icons";

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
}

function parseUsersCsv(text: string): AdminUserImportRow[] {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const firstCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  let nameIdx = 0;
  let emailIdx = 1;
  let passIdx = 2;
  let startIndex = 0;

  const hasNameHeader = firstCells.some((c) => c === "name" || c === "নাম");
  const hasEmailHeader = firstCells.some((c) => c === "email" || c === "ইমেইল");

  if (hasNameHeader || hasEmailHeader) {
    startIndex = 1;
    firstCells.forEach((c, idx) => {
      if (c === "name" || c === "নাম") nameIdx = idx;
      else if (c === "email" || c === "ইমেইল") emailIdx = idx;
      else if (c === "password" || c === "পাসওয়ার্ড" || c === "pass") passIdx = idx;
    });
  }

  const rows: AdminUserImportRow[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const name = cells[nameIdx]?.trim();
    const email = cells[emailIdx]?.trim();
    const password = cells[passIdx]?.trim() || undefined;
    if (email && email.includes("@")) {
      rows.push({
        name: name || "User",
        email,
        password: password || undefined,
      });
    }
  }

  return rows;
}

function formatDate(iso: string, lang: Lang): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === "bn" ? "bn-BD" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function StatTile({
  label,
  value,
  icon: Icon,
  lang,
  accentColor = "emerald",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  lang: Lang;
  accentColor?: "emerald" | "amber" | "sky" | "violet";
}) {
  const iconBg = {
    emerald: "bg-emerald/10 text-emerald",
    amber: "bg-warning/10 text-warning",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    violet: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  }[accentColor];

  return (
    <div className="glass-card rounded-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-control ${iconBg}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      <p
        className={`mt-2.5 text-2xl font-extrabold tabular-nums tracking-tight text-ink ${
          lang === "bn" ? "font-bn" : "font-en"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

interface ConfirmModalState {
  type: "suspend" | "unsuspend" | "delete";
  user: {
    id: string;
    name: string;
    email: string | null;
  };
}

interface BulkConfirmModalState {
  type: "suspend" | "unsuspend" | "delete";
  userIds: string[];
  userNames: string[];
}

export function Admin() {
  const lang = useLangStore((s) => s.lang);
  const currentUser = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  usePageTitle(w(lang, "adminTitle"));

  const [stats, setStats] = useState<AdminPlatformStats | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [totalUsersCount, setTotalUsersCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Inspector state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inspectUser, setInspectUser] = useState<AdminUserDetail | null>(null);
  const [userExpenses, setUserExpenses] = useState<AdminUserExpenses | null>(null);
  const [userDebts, setUserDebts] = useState<AdminUserDebts | null>(null);
  const [userRecurring, setUserRecurring] = useState<AdminUserRecurring | null>(null);
  const [inspectTab, setInspectTab] = useState<"expenses" | "debts" | "budgets" | "recurring">("expenses");
  const [inspectLoading, setInspectLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // User management action state
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [actionInProgress, setActionInProgress] = useState(false);

  // Bulk action state
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkConfirmModal, setBulkConfirmModal] = useState<BulkConfirmModalState | null>(null);
  const [bulkActionInProgress, setBulkActionInProgress] = useState(false);

  // Import / Export state
  const [exporting, setExporting] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<AdminUserImportRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [, startTransition] = useTransition();

  // Guard: superadmin access
  useEffect(() => {
    if (currentUser && !currentUser.isSuperadmin) {
      navigate("/", { replace: true });
    }
  }, [currentUser, navigate]);

  // Load stats and user list
  const refreshUsersAndStats = async () => {
    setLoading(true);
    setError(null);

    const [statsRes, usersRes] = await Promise.all([
      apiAdminStats(lang),
      apiAdminListUsers({ q: searchQuery.trim() || undefined, limit: 50 }, lang),
    ]);

    if (statsRes.ok) {
      setStats(statsRes.data);
    } else {
      setError(statsRes.detail);
    }

    if (usersRes.ok) {
      setUsers(usersRes.data.items);
      setTotalUsersCount(usersRes.data.total);
    } else if (!statsRes.ok) {
      setError(usersRes.detail);
    }

    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    async function fetchData() {
      setLoading(true);
      setError(null);

      const [statsRes, usersRes] = await Promise.all([
        apiAdminStats(lang),
        apiAdminListUsers({ q: searchQuery.trim() || undefined, limit: 50 }, lang),
      ]);

      if (!active) return;

      if (statsRes.ok) setStats(statsRes.data);
      else setError(statsRes.detail);

      if (usersRes.ok) {
        setUsers(usersRes.data.items);
        setTotalUsersCount(usersRes.data.total);
      } else if (!statsRes.ok) {
        setError(usersRes.detail);
      }

      setLoading(false);
    }

    fetchData();

    return () => {
      active = false;
    };
  }, [lang, searchQuery]);

  // Load inspected user data when a user ID is selected
  useEffect(() => {
    if (!selectedUserId) {
      setInspectUser(null);
      setUserExpenses(null);
      setUserDebts(null);
      setUserRecurring(null);
      return;
    }

    let active = true;
    async function fetchUserDetail(uid: string) {
      setInspectLoading(true);
      const [detailRes, expRes, debtsRes, recRes] = await Promise.all([
        apiAdminGetUser(uid, lang),
        apiAdminGetUserExpenses(uid, { limit: 50 }, lang),
        apiAdminGetUserDebts(uid, lang),
        apiAdminGetUserRecurring(uid, lang),
      ]);

      if (!active) return;

      if (detailRes.ok) setInspectUser(detailRes.data);
      if (expRes.ok) setUserExpenses(expRes.data);
      if (debtsRes.ok) setUserDebts(debtsRes.data);
      if (recRes.ok) setUserRecurring(recRes.data);

      setInspectLoading(false);
    }

    fetchUserDetail(selectedUserId);

    return () => {
      active = false;
    };
  }, [selectedUserId, lang]);

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleExecuteAction = async () => {
    if (!confirmModal) return;
    setActionInProgress(true);
    setError(null);
    setActionSuccess(null);

    const { type, user: target } = confirmModal;

    if (type === "suspend" || type === "unsuspend") {
      const suspended = type === "suspend";
      const res = await apiAdminSuspendUser(target.id, suspended, lang);
      if (res.ok) {
        setActionSuccess(res.data.message);
        // Update user in local state
        setUsers((prev) =>
          prev.map((u) => (u.id === target.id ? { ...u, isSuspended: suspended } : u)),
        );
        if (inspectUser && inspectUser.user.id === target.id) {
          setInspectUser({
            ...inspectUser,
            user: { ...inspectUser.user, isSuspended: suspended },
          });
        }
      } else {
        setError(res.detail);
      }
    } else if (type === "delete") {
      const res = await apiAdminDeleteUser(target.id, lang);
      if (res.ok) {
        setActionSuccess(res.data.message);
        // Remove user from local state
        setUsers((prev) => prev.filter((u) => u.id !== target.id));
        setTotalUsersCount((c) => Math.max(0, c - 1));
        if (selectedUserId === target.id) {
          setSelectedUserId(null);
        }
        void refreshUsersAndStats();
      } else {
        setError(res.detail);
      }
    }

    setActionInProgress(false);
    setConfirmModal(null);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  // Selection helpers
  const selectableUsers = users.filter(
    (u) => u.id !== currentUser?.id && u.email !== currentUser?.email,
  );
  const allSelected =
    selectableUsers.length > 0 &&
    selectableUsers.every((u) => selectedUserIds.has(u.id));
  const isIndeterminate = selectedUserIds.size > 0 && !allSelected;

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(selectableUsers.map((u) => u.id)));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExecuteBulkAction = async () => {
    if (!bulkConfirmModal) return;
    setBulkActionInProgress(true);
    setError(null);
    setActionSuccess(null);

    const { type, userIds } = bulkConfirmModal;

    if (type === "suspend" || type === "unsuspend") {
      const suspended = type === "suspend";
      const res = await apiAdminBulkSuspendUsers(userIds, suspended, lang);
      if (res.ok) {
        setActionSuccess(res.data.message);
        const targetSet = new Set(userIds);
        setUsers((prev) =>
          prev.map((u) =>
            targetSet.has(u.id) ? { ...u, isSuspended: suspended } : u,
          ),
        );
        setSelectedUserIds(new Set());
      } else {
        setError(res.detail);
      }
    } else if (type === "delete") {
      const res = await apiAdminBulkDeleteUsers(userIds, lang);
      if (res.ok) {
        setActionSuccess(res.data.message);
        const targetSet = new Set(userIds);
        setUsers((prev) => prev.filter((u) => !targetSet.has(u.id)));
        setTotalUsersCount((c) => Math.max(0, c - userIds.length));
        setSelectedUserIds(new Set());
        void refreshUsersAndStats();
      } else {
        setError(res.detail);
      }
    }

    setBulkActionInProgress(false);
    setBulkConfirmModal(null);
    setTimeout(() => setActionSuccess(null), 4000);
  };

  const handleExportUsers = async () => {
    setExporting(true);
    setError(null);
    const res = await apiAdminDownloadUsersCsv(lang);
    if (res.ok && res.data) {
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (!res.ok) {
      setError(res.detail);
    }
    setExporting(false);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseUsersCsv(text);
      if (parsed.length === 0) {
        setImportError(
          lang === "bn"
            ? "ফাইলে কোনো বৈধ ব্যবহারকারী তথ্য পাওয়া যায়নি (নাম এবং সঠিক ইমেইল থাকা আবশ্যক)।"
            : "No valid user rows found in CSV (name and valid email required).",
        );
        setImportRows([]);
        return;
      }
      setImportError(null);
      setImportRows(parsed);
    } catch {
      setImportError(
        lang === "bn" ? "CSV ফাইল পড়া যায়নি।" : "Failed to read CSV file.",
      );
    }
  };

  const handleDownloadSampleCsv = () => {
    const sample =
      "\uFEFFname,email,password\r\nRahim Uddin,rahim@example.com,RahimPass123!\r\nKarim Hossain,karim@example.com,";
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExecuteImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    setImportError(null);

    const res = await apiAdminImportUsers(importRows, lang);
    if (res.ok) {
      const { createdCount, skippedCount } = res.data;
      let msg = `${createdCount} ${w(lang, "adminImportSuccess")}`;
      if (skippedCount > 0) {
        msg += `, ${skippedCount} ${w(lang, "adminImportSkipped")}`;
      }
      setActionSuccess(msg);
      setImportModalOpen(false);
      setImportRows([]);
      void refreshUsersAndStats();
    } else {
      setImportError(res.detail);
    }
    setImporting(false);
    setTimeout(() => setActionSuccess(null), 5000);
  };


  if (!currentUser?.isSuperadmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger/10 text-danger">
          <IconShield className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-ink">
          {lang === "bn" ? "প্রবেশাধিকার নেই" : "Access Denied"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {lang === "bn"
            ? "এই পৃষ্ঠা দেখার জন্য সুপার অ্যাডমিন পারমিশন প্রয়োজন।"
            : "Super Admin privileges are required to view this page."}
        </p>
      </div>
    );
  }

  const num = (n: number) => (lang === "bn" ? toBnDigits(String(n)) : String(n));

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-12 pt-2 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-card bg-emerald text-accent-ink shadow-sm">
              <IconShield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
                {w(lang, "adminTitle")}
              </h1>
              <p className="text-xs text-muted sm:text-sm">{w(lang, "adminSub")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && !stats && (
        <div aria-hidden="true" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-card border border-line bg-surface"
              />
            ))}
          </div>
          <div className="h-[300px] animate-pulse rounded-card border border-line bg-surface" />
        </div>
      )}

      {/* KPI Cards Grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <StatTile
            label={w(lang, "adminTotalUsers")}
            value={num(stats.totalUsers)}
            icon={IconShield}
            lang={lang}
            accentColor="emerald"
          />
          <StatTile
            label={w(lang, "adminTotalExpenses")}
            value={num(stats.totalExpenses)}
            icon={IconReceipt}
            lang={lang}
            accentColor="sky"
          />
          <StatTile
            label={w(lang, "adminTabDebts")}
            value={num(stats.totalDebts)}
            icon={IconSwap}
            lang={lang}
            accentColor="amber"
          />
          <StatTile
            label={w(lang, "adminTotalVolume")}
            value={fmtTaka(stats.totalAmount, lang)}
            icon={IconWallet}
            lang={lang}
            accentColor="violet"
          />
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-center gap-2.5 rounded-card border border-emerald/25 bg-emerald/10 p-3.5 text-sm font-semibold text-emerald shadow-sm">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald text-[11px] text-accent-ink">✓</span>
          {actionSuccess}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 rounded-card border border-danger/25 bg-danger/10 p-3.5 text-sm font-medium text-danger shadow-sm">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[11px] text-accent-ink">!</span>
          {error}
        </div>
      )}

      {/* Users Section */}
      <div className="glass-card rounded-card overflow-hidden">
        {/* Table Toolbar */}
        <div className="border-b border-line/50 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-base font-bold text-ink">
              {w(lang, "adminUsersTable")}
            </h2>
            <p className="text-xs text-muted">
              {lang === "bn"
                ? `মোট ${num(totalUsersCount)} জন নিবন্ধিত ব্যবহারকারী`
                : `${totalUsersCount} registered users total`}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
            <div className="relative min-w-[200px] max-w-xs flex-1 sm:w-60">
              <IconSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="search"
                placeholder={w(lang, "adminSearchPlaceholder")}
                value={searchQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  startTransition(() => {
                    setSearchQuery(val);
                  });
                }}
                className="w-full rounded-control border border-line/60 bg-surface/70 py-2 pl-9 pr-8 text-sm text-ink outline-none transition-all placeholder:text-muted focus:border-emerald focus:bg-surface focus:ring-2 focus:ring-emerald/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full text-xs text-muted hover:bg-surface-2 hover:text-ink"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Export CSV button */}
            <button
              type="button"
              onClick={() => void handleExportUsers()}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-control border border-line/70 bg-surface/80 px-3 py-2 text-xs font-semibold text-ink shadow-sm transition-all hover:bg-surface-2 hover:border-emerald/40 active:scale-95 disabled:opacity-60"
            >
              {exporting ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald/30 border-t-emerald" />
              ) : (
                <IconDownload className="h-3.5 w-3.5 text-emerald" />
              )}
              <span>{exporting ? w(lang, "loading") : w(lang, "adminExportCsv")}</span>
            </button>

            {/* Import CSV button */}
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-control border border-line/70 bg-surface/80 px-3 py-2 text-xs font-semibold text-ink shadow-sm transition-all hover:bg-surface-2 hover:border-emerald/40 active:scale-95"
            >
              <IconUpload className="h-3.5 w-3.5 text-emerald" />
              <span>{w(lang, "adminImportUsers")}</span>
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line/40 bg-surface-2/40 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="w-10 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={handleToggleSelectAll}
                    disabled={selectableUsers.length === 0}
                    aria-label={w(lang, "adminSelectAll")}
                    className="h-4 w-4 rounded border-line text-emerald focus:ring-emerald cursor-pointer accent-emerald disabled:cursor-not-allowed disabled:opacity-30"
                  />
                </th>
                <th className="px-4 py-3">{w(lang, "adminUserName")}</th>
                <th className="hidden px-4 py-3 md:table-cell">{w(lang, "adminUserEmail")}</th>
                <th className="px-4 py-3 text-center">{w(lang, "adminStatus")}</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">{w(lang, "adminUserExpensesCount")}</th>
                <th className="px-4 py-3 text-right">{w(lang, "adminUserTotalSpent")}</th>
                <th className="hidden px-4 py-3 lg:table-cell">{w(lang, "adminUserJoined")}</th>
                <th className="px-4 py-3 text-center">{w(lang, "adminUserActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/30">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2 text-muted">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted/30 border-t-emerald" />
                      <span className="text-sm">{w(lang, "loading")}</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-muted">
                    {w(lang, "adminNoData")}
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const initial = (u.name.trim()[0] ?? "U").toUpperCase();
                  const isSelf = u.id === currentUser.id || u.email === currentUser.email;

                  return (
                    <tr
                      key={u.id}
                      className={`group transition-colors hover:bg-surface-2/40 ${
                        selectedUserIds.has(u.id) ? "bg-emerald/5" : ""
                      }`}
                    >
                      {/* Selection Checkbox */}
                      <td className="w-10 px-4 py-3.5 text-center whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(u.id)}
                          disabled={isSelf}
                          onChange={() => handleToggleSelectRow(u.id)}
                          aria-label={`Select ${u.name}`}
                          title={isSelf ? w(lang, "adminSelfActionDenied") : undefined}
                          className="h-4 w-4 rounded border-line text-emerald focus:ring-emerald cursor-pointer accent-emerald disabled:cursor-not-allowed disabled:opacity-30"
                        />
                      </td>

                      {/* Name & Badge */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(u.id)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-xs font-bold text-emerald transition-transform hover:scale-105 focus:outline-none"
                            title={lang === "bn" ? "ডাটা দেখতে ক্লিক করুন" : "Click to view user data"}
                          >
                            {initial}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedUserId(u.id)}
                                className="font-semibold text-ink hover:text-emerald hover:underline focus:outline-none text-left"
                                title={lang === "bn" ? "ডাটা দেখতে ক্লিক করুন" : "Click to view user data"}
                              >
                                {u.name}
                              </button>
                              {u.isSuperadmin && (
                                <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-[10px] font-bold text-emerald">
                                  {w(lang, "adminSuperAdminBadge")}
                                </span>
                              )}
                            </div>
                            {/* Show email under name on mobile (hidden in its own column on md+) */}
                            <span className="block truncate text-[11px] text-muted md:hidden">
                              {u.email ?? "—"}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Email — hidden on mobile, visible from md */}
                      <td className="hidden px-4 py-3.5 font-en text-xs text-muted whitespace-nowrap md:table-cell">
                        {u.email ?? "—"}
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        {u.isSuspended ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-0.5 text-[11px] font-bold text-danger">
                            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                            {w(lang, "adminStatusSuspended")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                            {w(lang, "adminStatusActive")}
                          </span>
                        )}
                      </td>

                      {/* Expense Count — hidden on small mobile */}
                      <td className="hidden px-4 py-3.5 text-right font-semibold tabular-nums text-ink whitespace-nowrap sm:table-cell">
                        {num(u.expenseCount)}
                      </td>

                      {/* Total Spent */}
                      <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-ink whitespace-nowrap">
                        {fmtTaka(u.totalExpense, lang)}
                      </td>

                      {/* Joined Date — hidden on mobile */}
                      <td className="hidden px-4 py-3.5 text-xs text-muted whitespace-nowrap lg:table-cell">
                        {formatDate(u.createdAt, lang)}
                      </td>

                      {/* Action Buttons */}
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Inspect */}
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(u.id)}
                            className="inline-flex items-center gap-1 rounded-control bg-emerald px-2.5 py-1 text-xs font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-95"
                          >
                            {w(lang, "adminInspect")}
                          </button>

                          {/* Suspend / Reactivate */}
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  type: u.isSuspended ? "unsuspend" : "suspend",
                                  user: { id: u.id, name: u.name, email: u.email },
                                })
                              }
                              className={`rounded-control px-2 py-1 text-xs font-semibold transition-all hover:brightness-105 active:scale-95 ${
                                u.isSuspended
                                  ? "bg-emerald/15 text-emerald hover:bg-emerald/25"
                                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
                              }`}
                            >
                              {u.isSuspended ? w(lang, "adminUnsuspend") : w(lang, "adminSuspend")}
                            </button>
                          )}

                          {/* Delete */}
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmModal({
                                  type: "delete",
                                  user: { id: u.id, name: u.name, email: u.email },
                                })
                              }
                              className="rounded-control p-1 text-danger/80 hover:bg-danger/10 hover:text-danger active:scale-95"
                              title={w(lang, "adminDelete")}
                              aria-label={w(lang, "adminDelete")}
                            >
                              <IconTrash className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Data Inspector Modal */}
      <Modal
        open={Boolean(selectedUserId)}
        onClose={() => setSelectedUserId(null)}
        label={w(lang, "adminInspectTitle")}
        className="lg:max-w-3xl"
      >
        <div className="flex max-h-[88vh] flex-col p-6 sm:p-7">
          {/* Modal Header */}
          <div className="flex items-start justify-between gap-4 border-b border-line/50 pb-5">
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-base font-bold text-emerald ring-2 ring-emerald/25 shadow-sm">
                {(inspectUser?.user.name.trim()[0] ?? "U").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-ink truncate">
                    {inspectUser?.user.name ?? w(lang, "adminInspectTitle")}
                  </h3>
                  {inspectUser?.user.isSuperadmin && (
                    <span className="rounded-full bg-emerald/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald">
                      {w(lang, "adminSuperAdminBadge")}
                    </span>
                  )}
                  {inspectUser && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        inspectUser.user.isSuspended
                          ? "bg-danger/15 text-danger"
                          : "bg-emerald/15 text-emerald"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${inspectUser.user.isSuspended ? "bg-danger" : "bg-emerald"}`} />
                      {inspectUser.user.isSuspended
                        ? w(lang, "adminStatusSuspended")
                        : w(lang, "adminStatusActive")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 font-en text-xs text-muted">
                  {inspectUser?.user.email ?? "No email"}
                </p>
                {selectedUserId && (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-control border border-line/60 bg-surface-2/60 px-2.5 py-1 text-xs">
                    <span className="font-mono text-muted select-all">
                      ID: {selectedUserId}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyId(selectedUserId)}
                      className="font-semibold text-emerald transition-colors hover:underline hover:text-emerald/80"
                    >
                      {copiedId === selectedUserId
                        ? (lang === "bn" ? "✓ কপি হয়েছে!" : "✓ Copied!")
                        : (lang === "bn" ? "কপি করুন" : "Copy")}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Suspend / Delete buttons inside inspector */}
              {inspectUser &&
                inspectUser.user.id !== currentUser.id &&
                inspectUser.user.email !== currentUser.email && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          type: inspectUser.user.isSuspended ? "unsuspend" : "suspend",
                          user: {
                            id: inspectUser.user.id,
                            name: inspectUser.user.name,
                            email: inspectUser.user.email,
                          },
                        })
                      }
                      className={`rounded-control px-3 py-1.5 text-xs font-semibold shadow-sm transition-all hover:brightness-105 active:scale-95 ${
                        inspectUser.user.isSuspended
                          ? "bg-emerald/15 text-emerald hover:bg-emerald/25"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
                      }`}
                    >
                      {inspectUser.user.isSuspended
                        ? w(lang, "adminUnsuspend")
                        : w(lang, "adminSuspend")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmModal({
                          type: "delete",
                          user: {
                            id: inspectUser.user.id,
                            name: inspectUser.user.name,
                            email: inspectUser.user.email,
                          },
                        })
                      }
                      className="rounded-control bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 active:scale-95 transition-colors"
                    >
                      {w(lang, "adminDelete")}
                    </button>
                  </>
                )}
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2/70 text-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none"
                aria-label={w(lang, "adminClose")}
              >
                ✕
              </button>
            </div>
          </div>

          {/* User Overview Quick KPIs */}
          {inspectUser && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-card border border-line/60 bg-surface-2/50 p-3 text-center shadow-xs">
                <span className="text-[11px] font-semibold text-muted">{w(lang, "adminUserExpensesCount")}</span>
                <p className="mt-1 text-base font-extrabold tabular-nums text-ink">{num(inspectUser.user.expenseCount)}</p>
              </div>
              <div className="rounded-card border border-line/60 bg-surface-2/50 p-3 text-center shadow-xs">
                <span className="text-[11px] font-semibold text-muted">{w(lang, "adminUserTotalSpent")}</span>
                <p className="mt-1 text-base font-extrabold tabular-nums text-ink">{fmtTaka(inspectUser.user.totalExpense, lang)}</p>
              </div>
              <div className="rounded-card border border-line/60 bg-surface-2/50 p-3 text-center shadow-xs">
                <span className="text-[11px] font-semibold text-muted">{w(lang, "adminTabDebts")}</span>
                <p className="mt-1 text-base font-extrabold tabular-nums text-ink">{num(inspectUser.user.debtCount)}</p>
              </div>
              <div className="rounded-card border border-line/60 bg-surface-2/50 p-3 text-center shadow-xs">
                <span className="text-[11px] font-semibold text-muted">{w(lang, "adminTabRecurring")}</span>
                <p className="mt-1 text-base font-extrabold tabular-nums text-ink">{num(inspectUser.user.recurringCount)}</p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="mt-5 flex gap-2 overflow-x-auto border-b border-line/50 pb-px text-xs font-semibold [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <button
              type="button"
              onClick={() => setInspectTab("expenses")}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 transition-all ${
                inspectTab === "expenses"
                  ? "border-emerald text-emerald font-bold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <IconReceipt className="h-3.5 w-3.5" />
              {w(lang, "adminTabExpenses")} ({num(userExpenses?.items.length ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setInspectTab("debts")}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 transition-all ${
                inspectTab === "debts"
                  ? "border-emerald text-emerald font-bold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <IconSwap className="h-3.5 w-3.5" />
              {w(lang, "adminTabDebts")} ({num(userDebts?.items.length ?? 0)})
            </button>
            <button
              type="button"
              onClick={() => setInspectTab("budgets")}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 transition-all ${
                inspectTab === "budgets"
                  ? "border-emerald text-emerald font-bold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <IconWallet className="h-3.5 w-3.5" />
              {w(lang, "adminTabBudgets")}
            </button>
            <button
              type="button"
              onClick={() => setInspectTab("recurring")}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 transition-all ${
                inspectTab === "recurring"
                  ? "border-emerald text-emerald font-bold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <IconRepeat className="h-3.5 w-3.5" />
              {w(lang, "adminTabRecurring")} ({num(userRecurring?.items.length ?? 0)})
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto pt-4">
            {inspectLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted/30 border-t-emerald" />
                <span className="text-sm">{w(lang, "loading")}</span>
              </div>
            ) : inspectTab === "expenses" ? (
              userExpenses && userExpenses.items.length > 0 ? (
                <div className="rounded-card border border-line/40 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-line/40 bg-surface-2/50 text-[11px] font-bold uppercase tracking-wider text-muted">
                        <tr>
                          <th className="px-3.5 py-2.5">{w(lang, "dateLabel")}</th>
                          <th className="px-3.5 py-2.5">{w(lang, "catLabel")}</th>
                          <th className="px-3.5 py-2.5">{w(lang, "grpLabel")}</th>
                          <th className="px-3.5 py-2.5">{w(lang, "descLabel")}</th>
                          <th className="px-3.5 py-2.5 text-right">{w(lang, "amtLabel")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/20">
                        {userExpenses.items.map((exp) => (
                          <tr key={exp.id} className="hover:bg-surface-2/30 transition-colors">
                            <td className="px-3.5 py-2.5 text-muted whitespace-nowrap">{exp.iso}</td>
                            <td className="px-3.5 py-2.5 font-medium text-ink whitespace-nowrap">{exp.cat}</td>
                            <td className="px-3.5 py-2.5 text-muted whitespace-nowrap">{exp.grp}</td>
                            <td className="px-3.5 py-2.5 text-muted truncate max-w-[14rem]">{exp.desc ?? "—"}</td>
                            <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-ink whitespace-nowrap">
                              {fmtTaka(exp.amt, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2/70 text-muted">
                    <IconReceipt className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink">{w(lang, "adminNoData")}</p>
                </div>
              )
            ) : inspectTab === "debts" ? (
              userDebts && userDebts.items.length > 0 ? (
                <div className="rounded-card border border-line/40 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-line/40 bg-surface-2/50 text-[11px] font-bold uppercase tracking-wider text-muted">
                        <tr>
                          <th className="px-3.5 py-2.5">
                            {lang === "bn" ? "ব্যক্তি / প্রতিষ্ঠান" : "Party"}
                          </th>
                          <th className="px-3.5 py-2.5">
                            {lang === "bn" ? "ধরন" : "Direction"}
                          </th>
                          <th className="px-3.5 py-2.5">{w(lang, "descLabel")}</th>
                          <th className="px-3.5 py-2.5">
                            {lang === "bn" ? "স্ট্যাটাস" : "Status"}
                          </th>
                          <th className="px-3.5 py-2.5 text-right">{w(lang, "amtLabel")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/20">
                        {userDebts.items.map((debt) => (
                          <tr key={debt.id} className="hover:bg-surface-2/30 transition-colors">
                            <td className="px-3.5 py-2.5 font-medium text-ink">{debt.party}</td>
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  debt.dir === "lend"
                                    ? "bg-emerald/15 text-emerald"
                                    : "bg-danger/15 text-danger"
                                }`}
                              >
                                {debt.dir === "lend"
                                  ? (lang === "bn" ? "পাবো (Lend)" : "Lend")
                                  : (lang === "bn" ? "দিতে হবে (Borrow)" : "Borrow")}
                              </span>
                            </td>
                            <td className="px-3.5 py-2.5 text-muted">{debt.note ?? "—"}</td>
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  debt.settled_at
                                    ? "bg-muted/15 text-muted line-through"
                                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold"
                                }`}
                              >
                                {debt.settled_at ? (lang === "bn" ? "পরিশোধিত" : "Settled") : (lang === "bn" ? "বাকি" : "Pending")}
                              </span>
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-ink whitespace-nowrap">
                              {fmtTaka(debt.amt, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2/70 text-muted">
                    <IconSwap className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink">{w(lang, "adminNoData")}</p>
                </div>
              )
            ) : inspectTab === "budgets" ? (
              inspectUser?.budget ? (
                <div className="space-y-4 py-2">
                  <div className="glass-card rounded-card border border-line/50 p-4 shadow-xs">
                    <span className="text-xs font-semibold text-muted">
                      {lang === "bn" ? "মাসিক মোট বাজেট" : "Monthly Total Budget"}
                    </span>
                    <p className="mt-1 text-2xl font-extrabold text-ink tabular-nums">
                      {fmtTaka(inspectUser.budget.total, lang)}
                    </p>
                  </div>
                  {inspectUser.budget.cats &&
                    Object.keys(inspectUser.budget.cats).length > 0 && (
                      <div>
                        <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted">
                          {lang === "bn" ? "খাতভিত্তিক বাজেট" : "Category Limits"}
                        </h4>
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                          {Object.entries(inspectUser.budget.cats).map(([cat, limit]) => (
                            <div key={cat} className="rounded-control border border-line/40 bg-surface-2/50 p-3 shadow-xs">
                              <span className="text-xs text-muted font-medium">{cat}</span>
                              <p className="mt-1 font-bold text-ink tabular-nums">{fmtTaka(limit, lang)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2/70 text-muted">
                    <IconWallet className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink">{w(lang, "noBudget")}</p>
                </div>
              )
            ) : inspectTab === "recurring" ? (
              userRecurring && userRecurring.items.length > 0 ? (
                <div className="rounded-card border border-line/40 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-line/40 bg-surface-2/50 text-[11px] font-bold uppercase tracking-wider text-muted">
                        <tr>
                          <th className="px-3.5 py-2.5">{w(lang, "catLabel")}</th>
                          <th className="px-3.5 py-2.5">{w(lang, "rFreq")}</th>
                          <th className="px-3.5 py-2.5">{w(lang, "rNext")}</th>
                          <th className="px-3.5 py-2.5">{w(lang, "rActive")}</th>
                          <th className="px-3.5 py-2.5 text-right">{w(lang, "amtLabel")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/20">
                        {userRecurring.items.map((rule) => (
                          <tr key={rule.id} className="hover:bg-surface-2/30 transition-colors">
                            <td className="px-3.5 py-2.5 font-medium text-ink">{rule.cat}</td>
                            <td className="px-3.5 py-2.5 text-muted">{rule.freq}</td>
                            <td className="px-3.5 py-2.5 text-muted">{rule.next_run}</td>
                            <td className="px-3.5 py-2.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  rule.active
                                    ? "bg-emerald/15 text-emerald"
                                    : "bg-muted/15 text-muted"
                                }`}
                              >
                                {rule.active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-bold tabular-nums text-ink">
                              {fmtTaka(rule.amt, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2/70 text-muted">
                    <IconRepeat className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink">{w(lang, "adminNoData")}</p>
                </div>
              )
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Action Confirmation Modal */}
      <Modal
        open={Boolean(confirmModal)}
        onClose={() => setConfirmModal(null)}
        label={
          confirmModal?.type === "delete"
            ? w(lang, "adminDelete")
            : confirmModal?.type === "suspend"
              ? w(lang, "adminSuspend")
              : w(lang, "adminUnsuspend")
        }
      >
        {confirmModal && (
          <div className="space-y-5 p-5">
            {/* Header with icon */}
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  confirmModal.type === "delete"
                    ? "bg-danger/15 text-danger"
                    : confirmModal.type === "suspend"
                      ? "bg-warning/15 text-warning"
                      : "bg-emerald/15 text-emerald"
                }`}
              >
                {confirmModal.type === "delete" ? (
                  <IconTrash className="h-5 w-5" />
                ) : (
                  <IconShield className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">
                  {confirmModal.type === "delete"
                    ? w(lang, "adminDelete")
                    : confirmModal.type === "suspend"
                      ? w(lang, "adminSuspend")
                      : w(lang, "adminUnsuspend")}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {confirmModal.type === "delete"
                    ? w(lang, "adminConfirmDelete")
                    : confirmModal.type === "suspend"
                      ? w(lang, "adminConfirmSuspend")
                      : w(lang, "adminConfirmUnsuspend")}
                </p>
              </div>
            </div>

            {/* Target user info card */}
            <div className="rounded-card border border-line/60 bg-surface-2/50 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald/15 text-xs font-bold text-emerald">
                  {(confirmModal.user.name.trim()[0] ?? "U").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{confirmModal.user.name}</p>
                  {confirmModal.user.email && (
                    <p className="truncate text-xs text-muted font-en">{confirmModal.user.email}</p>
                  )}
                </div>
              </div>
              <p className="mt-2 border-t border-line/40 pt-2 font-mono text-[11px] text-muted">
                ID: {confirmModal.user.id}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={actionInProgress}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink focus:outline-none"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleExecuteAction()}
                disabled={actionInProgress}
                className={`inline-flex items-center gap-2 rounded-control px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60 ${
                  confirmModal.type === "delete"
                    ? "bg-danger"
                    : confirmModal.type === "suspend"
                      ? "bg-warning"
                      : "bg-emerald"
                }`}
              >
                {actionInProgress && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {actionInProgress
                  ? w(lang, "loading")
                  : confirmModal.type === "delete"
                    ? w(lang, "adminDelete")
                    : confirmModal.type === "suspend"
                      ? w(lang, "adminSuspend")
                      : w(lang, "adminUnsuspend")}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Floating Bulk Action Bar */}
      {selectedUserIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex max-w-[94vw] flex-wrap items-center justify-center gap-2 sm:gap-3.5 rounded-card sm:rounded-full border border-line/70 bg-surface/95 px-4 py-2.5 sm:px-5 sm:py-3 shadow-2xl backdrop-blur-md transition-all">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald text-xs font-bold text-accent-ink">
              {num(selectedUserIds.size)}
            </span>
            <span className="text-xs font-semibold text-ink sm:text-sm">
              {w(lang, "adminSelectedCount")}
            </span>
          </div>

          <div className="hidden sm:block h-4 w-px bg-line/60" />

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Bulk Suspend */}
            <button
              type="button"
              onClick={() => {
                const ids = Array.from(selectedUserIds);
                const names = users
                  .filter((u) => selectedUserIds.has(u.id))
                  .map((u) => u.name);
                setBulkConfirmModal({
                  type: "suspend",
                  userIds: ids,
                  userNames: names,
                });
              }}
              className="rounded-control bg-warning/15 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/25 active:scale-95 transition-all"
            >
              {w(lang, "adminBulkSuspend")}
            </button>

            {/* Bulk Reactivate */}
            <button
              type="button"
              onClick={() => {
                const ids = Array.from(selectedUserIds);
                const names = users
                  .filter((u) => selectedUserIds.has(u.id))
                  .map((u) => u.name);
                setBulkConfirmModal({
                  type: "unsuspend",
                  userIds: ids,
                  userNames: names,
                });
              }}
              className="rounded-control bg-emerald/15 px-3 py-1.5 text-xs font-semibold text-emerald hover:bg-emerald/25 active:scale-95 transition-all"
            >
              {w(lang, "adminBulkUnsuspend")}
            </button>

            {/* Bulk Delete */}
            <button
              type="button"
              onClick={() => {
                const ids = Array.from(selectedUserIds);
                const names = users
                  .filter((u) => selectedUserIds.has(u.id))
                  .map((u) => u.name);
                setBulkConfirmModal({
                  type: "delete",
                  userIds: ids,
                  userNames: names,
                });
              }}
              className="rounded-control bg-danger px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-danger/90 active:scale-95 transition-all"
            >
              {w(lang, "adminBulkDelete")}
            </button>

            {/* Clear Selection */}
            <button
              type="button"
              onClick={() => setSelectedUserIds(new Set())}
              className="rounded-control px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink hover:bg-surface-2 transition-all"
              title={w(lang, "adminClearSelection")}
            >
              ✕ {w(lang, "adminClearSelection")}
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action Confirmation Modal */}
      <Modal
        open={Boolean(bulkConfirmModal)}
        onClose={() => {
          if (!bulkActionInProgress) setBulkConfirmModal(null);
        }}
        label={
          bulkConfirmModal?.type === "delete"
            ? w(lang, "adminBulkDelete")
            : bulkConfirmModal?.type === "suspend"
              ? w(lang, "adminBulkSuspend")
              : w(lang, "adminBulkUnsuspend")
        }
      >
        {bulkConfirmModal && (
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  bulkConfirmModal.type === "delete"
                    ? "bg-danger/15 text-danger"
                    : bulkConfirmModal.type === "suspend"
                      ? "bg-warning/15 text-warning"
                      : "bg-emerald/15 text-emerald"
                }`}
              >
                {bulkConfirmModal.type === "delete" ? (
                  <IconTrash className="h-5 w-5" />
                ) : (
                  <IconShield className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-ink">
                  {bulkConfirmModal.type === "delete"
                    ? w(lang, "adminBulkDelete")
                    : bulkConfirmModal.type === "suspend"
                      ? w(lang, "adminBulkSuspend")
                      : w(lang, "adminBulkUnsuspend")}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {bulkConfirmModal.type === "delete"
                    ? w(lang, "adminBulkConfirmDelete")
                    : bulkConfirmModal.type === "suspend"
                      ? w(lang, "adminBulkConfirmSuspend")
                      : w(lang, "adminBulkUnsuspend")}
                </p>
              </div>
            </div>

            {/* Affected users summary */}
            <div className="rounded-card border border-line/60 bg-surface-2/50 p-3">
              <div className="flex items-center justify-between pb-2 border-b border-line/40">
                <span className="text-xs font-semibold text-muted">
                  {lang === "bn" ? "প্রভাবিত ব্যবহারকারী তালিকা" : "Affected Users"}
                </span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold tabular-nums text-ink">
                  {num(bulkConfirmModal.userIds.length)}
                </span>
              </div>
              <div className="mt-2 max-h-44 overflow-y-auto divide-y divide-line/30 pr-1 text-xs">
                {bulkConfirmModal.userNames.map((name, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <span className="font-semibold text-ink">{name}</span>
                    <span className="font-mono text-[10px] text-muted truncate max-w-[140px]">
                      {bulkConfirmModal.userIds[i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
              <button
                type="button"
                onClick={() => setBulkConfirmModal(null)}
                disabled={bulkActionInProgress}
                className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink focus:outline-none"
              >
                {w(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleExecuteBulkAction()}
                disabled={bulkActionInProgress}
                className={`inline-flex items-center gap-2 rounded-control px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-60 ${
                  bulkConfirmModal.type === "delete"
                    ? "bg-danger"
                    : bulkConfirmModal.type === "suspend"
                      ? "bg-warning"
                      : "bg-emerald"
                }`}
              >
                {bulkActionInProgress && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
                )}
                {bulkActionInProgress
                  ? w(lang, "loading")
                  : bulkConfirmModal.type === "delete"
                    ? w(lang, "adminBulkDelete")
                    : bulkConfirmModal.type === "suspend"
                      ? w(lang, "adminBulkSuspend")
                      : w(lang, "adminBulkUnsuspend")}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* CSV Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => {
          if (!importing) {
            setImportModalOpen(false);
            setImportRows([]);
            setImportError(null);
          }
        }}
        label={w(lang, "adminImportModalTitle")}
        className="lg:max-w-xl"
      >
        <div className="space-y-5 p-5 sm:p-6">
          <div>
            <h3 className="text-base font-bold text-ink">
              {w(lang, "adminImportModalTitle")}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {lang === "bn"
                ? "CSV ফাইল আপলোড করে এক সাথে একাধিক ব্যবহারকারী যোগ করুন। কলাম: name, email, password"
                : "Import multiple users at once via CSV file. Required columns: name, email, password"}
            </p>
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            accept=".csv,text/csv"
            ref={fileInputRef}
            onChange={(e) => void handleFileChange(e)}
            className="hidden"
          />

          {/* Upload Dropzone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-card border-2 border-dashed border-line/80 bg-surface-2/30 p-6 text-center transition-all hover:border-emerald/60 hover:bg-emerald/5 focus:outline-none"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald/10 text-emerald">
              <IconUpload className="h-6 w-6" />
            </div>
            <p className="mt-2.5 text-xs font-semibold text-ink">
              {w(lang, "adminImportUploadPrompt")}
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {lang === "bn"
                ? "ক্লিক করে কম্পিউটার থেকে .csv ফাইল নির্বাচন করুন"
                : "Click to select a .csv file from your device"}
            </p>
          </button>

          {/* Template download link */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleDownloadSampleCsv}
              className="text-xs font-semibold text-emerald transition-colors hover:underline hover:text-emerald/80"
            >
              ↓ {w(lang, "adminImportTemplate")}
            </button>
            {importRows.length > 0 && (
              <span className="rounded-full bg-emerald/15 px-2.5 py-0.5 text-xs font-bold text-emerald">
                {num(importRows.length)} {lang === "bn" ? "জন তৈরি হবে" : "users ready"}
              </span>
            )}
          </div>

          {/* Error display */}
          {importError && (
            <div className="rounded-control border border-danger/25 bg-danger/10 p-3 text-xs font-medium text-danger">
              {importError}
            </div>
          )}

          {/* Preview Table */}
          {importRows.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-ink">
                {lang === "bn" ? "আমদানি প্রিভিউ" : "Import Preview"}
              </h4>
              <div className="max-h-52 overflow-y-auto rounded-card border border-line/60 bg-surface">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-line/40 bg-surface-2 text-[10px] uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2">{w(lang, "adminUserName")}</th>
                      <th className="px-3 py-2">{w(lang, "adminUserEmail")}</th>
                      <th className="px-3 py-2 text-right">Password</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/30">
                    {importRows.slice(0, 50).map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-2/40">
                        <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                        <td className="px-3 py-2 font-en text-muted truncate max-w-[180px]">
                          {row.email}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted text-[11px]">
                          {row.password ? "••••••••" : "(Auto)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importRows.length > 50 && (
                <p className="text-[11px] text-muted text-right">
                  {lang === "bn"
                    ? `আরও ${num(importRows.length - 50)} জন নিচে আছে...`
                    : `+ ${importRows.length - 50} more users...`}
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 border-t border-line/40 pt-4">
            <button
              type="button"
              onClick={() => {
                setImportModalOpen(false);
                setImportRows([]);
                setImportError(null);
              }}
              disabled={importing}
              className="rounded-control px-4 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink focus:outline-none"
            >
              {w(lang, "cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleExecuteImport()}
              disabled={importing || importRows.length === 0}
              className="inline-flex items-center gap-2 rounded-control bg-emerald px-4 py-2 text-sm font-semibold text-accent-ink transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-50"
            >
              {importing && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
              )}
              {importing ? w(lang, "adminImporting") : w(lang, "adminImportUsers")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
