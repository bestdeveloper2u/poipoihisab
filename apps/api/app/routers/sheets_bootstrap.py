"""Automated Google Sheets template bootstrapping for Poi Poi Hisab.

When syncing to a blank or uninitialized spreadsheet, this module constructs
the full 18-tab Bengali accounting template (matching Expences-full-ledger.xlsx)
in two atomic Google Sheets API calls:
1. Structural batchUpdate (:batchUpdate): Creates all 12 month tabs, the 3 ledger
   tabs, settings, and yearly summary, then deletes the placeholder Sheet1.
2. Values batchUpdate (/values:batchUpdate): Populates headers, column formulas
   (=IFERROR(VLOOKUP(...))), named ranges/lookups, and default category matrix.
"""

from typing import Any

from app.routers.sheets_years import BASE_YEAR, DIGITS, SETTINGS, SUMMARY

TAB_DEBTS = "ধার-দেনা"
TAB_BUDGET = "বাজেট"
TAB_RECURRING = "পুনরাবৃত্ত খরচ"

BN_MONTHS = [
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
]

DEFAULT_CATEGORIES: list[tuple[str, str]] = [
    # খাদ্য ও মুদি (food)
    ("চাল", "খাদ্য ও মুদি"),
    ("ডাল", "খাদ্য ও মুদি"),
    ("তেল", "খাদ্য ও মুদি"),
    ("সবজি", "খাদ্য ও মুদি"),
    ("মাছ", "খাদ্য ও মুদি"),
    ("মাংস", "খাদ্য ও মুদি"),
    ("ডিম", "খাদ্য ও মুদি"),
    ("দুধ", "খাদ্য ও মুদি"),
    ("মসলা", "খাদ্য ও মুদি"),
    ("আটা ও ময়দা", "খাদ্য ও মুদি"),
    ("মুদি বাজার", "খাদ্য ও মুদি"),
    ("কাঁচাবাজার", "খাদ্য ও মুদি"),
    ("ফলমূল", "খাদ্য ও মুদি"),
    ("হোটেল / রেস্তোরাঁ", "খাদ্য ও মুদি"),
    ("নাস্তা ও চা", "খাদ্য ও মুদি"),
    ("মিষ্টি ও বেকারি", "খাদ্য ও মুদি"),
    # বাসস্থান (housing)
    ("বাসা ভাড়া", "বাসস্থান"),
    ("বাড়ি মেরামত", "বাসস্থান"),
    ("আসবাবপত্র", "বাসস্থান"),
    # ইউটিলিটি বিল (utility)
    ("বিদ্যুৎ বিল", "ইউটিলিটি বিল"),
    ("গ্যাস বিল", "ইউটিলিটি বিল"),
    ("পানির বিল", "ইউটিলিটি বিল"),
    ("ইন্টারনেট / ওয়াইফাই", "ইউটিলিটি বিল"),
    ("ময়লা বিল", "ইউটিলিটি বিল"),
    ("সার্ভিস চার্জ", "ইউটিলিটি বিল"),
    # যাতায়াত (transport)
    ("বাস ভাড়া", "যাতায়াত"),
    ("রিকশা", "যাতায়াত"),
    ("সিএনজি", "যাতায়াত"),
    ("মেট্রোরেল", "যাতায়াত"),
    ("উবার / রাইড", "যাতায়াত"),
    ("জ্বালানি / পেট্রোল", "যাতায়াত"),
    ("গাড়ি মেরামত", "যাতায়াত"),
    # স্বাস্থ্য (health)
    ("ওষুধ", "স্বাস্থ্য"),
    ("ডাক্তার ফি", "স্বাস্থ্য"),
    ("হাসপাতাল / ক্লিনিক", "স্বাস্থ্য"),
    ("মেডিকেল টেস্ট", "স্বাস্থ্য"),
    # শিক্ষা (education)
    ("স্কুল / কলেজ ফি", "শিক্ষা"),
    ("টিউশন ফি", "শিক্ষা"),
    ("বই ও খাতা", "শিক্ষা"),
    ("শিক্ষা উপকরণ", "শিক্ষা"),
    # ব্যক্তিগত ও কেনাকাটা (personal)
    ("মোবাইল রিচার্জ", "ব্যক্তিগত ও কেনাকাটা"),
    ("কাপড়চোপড়", "ব্যক্তিগত ও কেনাকাটা"),
    ("জুতা", "ব্যক্তিগত ও কেনাকাটা"),
    ("প্রসাধন / পার্লার", "ব্যক্তিগত ও কেনাকাটা"),
    ("উপহার", "ব্যক্তিগত ও কেনাকাটা"),
    ("ইলেকট্রনিক্স", "ব্যক্তিগত ও কেনাকাটা"),
    # বিনোদন (entertainment)
    ("ঘোরাঘুরি ও ভ্রমণ", "বিনোদন"),
    ("সিনেমা ও বিনোদন", "বিনোদন"),
    # অন্যান্য (other)
    ("দান ও সদকা", "অন্যান্য"),
    ("ব্যাংক চার্জ", "অন্যান্য"),
    ("ঋণ ও কিস্তি", "অন্যান্য"),
]

