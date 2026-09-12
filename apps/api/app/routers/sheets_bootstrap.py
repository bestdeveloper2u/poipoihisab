"""Automated Google Sheets template bootstrapping for Poi Poi Hisab.

When syncing to a blank or uninitialized spreadsheet, this module constructs
the full 18-tab accounting template (matching Expences-full-ledger.xlsx)
in two atomic Google Sheets API calls:
1. Structural batchUpdate (:batchUpdate): Creates all 12 month tabs, the 3 ledger
   tabs, settings, and yearly summary, then deletes the placeholder Sheet1.
2. Values batchUpdate (/values:batchUpdate): Populates headers, column formulas
   (=IFERROR(VLOOKUP(...))), named ranges/lookups, and default category matrix.

Supports both Bengali (`bn`) and English (`en`) based on the user's language.
"""

from typing import Any

from app.routers.sheets_locale import LOCALE_BN, get_locale
from app.routers.sheets_years import BASE_YEAR

# Backwards-compatible aliases (defaults to Bengali)
SETTINGS = LOCALE_BN.tab_settings
SUMMARY = LOCALE_BN.tab_summary
TAB_DEBTS = LOCALE_BN.tab_debts
TAB_BUDGET = LOCALE_BN.tab_budget
TAB_RECURRING = LOCALE_BN.tab_recurring
BN_MONTHS = list(LOCALE_BN.months)
DEFAULT_CATEGORIES = LOCALE_BN.default_categories
DEFAULT_GROUPS = LOCALE_BN.default_groups
DEFAULT_PAYMENTS = LOCALE_BN.payment_list


def tab_name(year: int, month: int, lang: str = "bn") -> str:
    """Return the monthly tab title (e.g. 'সেপ্টেম্বর ২০২৬' or 'September 2026')."""
    return get_locale(lang).tab_name(year, month)


def is_uninitialized_spreadsheet(titles: list[str]) -> bool:
    """Return True if the spreadsheet only contains blank default tabs (e.g. Sheet1, শীট১)."""
    if not titles:
        return True
    blank_defaults = {"sheet1", "শীট১", "sheet 1", "feuille 1", "hoja 1", "tabelle 1"}
    return all(t.strip().lower() in blank_defaults for t in titles)


def build_bootstrap_structural(
    metadata: dict[str, Any], year: int = BASE_YEAR, lang: str = "bn"
) -> tuple[list[dict[str, Any]], int | None, list[str]]:
    """Generate the batchUpdate requests to add all template sheets and clean up placeholder sheet.

    Returns:
        (requests, delete_sheet_id, created_tab_names)
    """
    loc = get_locale(lang)
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

    # 1. Add Yearly Summary
    summary_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": summary_id,
                "title": loc.tab_summary,
                "gridProperties": {"rowCount": 100, "columnCount": 15},
            }
        }
    })
    created_tabs.append(loc.tab_summary)

    # 2. Add Recurring
    recurring_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": recurring_id,
                "title": loc.tab_recurring,
                "gridProperties": {"rowCount": 104, "columnCount": 11},
            }
        }
    })
    created_tabs.append(loc.tab_recurring)

    # 3. Add Debts
    debts_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": debts_id,
                "title": loc.tab_debts,
                "gridProperties": {"rowCount": 104, "columnCount": 11},
            }
        }
    })
    created_tabs.append(loc.tab_debts)

    # 4. Add Budget
    budget_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": budget_id,
                "title": loc.tab_budget,
                "gridProperties": {"rowCount": 60, "columnCount": 10},
            }
        }
    })
    created_tabs.append(loc.tab_budget)

    # 5. Add Settings
    settings_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": settings_id,
                "title": loc.tab_settings,
                "gridProperties": {"rowCount": 80, "columnCount": 12},
            }
        }
    })
    created_tabs.append(loc.tab_settings)

    # 6. Add all 12 month sheets
    for m in range(1, 13):
        m_id = allocate_id()
        m_title = loc.tab_name(year, m)
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
    delete_id: int | None = None
    if len(existing_sheets) == 1:
        sole_title = existing_titles[0]
        if sole_title in {"Sheet1", "শীট১", "Sheet 1"}:
            delete_id = existing_sheets[0].get("properties", {}).get("sheetId")
            if delete_id is not None:
                requests.append({"deleteSheet": {"sheetId": delete_id}})

    return requests, delete_id, created_tabs


