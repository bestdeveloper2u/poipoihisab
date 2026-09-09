"""Rollover request contract; these assertions are not a live Google round trip."""

from copy import deepcopy

import pytest

from app.routers.sheets import _tab_name
from app.routers.sheets_years import SUMMARY, TemplateError, plan_years


def template():
    titles = [SUMMARY, "সেটিংস", "বাজেট", *[_tab_name(2026, m) for m in range(1, 13)]]
    metadata = {
        "sheets": [
            {
                "properties": {
                    "sheetId": i,
                    "title": title,
                    "gridProperties": {"rowCount": 203, "columnCount": 14, "hideGridlines": True},
                }
            }
            for i, title in enumerate(titles)
        ],
        "namedRanges": [
            {
                "name": "MonthTabs",
                "namedRangeId": "month-tabs",
                "range": {
                    "sheetId": 1,
                    "startRowIndex": 1,
                    "endRowIndex": 13,
                    "startColumnIndex": 8,
                    "endColumnIndex": 9,
                },
            }
        ],
    }
    summary = deepcopy(metadata["sheets"][0])
    summary["data"] = [
        {
            "rowData": [
                {
                    "values": [
                        {
                            "userEnteredValue": {
                                "formulaValue": f"='{_tab_name(2026, m)}'!$J$12",
                            }
                        }
                        for m in range(1, 13)
                    ]
                }
            ],
            "rowMetadata": [{"pixelSize": 34}],
            "columnMetadata": [{"pixelSize": 160}],
        }
    ]
    summary["charts"] = [
        {
            "chartId": 900,
            "spec": {
                "title": "Monthly totals",
                "basicChart": {
                    "domains": [
                        {
                            "domain": {
                                "sourceRange": {
                                    "sources": [
                                        {"sheetId": 0, "startRowIndex": 8, "endRowIndex": 9}
                                    ]
                                },
                            }
                        }
                    ],
                    "series": [
                        {
                            "series": {
                                "sourceRange": {
                                    "sources": [
                                        {"sheetId": 3, "startRowIndex": 3, "endRowIndex": 12},
                                    ]
                                }
                            }
                        }
                    ],
                },
            },
            "position": {
                "overlayPosition": {
                    "anchorCell": {"sheetId": 0, "rowIndex": 40, "columnIndex": 0},
                }
            },
        }
    ]
    registry = [["মাস"]] + [[_tab_name(2026, m)] for m in range(1, 13)]
    return metadata, summary, registry


def plan(years=(2027,), mutate=None):
    metadata, summary, registry = template()
    if mutate:
        mutate(metadata, summary, registry)
    return plan_years(metadata, summary, list(years), _tab_name, registry)


def test_new_year_is_complete_empty_and_does_not_mutate_source():
    metadata, summary, registry = template()
    original = deepcopy((metadata, summary, registry))
    requests, created = plan_years(metadata, summary, [2027], _tab_name, registry)
    assert (metadata, summary, registry) == original
    clones = [r["duplicateSheet"] for r in requests if "duplicateSheet" in r]
    assert [r["newSheetName"] for r in clones] == [_tab_name(2027, m) for m in range(1, 13)]
    assert len(created) == 13 and created[-1] == SUMMARY + " ২০২৭"
    new_ids = {r["newSheetId"] for r in clones}
    assert len(new_ids) == 12 and not new_ids & set(range(15))
    clears = [r["repeatCell"] for r in requests if "repeatCell" in r]
    assert len(clears) == 24
    for clear in clears:
        rng = clear["range"]
        assert rng["sheetId"] in new_ids
        assert (rng["startColumnIndex"], rng["endColumnIndex"]) in ((0, 3), (4, 7))
        assert (rng["startRowIndex"], rng["endRowIndex"]) == (3, 203)
        assert clear["cell"] == {} and clear["fields"] == "userEnteredValue,note"
    assert all("deleteSheet" not in r for r in requests)


@pytest.mark.parametrize("year,last", [(2027, 28), (2028, 29), (2100, 28), (2400, 29)])
def test_february_validation_uses_target_year_and_leap_day(year, last):
    requests, _ = plan((year,))
    rules = [r["setDataValidation"]["rule"] for r in requests if "setDataValidation" in r]
    assert rules[1]["condition"] == {
        "type": "DATE_BETWEEN",
        "values": [
            {"userEnteredValue": f"=DATE({year},2,1)"},
            {"userEnteredValue": f"=DATE({year},2,{last})"},
        ],
    }
    assert rules[1]["strict"]


