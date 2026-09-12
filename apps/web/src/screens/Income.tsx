import { useMemo, useState } from "react";
import { moneyToNumber, t, toBnDigits, type IncomeSource } from "@poipoihisab/core";
import type { Income, PayMethod } from "@poipoihisab/api-client";
import { useIncomeMutations, useIncomesInfinite, useMonthlyReport } from "../lib/queries";
import { dayLabel, normalizeAmount, todayIso } from "../lib/catalog";
import { w } from "../lib/web-i18n";
import { fmtTaka } from "../lib/money";
import { usePageTitle } from "../lib/usePageTitle";
import { useLangStore } from "../store/lang";
import { toast } from "../lib/toast";
import { IconTrash } from "../components/icons";

function currentYm(): string {
  return new Date().toISOString().slice(0, 7);
}

const INCOME_SOURCES: IncomeSource[] = [
  "salary",
  "freelance",
  "business",
  "investment",
  "gift",
  "other",
];

const SOURCE_LABEL_KEY: Record<IncomeSource, "incSalary" | "incFreelance" | "incBusiness" | "incInvestment" | "incGift" | "incOther"> = {
  salary: "incSalary",
  freelance: "incFreelance",
  business: "incBusiness",
  investment: "incInvestment",
  gift: "incGift",
  other: "incOther",
};

const PAY_METHODS: { id: PayMethod; labelBn: string; labelEn: string }[] = [
  { id: "cash", labelBn: "নগদ", labelEn: "Cash" },
  { id: "bkash", labelBn: "বিকাশ", labelEn: "bKash" },
  { id: "nagad", labelBn: "নগদ", labelEn: "Nagad" },
  { id: "rocket", labelBn: "রকেট", labelEn: "Rocket" },
  { id: "bank", labelBn: "ব্যাংক", labelEn: "Bank" },
  { id: "card", labelBn: "কার্ড", labelEn: "Card" },
];

