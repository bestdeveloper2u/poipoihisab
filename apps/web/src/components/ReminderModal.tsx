import { useState } from "react";
import { toBnDigits } from "@poipoihisab/core";
import { Modal } from "./Modal";
import { toast } from "../lib/toast";
import { w } from "../lib/web-i18n";
import { useLangStore } from "../store/lang";

interface ReminderModalProps {
  party: string;
  amount: string;
  onClose: () => void;
}

export function ReminderModal({ party, amount, onClose }: ReminderModalProps) {
  const lang = useLangStore((s) => s.lang);
  const displayAmt = lang === "bn" ? toBnDigits(amount) : amount;

  const defaultMsg =
    lang === "bn"
      ? `আসসালামু আলাইকুম ${party}, পই পই হিসাব অনুযায়ী আপনার কাছে ৳${displayAmt} পাওনা আছে। অনুগ্রহ করে দ্রুত পরিশোধ করবেন। ধন্যবাদ।`
      : `Hi ${party}, according to Poi Poi Hisab you owe ৳${displayAmt}. Please settle at your earliest convenience. Thank you.`;

  const [message, setMessage] = useState(defaultMsg);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast(w(lang, "reminderCopied"));
    } catch {
      toast(w(lang, "errFallback"));
    }
  };

  const handleWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSms = () => {
    window.location.href = `sms:?body=${encodeURIComponent(message)}`;
  };

  return (
    <Modal open onClose={onClose} label={w(lang, "reminderTitle")}>
      <div className="p-1">
        <h2 className="text-lg font-bold text-ink">{w(lang, "reminderTitle")}</h2>
        <p className="mt-1 text-xs text-muted">
          {party} · ৳{displayAmt}
        </p>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-muted">
            {lang === "bn" ? "তাগাদা মেসেজ" : "Reminder message"}
          </label>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1.5 w-full rounded-control border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-emerald"
          />
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleWhatsApp}
            className="flex flex-1 items-center justify-center gap-2 rounded-control bg-[#25D366] px-4 py-2.5 text-sm font-bold text-white hover:brightness-105"
          >
            <span aria-hidden="true">💬</span>
            {w(lang, "reminderWhatsApp")}
          </button>

          <button
            type="button"
            onClick={handleSms}
            className="flex flex-1 items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2"
          >
            <span aria-hidden="true">📱</span>
            {w(lang, "reminderSms")}
          </button>
        </div>

        <div className="mt-3 flex justify-between gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2"
          >
            📋 {w(lang, "reminderCopied").replace(" ✓", "")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control bg-surface-2 px-4 py-1.5 text-xs font-semibold text-ink hover:bg-surface-3"
          >
            {w(lang, "cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
