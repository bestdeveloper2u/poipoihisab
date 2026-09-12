"""Automated Google Sheets template bootstrapping for Poi Poi Hisab.

When syncing to a blank or uninitialized spreadsheet, this module constructs
the full 18-tab accounting template (matching Expences-full-ledger.xlsx)
in two atomic Google Sheets API calls:
1. Structural batchUpdate (:batchUpdate): Creates all 12 month tabs, the 3 ledger
   tabs, settings, and yearly summary with full visual styling (colors, borders,
   column widths, frozen headers), then deletes the placeholder Sheet1.
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

# ── Visual Styling Constants (matching Expences-full-ledger.xlsx) ───────────
NAVY_COLOR = {"red": 0.122, "green": 0.220, "blue": 0.392}  # #1F3864
BLUE_COLOR = {"red": 0.180, "green": 0.361, "blue": 0.600}  # #2E5C99
WHITE_COLOR = {"red": 1.0, "green": 1.0, "blue": 1.0}
GREY_BG = {"red": 0.961, "green": 0.961, "blue": 0.961}  # #F5F5F5
MUTED_TEXT = {"red": 0.251, "green": 0.251, "blue": 0.251}  # #404040
PANEL_BG = {"red": 0.949, "green": 0.965, "blue": 0.984}  # #F2F6FB
BORDER_COLOR = {"red": 0.749, "green": 0.749, "blue": 0.749}  # #BFBFBF

THIN_BORDER = {"style": "SOLID", "color": BORDER_COLOR}


def tab_name(year: int, month: int, lang: str = "bn") -> str:
    """Return the monthly tab title (e.g. 'সেপ্টেম্বর ২০২৬' or 'September 2026')."""
    return get_locale(lang).tab_name(year, month)


def is_uninitialized_spreadsheet(titles: list[str]) -> bool:
    """Return True if the spreadsheet only contains blank default tabs (e.g. Sheet1, শীট১)."""
    if not titles:
        return True
    blank_defaults = {"sheet1", "শীট১", "sheet 1", "feuille 1", "hoja 1", "tabelle 1"}
    return all(t.strip().lower() in blank_defaults for t in titles)


# ── Styling Helpers ─────────────────────────────────────────────────────────


def _merge_and_style_title(sheet_id: int, num_cols: int) -> list[dict[str, Any]]:
    """Merged Navy title banner in row 1 (0-indexed 0) with white bold text."""
    return [
        {
            "mergeCells": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
                },
                "mergeType": "MERGE_ALL",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": NAVY_COLOR,
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                        "textFormat": {
                            "foregroundColor": WHITE_COLOR,
                            "fontSize": 14,
                            "bold": True,
                        },
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": 0,
                    "endIndex": 1,
                },
                "properties": {"pixelSize": 36},
                "fields": "pixelSize",
            }
        },
    ]


def _style_table_header(sheet_id: int, row_idx: int, num_cols: int) -> list[dict[str, Any]]:
    """Deep Blue header row with white bold text and centered alignment."""
    return [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": 0,
                    "endColumnIndex": num_cols,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": BLUE_COLOR,
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                        "wrapStrategy": "WRAP",
                        "textFormat": {
                            "foregroundColor": WHITE_COLOR,
                            "fontSize": 11,
                            "bold": True,
                        },
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)",
            }
        },
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": row_idx,
                    "endIndex": row_idx + 1,
                },
                "properties": {"pixelSize": 28},
                "fields": "pixelSize",
            }
        },
    ]


def _style_column_widths(
    sheet_id: int, widths: list[int], start_col: int = 0
) -> list[dict[str, Any]]:
    """Set explicit pixel widths for columns."""
    return [
        {
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": start_col + i,
                    "endIndex": start_col + i + 1,
                },
                "properties": {"pixelSize": width},
                "fields": "pixelSize",
            }
        }
        for i, width in enumerate(widths)
    ]


def _style_grid_borders(
    sheet_id: int, start_row: int, end_row: int, num_cols: int
) -> dict[str, Any]:
    """Apply thin border grid across the table cells."""
    return {
        "updateBorders": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": start_row,
                "endRowIndex": end_row,
                "startColumnIndex": 0,
                "endColumnIndex": num_cols,
            },
            "top": THIN_BORDER,
            "bottom": THIN_BORDER,
            "left": THIN_BORDER,
            "right": THIN_BORDER,
            "innerHorizontal": THIN_BORDER,
            "innerVertical": THIN_BORDER,
        }
    }


def _style_formula_column(
    sheet_id: int, start_row: int, end_row: int, col_idx: int
) -> dict[str, Any]:
    """Light grey fill with muted italic text indicating an automatic formula column."""
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": start_row,
                "endRowIndex": end_row,
                "startColumnIndex": col_idx,
                "endColumnIndex": col_idx + 1,
            },
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": GREY_BG,
                    "textFormat": {
                        "foregroundColor": MUTED_TEXT,
                        "italic": True,
                    },
                }
            },
            "fields": "userEnteredFormat(backgroundColor,textFormat)",
        }
    }


def _style_col_alignment(
    sheet_id: int,
    start_row: int,
    end_row: int,
    col_idx: int,
    align: str,
    number_pattern: str | None = None,
) -> dict[str, Any]:
    """Set text alignment and optional currency/number pattern for a column span."""
    format_dict: dict[str, Any] = {
        "horizontalAlignment": align,
        "verticalAlignment": "MIDDLE",
    }
    if number_pattern:
        format_dict["numberFormat"] = {"type": "CURRENCY", "pattern": number_pattern}
    fields = (
        "userEnteredFormat(horizontalAlignment,verticalAlignment,numberFormat)"
        if number_pattern
        else "userEnteredFormat(horizontalAlignment,verticalAlignment)"
    )
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": start_row,
                "endRowIndex": end_row,
                "startColumnIndex": col_idx,
                "endColumnIndex": col_idx + 1,
            },
            "cell": {"userEnteredFormat": format_dict},
            "fields": fields,
        }
    }


def _style_budget_panel(sheet_id: int) -> dict[str, Any]:
    """Style the C2:D2 total budget panel with pale blue fill and navy bold font."""
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": 1,
                "endRowIndex": 2,
                "startColumnIndex": 2,
                "endColumnIndex": 4,
            },
            "cell": {
                "userEnteredFormat": {
                    "backgroundColor": PANEL_BG,
                    "verticalAlignment": "MIDDLE",
                    "textFormat": {
                        "foregroundColor": NAVY_COLOR,
                        "fontSize": 11,
                        "bold": True,
                    },
                    "borders": {
                        "top": THIN_BORDER,
                        "bottom": THIN_BORDER,
                        "left": THIN_BORDER,
                        "right": THIN_BORDER,
                    },
                }
            },
            "fields": "userEnteredFormat(backgroundColor,verticalAlignment,textFormat,borders)",
        }
    }


def _style_settings_headers(sheet_id: int) -> list[dict[str, Any]]:
    """Style settings table headers in row 1 (B1, C1, E1, G1, I1)."""
    reqs: list[dict[str, Any]] = []
    for col_idx in (1, 2, 4, 6, 8):
        reqs.append({
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": 0,
                    "endRowIndex": 1,
                    "startColumnIndex": col_idx,
                    "endColumnIndex": col_idx + 1,
                },
                "cell": {
                    "userEnteredFormat": {
                        "backgroundColor": BLUE_COLOR,
                        "horizontalAlignment": "CENTER",
                        "verticalAlignment": "MIDDLE",
                        "wrapStrategy": "WRAP",
                        "textFormat": {
                            "foregroundColor": WHITE_COLOR,
                            "fontSize": 11,
                            "bold": True,
                        },
                    }
                },
                "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)",
            }
        })
    reqs.append({
        "updateDimensionProperties": {
            "range": {
                "sheetId": sheet_id,
                "dimension": "ROWS",
                "startIndex": 0,
                "endIndex": 1,
            },
            "properties": {"pixelSize": 28},
            "fields": "pixelSize",
        }
    })
    return reqs


# ── Structural & Values Builders ────────────────────────────────────────────


def build_bootstrap_structural(
    metadata: dict[str, Any], year: int = BASE_YEAR, lang: str = "bn"
) -> tuple[list[dict[str, Any]], int | None, list[str]]:
    """Generate batchUpdate requests to create all styled template sheets and clean up placeholder sheet.

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
                "gridProperties": {"rowCount": 100, "columnCount": 15, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_summary)
    requests.extend(_merge_and_style_title(summary_id, 2))
    requests.extend(_style_table_header(summary_id, 2, 2))
    requests.append(_style_grid_borders(summary_id, 2, 16, 2))
    requests.append(_style_col_alignment(summary_id, 3, 16, 0, "CENTER"))
    requests.append(_style_col_alignment(summary_id, 3, 16, 1, "RIGHT", '"৳ "#,##0.00'))
    requests.extend(_style_column_widths(summary_id, [180, 160]))

    # 2. Add Recurring
    recurring_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": recurring_id,
                "title": loc.tab_recurring,
                "gridProperties": {"rowCount": 104, "columnCount": 11, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_recurring)
    requests.extend(_merge_and_style_title(recurring_id, 9))
    requests.extend(_style_table_header(recurring_id, 2, 9))
    requests.append(_style_grid_borders(recurring_id, 2, 103, 9))
    requests.append(_style_formula_column(recurring_id, 3, 103, 3))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 0, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 4, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 5, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 6, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 7, "CENTER"))
    requests.extend(_style_column_widths(recurring_id, [110, 200, 140, 140, 120, 130, 120, 100, 180]))

    # 3. Add Debts
    debts_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": debts_id,
                "title": loc.tab_debts,
                "gridProperties": {"rowCount": 104, "columnCount": 11, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_debts)
    requests.extend(_merge_and_style_title(debts_id, 8))
    requests.extend(_style_table_header(debts_id, 2, 8))
    requests.append(_style_grid_borders(debts_id, 2, 103, 8))
    requests.append(_style_formula_column(debts_id, 3, 103, 5))
    requests.append(_style_col_alignment(debts_id, 3, 103, 0, "CENTER"))
    requests.append(_style_col_alignment(debts_id, 3, 103, 2, "CENTER"))
    requests.append(_style_col_alignment(debts_id, 3, 103, 4, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(debts_id, 3, 103, 5, "CENTER"))
    requests.append(_style_col_alignment(debts_id, 3, 103, 6, "CENTER"))
    requests.extend(_style_column_widths(debts_id, [110, 200, 130, 150, 120, 110, 120, 180]))

    # 4. Add Budget
    budget_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": budget_id,
                "title": loc.tab_budget,
                "gridProperties": {"rowCount": 60, "columnCount": 10, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_budget)
    requests.extend(_merge_and_style_title(budget_id, 4))
    requests.append(_style_budget_panel(budget_id))
    requests.extend(_style_table_header(budget_id, 2, 2))
    requests.append(_style_grid_borders(budget_id, 2, 53, 2))
    requests.append(_style_col_alignment(budget_id, 3, 53, 1, "RIGHT", '"৳ "#,##0.00'))
    requests.extend(_style_column_widths(budget_id, [180, 140, 120, 140]))

    # 5. Add Settings
    settings_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": settings_id,
                "title": loc.tab_settings,
                "gridProperties": {"rowCount": 80, "columnCount": 12, "frozenRowCount": 1},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_settings)
    requests.extend(_style_settings_headers(settings_id))
    requests.extend(_style_column_widths(settings_id, [30, 170, 170, 30, 170, 30, 180, 30, 180]))

    # 6. Add all 12 month sheets
    for m in range(1, 13):
        m_id = allocate_id()
        m_title = loc.tab_name(year, m)
        requests.append({
            "addSheet": {
                "properties": {
                    "sheetId": m_id,
                    "title": m_title,
                    "gridProperties": {"rowCount": 204, "columnCount": 11, "frozenRowCount": 3},
                    "tabColor": NAVY_COLOR,
                }
            }
        })
        created_tabs.append(m_title)
        requests.extend(_merge_and_style_title(m_id, 7))
        requests.extend(_style_table_header(m_id, 2, 7))
        requests.append(_style_grid_borders(m_id, 2, 203, 7))
        requests.append(_style_formula_column(m_id, 3, 203, 3))
        requests.append(_style_col_alignment(m_id, 3, 203, 0, "CENTER"))
        requests.append(_style_col_alignment(m_id, 3, 203, 4, "RIGHT", '"৳ "#,##0.00'))
        requests.append(_style_col_alignment(m_id, 3, 203, 5, "CENTER"))
        requests.extend(_style_column_widths(m_id, [110, 220, 150, 150, 120, 150, 180]))

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
