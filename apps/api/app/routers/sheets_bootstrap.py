"""Automated Google Sheets template bootstrapping for Poi Poi Hisab.

When syncing to a blank or uninitialized spreadsheet, this module constructs
the full 18-tab accounting template (matching Expences-full-ledger.xlsx)
in two atomic Google Sheets API calls:
1. Structural batchUpdate (:batchUpdate): Creates all 18 tabs (Guide, Annual Summary,
   Debts, Budget, Recurring Expenses, Settings, and 12 monthly tabs) with complete
   visual styling (Navy title banners, Royal Blue table headers, formula column
   fills, side summary panels, custom column widths, frozen panes, thin borders),
   then deletes the placeholder Sheet1.
2. Values batchUpdate (/values:batchUpdate): Populates guide instructions, settings
   matrix (54 categories, 8 groups, payment methods, month list), table headers,
   column formulas, side panel formulas (group breakdowns, key metrics, debt and
   recurring summaries, budget actuals), and annual rollup formulas.

Supports both Bengali (`bn`) and English (`en`) based on the user's language.
"""

from __future__ import annotations

import calendar
from typing import Any

from app.routers.sheets_locale import LOCALE_BN, get_locale
from app.routers.sheets_years import BASE_YEAR

# Backwards-compatible aliases (defaults to Bengali)
GUIDE = LOCALE_BN.tab_guide
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


def _merge_and_style_title(
    sheet_id: int, num_cols: int, start_col: int = 0, row_idx: int = 0
) -> list[dict[str, Any]]:
    """Merged Navy title banner in specified row with white bold text."""
    return [
        {
            "mergeCells": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": start_col,
                    "endColumnIndex": start_col + num_cols,
                },
                "mergeType": "MERGE_ALL",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": start_col,
                    "endColumnIndex": start_col + num_cols,
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
                    "startIndex": row_idx,
                    "endIndex": row_idx + 1,
                },
                "properties": {"pixelSize": 36},
                "fields": "pixelSize",
            }
        },
    ]


def _style_subtitle(
    sheet_id: int, num_cols: int, start_col: int = 0, row_idx: int = 1
) -> list[dict[str, Any]]:
    """Merged subtle italic subtitle row."""
    return [
        {
            "mergeCells": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": start_col,
                    "endColumnIndex": start_col + num_cols,
                },
                "mergeType": "MERGE_ALL",
            }
        },
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": start_col,
                    "endColumnIndex": start_col + num_cols,
                },
                "cell": {
                    "userEnteredFormat": {
                        "horizontalAlignment": "LEFT",
                        "verticalAlignment": "MIDDLE",
                        "textFormat": {
                            "foregroundColor": MUTED_TEXT,
                            "fontSize": 9,
                            "italic": True,
                        },
                    }
                },
                "fields": "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
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
                "properties": {"pixelSize": 22},
                "fields": "pixelSize",
            }
        },
    ]