def test_summary_formulas_charts_dimensions_and_picker_target_new_year():
    requests, _ = plan()
    props = next(r["addSheet"]["properties"] for r in requests if "addSheet" in r)
    summary_id = props["sheetId"]
    replacements = [r["findReplace"] for r in requests if "findReplace" in r]
    assert len(replacements) == 13
    assert all(r["sheetId"] == summary_id and r["includeFormulas"] for r in replacements)
    for m, request in enumerate(replacements[:12], 1):
        assert request["find"] == f"'{_tab_name(2026, m)}'!"
        assert request["replacement"] == f"'{_tab_name(2027, m)}'!"
    chart = next(r["addChart"]["chart"] for r in requests if "addChart" in r)
    assert "chartId" not in chart
    assert chart["position"]["overlayPosition"]["anchorCell"]["sheetId"] == summary_id
    basic = chart["spec"]["basicChart"]
    assert basic["domains"][0]["domain"]["sourceRange"]["sources"][0]["sheetId"] == summary_id
    january_id = requests[0]["duplicateSheet"]["newSheetId"]
    assert basic["series"][0]["series"]["sourceRange"]["sources"][0]["sheetId"] == january_id
    dimensions = [
        r["updateDimensionProperties"] for r in requests if "updateDimensionProperties" in r
    ]
    assert [r["properties"]["pixelSize"] for r in dimensions] == [34, 160]
    name = next(r["updateNamedRange"] for r in requests if "updateNamedRange" in r)
    assert name["namedRange"]["range"]["endRowIndex"] == 25
    picker = requests[-1]["setDataValidation"]
    assert picker["range"]["sheetId"] == 2
    assert picker["rule"]["condition"]["values"] == [{"userEnteredValue": "='সেটিংস'!$I$2:$I$25"}]
    # B2's value is not written: the owner's selected month remains selected.
    assert all(r.get("updateCells", {}).get("start", {}).get("sheetId") != 2 for r in requests)


def test_two_years_get_distinct_ids_and_one_registry_expansion():
    requests, created = plan((2027, 2028))
    ids = [r["duplicateSheet"]["newSheetId"] for r in requests if "duplicateSheet" in r]
    ids += [r["addSheet"]["properties"]["sheetId"] for r in requests if "addSheet" in r]
    assert len(set(ids)) == len(created) == 26
    names = [r["updateNamedRange"] for r in requests if "updateNamedRange" in r]
    assert len(names) == 1 and names[0]["namedRange"]["range"]["endRowIndex"] == 37


@pytest.mark.parametrize(
    "damage",
    [
        lambda m, s, r: m["sheets"].pop(),
        lambda m, s, r: m["sheets"].append({"properties": {"title": _tab_name(2027, 1)}}),
        lambda m, s, r: m["sheets"].append({"properties": {"title": SUMMARY + " ২০২৭"}}),
        lambda m, s, r: m["sheets"][3]["properties"]["gridProperties"].update(rowCount=100),
        lambda m, s, r: m["sheets"][3].update(charts=[{}]),
        lambda m, s, r: s.update(data=[]),
        lambda m, s, r: s["properties"].update(sheetId=999),
        lambda m, s, r: m.update(namedRanges=[]),
        lambda m, s, r: m["namedRanges"][0]["range"].update(startColumnIndex=7),
        lambda m, s, r: r.append(["Owner's note; do not overwrite"]),
        lambda m, s, r: r.__setitem__(1, ["=some_formula()"]),
        lambda m, s, r: r.__setitem__(1, r[2]),
        lambda m, s, r: s["charts"][0].update(position={"sheetId": 999}),
    ],
)
def test_modified_templates_refuse_before_requests_are_returned(damage):
    with pytest.raises(TemplateError):
        plan(mutate=damage)


def test_expense_only_template_does_not_require_budget_registry():
    def old(m, s, r):
        m["sheets"] = [sheet for sheet in m["sheets"] if sheet["properties"]["title"] != "বাজেট"]
        m["namedRanges"] = []

    requests, created = plan(mutate=old)
    assert len(created) == 13
    assert not any("updateNamedRange" in r for r in requests)


def test_registry_grows_grid_only_when_needed():
    requests, _ = plan(
        mutate=lambda m, s, r: m["sheets"][1]["properties"]["gridProperties"].update(rowCount=13)
    )
    assert next(r["appendDimension"] for r in requests if "appendDimension" in r) == {
        "sheetId": 1,
        "dimension": "ROWS",
        "length": 12,
    }


def test_rollover_batch_is_bounded():
    with pytest.raises(TemplateError, match="ten"):
        plan(range(2027, 2038))


@pytest.mark.parametrize("year", [1, 1899, 10000])
def test_date_function_cannot_silently_shift_early_years(year):
    with pytest.raises(TemplateError, match="1900"):
        plan((year,))


def test_no_new_years_is_a_noop():
    assert plan(()) == ([], [])


def test_new_month_does_not_inherit_manual_entries_beyond_sync_capacity():
    requests, _ = plan(
        mutate=lambda m, s, r: m["sheets"][3]["properties"]["gridProperties"].update(rowCount=1000)
    )
    clears = [r["repeatCell"]["range"] for r in requests if "repeatCell" in r]
    assert clears[0]["endRowIndex"] == clears[1]["endRowIndex"] == 1000
