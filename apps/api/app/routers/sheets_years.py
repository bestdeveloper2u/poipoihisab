"""Pure request planning for the supplied 2026 template; never performs I/O.

Months are duplicated, but the summary grid and charts are copied separately:
duplicating a chart gives it an unknown ID, preventing us from explicitly
retargeting its series in the same atomic structural batch.
Google request schemas: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request
"""

import calendar
from collections.abc import Callable
from copy import deepcopy
from typing import Any

from app.routers.sheets_locale import LOCALE_BN, SheetsLocale

SUMMARY = LOCALE_BN.tab_summary
SETTINGS = LOCALE_BN.tab_settings
BASE_YEAR = 2026
DIGITS = LOCALE_BN.digits


class TemplateError(ValueError):
    """An altered/incomplete template cannot safely be extended automatically."""


def _range(sheet_id: int, row: int, end: int, col: int, right: int) -> dict:
    return {
        "sheetId": sheet_id,
        "startRowIndex": row,
        "endRowIndex": end,
        "startColumnIndex": col,
        "endColumnIndex": right,
    }


def _text(sheet_id: int, text: str) -> dict:
    return {
        "updateCells": {
            "start": {"sheetId": sheet_id, "rowIndex": 0, "columnIndex": 0},
            "rows": [{"values": [{"userEnteredValue": {"stringValue": text}}]}],
            "fields": "userEnteredValue",
        }
    }


def _remap(value: Any, ids: dict[int, int]) -> Any:
    if isinstance(value, list):
        return [_remap(item, ids) for item in value]
    if isinstance(value, dict):
        return {
            key: ids.get(item, item) if key == "sheetId" else _remap(item, ids)
            for key, item in value.items()
        }
    return value