DEFAULT_GROUPS = [
    "খাদ্য ও মুদি",
    "বাসস্থান",
    "ইউটিলিটি বিল",
    "যাতায়াত",
    "স্বাস্থ্য",
    "শিক্ষা",
    "ব্যক্তিগত ও কেনাকাটা",
    "বিনোদন",
    "অন্যান্য",
]

DEFAULT_PAYMENTS = [
    "নগদ টাকা",
    "বিকাশ",
    "নগদ (অ্যাপ)",
    "রকেট",
    "ডেবিট / ক্রেডিট কার্ড",
    "ব্যাংক ট্রান্সফার",
]


def tab_name(year: int, month: int) -> str:
    """Return the Bengali monthly tab title (e.g. 'সেপ্টেম্বর ২০২৬')."""
    return f"{BN_MONTHS[month - 1]} {str(year).translate(DIGITS)}"


def is_uninitialized_spreadsheet(titles: list[str]) -> bool:
    """Return True if the spreadsheet only contains blank default tabs (e.g. Sheet1, শীট১)."""
    if not titles:
        return True
    blank_defaults = {"sheet1", "শীট১", "sheet 1", "feuille 1", "hoja 1", "tabelle 1"}
    return all(t.strip().lower() in blank_defaults for t in titles)


def build_bootstrap_structural(
    metadata: dict[str, Any], year: int = BASE_YEAR
) -> tuple[list[dict[str, Any]], int | None, list[str]]:
    """Generate the batchUpdate requests to add all template sheets and clean up placeholder sheet.

    Returns:
        (requests, delete_sheet_id, created_tab_names)
    """
    existing_sheets = metadata.get("sheets", [])
    used_ids = {
        s["properties"]["sheetId"]
        for s in existing_sheets
        if "properties" in s and "sheetId" in s["properties"]
    }
    existing_titles = [s["properties"]["title"] for s in existing_sheets if "properties" in s]

    next_id = 1

    def allocate_id() -> int:
        nonlocal next_id
        while next_id in used_ids:
            next_id += 1
        used_ids.add(next_id)
        return next_id

    requests: list[dict[str, Any]] = []
    created_tabs: list[str] = []

    # 1. Add 'বার্ষিক সারসংক্ষেপ' (Annual Summary)
    summary_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": summary_id,
                "title": SUMMARY,
                "gridProperties": {"rowCount": 100, "columnCount": 15},
            }
        }
    })
    created_tabs.append(SUMMARY)

    # 2. Add 'পুনরাবৃত্ত খরচ' (Recurring)
    recurring_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": recurring_id,
                "title": TAB_RECURRING,
                "gridProperties": {"rowCount": 104, "columnCount": 11},
            }
        }
    })
    created_tabs.append(TAB_RECURRING)

    # 3. Add 'ধার-দেনা' (Debts)
    debts_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": debts_id,
                "title": TAB_DEBTS,
                "gridProperties": {"rowCount": 104, "columnCount": 11},
            }
        }
    })
    created_tabs.append(TAB_DEBTS)

    # 4. Add 'বাজেট' (Budget)
    budget_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": budget_id,
                "title": TAB_BUDGET,
                "gridProperties": {"rowCount": 60, "columnCount": 10},
            }
        }
    })
    created_tabs.append(TAB_BUDGET)

    # 5. Add 'সেটিংস' (Settings)
    settings_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": settings_id,
                "title": SETTINGS,
                "gridProperties": {"rowCount": 80, "columnCount": 12},
            }
        }
    })
    created_tabs.append(SETTINGS)

    # 6. Add all 12 Bengali month sheets (e.g. 'জানুয়ারি ২০২৬' .. 'ডিসেম্বর ২০২৬')
    for m in range(1, 13):
        m_id = allocate_id()
        m_title = tab_name(year, m)
        requests.append({
            "addSheet": {
                "properties": {
                    "sheetId": m_id,
                    "title": m_title,
                    "gridProperties": {"rowCount": 204, "columnCount": 11},
                }
            }
        })
        created_tabs.append(m_title)

    # Determine if we should delete the initial placeholder sheet (e.g. 'Sheet1')
    # Only delete if it's the sole sheet and has a standard blank name
    delete_id: int | None = None
    if len(existing_sheets) == 1:
        sole_title = existing_titles[0]
        if sole_title in {"Sheet1", "শীট১", "Sheet 1"}:
            delete_id = existing_sheets[0].get("properties", {}).get("sheetId")
            if delete_id is not None:
                requests.append({"deleteSheet": {"sheetId": delete_id}})

    return requests, delete_id, created_tabs


