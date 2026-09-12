"""Bilingual string tables for Google Sheets integration.

Every user-visible string in the spreadsheet template — tab names, column
headers, payment methods, category defaults — lives here in both Bengali and
English.  The rest of the sheets code calls ``get_locale(lang)`` once per
request and threads the result through bootstrap, sync, and year-extension
helpers.
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

    # ── Month names (1-indexed via months[month - 1]) ─────────────────────
    months: tuple[str, ...]

    # ── Year digit translation (identity for English) ─────────────────────
    digits: dict[int, int] | None  # str.maketrans result, or None = no-op

    # ── Payment method mapping (app enum → sheet label) ───────────────────
    payments: dict[str, str]
    payment_list: list[str]  # dropdown order in Settings

    # ── Debt direction labels ─────────────────────────────────────────────
    dir_lend: str
    dir_borrow: str

    # ── Recurring frequency labels ────────────────────────────────────────
    freq_daily: str
    freq_weekly: str
    freq_monthly: str
    freq_yearly: str

    # ── Active / paused labels ────────────────────────────────────────────
    active_on: str
    active_off: str

    # ── Column headers (monthly tab) ──────────────────────────────────────
    h_date: str
    h_desc: str
    h_category: str
    h_group: str
    h_amount: str
    h_payment: str
    h_notes: str

    # ── Debt tab headers ──────────────────────────────────────────────────
    h_debt_date: str
    h_debt_desc: str
    h_debt_type: str
    h_debt_party: str
    h_debt_amount: str
    h_debt_status: str
    h_debt_settle_date: str
    h_debt_notes: str

    # ── Budget tab labels ─────────────────────────────────────────────────
    h_budget_cat: str
    h_budget_limit: str
    budget_total_label: str

    # ── Recurring tab headers ─────────────────────────────────────────────
    h_rec_date: str
    h_rec_desc: str
    h_rec_cat: str
    h_rec_group: str
    h_rec_amount: str
    h_rec_freq: str
    h_rec_next: str
    h_rec_status: str
    h_rec_notes: str

    # ── Summary tab headers ───────────────────────────────────────────────
    h_sum_month: str
    h_sum_total: str

    # ── Settings tab headers ──────────────────────────────────────────────
    h_set_category: str
    h_set_group: str
    h_set_group_list: str
    h_set_payment: str
    h_set_month_list: str

    # ── Formula text (VLOOKUP fallback, debt status) ──────────────────────
    vlookup_fallback: str
    debt_status_outstanding: str
    debt_status_settled: str

    # ── Title prefixes ────────────────────────────────────────────────────
    monthly_title_prefix: str  # e.g. "দৈনিক খরচের হিসাব" or "Poi Poi Hisab"

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

    def settings_header_row(self) -> list[str]:
        return [self.h_set_category, self.h_set_group, "",
                self.h_set_group_list, "", self.h_set_payment, "",
                self.h_set_month_list]


# ══════════════════════════════════════════════════════════════════════════
#  Bengali locale
# ══════════════════════════════════════════════════════════════════════════

_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")

_BN_CATEGORIES: list[tuple[str, str]] = [
    ("চাল", "খাদ্য ও মুদি"), ("ডাল", "খাদ্য ও মুদি"),
    ("তেল", "খাদ্য ও মুদি"), ("সবজি", "খাদ্য ও মুদি"),
    ("মাছ", "খাদ্য ও মুদি"), ("মাংস", "খাদ্য ও মুদি"),
    ("ডিম", "খাদ্য ও মুদি"), ("দুধ", "খাদ্য ও মুদি"),
    ("মসলা", "খাদ্য ও মুদি"), ("আটা ও ময়দা", "খাদ্য ও মুদি"),
    ("মুদি বাজার", "খাদ্য ও মুদি"), ("কাঁচাবাজার", "খাদ্য ও মুদি"),
    ("ফলমূল", "খাদ্য ও মুদি"), ("হোটেল / রেস্তোরাঁ", "খাদ্য ও মুদি"),
    ("নাস্তা ও চা", "খাদ্য ও মুদি"), ("মিষ্টি ও বেকারি", "খাদ্য ও মুদি"),
    ("বাসা ভাড়া", "বাসস্থান"), ("বাড়ি মেরামত", "বাসস্থান"),
    ("আসবাবপত্র", "বাসস্থান"),
    ("বিদ্যুৎ বিল", "ইউটিলিটি বিল"), ("গ্যাস বিল", "ইউটিলিটি বিল"),
    ("পানির বিল", "ইউটিলিটি বিল"), ("ইন্টারনেট / ওয়াইফাই", "ইউটিলিটি বিল"),
    ("ময়লা বিল", "ইউটিলিটি বিল"), ("সার্ভিস চার্জ", "ইউটিলিটি বিল"),
    ("বাস ভাড়া", "যাতায়াত"), ("রিকশা", "যাতায়াত"),
    ("সিএনজি", "যাতায়াত"), ("মেট্রোরেল", "যাতায়াত"),
    ("উবার / রাইড", "যাতায়াত"), ("জ্বালানি / পেট্রোল", "যাতায়াত"),
    ("গাড়ি মেরামত", "যাতায়াত"),
    ("ওষুধ", "স্বাস্থ্য"), ("ডাক্তার ফি", "স্বাস্থ্য"),
    ("হাসপাতাল / ক্লিনিক", "স্বাস্থ্য"), ("মেডিকেল টেস্ট", "স্বাস্থ্য"),
    ("স্কুল / কলেজ ফি", "শিক্ষা"), ("টিউশন ফি", "শিক্ষা"),
    ("বই ও খাতা", "শিক্ষা"), ("শিক্ষা উপকরণ", "শিক্ষা"),
    ("মোবাইল রিচার্জ", "ব্যক্তিগত ও কেনাকাটা"),
    ("কাপড়চোপড়", "ব্যক্তিগত ও কেনাকাটা"),
    ("জুতা", "ব্যক্তিগত ও কেনাকাটা"),
    ("প্রসাধন / পার্লার", "ব্যক্তিগত ও কেনাকাটা"),
    ("উপহার", "ব্যক্তিগত ও কেনাকাটা"),
    ("ইলেকট্রনিক্স", "ব্যক্তিগত ও কেনাকাটা"),
    ("ঘোরাঘুরি ও ভ্রমণ", "বিনোদন"), ("সিনেমা ও বিনোদন", "বিনোদন"),
    ("দান ও সদকা", "অন্যান্য"), ("ব্যাংক চার্জ", "অন্যান্য"),
    ("ঋণ ও কিস্তি", "অন্যান্য"),
]

_BN_GROUPS = [
    "খাদ্য ও মুদি", "বাসস্থান", "ইউটিলিটি বিল", "যাতায়াত",
    "স্বাস্থ্য", "শিক্ষা", "ব্যক্তিগত ও কেনাকাটা", "বিনোদন", "অন্যান্য",
]

_BN_PAYMENTS_MAP = {
    "cash": "নগদ টাকা", "bkash": "বিকাশ", "nagad": "নগদ (অ্যাপ)",
    "rocket": "রকেট", "card": "ডেবিট / ক্রেডিট কার্ড", "bank": "ব্যাংক ট্রান্সফার",
}

_BN_PAYMENTS_LIST = [
    "নগদ টাকা", "বিকাশ", "নগদ (অ্যাপ)",
    "রকেট", "ডেবিট / ক্রেডিট কার্ড", "ব্যাংক ট্রান্সফার",
]

LOCALE_BN = SheetsLocale(
    tab_settings="সেটিংস", tab_summary="বার্ষিক সারসংক্ষেপ",
    tab_debts="ধার-দেনা", tab_budget="বাজেট", tab_recurring="পুনরাবৃত্ত খরচ",
    months=(
        "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
        "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
    ),
    digits=_BN_DIGITS,
    payments=_BN_PAYMENTS_MAP, payment_list=_BN_PAYMENTS_LIST,
    dir_lend="ধার দিয়েছি", dir_borrow="ধার নিয়েছি",
    freq_daily="প্রতিদিন", freq_weekly="প্রতি সপ্তাহে",
    freq_monthly="প্রতি মাসে", freq_yearly="প্রতি বছরে",
    active_on="চালু", active_off="বন্ধ",
    h_date="তারিখ", h_desc="বিবরণ", h_category="খাত", h_group="গ্রুপ",
    h_amount="পরিমাণ", h_payment="পেমেন্ট", h_notes="মন্তব্য",
    h_debt_date="তারিখ", h_debt_desc="বিবরণ", h_debt_type="ধরণ",
    h_debt_party="ব্যক্তি", h_debt_amount="পরিমাণ", h_debt_status="অবস্থা",
    h_debt_settle_date="পরিশোধের তারিখ", h_debt_notes="মন্তব্য",
    h_budget_cat="খাত", h_budget_limit="বাজেট সীমা",
    budget_total_label="মোট বাজেট:",
    h_rec_date="তারিখ", h_rec_desc="বিবরণ", h_rec_cat="খাত",
    h_rec_group="গ্রুপ", h_rec_amount="পরিমাণ", h_rec_freq="পুনরাবৃত্তি",
    h_rec_next="পরবর্তী তারিখ", h_rec_status="অবস্থা", h_rec_notes="মন্তব্য",
    h_sum_month="মাস", h_sum_total="মোট খরচ",
    h_set_category="খাত (উপশ্রেণী)", h_set_group="গ্রুপ (প্রধান খাত)",
    h_set_group_list="গ্রুপ তালিকা", h_set_payment="পেমেন্ট মাধ্যম",
    h_set_month_list="মাসিক শীটের তালিকা",
    vlookup_fallback="শ্রেণিবিন্যাসহীন",
    debt_status_outstanding="চলমান", debt_status_settled="পরিশোধিত",
    monthly_title_prefix="দৈনিক খরচের হিসাব",
    default_categories=_BN_CATEGORIES, default_groups=_BN_GROUPS,
)

# ══════════════════════════════════════════════════════════════════════════
#  English locale
# ══════════════════════════════════════════════════════════════════════════

_EN_CATEGORIES: list[tuple[str, str]] = [
    ("Rice", "Food & Groceries"), ("Lentils", "Food & Groceries"),
    ("Oil", "Food & Groceries"), ("Vegetables", "Food & Groceries"),
    ("Fish", "Food & Groceries"), ("Meat", "Food & Groceries"),
    ("Eggs", "Food & Groceries"), ("Milk", "Food & Groceries"),
    ("Spices", "Food & Groceries"), ("Flour", "Food & Groceries"),
    ("Groceries", "Food & Groceries"), ("Fresh Market", "Food & Groceries"),
    ("Fruits", "Food & Groceries"), ("Restaurant", "Food & Groceries"),
    ("Snacks & Tea", "Food & Groceries"), ("Sweets & Bakery", "Food & Groceries"),
    ("Rent", "Housing"), ("Home Repairs", "Housing"), ("Furniture", "Housing"),
    ("Electricity", "Utilities"), ("Gas Bill", "Utilities"),
    ("Water Bill", "Utilities"), ("Internet / WiFi", "Utilities"),
    ("Waste Bill", "Utilities"), ("Service Charge", "Utilities"),
    ("Bus Fare", "Transport"), ("Rickshaw", "Transport"),
    ("CNG", "Transport"), ("Metro Rail", "Transport"),
    ("Uber / Ride", "Transport"), ("Fuel / Petrol", "Transport"),
    ("Vehicle Repair", "Transport"),
    ("Medicine", "Health"), ("Doctor Fee", "Health"),
    ("Hospital / Clinic", "Health"), ("Medical Tests", "Health"),
    ("School / College Fee", "Education"), ("Tuition Fee", "Education"),
    ("Books & Stationery", "Education"), ("Education Supplies", "Education"),
    ("Mobile Recharge", "Personal & Shopping"),
    ("Clothing", "Personal & Shopping"), ("Shoes", "Personal & Shopping"),
    ("Salon / Parlour", "Personal & Shopping"),
    ("Gifts", "Personal & Shopping"), ("Electronics", "Personal & Shopping"),
    ("Travel & Tours", "Entertainment"), ("Cinema & Fun", "Entertainment"),
    ("Charity & Donation", "Other"), ("Bank Charges", "Other"),
    ("Loans & EMI", "Other"),
]

_EN_GROUPS = [
    "Food & Groceries", "Housing", "Utilities", "Transport",
    "Health", "Education", "Personal & Shopping", "Entertainment", "Other",
]

_EN_PAYMENTS_MAP = {
    "cash": "Cash", "bkash": "bKash", "nagad": "Nagad",
    "rocket": "Rocket", "card": "Debit / Credit Card", "bank": "Bank Transfer",
}

_EN_PAYMENTS_LIST = [
    "Cash", "bKash", "Nagad",
    "Rocket", "Debit / Credit Card", "Bank Transfer",
]

LOCALE_EN = SheetsLocale(
    tab_settings="Settings", tab_summary="Annual Summary",
    tab_debts="Debts", tab_budget="Budget", tab_recurring="Recurring Expenses",
    months=(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ),
    digits=None,
    payments=_EN_PAYMENTS_MAP, payment_list=_EN_PAYMENTS_LIST,
    dir_lend="Lent", dir_borrow="Borrowed",
    freq_daily="Daily", freq_weekly="Weekly",
    freq_monthly="Monthly", freq_yearly="Yearly",
    active_on="Active", active_off="Paused",
    h_date="Date", h_desc="Description", h_category="Category", h_group="Group",
    h_amount="Amount", h_payment="Payment", h_notes="Notes",
    h_debt_date="Date", h_debt_desc="Description", h_debt_type="Type",
    h_debt_party="Person", h_debt_amount="Amount", h_debt_status="Status",
    h_debt_settle_date="Settle Date", h_debt_notes="Notes",
    h_budget_cat="Category", h_budget_limit="Budget Limit",
    budget_total_label="Total Budget:",
    h_rec_date="Date", h_rec_desc="Description", h_rec_cat="Category",
    h_rec_group="Group", h_rec_amount="Amount", h_rec_freq="Frequency",
    h_rec_next="Next Date", h_rec_status="Status", h_rec_notes="Notes",
    h_sum_month="Month", h_sum_total="Total Expenses",
    h_set_category="Category", h_set_group="Group",
    h_set_group_list="Group List", h_set_payment="Payment Method",
    h_set_month_list="Monthly Sheets",
    vlookup_fallback="Uncategorized",
    debt_status_outstanding="Outstanding", debt_status_settled="Settled",
    monthly_title_prefix="Poi Poi Hisab",
    default_categories=_EN_CATEGORIES, default_groups=_EN_GROUPS,
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
    bn_markers = {LOCALE_BN.tab_settings, LOCALE_BN.tab_summary,
                  LOCALE_BN.tab_debts, LOCALE_BN.tab_budget, LOCALE_BN.tab_recurring}
    en_markers = {LOCALE_EN.tab_settings, LOCALE_EN.tab_summary,
                  LOCALE_EN.tab_debts, LOCALE_EN.tab_budget, LOCALE_EN.tab_recurring}
    bn_hits = len(titles & bn_markers)
    en_hits = len(titles & en_markers)
    if en_hits > bn_hits:
        return "en"
    return "bn"