def _style_table_header(
    sheet_id: int, row_idx: int, num_cols: int, start_col: int = 0
) -> list[dict[str, Any]]:
    """Deep Blue header row with white bold text and centered alignment."""
    return [
        {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": row_idx,
                    "endRowIndex": row_idx + 1,
                    "startColumnIndex": start_col,
                    "endColumnIndex": start_col + num_cols,
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
    sheet_id: int, start_row: int, end_row: int, num_cols: int, start_col: int = 0
) -> dict[str, Any]:
    """Apply thin border grid across the table cells."""
    return {
        "updateBorders": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": start_row,
                "endRowIndex": end_row,
                "startColumnIndex": start_col,
                "endColumnIndex": start_col + num_cols,
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
    num_type: str = "CURRENCY",
) -> dict[str, Any]:
    """Set text alignment and optional currency/percentage pattern for a column span."""
    format_dict: dict[str, Any] = {
        "horizontalAlignment": align,
        "verticalAlignment": "MIDDLE",
    }
    if number_pattern:
        format_dict["numberFormat"] = {"type": num_type, "pattern": number_pattern}
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
    """Style the A2:F2 budget panel with pale blue fill, borders, and navy bold font."""
    return {
        "repeatCell": {
            "range": {
                "sheetId": sheet_id,
                "startRowIndex": 1,
                "endRowIndex": 2,
                "startColumnIndex": 0,
                "endColumnIndex": 6,
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
    """Style settings table headers in row 1 (A1, B1, C1, E1, G1, I1)."""
    reqs: list[dict[str, Any]] = []
    for col_idx in (0, 1, 2, 4, 6, 8):
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
    """Generate batchUpdate requests to create all 18 styled template sheets and clean up placeholder sheet.

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

    # 1. Add Guide / Instructions Sheet (Tab 1)
    guide_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": guide_id,
                "title": loc.tab_guide,
                "gridProperties": {"rowCount": 40, "columnCount": 6, "frozenRowCount": 2},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_guide)
    requests.extend(_merge_and_style_title(guide_id, 2, start_col=1, row_idx=1))
    requests.extend(_style_column_widths(guide_id, [25, 190, 720]))
    requests.append(_style_grid_borders(guide_id, 3, 3 + len(loc.guide_sections), 2, start_col=1))
    requests.append({
        "repeatCell": {
            "range": {
                "sheetId": guide_id,
                "startRowIndex": 3,
                "endRowIndex": 3 + len(loc.guide_sections),
                "startColumnIndex": 1,
                "endColumnIndex": 2,
            },
            "cell": {
                "userEnteredFormat": {
                    "textFormat": {"bold": True, "foregroundColor": NAVY_COLOR},
                    "verticalAlignment": "MIDDLE",
                }
            },
            "fields": "userEnteredFormat(textFormat,verticalAlignment)",
        }
    })
    requests.append({
        "repeatCell": {
            "range": {
                "sheetId": guide_id,
                "startRowIndex": 3,
                "endRowIndex": 3 + len(loc.guide_sections),
                "startColumnIndex": 2,
                "endColumnIndex": 3,
            },
            "cell": {
                "userEnteredFormat": {
                    "wrapStrategy": "WRAP",
                    "verticalAlignment": "MIDDLE",
                }
            },
            "fields": "userEnteredFormat(wrapStrategy,verticalAlignment)",
        }
    })

    # 2. Add Yearly Summary Sheet
    summary_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": summary_id,
                "title": loc.tab_summary,
                "gridProperties": {"rowCount": 100, "columnCount": 16, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_summary)
    requests.extend(_merge_and_style_title(summary_id, 14, start_col=0, row_idx=0))
    requests.extend(_style_subtitle(summary_id, 14, start_col=0, row_idx=1))
    requests.extend(_style_table_header(summary_id, 7, 14, start_col=0))
    requests.append(_style_grid_borders(summary_id, 7, 19, 14, start_col=0))
    for col_c in range(1, 14):
        requests.append(_style_col_alignment(summary_id, 9, 19, col_c, "RIGHT", '"৳ "#,##0.00'))
    summary_widths = [190] + [110] * 12 + [130]
    requests.extend(_style_column_widths(summary_id, summary_widths))

    # 3. Add Debts Sheet
    debts_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": debts_id,
                "title": loc.tab_debts,
                "gridProperties": {"rowCount": 104, "columnCount": 12, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_debts)
    requests.extend(_merge_and_style_title(debts_id, 7, start_col=0, row_idx=0))
    requests.extend(_style_subtitle(debts_id, 7, start_col=0, row_idx=1))
    requests.extend(_style_table_header(debts_id, 2, 7, start_col=0))
    requests.append(_style_grid_borders(debts_id, 2, 103, 7, start_col=0))
    requests.append(_style_formula_column(debts_id, 3, 103, 5))
    requests.append(_style_col_alignment(debts_id, 3, 103, 0, "CENTER"))
    requests.append(_style_col_alignment(debts_id, 3, 103, 2, "CENTER"))
    requests.append(_style_col_alignment(debts_id, 3, 103, 3, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(debts_id, 3, 103, 5, "CENTER"))
    requests.append(_style_col_alignment(debts_id, 3, 103, 6, "CENTER"))
    # Side panel on Debts (Cols I-J: start_col=8, num_cols=2)
    requests.extend(_merge_and_style_title(debts_id, 2, start_col=8, row_idx=0))
    requests.extend(_style_table_header(debts_id, 2, 2, start_col=8))
    requests.append(_style_grid_borders(debts_id, 2, 9, 2, start_col=8))
    requests.append(_style_formula_column(debts_id, 3, 9, 9))
    requests.append(_style_col_alignment(debts_id, 3, 7, 9, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(debts_id, 7, 9, 9, "RIGHT", '#,##0'))
    requests.extend(_style_column_widths(
        debts_id, [110, 180, 130, 120, 180, 110, 120, 25, 240, 130]
    ))

    # 4. Add Budget Sheet
    budget_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": budget_id,
                "title": loc.tab_budget,
                "gridProperties": {"rowCount": 62, "columnCount": 8, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_budget)
    requests.extend(_merge_and_style_title(budget_id, 6, start_col=0, row_idx=0))
    requests.append(_style_budget_panel(budget_id))
    requests.extend(_style_table_header(budget_id, 2, 6, start_col=0))
    requests.append(_style_grid_borders(budget_id, 2, 57, 6, start_col=0))
    for c_idx in (2, 3, 4, 5):
        requests.append(_style_formula_column(budget_id, 3, 57, c_idx))
    for c_idx in (1, 2, 3):
        requests.append(_style_col_alignment(budget_id, 3, 57, c_idx, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(budget_id, 3, 57, 4, "RIGHT", '0.0%', num_type="PERCENT"))
    requests.append(_style_col_alignment(budget_id, 3, 57, 5, "CENTER"))
    requests.extend(_style_column_widths(budget_id, [190, 140, 150, 140, 100, 130]))

    # 5. Add Recurring Sheet
    recurring_id = allocate_id()
    requests.append({
        "addSheet": {
            "properties": {
                "sheetId": recurring_id,
                "title": loc.tab_recurring,
                "gridProperties": {"rowCount": 104, "columnCount": 15, "frozenRowCount": 3},
                "tabColor": NAVY_COLOR,
            }
        }
    })
    created_tabs.append(loc.tab_recurring)
    requests.extend(_merge_and_style_title(recurring_id, 10, start_col=0, row_idx=0))
    requests.extend(_style_subtitle(recurring_id, 10, start_col=0, row_idx=1))
    requests.extend(_style_table_header(recurring_id, 2, 10, start_col=0))
    requests.append(_style_grid_borders(recurring_id, 2, 103, 10, start_col=0))
    requests.append(_style_formula_column(recurring_id, 3, 103, 1))
    requests.append(_style_formula_column(recurring_id, 3, 103, 9))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 2, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 3, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 5, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 6, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 7, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 8, "CENTER"))
    requests.append(_style_col_alignment(recurring_id, 3, 103, 9, "RIGHT", '"৳ "#,##0.00'))
    # Side panel on Recurring (Cols L-M: start_col=11, num_cols=2)
    requests.extend(_merge_and_style_title(recurring_id, 2, start_col=11, row_idx=0))
    requests.extend(_style_table_header(recurring_id, 2, 2, start_col=11))
    requests.append(_style_grid_borders(recurring_id, 2, 8, 2, start_col=11))
    requests.append(_style_formula_column(recurring_id, 3, 8, 12))
    requests.append(_style_col_alignment(recurring_id, 3, 5, 12, "RIGHT", '#,##0'))
    requests.append(_style_col_alignment(recurring_id, 5, 7, 12, "RIGHT", '"৳ "#,##0.00'))
    requests.append(_style_col_alignment(recurring_id, 7, 8, 12, "RIGHT", '#,##0'))
    requests.extend(_style_column_widths(
        recurring_id, [150, 140, 120, 150, 180, 130, 110, 110, 100, 130, 25, 210, 130]
    ))

    # 6. Add Settings Sheet
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
    requests.append(_style_col_alignment(settings_id, 1, 70, 0, "CENTER"))
    requests.extend(_style_column_widths(
        settings_id, [45, 180, 180, 25, 180, 25, 180, 25, 180]
    ))

    # 7. Add all 12 month sheets
    for m in range(1, 13):
        m_id = allocate_id()
        m_title = loc.tab_name(year, m)
        requests.append({
            "addSheet": {
                "properties": {
                    "sheetId": m_id,
                    "title": m_title,
                    "gridProperties": {"rowCount": 210, "columnCount": 15, "frozenRowCount": 3},
                    "tabColor": NAVY_COLOR,
                }
            }
        })
        created_tabs.append(m_title)
        # Main Table Styling
        requests.extend(_merge_and_style_title(m_id, 7, start_col=0, row_idx=0))
        requests.extend(_style_subtitle(m_id, 7, start_col=0, row_idx=1))
        requests.extend(_style_table_header(m_id, 2, 7, start_col=0))
        requests.append(_style_grid_borders(m_id, 2, 203, 7, start_col=0))
        requests.append(_style_formula_column(m_id, 3, 203, 3))
        requests.append(_style_col_alignment(m_id, 3, 203, 0, "CENTER"))
        requests.append(_style_col_alignment(m_id, 3, 203, 4, "RIGHT", '"৳ "#,##0.00'))
        requests.append(_style_col_alignment(m_id, 3, 203, 5, "CENTER"))

        # Side Panel (Columns I-K: start_col=8, num_cols=3)
        requests.extend(_merge_and_style_title(m_id, 3, start_col=8, row_idx=0))
        requests.extend(_style_table_header(m_id, 2, 3, start_col=8))
        requests.append(_style_grid_borders(m_id, 2, 13, 3, start_col=8))
        requests.append(_style_formula_column(m_id, 3, 13, 9))
        requests.append(_style_formula_column(m_id, 3, 13, 10))
        requests.append(_style_col_alignment(m_id, 3, 13, 9, "RIGHT", '"৳ "#,##0.00'))
        requests.append(_style_col_alignment(m_id, 3, 13, 10, "RIGHT", '0.0%', num_type="PERCENT"))

        # Key Metrics header and rows (Row 14..20, 0-indexed 13..20)
        requests.extend(_style_table_header(m_id, 13, 3, start_col=8))
        requests.append(_style_grid_borders(m_id, 13, 20, 2, start_col=8))
        requests.append(_style_formula_column(m_id, 14, 20, 9))
        requests.append(_style_col_alignment(m_id, 14, 15, 9, "RIGHT", '#,##0'))
        requests.append(_style_col_alignment(m_id, 15, 18, 9, "RIGHT", '"৳ "#,##0.00'))
        requests.append(_style_col_alignment(m_id, 18, 20, 9, "CENTER"))

        # Category Breakdown header and rows (Row 21..76, 0-indexed 20..76)
        requests.extend(_style_table_header(m_id, 20, 3, start_col=8))
        requests.extend(_style_table_header(m_id, 21, 3, start_col=8))
        requests.append(_style_grid_borders(m_id, 21, 76, 3, start_col=8))
        requests.append(_style_formula_column(m_id, 22, 76, 9))
        requests.append(_style_formula_column(m_id, 22, 76, 10))
        requests.append(_style_col_alignment(m_id, 22, 76, 9, "RIGHT", '"৳ "#,##0.00'))
        requests.append(_style_col_alignment(m_id, 22, 76, 10, "RIGHT", '0.0%', num_type="PERCENT"))

        requests.extend(_style_column_widths(
            m_id, [110, 220, 150, 150, 120, 150, 180, 25, 210, 120, 85]
        ))

    # Delete original placeholder sheet if it's sole Sheet1
    delete_id: int | None = None
    if len(existing_sheets) == 1:
        sole_title = existing_titles[0]
        if sole_title.lower() in {"sheet1", "শীট১", "sheet 1"}:
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

    # --- 1. Guide Tab ---
    updates.append({
        "range": f"'{loc.tab_guide}'!B2",
        "majorDimension": "ROWS",
        "values": [[loc.guide_title]],
    })
    guide_rows = [[sec[0], sec[1]] for sec in loc.guide_sections]
    updates.append({
        "range": f"'{loc.tab_guide}'!B4:C{3 + len(guide_rows)}",
        "majorDimension": "ROWS",
        "values": guide_rows,
    })

    # --- 2. Settings Sheet ---
    fallback_grp = "Other" if lang == "en" else "অন্যান্য"
    categories_map: dict[str, str] = dict(loc.default_categories)
    if custom_categories:
        for cat in custom_categories:
            if cat and cat not in categories_map:
                categories_map[cat] = fallback_grp

    cat_rows = [[cat, grp] for cat, grp in categories_map.items()]
    serial_rows = [[i] for i in range(1, 1 + len(cat_rows))]
    group_rows = [[grp] for grp in loc.default_groups]
    payment_rows = [[pay] for pay in loc.payment_list]
    month_rows = [[loc.tab_name(year, m)] for m in range(1, 13)]

    # Headers for Settings
    updates.append({
        "range": f"'{loc.tab_settings}'!A1:I1",
        "majorDimension": "ROWS",
        "values": [loc.settings_header_row()],
    })
    # Serials (A2:A...)
    updates.append({
        "range": f"'{loc.tab_settings}'!A2:A{1 + len(serial_rows)}",
        "majorDimension": "ROWS",
        "values": serial_rows,
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

    # --- 3. 12 Monthly Tabs ---
    settings_max_row = 1 + len(cat_rows)
    for m in range(1, 13):
        m_title = loc.tab_name(year, m)
        num_days = calendar.monthrange(year, m)[1]
        # Main Table Header in Row 1 & 2 & 3
        updates.append({
            "range": f"'{m_title}'!A1",
            "majorDimension": "ROWS",
            "values": [[f"{loc.monthly_title_prefix}  —  {m_title}"]],
        })
        updates.append({
            "range": f"'{m_title}'!A2",
            "majorDimension": "ROWS",
            "values": [[loc.subtitle_monthly]],
        })
        updates.append({
            "range": f"'{m_title}'!A3:G3",
            "majorDimension": "ROWS",
            "values": [loc.monthly_headers()],
        })
        # Group VLOOKUP formula in Column D (rows 4..203)
        formula_rows = [
            [f'=IFERROR(VLOOKUP(C{r}, \'{loc.tab_settings}\'!$B$2:$C${settings_max_row}, 2, FALSE), "{loc.vlookup_fallback}")']
            for r in range(4, 204)
        ]
        updates.append({
            "range": f"'{m_title}'!D4:D203",
            "majorDimension": "ROWS",
            "values": formula_rows,
        })

        # Side Panel (Columns I-K)
        # Title in I1
        updates.append({
            "range": f"'{m_title}'!I1",
            "majorDimension": "ROWS",
            "values": [[loc.h_monthly_summary]],
        })
        # Table Header in I3:K3
        updates.append({
            "range": f"'{m_title}'!I3:K3",
            "majorDimension": "ROWS",
            "values": [[loc.h_group_main, loc.h_total, loc.h_percentage]],
        })
        # 8 Groups in I4:K11
        group_summary_rows = [
            [grp, f'=SUMIF($D$4:$D$203,$I{r},$E$4:$E$203)', f'=IFERROR($J{r}/$J$12,0)']
            for r, grp in enumerate(loc.default_groups, start=4)
        ]
        updates.append({
            "range": f"'{m_title}'!I4:K11",
            "majorDimension": "ROWS",
            "values": group_summary_rows,
        })
        # Row 12: Total Monthly Expense
        updates.append({
            "range": f"'{m_title}'!I12:K12",
            "majorDimension": "ROWS",
            "values": [[loc.h_monthly_total_exp, '=SUM($E$4:$E$203)', '=IFERROR($J$12/$J$12,0)']],
        })
        # Row 13: Uncategorized
        updates.append({
            "range": f"'{m_title}'!I13:K13",
            "majorDimension": "ROWS",
            "values": [[loc.h_uncategorized, '=$J$12-SUM($J$4:$J$11)', '=IFERROR($J13/$J$12,0)']],
        })
        # Row 14: Key Metrics Header
        updates.append({
            "range": f"'{m_title}'!I14",
            "majorDimension": "ROWS",
            "values": [[loc.h_key_metrics]],
        })
        # Rows 15..20: Metrics formulas
        cat_count = len(loc.default_categories)
        cat_end_row = 22 + cat_count
        metric_rows = [
            [loc.h_metric_tx_count, '=COUNT($E$4:$E$203)'],
            [loc.h_metric_daily_avg, f'=IFERROR($J$12/{num_days},0)'],
            [loc.h_metric_avg_per_tx, '=IFERROR($J$12/COUNT($E$4:$E$203),0)'],
            [loc.h_metric_max_single, '=IFERROR(MAX($E$4:$E$203),0)'],
            [loc.h_metric_top_group, '=IF($J$12=0,"–",IFERROR(INDEX($I$4:$I$11,MATCH(MAX($J$4:$J$11),$J$4:$J$11,0)),"–"))'],
            [loc.h_metric_top_cat, f'=IF($J$12=0,"–",IFERROR(INDEX($I$23:$I${cat_end_row},MATCH(MAX($J$23:$J${cat_end_row}),$J$23:$J${cat_end_row},0)),"–"))'],
        ]
        updates.append({
            "range": f"'{m_title}'!I15:J20",
            "majorDimension": "ROWS",
            "values": metric_rows,
        })
        # Row 21: Category Breakdown Header
        updates.append({
            "range": f"'{m_title}'!I21",
            "majorDimension": "ROWS",
            "values": [[loc.h_category_breakdown]],
        })
        # Row 22: Category Breakdown Table Header
        updates.append({
            "range": f"'{m_title}'!I22:K22",
            "majorDimension": "ROWS",
            "values": [[loc.h_category, loc.h_total, loc.h_percentage]],
        })
        # Rows 23..: Category rows with SUMIF
        category_summary_rows = [
            [cat, f'=SUMIF($C$4:$C$203,$I{r},$E$4:$E$203)', f'=IFERROR($J{r}/$J$12,0)']
            for r, (cat, _) in enumerate(loc.default_categories, start=23)
        ]
        updates.append({
            "range": f"'{m_title}'!I23:K{22 + len(category_summary_rows)}",
            "majorDimension": "ROWS",
            "values": category_summary_rows,
        })

    # --- 4. Debts Tab ---
    updates.append({
        "range": f"'{loc.tab_debts}'!A1",
        "majorDimension": "ROWS",
        "values": [[f"{loc.tab_debts}  —  {'কে কত পাবে / দেবে' if lang == 'bn' else 'Receivables & Payables'}"]],
    })
    updates.append({
        "range": f"'{loc.tab_debts}'!A2",
        "majorDimension": "ROWS",
        "values": [[loc.subtitle_debts]],
    })
    updates.append({
        "range": f"'{loc.tab_debts}'!A3:G3",
        "majorDimension": "ROWS",
        "values": [loc.debt_headers()],
    })
    # Status formula in Column F (rows 4..103)
    debt_formulas = [
        [f'=IF($A{r}="","",IF($G{r}="","{loc.debt_status_outstanding}","{loc.debt_status_settled}"))']
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{loc.tab_debts}'!F4:F103",
        "majorDimension": "ROWS",
        "values": debt_formulas,
    })
    # Debts Side Summary Panel (I1..J9)
    updates.append({
        "range": f"'{loc.tab_debts}'!I1",
        "majorDimension": "ROWS",
        "values": [[loc.h_summary_title]],
    })
    updates.append({
        "range": f"'{loc.tab_debts}'!I3:J3",
        "majorDimension": "ROWS",
        "values": [[loc.h_debt_calc, loc.h_total]],
    })
    debt_kpis = [
        [loc.h_debt_lent_open, f'=SUMIFS($D$4:$D$103,$C$4:$C$103,"{loc.dir_lend}",$G$4:$G$103,"")'],
        [loc.h_debt_borrow_open, f'=SUMIFS($D$4:$D$103,$C$4:$C$103,"{loc.dir_borrow}",$G$4:$G$103,"")'],
        [loc.h_debt_net_pos, '=$J$4-$J$5'],
        [loc.h_debt_settled_sum, '=SUMIFS($D$4:$D$103,$G$4:$G$103,"<>")'],
        [loc.h_debt_open_count, '=COUNTIFS($A$4:$A$103,"<>",$G$4:$G$103,"")'],
        [loc.h_debt_total_count, '=COUNTIF($A$4:$A$103,"<>")'],
    ]
    updates.append({
        "range": f"'{loc.tab_debts}'!I4:J9",
        "majorDimension": "ROWS",
        "values": debt_kpis,
    })

    # --- 5. Budget Tab ---
    updates.append({
        "range": f"'{loc.tab_budget}'!A1",
        "majorDimension": "ROWS",
        "values": [[loc.subtitle_budget]],
    })
    updates.append({
        "range": f"'{loc.tab_budget}'!A2:E2",
        "majorDimension": "ROWS",
        "values": [[
            loc.h_budget_month,
            loc.tab_name(year, 1),
            loc.budget_total_label,
            "",
            f'=IF($D$2=0,"",IF(SUM($B$4:$B$57)>$D$2,"{loc.budget_warning_msg}",""))',
        ]],
    })
    updates.append({
        "range": f"'{loc.tab_budget}'!A3:F3",
        "majorDimension": "ROWS",
        "values": [loc.budget_headers()],
    })
    budget_cat_rows = [
        [
            cat,
            "",
            f'=IF($A{r}="","",SUMIF(INDIRECT("\'"&$B$2&"\'!$C$4:$C$203"),$A{r},INDIRECT("\'"&$B$2&"\'!$E$4:$E$203)))',
            f'=IF($A{r}="","",$B{r}-$C{r})',
            f'=IF($A{r}="","",IFERROR($C{r}/$B{r},0))',
            f'=IF($A{r}="","",IF($B{r}=0,"—",IF($E{r}>1,"{loc.budget_status_over}",IF($E{r}>=0.8,"{loc.budget_status_warn}","{loc.budget_status_ok}"))))',
        ]
        for r, (cat, _) in enumerate(loc.default_categories, start=4)
    ]
    updates.append({
        "range": f"'{loc.tab_budget}'!A4:F{3 + len(budget_cat_rows)}",
        "majorDimension": "ROWS",
        "values": budget_cat_rows,
    })

    # --- 6. Recurring Tab ---
    updates.append({
        "range": f"'{loc.tab_recurring}'!A1",
        "majorDimension": "ROWS",
        "values": [[f"{loc.tab_recurring}  —  {'নিয়মিত বিল ও কিস্তি' if lang == 'bn' else 'Regular Bills & Subscriptions'}"]],
    })
    updates.append({
        "range": f"'{loc.tab_recurring}'!A2",
        "majorDimension": "ROWS",
        "values": [[loc.subtitle_recurring]],
    })
    updates.append({
        "range": f"'{loc.tab_recurring}'!A3:J3",
        "majorDimension": "ROWS",
        "values": [loc.recurring_headers()],
    })
    recurring_group_formulas = [
        [f'=IFERROR(VLOOKUP($A{r}, \'{loc.tab_settings}\'!$B$2:$C${settings_max_row}, 2, FALSE), "{loc.vlookup_fallback}")']
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{loc.tab_recurring}'!B4:B103",
        "majorDimension": "ROWS",
        "values": recurring_group_formulas,
    })
    recurring_equiv_formulas = [
        [
            (f'=IF($A{r}="","",IF($I{r}<>"{loc.active_on}",0,$C{r}*IF($F{r}="{loc.freq_daily}",30,'
            f'IF($F{r}="{loc.freq_weekly}",4.33,IF($F{r}="{loc.freq_monthly}",1,IF($F{r}="{loc.freq_yearly}",1/12,0))))))')
        ]
        for r in range(4, 104)
    ]
    updates.append({
        "range": f"'{loc.tab_recurring}'!J4:J103",
        "majorDimension": "ROWS",
        "values": recurring_equiv_formulas,
    })
    # Recurring Side Summary Panel (L1..M8)
    updates.append({
        "range": f"'{loc.tab_recurring}'!L1",
        "majorDimension": "ROWS",
        "values": [[loc.h_summary_title]],
    })
    updates.append({
        "range": f"'{loc.tab_recurring}'!L3:M3",
        "majorDimension": "ROWS",
        "values": [[loc.h_rec_calc, loc.h_rec_val]],
    })
    recurring_kpis = [
        [loc.h_rec_active_count, f'=COUNTIF($I$4:$I$103,"{loc.active_on}")'],
        [loc.h_rec_paused_count, f'=COUNTIF($I$4:$I$103,"{loc.active_off}")'],
        [loc.h_rec_monthly_commit, '=SUM($J$4:$J$103)'],
        [loc.h_rec_annual_commit, '=$M$6*12'],
        [loc.h_rec_overdue_count, f'=COUNTIFS($I$4:$I$103,"{loc.active_on}",$H$4:$H$103,"<"&TODAY())'],
    ]
    updates.append({
        "range": f"'{loc.tab_recurring}'!L4:M8",
        "majorDimension": "ROWS",
        "values": recurring_kpis,
    })

    # --- 7. Annual Summary ---
    updates.append({
        "range": f"'{loc.tab_summary}'!A1",
        "majorDimension": "ROWS",
        "values": [[f"{loc.tab_summary}  —  {loc.year_str(year)}"]],
    })
    updates.append({
        "range": f"'{loc.tab_summary}'!A2",
        "majorDimension": "ROWS",
        "values": [[loc.subtitle_summary]],
    })
    updates.append({
        "range": f"'{loc.tab_summary}'!A4:D4",
        "majorDimension": "ROWS",
        "values": [[loc.annual_total_label, "", "", loc.annual_monthly_avg_label]],
    })
    updates.append({
        "range": f"'{loc.tab_summary}'!A5",
        "majorDimension": "ROWS",
        "values": [['=SUM($B$18:$M$18)']],
    })
    updates.append({
        "range": f"'{loc.tab_summary}'!D5",
        "majorDimension": "ROWS",
        "values": [['=IFERROR(AVERAGE($B$18:$M$18),0)']],
    })
    updates.append({
        "range": f"'{loc.tab_summary}'!A7",
        "majorDimension": "ROWS",
        "values": [[loc.annual_group_section]],
    })
    # Table Header at Row 8: Group/Month, Jan..Dec, Total
    annual_header = [loc.h_annual_group_month] + [loc.months[m - 1] for m in range(1, 13)] + [loc.h_total]
    updates.append({
        "range": f"'{loc.tab_summary}'!A8:N8",
        "majorDimension": "ROWS",
        "values": [annual_header],
    })
    # Rows 10..17 (8 Groups rollup from $J$4..$J$11 of each month)
    group_rollup_rows = [
        [grp] + [f"='{loc.tab_name(year, m)}'!$J${4 + i}" for m in range(1, 13)] + [f'=SUM($B{10 + i}:$M{10 + i})']
        for i, grp in enumerate(loc.default_groups)
    ]
    updates.append({
        "range": f"'{loc.tab_summary}'!A10:N17",
        "majorDimension": "ROWS",
        "values": group_rollup_rows,
    })
    # Row 18: Monthly Total
    updates.append({
        "range": f"'{loc.tab_summary}'!A18:N18",
        "majorDimension": "ROWS",
        "values": [[
            loc.h_monthly_total_exp,
            *[f"='{loc.tab_name(year, m)}'!$J$12" for m in range(1, 13)],
            '=SUM($B18:$M18)',
        ]],
    })
    # Row 19: Uncategorized
    updates.append({
        "range": f"'{loc.tab_summary}'!A19:N19",
        "majorDimension": "ROWS",
        "values": [[
            loc.h_uncategorized,
            *[f"='{loc.tab_name(year, m)}'!$J$13" for m in range(1, 13)],
            '=SUM($B19:$M19)',
        ]],
    })

    return updates
