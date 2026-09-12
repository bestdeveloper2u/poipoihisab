import { useState } from "react";
import { moneyToNumber } from "@poipoihisab/core";
import type { Debt } from "@poipoihisab/api-client";
import type { PartySummary } from "@poipoihisab/core";
import { useDebtsInfinite } from "../lib/queries";
import { Modal } from "./Modal";
import { fmtTaka } from "../lib/money";
import { dayLabel } from "../lib/catalog";
import { w } from "../lib/web-i18n";
import { useLangStore } from "../store/lang";
import { ReminderModal } from "./ReminderModal";
import { DigitalReceiptModal } from "./DigitalReceiptModal";

interface PartyLedgerModalProps {
  party: PartySummary;
  onClose: () => void;
  onPay: (debt: Debt) => void;
}

export function PartyLedgerModal({ party, onClose, onPay }: PartyLedgerModalProps) {
  const lang = useLangStore((s) => s.lang);
  const debtsQ = useDebtsInfinite("all", party.party);

  const [reminderOpen, setReminderOpen] = useState(false);
  const [selectedReceiptDebt, setSelectedReceiptDebt] = useState<Debt | null>(null);

  const netNum = moneyToNumber(party.net_balance);
  const isReceivable = netNum > 0;
  const isPayable = netNum < 0;

  // Flatten all pages
  const items = debtsQ.data?.pages.flatMap((p) => (p.ok ? p.data.items : [])) ?? [];

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <Modal open onClose={onClose} label={`${party.party} — ${w(lang, "partyTitle")}`}>
        <div className="p-1">
          {/* Header Card */}
          <div className="rounded-card border border-line bg-surface-2 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-soft text-base font-bold text-emerald"
                >
                  {party.party.slice(0, 1)}
                </span>
                <div>
                  <h2 className="text-base font-bold text-ink">{party.party}</h2>
                  <p className="text-xs text-muted">
                    {lang === "bn" ? "মোট লেনদেন" : "Transactions"}: {party.total_count} · {w(lang, "dOpen")}: {party.open_count}
                  </p>
                </div>
              </div>

              {/* Net Balance Pill */}
              <div className="text-right">
                <p className="text-[11px] font-semibold text-muted">
                  {w(lang, "partyNet")}
                </p>
                <p
                  className={`text-base font-extrabold ${
                    isReceivable
                      ? "text-emerald"
                      : isPayable
                        ? "text-danger"
                        : "text-muted"
                  }`}
                >
                  {isReceivable && "+"}
                  {fmtTaka(party.net_balance, lang)}
                </p>
                <span className="text-[10px] text-muted">
                  {isReceivable
                    ? w(lang, "partyReceivable")
                    : isPayable
                      ? w(lang, "partyPayable")
                      : w(lang, "dSettled")}
                </span>
              </div>
            </div>

            {/* Quick Action Bar for Party */}
            <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-line/60">
              {isReceivable && (
                <button
                  type="button"
                  onClick={() => setReminderOpen(true)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-emerald px-3 py-1.5 text-xs font-bold text-accent-ink hover:brightness-110"
                >
                  📢 {w(lang, "reminderTitle")}
                </button>
              )}
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-3"
              >
                🖨️ {lang === "bn" ? "স্টেটমেন্ট প্রিন্ট" : "Print Statement"}
              </button>
            </div>
          </div>

          {/* KPI Mini-Cards */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-control border border-line bg-surface p-2.5">
              <span className="text-[11px] text-muted">{w(lang, "partyLent")}</span>
              <p className="text-sm font-bold text-emerald">{fmtTaka(party.total_lent, lang)}</p>
            </div>
            <div className="rounded-control border border-line bg-surface p-2.5">
              <span className="text-[11px] text-muted">{w(lang, "partyBorrowed")}</span>
              <p className="text-sm font-bold text-danger">{fmtTaka(party.total_borrowed, lang)}</p>
            </div>
          </div>

          {/* Timeline of Debts */}
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">
              {lang === "bn" ? "লেনদেনের ইতিহাস" : "Transaction Timeline"}
            </h3>

            {debtsQ.isLoading ? (
              <div className="py-6 text-center text-xs text-muted">{w(lang, "loading")}</div>
            ) : items.length === 0 ? (
              <div className="rounded-control bg-surface-2 p-4 text-center text-xs text-muted">
                {w(lang, "dEmpty")}
              </div>
            ) : (
              <ul className="divide-y divide-line rounded-card border border-line bg-surface max-h-[300px] overflow-y-auto">
                {items.map((debt) => {
                  const lend = debt.dir === "lend";
                  const settled = debt.settled_at !== null;
                  return (
                    <li key={debt.id} className="flex items-center justify-between p-3 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              lend
                                ? "bg-emerald-soft text-emerald"
                                : "bg-warning/10 text-warning"
                            }`}
                          >
                            {lend ? w(lang, "dGave") : w(lang, "dTook")}
                          </span>
                          {settled && (
                            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                              {w(lang, "dSettled")}
                            </span>
                          )}
                          <span className="text-xs font-bold tabular-nums">
                            {fmtTaka(debt.amt, lang)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {dayLabel(debt.iso, lang)}
                          {debt.note ? ` · ${debt.note}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedReceiptDebt(debt)}
                          className="rounded-control border border-line px-2 py-1 text-[11px] font-semibold text-muted hover:bg-surface-2"
                        >
                          📄 {lang === "bn" ? "রসিদ" : "Slip"}
                        </button>
                        {!settled && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onPay(debt);
                            }}
                            className="rounded-control border border-emerald px-2 py-1 text-[11px] font-bold text-emerald hover:bg-emerald-soft"
                          >
                            {w(lang, "dPay")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-control bg-surface-2 px-4 py-2 text-xs font-semibold text-ink hover:bg-surface-3"
            >
              {w(lang, "cancel")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Embedded Sub-Modals */}
      {reminderOpen && (
        <ReminderModal
          party={party.party}
          amount={party.net_balance}
          onClose={() => setReminderOpen(false)}
        />
      )}

      {selectedReceiptDebt && (
        <DigitalReceiptModal
          debt={selectedReceiptDebt}
          onClose={() => setSelectedReceiptDebt(null)}
        />
      )}
    </>
  );
}
