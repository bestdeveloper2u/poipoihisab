import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { moneyToNumber, t, toBnDigits } from "@poipoihisab/core";
import type { Debt } from "@poipoihisab/api-client";
import type { PartySummary } from "@poipoihisab/core";
import { useDebtMutations, useDebtParties, useDebtsInfinite } from "../lib/queries";
import { dayLabel, normalizeAmount, todayIso } from "../lib/catalog";
import { w } from "../lib/web-i18n";
import { fmtTaka } from "../lib/money";
import { usePageTitle } from "../lib/usePageTitle";
import { useLangStore } from "../store/lang";
import { Modal } from "../components/Modal";
import { toast } from "../lib/toast";
import { IconMic, IconTrash } from "../components/icons";
import { VoiceOverlay } from "../components/VoiceOverlay";
import { PartyLedgerModal } from "../components/PartyLedgerModal";
import { ReminderModal } from "../components/ReminderModal";
import { DigitalReceiptModal } from "../components/DigitalReceiptModal";

type StatusTab = "open" | "settled" | "all";
const STATUS_TABS: StatusTab[] = ["open", "settled", "all"];
const STATUS_KEY = { open: "dOpen", settled: "dSettledLbl", all: "dAll" } as const;

type ViewMode = "transactions" | "parties";

/** Two-step delete (arm → confirm), mirroring the expenses list. */
function DeleteDebtButton({ debt }: { debt: Debt }) {
  const lang = useLangStore((s) => s.lang);
  const { remove } = useDebtMutations();
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        aria-label={`${debt.party} — ${w(lang, "remove")}`}
        onClick={() => setArmed(true)}
        className="max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center rounded-control p-2 text-muted hover:bg-surface-2 hover:text-danger"
      >
        <IconTrash className="h-4 w-4" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(debt.id, {
            onSuccess: () => {
              setArmed(false);
              toast(w(lang, "tDeleted"));
            },
          })
        }
        className="max-md:flex max-md:min-h-11 max-md:items-center rounded-control bg-danger px-2 py-1.5 text-xs font-bold text-accent-ink disabled:opacity-60"
      >
        {w(lang, "confirmDelete")}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        aria-label={w(lang, "cancel")}
        className="max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center rounded-control px-1.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2"
      >
        ✕
      </button>
    </span>
  );
}