def plan_years(
    metadata: dict,
    summary: dict,
    years: list[int],
    tab_name: Callable[[int, int], str],
    registry: list[list[Any]],
    locale: SheetsLocale | None = None,
) -> tuple[list[dict], list[str]]:
    """Plan complete absent years. Refuse partial years or registry collisions.

    The caller checks every expense/ledger row cap BEFORE submitting these requests.
    No request here changes an existing month, summary, or budget selection.
    """
    loc = locale or LOCALE_BN
    summary_tab = loc.tab_summary
    settings_tab = loc.tab_settings
    budget_tab = loc.tab_budget
    digits = loc.digits

    sheets = {s["properties"]["title"]: s for s in metadata["sheets"]}
    if not years:
        return [], []
    if len(years) > 10:
        raise TemplateError("Sync at most ten new years at a time using the month filter")
    if any(year < 1900 or year > 9999 for year in years):
        raise TemplateError("Automatic rollover supports years 1900 through 9999")
    source_titles = [tab_name(BASE_YEAR, m) for m in range(1, 13)]
    if not all(t in sheets for t in [summary_tab, settings_tab, *source_titles]):
        raise TemplateError("Keep the complete 2026 template, including its yearly summary")
    if any(tab_name(y, m) in sheets for y in years for m in range(1, 13)):
        raise TemplateError("A requested year is only partly present; restore its missing tabs")
    new_summaries = [f"{summary_tab} {str(y).translate(digits) if digits else str(y)}" for y in years]
    if any(t in sheets for t in new_summaries):
        raise TemplateError("A yearly summary already exists without all twelve month tabs")
    for title in source_titles:
        source = sheets[title]
        grid = source["properties"].get("gridProperties", {})
        if grid.get("rowCount", 0) < 203 or grid.get("columnCount", 0) < 11:
            raise TemplateError("The 2026 month layout no longer matches the template")
        if source.get("charts"):
            raise TemplateError("Custom monthly charts need a manual rollover")

    props = summary["properties"]
    if props["sheetId"] != sheets[summary_tab]["properties"]["sheetId"]:
        raise TemplateError("The yearly summary changed during inspection; retry")
    # Read formula strings, not cached numbers: an old year's cached totals
    # cannot prove that the new summary has a dependency on each new month.
    formulas = "\n".join(
        cell.get("userEnteredValue", {}).get("formulaValue", "")
        for block in summary.get("data", [])
        for row in block.get("rowData", [])
        for cell in row.get("values", [])
    )
    if not all(f"'{title}'!" in formulas for title in source_titles):
        raise TemplateError("The base yearly summary must reference all twelve 2026 months")

    used = {s["properties"]["sheetId"] for s in sheets.values()}
    next_id = 0

    def allocate() -> int:
        nonlocal next_id
        while next_id in used:
            next_id += 1
        used.add(next_id)
        return next_id

    requests: list[dict] = []
    created: list[str] = []
    new_months: list[str] = []
    for year, summary_title in zip(years, new_summaries, strict=True):
        mapping = {}
        for month, title in enumerate(source_titles, 1):
            source_id = sheets[title]["properties"]["sheetId"]
            source_rows = sheets[title]["properties"]["gridProperties"]["rowCount"]
            target_id = allocate()
            mapping[source_id] = target_id
            target_title = tab_name(year, month)
            created.append(target_title)
            new_months.append(target_title)
            requests.append(
                {
                    "duplicateSheet": {
                        "sourceSheetId": source_id,
                        "newSheetId": target_id,
                        "newSheetName": target_title,
                    }
                }
            )
            # Clear inherited inputs INCLUDING manual comments, but not D's
            # lookup. Existing months' comments are never part of this plan.
            for left, right in ((0, 3), (4, 7)):
                requests.append(
                    {
                        "repeatCell": {
                            "range": _range(target_id, 3, source_rows, left, right),
                            "cell": {},
                            "fields": "userEnteredValue,note",
                        }
                    }
                )
            requests.append(_text(target_id, f"দৈনিক খরচের হিসাব  —  {target_title}"))
            requests.append(
                {
                    "setDataValidation": {
                        "range": _range(target_id, 3, 203, 0, 1),
                        "rule": {
                            "condition": {
                                "type": "DATE_BETWEEN",
                                "values": [
                                    {"userEnteredValue": f"=DATE({year},{month},1)"},
                                    {
                                        "userEnteredValue": f"=DATE({year},{month},{calendar.monthrange(year, month)[1]})"
                                    },
                                ],
                            },
                            "strict": True,
                            "showCustomUi": True,
                        },
                    }
                }
            )

        summary_id = allocate()
        mapping[props["sheetId"]] = summary_id
        created.append(summary_title)
        grid = deepcopy(props["gridProperties"])
        requests.append(
            {
                "addSheet": {
                    "properties": {
                        "sheetId": summary_id,
                        "title": summary_title,
                        "gridProperties": grid,
                        **{k: props[k] for k in ("rightToLeft", "tabColorStyle") if k in props},
                    }
                }
            }
        )
        source_range = _range(props["sheetId"], 0, grid["rowCount"], 0, grid["columnCount"])
        target_range = {**source_range, "sheetId": summary_id}
        for paste in ("PASTE_NORMAL", "PASTE_DATA_VALIDATION", "PASTE_CONDITIONAL_FORMATTING"):
            requests.append(
                {
                    "copyPaste": {
                        "source": source_range,
                        "destination": target_range,
                        "pasteType": paste,
                    }
                }
            )
        for block in summary.get("data", []):
            for dimension, key, offset in (
                ("ROWS", "rowMetadata", "startRow"),
                ("COLUMNS", "columnMetadata", "startColumn"),
            ):
                for index, dimension_props in enumerate(block.get(key, []), block.get(offset, 0)):
                    if dimension_props:
                        requests.append(
                            {
                                "updateDimensionProperties": {
                                    "range": {
                                        "sheetId": summary_id,
                                        "dimension": dimension,
                                        "startIndex": index,
                                        "endIndex": index + 1,
                                    },
                                    "properties": dimension_props,
                                    "fields": ",".join(dimension_props),
                                }
                            }
                        )
        for month, title in enumerate(source_titles, 1):
            requests.append(
                {
                    "findReplace": {
                        "sheetId": summary_id,
                        "find": f"'{title}'!",
                        "replacement": f"'{tab_name(year, month)}'!",
                        "includeFormulas": True,
                        "matchCase": True,
                        "searchByRegex": False,
                    }
                }
            )
        # Explicit self references in copied formulas need the new summary too.
        requests.append(
            {
                "findReplace": {
                    "sheetId": summary_id,
                    "find": f"'{summary_tab}'!",
                    "replacement": f"'{summary_title}'!",
                    "includeFormulas": True,
                    "matchCase": True,
                    "searchByRegex": False,
                }
            }
        )
        requests.append(
            _text(summary_id, f"{summary_tab}  —  {str(year).translate(digits) if digits else str(year)}")
        )
        for chart in summary.get("charts", []):
            copied = {k: chart[k] for k in ("spec", "position", "border") if k in chart}
            if "overlayPosition" not in copied.get("position", {}):
                raise TemplateError("The yearly summary has an unsupported chart position")
            requests.append({"addChart": {"chart": _remap(copied, mapping)}})

    named = next((n for n in metadata.get("namedRanges", []) if n["name"] == "MonthTabs"), None)
    if named is None:
        if budget_tab in sheets:
            raise TemplateError("The budget tab needs the template's MonthTabs named range")
        return requests, created  # Older expense-only templates have no picker.
    settings = sheets[settings_tab]["properties"]
    rng = named["range"]
    first, end = rng.get("startRowIndex"), rng.get("endRowIndex", 0)
    if (
        rng.get("sheetId") != settings["sheetId"]
        or first != 1
        or end < 13
        or rng.get("startColumnIndex") != 8
        or rng.get("endColumnIndex") != 9
    ):
        raise TemplateError("MonthTabs no longer uses the template's settings column I")
    existing = [row[0] if row else "" for row in registry[first:end]]

    def is_month(title: str) -> bool:
        try:
            year = int(title.rsplit(" ", 1)[1])
            return 1 <= year <= 9999 and any(title == tab_name(year, m) for m in range(1, 13))
        except (ValueError, IndexError, AttributeError):
            return False

    if (
        len(existing) != end - first
        or len(set(existing)) != len(existing)
        or set(existing) != {t for t in sheets if is_month(t)}
    ):
        raise TemplateError("MonthTabs contains missing, duplicate, or non-month entries")
    new_end = end + len(new_months)
    if any(any(value != "" for value in row) for row in registry[end:new_end]):
        raise TemplateError(
            "Settings column I contains data below MonthTabs; move it before rollover"
        )
    if new_end > settings["gridProperties"]["rowCount"]:
        requests.append(
            {
                "appendDimension": {
                    "sheetId": settings["sheetId"],
                    "dimension": "ROWS",
                    "length": new_end - settings["gridProperties"]["rowCount"],
                }
            }
        )
    requests.append(
        {
            "updateCells": {
                "start": {"sheetId": settings["sheetId"], "rowIndex": end, "columnIndex": 8},
                "rows": [
                    {"values": [{"userEnteredValue": {"stringValue": t}}]} for t in new_months
                ],
                "fields": "userEnteredValue",
            }
        }
    )
    requests.append(
        {
            "updateNamedRange": {
                "namedRange": {
                    "namedRangeId": named["namedRangeId"],
                    "range": {**rng, "endRowIndex": new_end},
                },
                "fields": "range",
            }
        }
    )
    if budget_tab in sheets:
        # XLSX import can resolve a named validation to a fixed A1 range.
        # Updating the name alone would then leave the picker at twelve months.
        requests.append(
            {
                "setDataValidation": {
                    "range": _range(sheets[budget_tab]["properties"]["sheetId"], 1, 2, 1, 2),
                    "rule": {
                        "condition": {
                            "type": "ONE_OF_RANGE",
                            "values": [
                                {"userEnteredValue": f"='{settings_tab}'!$I$2:$I${new_end}"},
                            ],
                        },
                        "strict": True,
                        "showCustomUi": True,
                    },
                }
            }
        )
    return requests, created
