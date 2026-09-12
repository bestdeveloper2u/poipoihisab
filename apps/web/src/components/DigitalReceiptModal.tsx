import { useRef } from "react";
import type { Debt } from "@poipoihisab/api-client";
import { Modal } from "./Modal";
import { fmtTaka } from "../lib/money";
import { dayLabel } from "../lib/catalog";
import { toast } from "../lib/toast";
import { w } from "../lib/web-i18n";
import { useLangStore } from "../store/lang";

interface DigitalReceiptModalProps {
  debt: Debt;
  onClose: () => void;
}

export function DigitalReceiptModal({ debt, onClose }: DigitalReceiptModalProps) {
  const lang = useLangStore((s) => s.lang);
  const receiptRef = useRef<HTMLDivElement | null>(null);

  const isLend = debt.dir === "lend";
  const isSettled = debt.settled_at !== null;

  const typeLabel = isLend
    ? lang === "bn" ? "ধার প্রদান (পাওনা)" : "Lent (Receivable)"
    : lang === "bn" ? "ধার গ্রহণ (দেনা)" : "Borrowed (Payable)";

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    const text =
      lang === "bn"
        ? `পই পই হিসাব — ডিজিটাল রসিদ\nব্যক্তি: ${debt.party}\nধরন: ${typeLabel}\nপরিমাণ: ${fmtTaka(debt.amt, lang)}\nতারিখ: ${dayLabel(debt.iso, lang)}\nস্ট্যাটাস: ${isSettled ? "পরিশোধিত" : "চলমান"}`
        : `Poi Poi Hisab — Digital Receipt\nParty: ${debt.party}\nType: ${typeLabel}\nAmount: ${fmtTaka(debt.amt, lang)}\nDate: ${dayLabel(debt.iso, lang)}\nStatus: ${isSettled ? "Settled" : "Active"}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: lang === "bn" ? "পই পই হিসাব রসিদ" : "Poi Poi Hisab Receipt",
          text,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        toast(lang === "bn" ? "রসিদের বিবরণ কপি হয়েছে ✓" : "Receipt copied ✓");
      } catch {
        toast(w(lang, "errFallback"));
      }
    }
  };

  return (
    <Modal open onClose={onClose} label={lang === "bn" ? "ডিজিটাল রসিদ" : "Digital Receipt"}>
      <div className="p-2">
        {/* Printable Receipt Card */}
        <div
          ref={receiptRef}
          className="rounded-card border-2 border-line bg-surface p-5 text-ink shadow-sm print:m-0 print:border-none print:shadow-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <h3 className="text-base font-bold text-emerald">
                {lang === "bn" ? "পই পই হিসাব" : "Poi Poi Hisab"}
              </h3>
              <p className="text-[11px] text-muted">
                {lang === "bn" ? "ডিজিটাল লেনদেন রসিদ" : "Digital Transaction Receipt"}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                isSettled
                  ? "bg-surface-2 text-muted"
                  : isLend
                    ? "bg-emerald-soft text-emerald"
                    : "bg-warning/10 text-warning"
              }`}
            >
              {isSettled
                ? (lang === "bn" ? "পরিশোধিত ✓" : "Settled ✓")
                : (lang === "bn" ? "চলমান" : "Active")}
            </span>
          </div>

          {/* Amount Callout */}
          <div className="my-5 text-center">
            <span className="text-xs font-medium text-muted">{typeLabel}</span>
            <div
              className={`mt-1 text-3xl font-extrabold tracking-tight ${
                isLend ? "text-emerald" : "text-danger"
              }`}
            >
              {fmtTaka(debt.amt, lang)}
            </div>
          </div>

          {/* Details Table */}
          <div className="space-y-2.5 rounded-control bg-surface-2 p-3.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">{lang === "bn" ? "ব্যক্তি" : "Party"}</span>
              <span className="font-bold text-ink">{debt.party}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{lang === "bn" ? "তারিখ" : "Date"}</span>
              <span className="font-semibold text-ink">{dayLabel(debt.iso, lang)}</span>
            </div>
            {debt.note && (
              <div className="flex justify-between">
                <span className="text-muted">{lang === "bn" ? "বিবরণ" : "Note"}</span>
                <span className="font-medium text-ink">{debt.note}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-line/60 pt-2">
              <span className="text-muted">{lang === "bn" ? "লেনদেন আইডি" : "Tx ID"}</span>
              <span className="font-mono text-[10px] text-muted">{debt.id.slice(0, 8)}</span>
            </div>
          </div>

          <div className="mt-4 text-center text-[10px] text-muted print:block">
            {lang === "bn"
              ? "সঠিক ও নির্ভরযোগ্য হিসাব সংরক্ষণে — পই পই হিসাব"
              : "Track your finances with precision — Poi Poi Hisab"}
          </div>
        </div>

        {/* Actions (hidden when printing) */}
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            onClick={handleShare}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-emerald px-4 py-2.5 text-xs font-bold text-accent-ink hover:brightness-110"
          >
            📤 {w(lang, "shareBtn")}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-4 py-2.5 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            🖨️ {lang === "bn" ? "প্রিন্ট / পিডিএফ" : "Print / PDF"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control bg-surface-2 px-3.5 py-2.5 text-xs font-semibold text-muted hover:bg-surface-3"
          >
            {w(lang, "cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