def build_bootstrap_values(
    custom_categories: set[str] | None = None, year: int = BASE_YEAR
) -> list[dict[str, Any]]:
    """Build the data payload for /values:batchUpdate to initialize template contents."""
    updates: list[dict[str, Any]] = []

    # --- 1. 'সেটিংস' (Settings Sheet) ---
    # Merge custom categories with default catalog
    categories_map: dict[str, str] = dict(DEFAULT_CATEGORIES)
    if custom_categories:
        for cat in custom_categories:
            if cat and cat not in categories_map:
                categories_map[cat] = "অন্যান্য"

    cat_rows = [[cat, grp] for cat, grp in categories_map.items()]
    group_rows = [[grp] for grp in DEFAULT_GROUPS]
    payment_rows = [[pay] for pay in DEFAULT_PAYMENTS]
    month_rows = [[tab_name(year, m)] for m in range(1, 13)]

    # Headers for Settings
    updates.append({
        "range": f"'{SETTINGS}'!B1:I1",
        "majorDimension": "ROWS",
        "values": [["খাত (উপশ্রেণী)", "গ্রুপ (প্রধান খাত)", "", "গ্রুপ তালিকা", "", "পেমেন্ট মাধ্যম", "", "মাসিক শীটের তালিকা"]],
    })
    # Categories & Groups (B2:C...)
    updates.append({
        "range": f"'{SETTINGS}'!B2:C{1 + len(cat_rows)}",
        "majorDimension": "ROWS",
        "values": cat_rows,
    })
    # Groups (E2:E...)
    updates.append({
        "range": f"'{SETTINGS}'!E2:E{1 + len(group_rows)}",
        "majorDimension": "ROWS",
        "values": group_rows,
    })
    # Payments (G2:G...)
    updates.append({
        "range": f"'{SETTINGS}'!G2:G{1 + len(payment_rows)}",
        "majorDimension": "ROWS",
        "values": payment_rows,
    })
    # Month list (I2:I13)
    updates.append({
        "range": f"'{SETTINGS}'!I2:I{1 + len(month_rows)}",
        "majorDimension": "ROWS",
        "values": month_rows,
    })

    # --- 2. 12 Monthly Tabs ---
    for m in range(1, 13):
        m_title = tab_name(year, m)
        # Title in A1
        updates.append({
            "range": f"'{m_title}'!A1",
            "majorDimension": "ROWS",
            "values": [[f"দৈনিক খরচের হিসাব  —  {m_title}"]],
        })
        # Table Header in Row 3
        updates.append({
            "range": f"'{m_title}'!A3:G3",
            "majorDimension": "ROWS",
            "values": [["তারিখ", "বিবরণ", "খাত", "গ্রুপ", "পরিমাণ", "পেমেন্ট", "মন্তব্য"]],
        })
        # Group VLOOKUP formula in Column D (rows 4..203)
        formula_rows = [
            [f'=IFERROR(VLOOKUP(C{r}, \'{SETTINGS}\'!$B$2:$C$70, 2, FALSE), "শ্রেণিবিন্যাসহীন")']
            for r in range(4, 204)
        ]
        updates.append({
            "range": f"'{m_title}'!D4:D203",
            "majorDimension": "ROWS",
            "values": formula_rows,
        })

    # --- 3. 'ধার-দেনা' (Debts Tab) ---
    updates.append({
        "range": f"'{TAB_DEBTS}'!A1",
        "majorDimension": "ROWS",
        "values": [["ধার-দেনা"]],
    })
    updates.append({
        "range": f"'{TAB_DEBTS}'!A3:H3",
        "majorDimension": "ROWS",
        "values": [["তারিখ", "বিবরণ", "ধরণ", "ব্যক্তি", "পরিমাণ", "অবস্থা", "পরিশোধের তারিখ", "মন্তব্য"]],
    })
    # Status formula in Column F (rows 4..103)
    debt_formulas = [
        [f'=IF(ISBLANK(A{r}),"",IF(ISBLANK(G{r}),"চলমান","পরিশোধিত"))']
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{TAB_DEBTS}'!F4:F103",
        "majorDimension": "ROWS",
        "values": debt_formulas,
    })

    # --- 4. 'বাজেট' (Budget Tab) ---
    updates.append({
        "range": f"'{TAB_BUDGET}'!A1",
        "majorDimension": "ROWS",
        "values": [["বাজেট"]],
    })
    updates.append({
        "range": f"'{TAB_BUDGET}'!C2:D2",
        "majorDimension": "ROWS",
        "values": [["মোট বাজেট:", ""]],
    })
    updates.append({
        "range": f"'{TAB_BUDGET}'!A3:B3",
        "majorDimension": "ROWS",
        "values": [["খাত", "বাজেট সীমা"]],
    })

    # --- 5. 'পুনরাবৃত্ত খরচ' (Recurring Tab) ---
    updates.append({
        "range": f"'{TAB_RECURRING}'!A1",
        "majorDimension": "ROWS",
        "values": [["পুনরাবৃত্ত খরচ"]],
    })
    updates.append({
        "range": f"'{TAB_RECURRING}'!A3:I3",
        "majorDimension": "ROWS",
        "values": [["তারিখ", "বিবরণ", "খাত", "গ্রুপ", "পরিমাণ", "পুনরাবৃত্তি", "পরবর্তী তারিখ", "অবস্থা", "মন্তব্য"]],
    })
    recurring_formulas = [
        [f'=IFERROR(VLOOKUP(C{r}, \'{SETTINGS}\'!$B$2:$C$70, 2, FALSE), "শ্রেণিবিন্যাসহীন")']
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{TAB_RECURRING}'!D4:D103",
        "majorDimension": "ROWS",
        "values": recurring_formulas,
    })

    # --- 6. 'বার্ষিক সারসংক্ষেপ' (Annual Summary) ---
    updates.append({
        "range": f"'{SUMMARY}'!A1",
        "majorDimension": "ROWS",
        "values": [[f"বার্ষিক সারসংক্ষেপ  —  {str(year).translate(DIGITS)}"]],
    })
    updates.append({
        "range": f"'{SUMMARY}'!A3:B3",
        "majorDimension": "ROWS",
        "values": [["মাস", "মোট খরচ"]],
    })
    summary_rows = [
        [tab_name(year, m), f"=SUM('{tab_name(year, m)}'!E4:E203)"]
        for m in range(1, 13)
    ]
    updates.append({
        "range": f"'{SUMMARY}'!A4:B15",
        "majorDimension": "ROWS",
        "values": summary_rows,
    })

    return updates