/** Pay-back dialog: prefills the remaining amount, offers a full-amount shortcut. */
function PayModal({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const lang = useLangStore((s) => s.lang);
  const { pay } = useDebtMutations();
  const [amt, setAmt] = useState(moneyToNumber(debt.amt).toString());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const normalized = normalizeAmount(amt);
    if (!normalized || moneyToNumber(normalized) <= 0) {
      setError(w(lang, "errAmt"));
      return;
    }
    setError(null);
    pay.mutate(
      { id: debt.id, amt: normalized },
      {
        onSuccess: (res) => {
          if (!res.ok) {
            setError(res.detail || w(lang, "dErrPay"));
            return;
          }
          const { status: s, debt: updatedDebt } = res.data;
          if (s === "FULL") {
            toast(w(lang, "dPaidFull"));
            onClose();
          } else {
            setFeedback(`${w(lang, "dPaidPartial")}: ${fmtTaka(updatedDebt.amt, lang)}`);
            setAmt(moneyToNumber(updatedDebt.amt).toString());
          }
        },
        onError: () => setError(w(lang, "dErrPay")),
      },
    );
  }

  return (
    <Modal open onClose={onClose} label={w(lang, "dPayTitle")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="p-1"
      >
        <h2 className="text-base font-bold text-ink">
          {w(lang, "dPayTitle")} — {debt.party}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {w(lang, "dRemaining")}: {fmtTaka(debt.amt, lang)}
        </p>

        <div className="mt-4">
          <label htmlFor="payAmt" className="block text-xs font-semibold text-muted">
            {w(lang, "dPayAmt")}
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="payAmt"
              type="text"
              inputMode="decimal"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              className="w-full rounded-control border border-line bg-surface p-2.5 text-base font-bold tabular-nums text-ink outline-none focus:border-emerald"
            />
            <button
              type="button"
              onClick={() => setAmt(moneyToNumber(debt.amt).toString())}
              className="shrink-0 rounded-control border border-line bg-surface-2 px-3 py-2 text-xs font-bold text-muted hover:bg-surface-3"
            >
              {w(lang, "dPayFull")}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-2 text-xs font-semibold text-danger" role="alert">
            {error}
          </p>
        )}
        {feedback && (
          <p className="mt-2 text-xs font-semibold text-emerald" role="status">
            {feedback}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border border-line px-4 py-2 text-xs font-semibold text-muted hover:bg-surface-2"
          >
            {w(lang, "cancel")}
          </button>
          <button
            type="submit"
            disabled={pay.isPending}
            className="rounded-control bg-emerald px-4 py-2 text-xs font-bold text-accent-ink hover:brightness-110 disabled:opacity-60"
          >
            {pay.isPending ? w(lang, "saving") : w(lang, "dPay")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** One ledger row: avatar, party + note, lend/borrow badge, amount, actions. */
function DebtRow({
  debt,
  onPay,
  onReceipt,
}: {
  debt: Debt;
  onPay: (debt: Debt) => void;
  onReceipt: (debt: Debt) => void;
}) {
  const lang = useLangStore((s) => s.lang);
  const lend = debt.dir === "lend";
  const settled = debt.settled_at !== null;

  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-soft text-sm font-bold text-emerald"
      >
        {debt.party.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-semibold">
          {debt.party}
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
              lend ? "bg-emerald-soft text-emerald" : "bg-warning/10 text-warning"
            }`}
          >
            {lend ? w(lang, "dGave") : w(lang, "dTook")}
          </span>
          {settled && (
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted">
              {w(lang, "dSettled")}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {dayLabel(debt.iso, lang)}
          {debt.note ? ` · ${debt.note}` : ""}
        </p>
      </div>
      <span className={`text-sm font-bold tabular-nums ${lend ? "text-emerald" : "text-danger"}`}>
        {fmtTaka(debt.amt, lang)}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onReceipt(debt)}
          aria-label={`${debt.party} — ${lang === "bn" ? "রসিদ" : "Slip"}`}
          className="rounded-control border border-line p-1.5 text-xs text-muted hover:bg-surface-2"
          title={lang === "bn" ? "রসিদ দেখুন" : "View receipt"}
        >
          📄
        </button>
        {!settled && (
          <button
            type="button"
            onClick={() => onPay(debt)}
            className="max-md:flex max-md:min-h-11 max-md:items-center shrink-0 rounded-control border border-emerald px-2.5 py-1.5 text-xs font-bold text-emerald hover:bg-emerald-soft"
          >
            {w(lang, "dPay")}
          </button>
        )}
        <DeleteDebtButton debt={debt} />
      </div>
    </li>
  );
}

/** One party ledger card in party list view */
function PartyCard({
  party,
  onOpenLedger,
  onOpenReminder,
}: {
  party: PartySummary;
  onOpenLedger: (party: PartySummary) => void;
  onOpenReminder: (party: string, amount: string) => void;
}) {
  const lang = useLangStore((s) => s.lang);
  const netNum = moneyToNumber(party.net_balance);
  const isReceivable = netNum > 0;
  const isPayable = netNum < 0;

  return (
    <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-surface-2/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-soft text-sm font-bold text-emerald"
        >
          {party.party.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{party.party}</p>
          <p className="text-xs text-muted">
            {lang === "bn" ? "মোট লেনদেন" : "Total tx"}: {party.total_count} · {w(lang, "dOpen")}: {party.open_count}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t border-line/40 sm:border-t-0">
        <div className="text-right">
          <span className="text-[11px] text-muted">{w(lang, "partyNet")}</span>
          <p
            className={`text-sm font-bold tabular-nums ${
              isReceivable ? "text-emerald" : isPayable ? "text-danger" : "text-muted"
            }`}
          >
            {isReceivable && "+"}
            {fmtTaka(party.net_balance, lang)}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isReceivable && (
            <button
              type="button"
              onClick={() => onOpenReminder(party.party, party.net_balance)}
              className="rounded-control bg-emerald/10 border border-emerald/30 px-2.5 py-1.5 text-xs font-bold text-emerald hover:bg-emerald/20"
              title={w(lang, "reminderTitle")}
            >
              📢 {w(lang, "reminderTitle")}
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenLedger(party)}
            className="rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            {w(lang, "partyViewLedger")}
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Debts screen (ধার-দেনা):
 * Supports both Transaction List view and Party Ledger view (ব্যক্তিভিত্তিক খতিয়ান),
 * with 1-tap WhatsApp/SMS reminders and printable digital receipts.
 */
export function Debts() {
  usePageTitle("ধার · Poi Poi Hisab");
  const lang = useLangStore((s) => s.lang);
  const { create } = useDebtMutations();

  const [viewMode, setViewMode] = useState<ViewMode>("transactions");
  const [status, setStatus] = useState<StatusTab>("open");

  const query = useDebtsInfinite(status);
  const partiesQuery = useDebtParties();

  const [searchParams, setSearchParams] = useSearchParams();

  // Voice overlay & FAB handling
  const [voiceOpen, setVoiceOpen] = useState(false);
  useEffect(() => {
    if (searchParams.get("voice") === "1") {
      setVoiceOpen(true);
      setSearchParams({}, { replace: true });
    } else if (searchParams.get("focus") === "party") {
      const el = document.getElementById("debtParty");
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.focus({ preventScroll: true });
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // New-entry form state
  const [party, setParty] = useState("");
  const [dir, setDir] = useState<"lend" | "borrow">("lend");
  const [amt, setAmt] = useState("");
  const [iso, setIso] = useState(todayIso());
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Modals state
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [selectedParty, setSelectedParty] = useState<PartySummary | null>(null);
  const [reminderTarget, setReminderTarget] = useState<{ party: string; amount: string } | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<Debt | null>(null);

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => (page.ok ? page.data.items : [])) ?? [],
    [query.data],
  );
  const totalIn = useMemo(
    () => rows.filter((d) => d.dir === "lend").reduce((s, d) => s + moneyToNumber(d.amt), 0),
    [rows],
  );
  const totalOut = useMemo(
    () => rows.filter((d) => d.dir === "borrow").reduce((s, d) => s + moneyToNumber(d.amt), 0),
    [rows],
  );

  const partiesList: PartySummary[] = useMemo(
    () => (partiesQuery.data?.ok ? partiesQuery.data.data.items : []),
    [partiesQuery.data],
  );

  const parties = useMemo(
    () => [...new Set(rows.map((d) => d.party))].slice(0, 30),
    [rows],
  );

  function submitDebt() {
    const normalized = normalizeAmount(amt);
    if (!party.trim()) {
      setFormError(w(lang, "dErrParty"));
      return;
    }
    if (!normalized || moneyToNumber(normalized) <= 0) {
      setFormError(w(lang, "errAmt"));
      return;
    }
    setFormError(null);
    create.mutate(
      { party: party.trim().slice(0, 120), dir, amt: normalized, iso, note: note.trim() || null },
      {
        onSuccess: (res) => {
          if (res.ok) {
            setParty("");
            setAmt("");
            setNote("");
            setIso(todayIso());
            setSavedFlash(true);
            toast(t(lang, "savedCheck"));
            setTimeout(() => setSavedFlash(false), 2000);
          } else {
            setFormError(res.detail || w(lang, "dErrSave"));
          }
        },
        onError: () => setFormError(w(lang, "dErrSave")),
      },
    );
  }

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold sm:text-2xl">{w(lang, "dTitle")}</h1>
          <p className="mt-0.5 text-[13px] text-muted">{w(lang, "dSub")}</p>
        </div>

        {/* View Switcher: Transactions vs Party Ledger */}
        <div className="inline-flex rounded-control bg-surface-2 p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode("transactions")}
            className={`rounded-control px-3 py-1.5 text-xs font-bold transition-all ${
              viewMode === "transactions" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            📋 {w(lang, "dLedger")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("parties")}
            className={`rounded-control px-3 py-1.5 text-xs font-bold transition-all ${
              viewMode === "parties" ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            👥 {w(lang, "partyTitle")}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="text-[13px] font-medium text-muted">{w(lang, "dIn")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald">
            {fmtTaka(totalIn, lang)}
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="text-[13px] font-medium text-muted">{w(lang, "dOut")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-danger">
            {fmtTaka(totalOut, lang)}
          </p>
        </div>
      </div>

      {/* VIEW 1: Transactions Ledger */}
      {viewMode === "transactions" && (
        <>
          <h2 className="mt-6 px-1 text-[13px] font-bold text-muted">{w(lang, "dLedger")}</h2>
          <div
            className="mt-2 inline-flex rounded-control bg-surface-2 p-1"
            role="group"
            aria-label={w(lang, "dLedger")}
          >
            {STATUS_TABS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={`rounded-control px-4 py-1.5 text-[13px] font-bold max-md:flex max-md:min-h-11 max-md:items-center ${
                  status === s ? "bg-surface text-ink shadow-card" : "text-muted"
                }`}
              >
                {w(lang, STATUS_KEY[s])}
              </button>
            ))}
          </div>

          {savedFlash && (
            <p className="mt-3 text-sm font-semibold text-emerald" role="status">
              {t(lang, "savedCheck")}
            </p>
          )}
          {query.isPending && (
            <p className="mt-5 text-sm text-muted" role="status">
              {w(lang, "loading")}
            </p>
          )}
          {query.isError && (
            <div
              className="mt-5 rounded-card border border-danger bg-danger/5 p-4 text-sm font-medium text-danger"
              role="alert"
            >
              {w(lang, "dErrLoad")}
            </div>
          )}

          {!query.isPending && rows.length === 0 && (
            <div className="mt-5 rounded-card border border-line bg-surface p-8 text-center shadow-card">
              <p className="font-bold">{w(lang, "dEmpty")}</p>
              <p className="mt-1 text-sm text-muted">{w(lang, "dEmptyHint")}</p>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <p className="mt-3 px-1 text-[13px] text-muted">
                {lang === "bn"
                  ? `${toBnDigits(String(rows.length))} ${w(lang, "entries")}`
                  : `${rows.length} ${w(lang, "entries")}`}
              </p>
              <ul className="mt-2 flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
                {rows.map((debt) => (
                  <DebtRow
                    key={debt.id}
                    debt={debt}
                    onPay={setPayTarget}
                    onReceipt={setReceiptTarget}
                  />
                ))}
              </ul>
            </>
          )}

          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                {query.isFetchingNextPage ? w(lang, "loading") : w(lang, "loadMore")}
              </button>
            </div>
          )}
        </>
      )}

      {/* VIEW 2: Party Ledger (ব্যক্তিভিত্তিক খতিয়ান) */}
      {viewMode === "parties" && (
        <div className="mt-5">
          <h2 className="px-1 text-[13px] font-bold text-muted">{w(lang, "partyTitle")}</h2>

          {partiesQuery.isLoading ? (
            <p className="mt-5 text-sm text-muted" role="status">
              {w(lang, "loading")}
            </p>
          ) : partiesQuery.isError ? (
            <div
              className="mt-5 rounded-card border border-danger bg-danger/5 p-4 text-sm font-medium text-danger"
              role="alert"
            >
              {w(lang, "dErrLoad")}
            </div>
          ) : partiesList.length === 0 ? (
            <div className="mt-5 rounded-card border border-line bg-surface p-8 text-center shadow-card">
              <p className="font-bold">{w(lang, "partyEmpty")}</p>
              <p className="mt-1 text-sm text-muted">{w(lang, "dEmptyHint")}</p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
              {partiesList.map((p) => (
                <PartyCard
                  key={p.party}
                  party={p}
                  onOpenLedger={(selected) => setSelectedParty(selected)}
                  onOpenReminder={(name, amount) =>
                    setReminderTarget({ party: name, amount })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Add New Debt Form */}
      <h2 className="mt-8 flex flex-wrap items-center justify-between gap-2 px-1">
        <span className="text-[13px] font-bold text-muted">{w(lang, "dNew")}</span>
        <button
          type="button"
          onClick={() => setVoiceOpen(true)}
          className="max-md:min-h-11 flex items-center gap-1.5 rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-2"
        >
          <IconMic className="h-4 w-4" />
          {w(lang, "voiceBtn")}
        </button>
      </h2>
      <form
        className="mt-2 max-w-[520px] rounded-card border border-line bg-surface p-5 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          submitDebt();
        }}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="debtParty" className="text-[13px] font-semibold text-muted">
              {w(lang, "dParty")}
            </label>
            <input
              id="debtParty"
              type="text"
              value={party}
              onChange={(e) => setParty(e.target.value)}
              placeholder={w(lang, "dPh")}
              maxLength={120}
              list="debtPartyList"
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-emerald focus:outline-none"
            />
            <datalist id="debtPartyList">
              {parties.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="debtDir" className="text-[13px] font-semibold text-muted">
              {w(lang, "dType")}
            </label>
            <select
              id="debtDir"
              value={dir}
              onChange={(e) => setDir(e.target.value as "lend" | "borrow")}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
            >
              <option value="lend">{w(lang, "dLend")}</option>
              <option value="borrow">{w(lang, "dBorrow")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="debtAmt" className="text-[13px] font-semibold text-muted">
              {w(lang, "amtLabel")}
            </label>
            <input
              id="debtAmt"
              type="text"
              inputMode="decimal"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              placeholder={w(lang, "amtPh")}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-lg font-bold tabular-nums text-ink placeholder:text-muted/70 focus:border-emerald focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="debtDate" className="text-[13px] font-semibold text-muted">
              {w(lang, "dateLabel")}
            </label>
            <input
              id="debtDate"
              type="date"
              value={iso}
              onChange={(e) => setIso(e.target.value || todayIso())}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="debtNote" className="text-[13px] font-semibold text-muted">
              {w(lang, "dNote")}
            </label>
            <input
              id="debtNote"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={w(lang, "dOpt")}
              maxLength={200}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-emerald focus:outline-none"
            />
          </div>
          {formError && (
            <p className="text-sm font-medium text-danger" role="alert">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={create.isPending}
            className="max-md:min-h-11 rounded-control bg-emerald px-4 py-2.5 text-sm font-bold text-accent-ink hover:brightness-110 disabled:opacity-60"
          >
            {create.isPending ? w(lang, "saving") : w(lang, "save")}
          </button>
        </div>
      </form>

      {/* Modals */}
      {payTarget && <PayModal debt={payTarget} onClose={() => setPayTarget(null)} />}

      {selectedParty && (
        <PartyLedgerModal
          party={selectedParty}
          onClose={() => setSelectedParty(null)}
          onPay={setPayTarget}
        />
      )}

      {reminderTarget && (
        <ReminderModal
          party={reminderTarget.party}
          amount={reminderTarget.amount}
          onClose={() => setReminderTarget(null)}
        />
      )}

      {receiptTarget && (
        <DigitalReceiptModal
          debt={receiptTarget}
          onClose={() => setReceiptTarget(null)}
        />
      )}

      {/* Voice overlay */}
      <VoiceOverlay
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        mode="debt"
        parties={parties}
      />
    </section>
  );
}
