"""Bilingual string tables for Google Sheets integration.

Every user-visible string in the spreadsheet template — tab names, column
headers, payment methods, category defaults, guide contents, side panel
summaries, and formula labels — lives here in both Bengali and English.
The rest of the sheets code calls ``get_locale(lang)`` once per request
and threads the result through bootstrap, sync, and year-extension helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class SheetsLocale:
    """All language-dependent strings the sheets integration needs."""

    # ── Tab names ──────────────────────────────────────────────────────────
    tab_settings: str
    tab_summary: str
    tab_debts: str
    tab_budget: str
    tab_recurring: str
    tab_guide: str = "নির্দেশিকা"

    # ── Guide content ──────────────────────────────────────────────────────
    guide_title: str = "পই পই খরচের হিসাব ২০২৬  —  ব্যবহার নির্দেশিকা"
    guide_sections: tuple[tuple[str, str], ...] = ()

    # ── Month names (1-indexed via months[month - 1]) ─────────────────────
    months: tuple[str, ...] = ()

    # ── Year digit translation (identity for English) ─────────────────────
    digits: dict[int, int] | None = None  # str.maketrans result, or None = no-op

    # ── Payment method mapping (app enum → sheet label) ───────────────────
    payments: dict[str, str] = field(default_factory=dict)
    payment_list: list[str] = field(default_factory=list)  # dropdown order in Settings

    # ── Debt direction labels ─────────────────────────────────────────────
    dir_lend: str = "ধার দিয়েছি"
    dir_borrow: str = "ধার নিয়েছি"

    # ── Recurring frequency labels ────────────────────────────────────────
    freq_daily: str = "প্রতিদিন"
    freq_weekly: str = "প্রতি সপ্তাহে"
    freq_monthly: str = "প্রতি মাসে"
    freq_yearly: str = "প্রতি বছরে"

    # ── Active / paused labels ────────────────────────────────────────────
    active_on: str = "চালু"
    active_off: str = "বন্ধ"

    # ── Column headers (monthly tab) ──────────────────────────────────────
    h_date: str = "তারিখ"
    h_desc: str = "বিবরণ"
    h_category: str = "খাত"
    h_group: str = "গ্রুপ"
    h_amount: str = "পরিমাণ (৳)"
    h_payment: str = "পেমেন্ট মাধ্যম"
    h_notes: str = "মন্তব্য"

    # ── Debt tab headers ──────────────────────────────────────────────────
    h_debt_date: str = "তারিখ"
    h_debt_desc: str = "কার সাথে"
    h_debt_type: str = "ধরন"
    h_debt_party: str = "ব্যক্তি"
    h_debt_amount: str = "বাকি (৳)"
    h_debt_status: str = "অবস্থা"
    h_debt_settle_date: str = "পরিশোধের তারিখ"
    h_debt_notes: str = "নোট"

    # ── Budget tab labels ─────────────────────────────────────────────────
    h_budget_cat: str = "খাত"
    h_budget_limit: str = "মাসিক সীমা (৳)"
    budget_total_label: str = "মোট মাসিক বাজেট (৳)"
    h_budget_month: str = "মাস"
    h_budget_actual: str = "এই মাসের খরচ (৳)"
    h_budget_remaining: str = "বাকি (৳)"
    h_budget_util: str = "ব্যবহার"
    h_budget_status: str = "অবস্থা"
    budget_warning_msg: str = "⚠ খাতভিত্তিক সীমার যোগফল মোট বাজেটের বেশি"
    budget_status_over: str = "বেশি হয়ে গেছে"
    budget_status_warn: str = "সতর্ক"
    budget_status_ok: str = "ভালো"

    # ── Recurring tab headers ─────────────────────────────────────────────
    h_rec_cat: str = "খাত"
    h_rec_group: str = "গ্রুপ"
    h_rec_amount: str = "পরিমাণ (৳)"
    h_rec_payment: str = "পেমেন্ট মাধ্যম"
    h_rec_desc: str = "বিবরণ"
    h_rec_freq: str = "কত দিন পর পর"
    h_rec_start: str = "শুরুর তারিখ"
    h_rec_next: str = "পরবর্তী"
    h_rec_status: str = "চালু?"
    h_rec_monthly_equiv: str = "মাসিক সমমান (৳)"
    h_rec_date: str = "তারিখ"
    h_rec_notes: str = "মন্তব্য"

    # ── Summary tab headers ───────────────────────────────────────────────
    h_sum_month: str = "মাস"
    h_sum_total: str = "মোট খরচ"
    annual_total_label: str = "বার্ষিক মোট ব্যয়"
    annual_monthly_avg_label: str = "মাসিক গড় ব্যয়"
    annual_group_section: str = "গ্রুপভিত্তিক মাসিক ব্যয়"
    h_annual_group_month: str = "গ্রুপ / মাস"

    # ── Settings tab headers ──────────────────────────────────────────────
    h_set_serial: str = "ক্রমিক"
    h_set_category: str = "খাত (উপশ্রেণি)"
    h_set_group: str = "গ্রুপ (প্রধান খাত)"
    h_set_group_list: str = "গ্রুপ তালিকা"
    h_set_payment: str = "পেমেন্ট মাধ্যম"
    h_set_month_list: str = "মাসিক শিটের তালিকা"

    # ── Subtitles ─────────────────────────────────────────────────────────
    subtitle_monthly: str = (
        "শুধু  তারিখ · বিবরণ · খাত · পরিমাণ · পেমেন্ট মাধ্যম · মন্তব্য  ঘরগুলো পূরণ করুন।"
        " ‘গ্রুপ’ কলাম স্বয়ংক্রিয়ভাবে পূরণ হবে।"
    )
    subtitle_debts: str = (
        "অ্যাপ থেকে সিঙ্ক করলে এই শিটের ৪–১০৩ সারি সম্পূর্ণ নতুন করে লেখা হয়।"
        " ‘অবস্থা’ কলাম স্বয়ংক্রিয় — এখানে কিছু লিখবেন না।"
        " ‘বাকি’ মানে এখনো অপরিশোধিত অংশ, মূল ধারের পরিমাণ নয়।"
    )
    subtitle_budget: str = "বাজেট  —  খরচ বনাম সীমা"
    subtitle_recurring: str = (
        "অ্যাপ থেকে সিঙ্ক করলে এই শিটের ৪–১০৩ সারি সম্পূর্ণ নতুন করে লেখা হয়।"
        " ‘গ্রুপ’ ও ‘মাসিক সমমান’ কলাম স্বয়ংক্রিয় — এখানে কিছু লিখবেন না।"
        " এগুলো নিয়ম, খরচ নয়: প্রকৃত খরচ মাসিক শিটে যায়।"
    )
    subtitle_summary: str = (
        "সব সংখ্যা মাসিক শিটগুলো থেকে স্বয়ংক্রিয়ভাবে আসে। এই শিটে কোনো কিছু হাতে লিখতে হবে না।"
    )

    # ── Monthly Side Panel (Columns I:K) ──────────────────────────────────
    h_monthly_summary: str = "মাসিক সারসংক্ষেপ"
    h_group_main: str = "গ্রুপ (প্রধান খাত)"
    h_total: str = "মোট (৳)"
    h_percentage: str = "শতাংশ"
    h_monthly_total_exp: str = "মোট মাসিক ব্যয়"
    h_uncategorized: str = "শ্রেণিবিন্যাসহীন (খাত তালিকায় নেই)"
    h_key_metrics: str = "গুরুত্বপূর্ণ তথ্য"
    h_metric_tx_count: str = "মোট লেনদেন সংখ্যা"
    h_metric_daily_avg: str = "দৈনিক গড় খরচ"
    h_metric_avg_per_tx: str = "প্রতি লেনদেনে গড়"
    h_metric_max_single: str = "সর্বোচ্চ একক খরচ"
    h_metric_top_group: str = "সর্বোচ্চ ব্যয়ের গ্রুপ"
    h_metric_top_cat: str = "সর্বোচ্চ ব্যয়ের খাত"
    h_category_breakdown: str = "খাতভিত্তিক বিস্তারিত"

    # ── Debts Side Panel (Columns I:J) ────────────────────────────────────
    h_summary_title: str = "সারসংক্ষেপ"
    h_debt_calc: str = "হিসাব"
    h_debt_lent_open: str = "মোট পাবো (ধার দিয়েছি) — চলমান"
    h_debt_borrow_open: str = "মোট দেবো (ধার নিয়েছি) — চলমান"
    h_debt_net_pos: str = "নিট অবস্থান  (পাবো − দেবো)"
    h_debt_settled_sum: str = "পরিশোধিত (মোট)"
    h_debt_open_count: str = "চলমান এন্ট্রি"
    h_debt_total_count: str = "মোট এন্ট্রি"

    # ── Recurring Side Panel (Columns L:M) ────────────────────────────────
    h_rec_calc: str = "হিসাব"
    h_rec_val: str = "মান"
    h_rec_active_count: str = "চালু নিয়ম"
    h_rec_paused_count: str = "বন্ধ নিয়ম"
    h_rec_monthly_commit: str = "মোট মাসিক প্রতিশ্রুতি"
    h_rec_annual_commit: str = "মোট বার্ষিক প্রতিশ্রুতি"
    h_rec_overdue_count: str = "পরবর্তী তারিখ পেরিয়ে গেছে"

    # ── Formula text (VLOOKUP fallback, debt status) ──────────────────────
    vlookup_fallback: str = "শ্রেণিবিন্যাসহীন"
    debt_status_outstanding: str = "চলমান"
    debt_status_settled: str = "পরিশোধিত"

    # ── Title prefixes ────────────────────────────────────────────────────
    monthly_title_prefix: str = "দৈনিক খরচের হিসাব"

    # ── Default categories: list of (category, group) ─────────────────────
    default_categories: list[tuple[str, str]] = field(default_factory=list)
    default_groups: list[str] = field(default_factory=list)

    # ── Derived helpers ───────────────────────────────────────────────────

    def tab_name(self, year: int, month: int) -> str:
        """Monthly tab title for a year and 1-indexed month."""
        y = str(year).translate(self.digits) if self.digits else str(year)
        return f"{self.months[month - 1]} {y}"

    def year_str(self, year: int) -> str:
        """Year as a display string (Bengali digits or plain ASCII)."""
        return str(year).translate(self.digits) if self.digits else str(year)

    @property
    def dir_map(self) -> dict[str, str]:
        return {"lend": self.dir_lend, "borrow": self.dir_borrow}

    @property
    def freq_map(self) -> dict[str, str]:
        return {
            "daily": self.freq_daily,
            "weekly": self.freq_weekly,
            "monthly": self.freq_monthly,
            "yearly": self.freq_yearly,
        }

    @property
    def category_range(self) -> str:
        """The A1-notation range for the category list in the Settings tab."""
        return f"'{self.tab_settings}'!B2:B"

    def monthly_headers(self) -> list[str]:
        return [self.h_date, self.h_desc, self.h_category, self.h_group,
                self.h_amount, self.h_payment, self.h_notes]

    def debt_headers(self) -> list[str]:
        return [self.h_debt_date, self.h_debt_desc, self.h_debt_type,
                self.h_debt_party, self.h_debt_amount, self.h_debt_status,
                self.h_debt_settle_date, self.h_debt_notes]

    def recurring_headers(self) -> list[str]:
        return [self.h_rec_date, self.h_rec_desc, self.h_rec_cat,
                self.h_rec_group, self.h_rec_amount, self.h_rec_freq,
                self.h_rec_next, self.h_rec_status, self.h_rec_notes]

    def budget_headers(self) -> list[str]:
        return [self.h_budget_cat, self.h_budget_limit, self.h_budget_actual,
                self.h_budget_remaining, self.h_budget_util, self.h_budget_status]

    def settings_header_row(self) -> list[str]:
        return [self.h_set_serial, self.h_set_category, self.h_set_group, "",
                self.h_set_group_list, "", self.h_set_payment, "",
                self.h_set_month_list]


# ══════════════════════════════════════════════════════════════════════════
#  Bengali locale
# ══════════════════════════════════════════════════════════════════════════

_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")

_BN_GUIDE_TITLE = "পই পই খরচের হিসাব ২০২৬  —  ব্যবহার নির্দেশিকা"

_BN_GUIDE_SECTIONS: tuple[tuple[str, str], ...] = (
    (
        "এই ফাইলে কী আছে",
        ("১৮টি শিট: এই নির্দেশিকা, একটি বার্ষিক সারসংক্ষেপ, তিনটি লেজার শিট"
        " (ধার-দেনা, বাজেট, পুনরাবৃত্ত খরচ), ১২টি মাসিক শিট (জানুয়ারি–ডিসেম্বর ২০২৬)"
        " এবং একটি সেটিংস শিট।"),
    ),
    (
        "কোথায় লিখবেন",
        ("মাসিক শিটের A থেকে G কলামে (৪–২০৩ সারি), এবং তিনটি লেজার শিটে।"
        " ধূসর ও ইটালিক ঘরগুলো সূত্র — সেখানে কিছু লিখবেন না।"),
    ),
    (
        "তারিখ (কলাম A)",
        ("DD/MM/YYYY আকারে লিখুন, যেমন ০৫/০১/২০২৬। মাসের বাইরের তারিখ দিলে"
        " সতর্কবার্তা আসবে — চাইলে রেখে দেওয়া যাবে।"),
    ),
    ("বিবরণ (কলাম B)", "খরচের সংক্ষিপ্ত বর্ণনা, যেমন ‘৫ কেজি মিনিকেট চাল’।"),
    (
        "খাত (কলাম C)",
        ("ড্রপ-ডাউন থেকে নির্বাচন করুন। মোট ৫৪টি খাত ৮টি গ্রুপে সাজানো — চাল, ডাল, মাছ,"
        " বাড়ি ভাড়া, বিদ্যুৎ বিল ইত্যাদি। তালিকার বাইরের খাত লেখা যাবে না; নতুন খাত"
        " দরকার হলে ‘সেটিংস’ শিটে যোগ করুন।"),
    ),
    ("গ্রুপ (কলাম D)", "স্বয়ংক্রিয়ভাবে পূরণ হয় — এখানে কিছু লিখবেন না।"),
    (
        "পরিমাণ (কলাম E)",
        "শুধু সংখ্যা লিখুন, টাকার চিহ্ন নিজে থেকে বসবে। ঋণাত্মক সংখ্যা গ্রহণযোগ্য নয়।",
    ),
    (
        "পেমেন্ট মাধ্যম (কলাম F)",
        "ড্রপ-ডাউন — নগদ টাকা, বিকাশ, নগদ (অ্যাপ), রকেট, কার্ড, ব্যাংক ট্রান্সফার।",
    ),
    ("মন্তব্য (কলাম G)", "ঐচ্ছিক — দোকানের নাম, রসিদ নম্বর ইত্যাদি।"),
    (
        "মাসিক সারসংক্ষেপ",
        ("প্রতিটি মাসিক শিটের ডান পাশে (I–K কলাম) গ্রুপভিত্তিক মোট, শতাংশ, দৈনিক গড়"
        " ও খাতভিত্তিক বিস্তারিত হিসাব স্বয়ংক্রিয়ভাবে দেখা যাবে।"),
    ),
    (
        "বার্ষিক সারসংক্ষেপ",
        ("‘বার্ষিক সারসংক্ষেপ’ শিটে ১২ মাসের সব হিসাব একসাথে, দুটি চার্টসহ।"
        " এই শিটে হাতে কিছু লেখার দরকার নেই।"),
    ),
    (
        "নতুন খাত যোগ করা",
        ("‘সেটিংস’ শিটের B ও C কলামের তালিকার শেষে নতুন খাত ও তার গ্রুপ যোগ করুন,"
        " তারপর Formulas → Name Manager থেকে CategoryList ও GroupLookup নামের সীমা বাড়িয়ে দিন।"),
    ),
    (
        "সারি বাড়ানো",
        ("প্রতি মাসে ২০০টি খরচের জায়গা আছে। আরও লাগলে ২০৩ নম্বর সারির উপরে নতুন"
        " সারি যোগ করুন — সব সূত্র নিজে থেকে ঠিক হয়ে যাবে।"),
    ),
    (
        "যাচাই ব্যবস্থা",
        ("মাসিক শিটে ‘মোট মাসিক ব্যয়’ এখন সব পরিমাণের সরাসরি যোগফল। এর নিচে"
        " ‘শ্রেণিবিন্যাসহীন’ ঘরটি শূন্য না হলে বোঝা যাবে কোনো খরচ কোনো গ্রুপে পড়েনি —"
        " সেই সারিগুলো লালচে রঙে চিহ্নিত হবে। আগে এমন খরচ মোট থেকে চুপচাপ বাদ পড়ত।"),
    ),
    (
        "ফন্ট",
        ("সব লেখায় Nirmala UI ব্যবহার করা হয়েছে। বাংলা ঠিকভাবে না দেখালে"
        " Kalpurush বা SolaimanLipi ফন্ট বেছে নিন।"),
    ),
    ("মুদ্রা", "বাংলাদেশি টাকা (৳)। ধারণা: সব অঙ্ক টাকায়, কোনো রূপান্তর ধরা হয়নি।"),
    (
        "ক্যালেন্ডার",
        "গ্রেগরিয়ান ২০২৬ (জানুয়ারি–ডিসেম্বর); ২০২৬ অধিবর্ষ নয়, ফেব্রুয়ারি ২৮ দিন।",
    ),
    (
        "ধার-দেনা শিট",
        ("কে কত পাবে, কে কত দেবে। ‘বাকি’ কলামে এখনো অপরিশোধিত অংশ থাকে — আংশিক"
        " পরিশোধ হলে অঙ্কটি কমে যায়, মূল ধারের পরিমাণ আলাদা করে রাখা হয় না।"
        " ‘পরিশোধের তারিখ’ ফাঁকা থাকলে ধারটি চলমান; ডান পাশের সারসংক্ষেপে পাবো, দেবো"
        " ও নিট অবস্থান আলাদা করে দেখা যায়।"),
    ),
    (
        "বাজেট শিট",
        ("উপরের ‘মাস’ ড্রপ-ডাউন যে মাসিক শিটকে দেখায়, সেই মাসের প্রকৃত খরচ খাত ধরে"
        " ধরে সীমার পাশে বসে। ৮০% ছুঁলে হলুদ, সীমা ছাড়ালে লাল। একদম নিচের"
        " ‘বাজেটবিহীন খাতে খরচ’ ঘরটি শূন্য না হলে বোঝা যাবে কোনো খাতে খরচ হচ্ছে যার কোনো সীমা ঠিক করা নেই।"),
    ),
    (
        "পুনরাবৃত্ত খরচ শিট",
        ("বাসা ভাড়া, বিদ্যুৎ বিলের মতো নিয়মিত খরচের নিয়ম — খরচ নয়, নিয়ম।"
        " ‘মাসিক সমমান’ কলাম প্রতিটি নিয়মকে মাসিক অঙ্কে দাঁড় করায় (দৈনিক ×৩০,"
        " সাপ্তাহিক ×৪.৩৩, বার্ষিক ÷১২), তাই ডান পাশে মোট মাসিক ও বার্ষিক প্রতিশ্রুতি এক নজরে দেখা যায়।"),
    ),
    (
        "অ্যাপ থেকে সিঙ্ক",
        ("‘পই পই হিসাব’ অ্যাপের সেটিংস থেকে সিঙ্ক করলে মাসিক শিটের খরচ এবং এই তিনটি"
        " লেজার শিট — তিনটিই সম্পূর্ণ নতুন করে লেখা হয়। একই সিঙ্ক বারবার করলে কিছু দ্বিগুণ হয় না।"
        " শিটে হাতে করা বদল পরের সিঙ্কে মুছে যাবে, তাই অ্যাপ চালু থাকলে বদলগুলো অ্যাপে করুন।"),
    ),
)

_BN_CATEGORIES: list[tuple[str, str]] = [
    ("চাল", "খাদ্য ও মুদি"),
    ("আটা ও ময়দা", "খাদ্য ও মুদি"),
    ("ডাল", "খাদ্য ও মুদি"),
    ("মাছ", "খাদ্য ও মুদি"),
    ("মাংস", "খাদ্য ও মুদি"),
    ("ডিম", "খাদ্য ও মুদি"),
    ("দুধ ও দুগ্ধজাত পণ্য", "খাদ্য ও মুদি"),
    ("ভোজ্য তেল", "খাদ্য ও মুদি"),
    ("শাক-সবজি", "খাদ্য ও মুদি"),
    ("ফলমূল", "খাদ্য ও মুদি"),
    ("মসলা", "খাদ্য ও মুদি"),
    ("চিনি ও লবণ", "খাদ্য ও মুদি"),
    ("চা ও কফি", "খাদ্য ও মুদি"),
    ("নাশতা ও বেকারি", "খাদ্য ও মুদি"),
    ("বাইরে খাওয়া / রেস্তোরাঁ", "খাদ্য ও মুদি"),
    ("বাড়ি ভাড়া", "বাসস্থান"),
    ("সার্ভিস চার্জ", "বাসস্থান"),
    ("বাড়ি মেরামত ও রক্ষণাবেক্ষণ", "বাসস্থান"),
    ("গৃহকর্মীর বেতন", "বাসস্থান"),
    ("আসবাবপত্র", "বাসস্থান"),
    ("বিদ্যুৎ বিল", "ইউটিলিটি বিল"),
    ("গ্যাস বিল", "ইউটিলিটি বিল"),
    ("পানির বিল", "ইউটিলিটি বিল"),
    ("ইন্টারনেট বিল", "ইউটিলিটি বিল"),
    ("মোবাইল রিচার্জ", "ইউটিলিটি বিল"),
    ("ডিশ / ক্যাবল বিল", "ইউটিলিটি বিল"),
    ("পৌর কর ও হোল্ডিং ট্যাক্স", "ইউটিলিটি বিল"),
    ("ময়লা ও পরিচ্ছন্নতা বিল", "ইউটিলিটি বিল"),
    ("রিকশা / সিএনজি", "যাতায়াত"),
    ("বাস / ট্রেন / লঞ্চ ভাড়া", "যাতায়াত"),
    ("রাইড শেয়ারিং", "যাতায়াত"),
    ("জ্বালানি (পেট্রোল / ডিজেল)", "যাতায়াত"),
    ("গাড়ি / বাইক রক্ষণাবেক্ষণ", "যাতায়াত"),
    ("পার্কিং ও টোল", "যাতায়াত"),
    ("ওষুধ", "স্বাস্থ্য"),
    ("ডাক্তারের ফি", "স্বাস্থ্য"),
    ("চিকিৎসা পরীক্ষা", "স্বাস্থ্য"),
    ("স্বাস্থ্য বীমা", "স্বাস্থ্য"),
    ("স্কুল / কলেজ ফি", "শিক্ষা"),
    ("প্রাইভেট / কোচিং", "শিক্ষা"),
    ("বই ও শিক্ষা উপকরণ", "শিক্ষা"),
    ("পরীক্ষার ফি", "শিক্ষা"),
    ("পোশাক ও জুতা", "ব্যক্তিগত ও গৃহস্থালি"),
    ("প্রসাধনী ও পরিচর্যা", "ব্যক্তিগত ও গৃহস্থালি"),
    ("সাবান ও ডিটারজেন্ট", "ব্যক্তিগত ও গৃহস্থালি"),
    ("গৃহস্থালি সামগ্রী", "ব্যক্তিগত ও গৃহস্থালি"),
    ("সেলুন / পার্লার", "ব্যক্তিগত ও গৃহস্থালি"),
    ("বিনোদন ও ঘোরাঘুরি", "অন্যান্য"),
    ("উপহার ও অনুষ্ঠান", "অন্যান্য"),
    ("দান ও যাকাত", "অন্যান্য"),
    ("সঞ্চয় ও বিনিয়োগ", "অন্যান্য"),
    ("ঋণ পরিশোধ / কিস্তি", "অন্যান্য"),
    ("বীমা প্রিমিয়াম", "অন্যান্য"),
    ("অন্যান্য খরচ", "অন্যান্য"),
]

_BN_GROUPS = [
    "খাদ্য ও মুদি",
    "বাসস্থান",
    "ইউটিলিটি বিল",
    "যাতায়াত",
    "স্বাস্থ্য",
    "শিক্ষা",
    "ব্যক্তিগত ও গৃহস্থালি",
    "অন্যান্য",
]

_BN_PAYMENTS_MAP = {
    "cash": "নগদ টাকা",
    "bkash": "বিকাশ",
    "nagad": "নগদ (অ্যাপ)",
    "rocket": "রকেট",
    "card": "ডেবিট / ক্রেডিট কার্ড",
    "bank": "ব্যাংক ট্রান্সফার",
}

_BN_PAYMENTS_LIST = [
    "নগদ টাকা",
    "বিকাশ",
    "নগদ (অ্যাপ)",
    "রকেট",
    "ডেবিট / ক্রেডিট কার্ড",
    "ব্যাংক ট্রান্সফার",
]

LOCALE_BN = SheetsLocale(
    tab_guide="নির্দেশিকা",
    tab_settings="সেটিংস",
    tab_summary="বার্ষিক সারসংক্ষেপ",
    tab_debts="ধার-দেনা",
    tab_budget="বাজেট",
    tab_recurring="পুনরাবৃত্ত খরচ",
    guide_title=_BN_GUIDE_TITLE,
    guide_sections=_BN_GUIDE_SECTIONS,
    months=(
        "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
        "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
    ),
    digits=_BN_DIGITS,
    payments=_BN_PAYMENTS_MAP,
    payment_list=_BN_PAYMENTS_LIST,
    dir_lend="ধার দিয়েছি",
    dir_borrow="ধার নিয়েছি",
    freq_daily="প্রতিদিন",
    freq_weekly="প্রতি সপ্তাহে",
    freq_monthly="প্রতি মাসে",
    freq_yearly="প্রতি বছরে",
    active_on="চালু",
    active_off="বন্ধ",
    h_date="তারিখ",
    h_desc="বিবরণ",
    h_category="খাত",
    h_group="গ্রুপ",
    h_amount="পরিমাণ (৳)",
    h_payment="পেমেন্ট মাধ্যম",
    h_notes="মন্তব্য",
    h_debt_date="তারিখ",
    h_debt_desc="কার সাথে",
    h_debt_type="ধরন",
    h_debt_party="ব্যক্তি",
    h_debt_amount="বাকি (৳)",
    h_debt_status="অবস্থা",
    h_debt_settle_date="পরিশোধের তারিখ",
    h_debt_notes="নোট",
    h_budget_cat="খাত",
    h_budget_limit="মাসিক সীমা (৳)",
    budget_total_label="মোট মাসিক বাজেট (৳)",
    h_rec_cat="খাত",
    h_rec_group="গ্রুপ",
    h_rec_amount="পরিমাণ (৳)",
    h_rec_payment="পেমেন্ট মাধ্যম",
    h_rec_desc="বিবরণ",
    h_rec_freq="কত দিন পর পর",
    h_rec_start="শুরুর তারিখ",
    h_rec_next="পরবর্তী",
    h_rec_status="চালু?",
    h_rec_monthly_equiv="মাসিক সমমান (৳)",
    h_rec_date="তারিখ",
    h_rec_notes="মন্তব্য",
    h_sum_month="মাস",
    h_sum_total="মোট খরচ",
    h_set_serial="ক্রমিক",
    h_set_category="খাত (উপশ্রেণি)",
    h_set_group="গ্রুপ (প্রধান খাত)",
    h_set_group_list="গ্রুপ তালিকা",
    h_set_payment="পেমেন্ট মাধ্যম",
    h_set_month_list="মাসিক শিটের তালিকা",
    vlookup_fallback="শ্রেণিবিন্যাসহীন",
    debt_status_outstanding="চলমান",
    debt_status_settled="পরিশোধিত",
    monthly_title_prefix="দৈনিক খরচের হিসাব",
    default_categories=_BN_CATEGORIES,
    default_groups=_BN_GROUPS,
)


# ══════════════════════════════════════════════════════════════════════════
#  English locale
# ══════════════════════════════════════════════════════════════════════════

_EN_GUIDE_TITLE = "Poi Poi Hisab 2026 — User Guide"

_EN_GUIDE_SECTIONS: tuple[tuple[str, str], ...] = (
    (
        "What's in this workbook",
        ("18 sheets: this guide, an annual summary, three ledger sheets"
        " (Debts, Budget, Recurring Expenses), 12 monthly sheets (January–December 2026),"
        " and a Settings sheet."),
    ),
    (
        "Where to enter data",
        ("In columns A to G (rows 4–203) of monthly sheets, and the three ledger sheets."
        " Grey and italicized cells contain formulas — do not overwrite them."),
    ),
    (
        "Date (Column A)",
        "Enter in YYYY-MM-DD or DD/MM/YYYY format. Dates outside the month will trigger a warning.",
    ),
    ("Description (Column B)", "Brief description of the expense (e.g. '5kg Miniket rice')."),
    (
        "Category (Column C)",
        ("Choose from the dropdown list. 54 categories organized into 8 groups."
        " Unlisted categories can be added in the Settings sheet."),
    ),
    ("Group (Column D)", "Populates automatically via lookup formula — do not edit."),
    (
        "Amount (Column E)",
        "Numeric amount; currency symbols are formatted automatically. Negative values not allowed.",
    ),
    (
        "Payment Method (Column F)",
        "Dropdown — Cash, bKash, Nagad, Rocket, Card, Bank Transfer.",
    ),
    ("Notes (Column G)", "Optional notes — vendor name, receipt number, etc."),
    (
        "Monthly Summary",
        ("The right side (Columns I–K) of each monthly tab automatically displays group totals,"
        " percentage of budget, daily average, and category details."),
    ),
    (
        "Annual Summary",
        ("The 'Annual Summary' tab aggregates all 12 months with breakdown charts."
        " No manual entry needed."),
    ),
    (
        "Adding New Categories",
        "Add new categories and groups at the bottom of columns B & C in the Settings sheet.",
    ),
    (
        "Row Expansion",
        "Each month accommodates 200 expenses. Insert rows above row 203 if more rows are needed.",
    ),
    (
        "Data Reconciliation",
        ("Total monthly expense directly sums all entries. Any uncategorized items appear in"
        " the reconciliation row."),
    ),
    ("Font", "Default font is Arial / Nirmala UI for optimal readability."),
    ("Currency", "Bangladeshi Taka (৳)."),
    ("Calendar", "Gregorian calendar 2026 (January–December)."),
    (
        "Debts Sheet",
        ("Track receivables and payables. Status automatically updates to Settled when a"
        " settle date is provided."),
    ),
    (
        "Budget Sheet",
        "Select any month to compare actual category spending against set limits with visual warnings.",
    ),
    (
        "Recurring Expenses",
        "Track recurring rules, bills, and subscriptions with automated monthly commitment calculations.",
    ),
    (
        "Syncing from App",
        ("Syncing from Poi Poi Hisab writes expenses and ledger entries cleanly and idempotently"
        " without duplicate records."),
    ),
)

_EN_CATEGORIES: list[tuple[str, str]] = [
    ("Rice", "Food & Groceries"),
    ("Flour", "Food & Groceries"),
    ("Lentils", "Food & Groceries"),
    ("Fish", "Food & Groceries"),
    ("Meat", "Food & Groceries"),
    ("Eggs", "Food & Groceries"),
    ("Milk & Dairy", "Food & Groceries"),
    ("Edible Oil", "Food & Groceries"),
    ("Vegetables", "Food & Groceries"),
    ("Fruits", "Food & Groceries"),
    ("Spices", "Food & Groceries"),
    ("Sugar & Salt", "Food & Groceries"),
    ("Tea & Coffee", "Food & Groceries"),
    ("Snacks & Bakery", "Food & Groceries"),
    ("Dine Out / Restaurant", "Food & Groceries"),
    ("House Rent", "Housing"),
    ("Service Charge", "Housing"),
    ("Home Repair & Maintenance", "Housing"),
    ("Domestic Help / Maid", "Housing"),
    ("Furniture & Decor", "Housing"),
    ("Electricity Bill", "Utilities"),
    ("Gas Bill", "Utilities"),
    ("Water Bill", "Utilities"),
    ("Internet Bill", "Utilities"),
    ("Mobile Recharge", "Utilities"),
    ("Cable / Dish Bill", "Utilities"),
    ("Holding Tax & Municipal", "Utilities"),
    ("Waste Management", "Utilities"),
    ("Rickshaw / CNG", "Transport"),
    ("Bus / Train / Launch Fare", "Transport"),
    ("Ride Sharing", "Transport"),
    ("Fuel (Petrol / Diesel)", "Transport"),
    ("Vehicle Maintenance", "Transport"),
    ("Parking & Toll", "Transport"),
    ("Medicine", "Health"),
    ("Doctor Fee", "Health"),
    ("Medical Tests / Diagnostic", "Health"),
    ("Health Insurance", "Health"),
    ("School / College Fee", "Education"),
    ("Tuition / Coaching", "Education"),
    ("Books & Stationery", "Education"),
    ("Exam Fees", "Education"),
    ("Clothing & Shoes", "Personal & Household"),
    ("Cosmetics & Personal Care", "Personal & Household"),
    ("Soap & Detergent", "Personal & Household"),
    ("Household Supplies", "Personal & Household"),
    ("Salon / Parlour", "Personal & Household"),
    ("Entertainment & Outings", "Other"),
    ("Gifts & Events", "Other"),
    ("Charity & Zakat", "Other"),
    ("Savings & Investments", "Other"),
    ("Loan Repayment / EMI", "Other"),
    ("Insurance Premium", "Other"),
    ("Other Expenses", "Other"),
]

_EN_GROUPS = [
    "Food & Groceries",
    "Housing",
    "Utilities",
    "Transport",
    "Health",
    "Education",
    "Personal & Household",
    "Other",
]

_EN_PAYMENTS_MAP = {
    "cash": "Cash",
    "bkash": "bKash",
    "nagad": "Nagad",
    "rocket": "Rocket",
    "card": "Debit / Credit Card",
    "bank": "Bank Transfer",
}

_EN_PAYMENTS_LIST = [
    "Cash",
    "bKash",
    "Nagad",
    "Rocket",
    "Debit / Credit Card",
    "Bank Transfer",
]

LOCALE_EN = SheetsLocale(
    tab_guide="Instructions",
    tab_settings="Settings",
    tab_summary="Annual Summary",
    tab_debts="Debts",
    tab_budget="Budget",
    tab_recurring="Recurring Expenses",
    guide_title=_EN_GUIDE_TITLE,
    guide_sections=_EN_GUIDE_SECTIONS,
    months=(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ),
    digits=None,
    payments=_EN_PAYMENTS_MAP,
    payment_list=_EN_PAYMENTS_LIST,
    dir_lend="Lent",
    dir_borrow="Borrowed",
    freq_daily="Daily",
    freq_weekly="Weekly",
    freq_monthly="Monthly",
    freq_yearly="Yearly",
    active_on="Active",
    active_off="Paused",
    h_date="Date",
    h_desc="Description",
    h_category="Category",
    h_group="Group",
    h_amount="Amount (৳)",
    h_payment="Payment Method",
    h_notes="Notes",
    h_debt_date="Date",
    h_debt_desc="Person",
    h_debt_type="Type",
    h_debt_party="Person",
    h_debt_amount="Remaining (৳)",
    h_debt_status="Status",
    h_debt_settle_date="Settle Date",
    h_debt_notes="Notes",
    h_budget_cat="Category",
    h_budget_limit="Budget Limit (৳)",
    budget_total_label="Total Monthly Budget (৳)",
    h_rec_cat="Category",
    h_rec_group="Group",
    h_rec_amount="Amount (৳)",
    h_rec_payment="Payment Method",
    h_rec_desc="Description",
    h_rec_freq="Frequency",
    h_rec_start="Start Date",
    h_rec_next="Next Run",
    h_rec_status="Active?",
    h_rec_monthly_equiv="Monthly Equiv (৳)",
    h_rec_date="Date",
    h_rec_notes="Notes",
    h_sum_month="Month",
    h_sum_total="Total Expenses",
    h_set_serial="SL",
    h_set_category="Category",
    h_set_group="Group",
    h_set_group_list="Group List",
    h_set_payment="Payment Method",
    h_set_month_list="Monthly Sheets",
    vlookup_fallback="Uncategorized",
    debt_status_outstanding="Outstanding",
    debt_status_settled="Settled",
    monthly_title_prefix="Poi Poi Hisab",
    subtitle_monthly=(
        "Only fill in Date · Description · Category · Amount · Payment Method · Notes."
        " The 'Group' column populates automatically."
    ),
    subtitle_debts=(
        "Syncing from the app writes rows 4–103 completely. The 'Status' column is automatic."
        " 'Remaining' is unpaid balance."
    ),
    subtitle_budget="Budget  —  Spending vs Limit",
    subtitle_recurring=(
        "Syncing from the app writes rows 4–103 completely."
        " 'Group' and 'Monthly Equiv' columns are automatic."
    ),
    subtitle_summary=(
        "All figures aggregate automatically from monthly sheets."
        " No manual data entry required on this sheet."
    ),
    h_monthly_summary="Monthly Summary",
    h_group_main="Group (Main Category)",
    h_total="Total (৳)",
    h_percentage="Percentage",
    h_monthly_total_exp="Total Monthly Expense",
    h_uncategorized="Uncategorized (Not in list)",
    h_key_metrics="Key Metrics",
    h_metric_tx_count="Total Transactions",
    h_metric_daily_avg="Daily Average Expense",
    h_metric_avg_per_tx="Average per Transaction",
    h_metric_max_single="Highest Single Expense",
    h_metric_top_group="Highest Expense Group",
    h_metric_top_cat="Highest Expense Category",
    h_category_breakdown="Category Breakdown",
    h_summary_title="Summary",
    h_debt_calc="Metric",
    h_debt_lent_open="Total Receivable (Lent) — Open",
    h_debt_borrow_open="Total Payable (Borrowed) — Open",
    h_debt_net_pos="Net Position (Receivable − Payable)",
    h_debt_settled_sum="Settled (Total)",
    h_debt_open_count="Open Entries",
    h_debt_total_count="Total Entries",
    h_rec_calc="Metric",
    h_rec_val="Value",
    h_rec_active_count="Active Rules",
    h_rec_paused_count="Paused Rules",
    h_rec_monthly_commit="Total Monthly Commitment",
    h_rec_annual_commit="Total Annual Commitment",
    h_rec_overdue_count="Overdue Next Run",
    h_budget_month="Month",
    h_budget_actual="This Month Spent (৳)",
    h_budget_remaining="Remaining (৳)",
    h_budget_util="Usage",
    h_budget_status="Status",
    budget_warning_msg="⚠ Sum of category limits exceeds total budget",
    budget_status_over="Over Budget",
    budget_status_warn="Warning",
    budget_status_ok="Good",
    annual_total_label="Annual Total Expenses",
    annual_monthly_avg_label="Monthly Average Expense",
    annual_group_section="Monthly Expenses by Group",
    h_annual_group_month="Group / Month",
    default_categories=_EN_CATEGORIES,
    default_groups=_EN_GROUPS,
)

# ══════════════════════════════════════════════════════════════════════════
#  Public API
# ══════════════════════════════════════════════════════════════════════════

_LOCALES: dict[str, SheetsLocale] = {"bn": LOCALE_BN, "en": LOCALE_EN}


def get_locale(lang: str) -> SheetsLocale:
    """Return the sheets locale for the given language code."""
    return _LOCALES.get(lang, LOCALE_BN)


def detect_sheet_lang(titles: set[str]) -> str:
    """Detect whether an existing sheet was bootstrapped in Bengali or English.

    Checks for known Bengali or English tab names among the existing sheet
    titles.  Defaults to ``"bn"`` when ambiguous.
    """
    bn_markers = {
        LOCALE_BN.tab_guide,
        LOCALE_BN.tab_settings,
        LOCALE_BN.tab_summary,
        LOCALE_BN.tab_debts,
        LOCALE_BN.tab_budget,
        LOCALE_BN.tab_recurring,
    }
    en_markers = {
        LOCALE_EN.tab_guide,
        LOCALE_EN.tab_settings,
        LOCALE_EN.tab_summary,
        LOCALE_EN.tab_debts,
        LOCALE_EN.tab_budget,
        LOCALE_EN.tab_recurring,
    }
    bn_hits = len(titles & bn_markers)
    en_hits = len(titles & en_markers)
    if en_hits > bn_hits:
        return "en"
    return "bn"