/** Two-step delete for income row */
function DeleteIncomeButton({ income }: { income: Income }) {
  const lang = useLangStore((s) => s.lang);
  const { remove } = useIncomeMutations();
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        aria-label={`${w(lang, SOURCE_LABEL_KEY[income.source as IncomeSource] ?? "incOther")} — ${w(lang, "remove")}`}
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
          remove.mutate(income.id, {
            onSuccess: () => {
              setArmed(false);
              toast(w(lang, "incDeleted"));
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

export function Income() {
  usePageTitle("আয়ের হিসাব · Poi Poi Hisab");
  const lang = useLangStore((s) => s.lang);
  const { create } = useIncomeMutations();

  const ym = currentYm();
  const reportQ = useMonthlyReport(ym);
  const query = useIncomesInfinite();

  // New-entry form state
  const [source, setSource] = useState<IncomeSource>("salary");
  const [amt, setAmt] = useState("");
  const [pay, setPay] = useState<PayMethod>("cash");
  const [iso, setIso] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const rows: Income[] = useMemo(
    () => query.data?.pages.flatMap((p) => (p.ok ? p.data.items : [])) ?? [],
    [query.data],
  );

  const report = reportQ.data?.ok ? reportQ.data.data : undefined;
  const monthTotalIncome = report?.total_income ?? "0.00";
  const netSavings = report?.net_savings ?? "0.00";
  const netSavingsNum = moneyToNumber(netSavings);

  function submitIncome() {
    const normalized = normalizeAmount(amt);
    if (!normalized || moneyToNumber(normalized) <= 0) {
      setFormError(w(lang, "errAmt"));
      return;
    }
    setFormError(null);
    create.mutate(
      {
        source,
        amt: normalized,
        pay,
        iso,
        description: desc.trim() || null,
      },
      {
        onSuccess: (res) => {
          if (res.ok) {
            setAmt("");
            setDesc("");
            setIso(todayIso());
            setSavedFlash(true);
            toast(w(lang, "incSaved"));
            setTimeout(() => setSavedFlash(false), 2000);
          } else {
            setFormError(res.detail || w(lang, "incErrSave"));
          }
        },
        onError: () => setFormError(w(lang, "incErrSave")),
      },
    );
  }

  return (
    <section>
      <div>
        <h1 className="text-[22px] font-bold sm:text-2xl">{w(lang, "incTitle")}</h1>
        <p className="mt-0.5 text-[13px] text-muted">{w(lang, "incSub")}</p>
      </div>

      {/* KPI Cards: Total Income & Net Savings */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="text-[13px] font-medium text-muted">{w(lang, "statIncome")}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald">
            {fmtTaka(monthTotalIncome, lang)}
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <p className="text-[13px] font-medium text-muted">{w(lang, "statNetSavings")}</p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              netSavingsNum >= 0 ? "text-emerald" : "text-danger"
            }`}
          >
            {netSavingsNum >= 0 ? "+" : ""}
            {fmtTaka(netSavings, lang)}
          </p>
        </div>
      </div>

      {/* Income Ledger */}
      <h2 className="mt-6 px-1 text-[13px] font-bold text-muted">
        {lang === "bn" ? "আয়ের তালিকা" : "Income List"}
      </h2>

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
          {w(lang, "incErrLoad")}
        </div>
      )}

      {!query.isPending && rows.length === 0 && (
        <div className="mt-5 rounded-card border border-line bg-surface p-8 text-center shadow-card">
          <p className="font-bold">{w(lang, "incEmpty")}</p>
          <p className="mt-1 text-sm text-muted">{w(lang, "incEmptyHint")}</p>
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
            {rows.map((inc) => {
              const srcKey = (SOURCE_LABEL_KEY[inc.source as IncomeSource] ?? "incOther") as "incOther";
              const srcLabel = w(lang, srcKey);
              const payObj = PAY_METHODS.find((p) => p.id === inc.pay);
              const payLabel = lang === "bn" ? payObj?.labelBn ?? inc.pay : payObj?.labelEn ?? inc.pay;

              return (
                <li key={inc.id} className="flex items-center gap-3 px-3.5 py-3">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-soft text-sm font-bold text-emerald"
                  >
                    💰
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {srcLabel}
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                        {payLabel}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {dayLabel(inc.iso, lang)}
                      {inc.description ? ` · ${inc.description}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-emerald">
                    +{fmtTaka(inc.amt, lang)}
                  </span>
                  <DeleteIncomeButton income={inc} />
                </li>
              );
            })}
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

      {/* Add Income Form */}
      <h2 className="mt-8 px-1 text-[13px] font-bold text-muted">{w(lang, "incNew")}</h2>
      <form
        className="mt-2 max-w-[520px] rounded-card border border-line bg-surface p-5 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          submitIncome();
        }}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="incSource" className="text-[13px] font-semibold text-muted">
              {w(lang, "incSource")}
            </label>
            <select
              id="incSource"
              value={source}
              onChange={(e) => setSource(e.target.value as IncomeSource)}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
            >
              {INCOME_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {w(lang, SOURCE_LABEL_KEY[s])}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="incAmt" className="text-[13px] font-semibold text-muted">
              {w(lang, "amtLabel")}
            </label>
            <input
              id="incAmt"
              type="text"
              inputMode="decimal"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              placeholder={w(lang, "amtPh")}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-lg font-bold tabular-nums text-ink placeholder:text-muted/70 focus:border-emerald focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="incPay" className="text-[13px] font-semibold text-muted">
              {w(lang, "payLabel")}
            </label>
            <select
              id="incPay"
              value={pay}
              onChange={(e) => setPay(e.target.value as PayMethod)}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
            >
              {PAY_METHODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {lang === "bn" ? p.labelBn : p.labelEn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="incDate" className="text-[13px] font-semibold text-muted">
              {w(lang, "dateLabel")}
            </label>
            <input
              id="incDate"
              type="date"
              value={iso}
              onChange={(e) => setIso(e.target.value || todayIso())}
              className="mt-1 max-md:min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2.5 text-sm text-ink focus:border-emerald focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="incDesc" className="text-[13px] font-semibold text-muted">
              {w(lang, "descLabel")}
            </label>
            <input
              id="incDesc"
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={w(lang, "descPh")}
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
    </section>
  );
}