def build_bootstrap_values(
    custom_categories: set[str] | None = None,
    year: int = BASE_YEAR,
    lang: str = "bn",
) -> list[dict[str, Any]]:
    """Build the data payload for /values:batchUpdate to initialize template contents."""
    loc = get_locale(lang)
    updates: list[dict[str, Any]] = []

    # --- 1. Settings Sheet ---
    fallback_grp = "Other" if lang == "en" else "অন্যান্য"
    categories_map: dict[str, str] = dict(loc.default_categories)
    if custom_categories:
        for cat in custom_categories:
            if cat and cat not in categories_map:
                categories_map[cat] = fallback_grp

    cat_rows = [[cat, grp] for cat, grp in categories_map.items()]
    group_rows = [[grp] for grp in loc.default_groups]
    payment_rows = [[pay] for pay in loc.payment_list]
    month_rows = [[loc.tab_name(year, m)] for m in range(1, 13)]

    # Headers for Settings
    updates.append({
        "range": f"'{loc.tab_settings}'!B1:I1",
        "majorDimension": "ROWS",
        "values": [loc.settings_header_row()],
    })
    # Categories & Groups (B2:C...)
    updates.append({
        "range": f"'{loc.tab_settings}'!B2:C{1 + len(cat_rows)}",
        "majorDimension": "ROWS",
        "values": cat_rows,
    })
    # Groups (E2:E...)
    updates.append({
        "range": f"'{loc.tab_settings}'!E2:E{1 + len(group_rows)}",
        "majorDimension": "ROWS",
        "values": group_rows,
    })
    # Payments (G2:G...)
    updates.append({
        "range": f"'{loc.tab_settings}'!G2:G{1 + len(payment_rows)}",
        "majorDimension": "ROWS",
        "values": payment_rows,
    })
    # Month list (I2:I13)
    updates.append({
        "range": f"'{loc.tab_settings}'!I2:I{1 + len(month_rows)}",
        "majorDimension": "ROWS",
        "values": month_rows,
    })

    # --- 2. 12 Monthly Tabs ---
    for m in range(1, 13):
        m_title = loc.tab_name(year, m)
        # Title in A1
        updates.append({
            "range": f"'{m_title}'!A1",
            "majorDimension": "ROWS",
            "values": [[f"{loc.monthly_title_prefix}  —  {m_title}"]],
        })
        # Table Header in Row 3
        updates.append({
            "range": f"'{m_title}'!A3:G3",
            "majorDimension": "ROWS",
            "values": [loc.monthly_headers()],
        })
        # Group VLOOKUP formula in Column D (rows 4..203)
        formula_rows = [
            [f'=IFERROR(VLOOKUP(C{r}, \'{loc.tab_settings}\'!$B$2:$C$70, 2, FALSE), "{loc.vlookup_fallback}")']
            for r in range(4, 204)
        ]
        updates.append({
            "range": f"'{m_title}'!D4:D203",
            "majorDimension": "ROWS",
            "values": formula_rows,
        })

    # --- 3. Debts Tab ---
    updates.append({
        "range": f"'{loc.tab_debts}'!A1",
        "majorDimension": "ROWS",
        "values": [[loc.tab_debts]],
    })
    updates.append({
        "range": f"'{loc.tab_debts}'!A3:H3",
        "majorDimension": "ROWS",
        "values": [loc.debt_headers()],
    })
    # Status formula in Column F (rows 4..103)
    debt_formulas = [
        [f'=IF(ISBLANK(A{r}),"",IF(ISBLANK(G{r}),"{loc.debt_status_outstanding}","{loc.debt_status_settled}"))']
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{loc.tab_debts}'!F4:F103",
        "majorDimension": "ROWS",
        "values": debt_formulas,
    })

    # --- 4. Budget Tab ---
    updates.append({
        "range": f"'{loc.tab_budget}'!A1",
        "majorDimension": "ROWS",
        "values": [[loc.tab_budget]],
    })
    updates.append({
        "range": f"'{loc.tab_budget}'!C2:D2",
        "majorDimension": "ROWS",
        "values": [[loc.budget_total_label, ""]],
    })
    updates.append({
        "range": f"'{loc.tab_budget}'!A3:B3",
        "majorDimension": "ROWS",
        "values": [[loc.h_budget_cat, loc.h_budget_limit]],
    })

    # --- 5. Recurring Tab ---
    updates.append({
        "range": f"'{loc.tab_recurring}'!A1",
        "majorDimension": "ROWS",
        "values": [[loc.tab_recurring]],
    })
    updates.append({
        "range": f"'{loc.tab_recurring}'!A3:I3",
        "majorDimension": "ROWS",
        "values": [loc.recurring_headers()],
    })
    recurring_formulas = [
        [f'=IFERROR(VLOOKUP(C{r}, \'{loc.tab_settings}\'!$B$2:$C$70, 2, FALSE), "{loc.vlookup_fallback}")']
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{loc.tab_recurring}'!D4:D103",
        "majorDimension": "ROWS",
        "values": recurring_formulas,
    })

    # --- 6. Annual Summary ---
    updates.append({
        "range": f"'{loc.tab_summary}'!A1",
        "majorDimension": "ROWS",
        "values": [[f"{loc.tab_summary}  —  {loc.year_str(year)}"]],
    })
    updates.append({
        "range": f"'{loc.tab_summary}'!A3:B3",
        "majorDimension": "ROWS",
        "values": [[loc.h_sum_month, loc.h_sum_total]],
    })
    summary_rows = [
        [loc.tab_name(year, m), f"=SUM('{loc.tab_name(year, m)}'!E4:E203)"]
        for m in range(1, 13)
    ]
    updates.append({
        "range": f"'{loc.tab_summary}'!A4:B15",
        "majorDimension": "ROWS",
        "values": summary_rows,
    })

    return updates
