"""Sheets export contract: mocked DB, credentials and HTTP; no external services."""

import importlib
import json
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import requests
from httpx import ASGITransport, AsyncClient
from test_sheets_years import template

from app.core.deps import get_current_user
from app.db.session import get_db
from app.main import create_app

URL = "/api/v1/export/sheets"
SHEET_ID = "1abc_DEF-1234567890abcdefghijklmnop"
OWNER = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


@pytest.fixture
async def api():
    app = create_app()
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=list)))
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=OWNER)
    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, db, app


@pytest.fixture
def google(monkeypatch, tmp_path):
    sheets = importlib.import_module("app.routers.sheets")
    path = tmp_path / "sa.json"
    path.write_text(json.dumps({"client_email": "export@example.iam.gserviceaccount.com"}))
    monkeypatch.setenv("poipoihisab_GOOGLE_SHEETS_SA_FILE", str(path))
    creds = Mock(token="test-token")
    factory = Mock(return_value=creds)
    monkeypatch.setattr(sheets.service_account.Credentials, "from_service_account_info", factory)
    http = Mock(return_value=SimpleNamespace(status_code=200, json=dict))
    monkeypatch.setattr(sheets.requests, "request", http)
    return sheets, creds, factory, http


def error(response, status, code):
    assert response.status_code == status, response.text
    detail = response.json()["detail"]
    assert detail["code"] == code
    assert set(detail) == {"code", "message_bn", "message_en"}
    assert detail["message_bn"] and detail["message_en"]


async def test_status_unconfigured(api, monkeypatch):
    monkeypatch.delenv("poipoihisab_GOOGLE_SHEETS_SA_FILE", raising=False)
    client, _, _ = api
    response = await client.get(URL + "/status")
    assert response.status_code == 200
    assert response.json() == {"configured": False, "sa_email": None}


async def test_status_configured(api, google):
    client, db, _ = api
    assert (await client.get(URL + "/status")).json() == {
        "configured": True,
        "sa_email": "export@example.iam.gserviceaccount.com",
    }
    google[1].refresh.assert_not_called()
    google[3].assert_not_called()
    db.execute.assert_not_called()


@pytest.mark.parametrize("content", ["not-json", "[]", "null"])
async def test_bad_credentials_status(api, google, monkeypatch, tmp_path, content):
    path = tmp_path / "bad.json"
    path.write_text(content)
    monkeypatch.setenv("poipoihisab_GOOGLE_SHEETS_SA_FILE", str(path))
    assert (await api[0].get(URL + "/status")).json() == {"configured": False, "sa_email": None}


async def test_status_readable_json_without_email(api, google, tmp_path, monkeypatch):
    path = tmp_path / "no-email.json"
    path.write_text("{}")
    monkeypatch.setenv("poipoihisab_GOOGLE_SHEETS_SA_FILE", str(path))
    assert (await api[0].get(URL + "/status")).json() == {"configured": True, "sa_email": None}


async def test_missing_file_and_library(api, google, monkeypatch):
    monkeypatch.setenv("poipoihisab_GOOGLE_SHEETS_SA_FILE", "/does/not/exist")
    assert not (await api[0].get(URL + "/status")).json()["configured"]
    monkeypatch.setattr(google[0], "service_account", None)
    error(await api[0].post(URL, json={"sheet_id": SHEET_ID}), 503, "sheets_unconfigured")


async def test_unconfigured_post(api, monkeypatch):
    monkeypatch.delenv("poipoihisab_GOOGLE_SHEETS_SA_FILE", raising=False)
    error(await api[0].post(URL, json={"sheet_id": SHEET_ID}), 503, "sheets_unconfigured")
    api[1].execute.assert_not_called()


@pytest.mark.parametrize(
    "reference",
    [
        "",
        "abc/def",
        "../secret",
        "https://evil.test/spreadsheets/d/" + SHEET_ID,
        "https://docs.google.com.evil.test/spreadsheets/d/" + SHEET_ID,
        "https://user@docs.google.com/spreadsheets/d/" + SHEET_ID,
        "http://docs.google.com/spreadsheets/d/" + SHEET_ID,
        "https://docs.google.com:444/spreadsheets/d/" + SHEET_ID,
        "https://docs.google.com/spreadsheets/d/abc%2Fdef/edit",
        "https://docs.google.com/document/d/" + SHEET_ID,
    ],
)
async def test_invalid_reference(api, google, reference):
    error(await api[0].post(URL, json={"sheet_id": reference}), 422, "sheets_invalid_sheet")
    google[3].assert_not_called()


@pytest.mark.parametrize(
    "month", ["2026-00", "2026-13", "2026-2", "0000-01", "2026-02-01", "bad", "２０２６-０９"]
)
async def test_invalid_month(api, google, month):
    error(
        await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": month}),
        422,
        "sheets_invalid_month",
    )
    google[3].assert_not_called()


SEPT = "সেপ্টেম্বর ২০২৬"
AUG = "আগস্ট ২০২৬"
DEBTS = "ধার-দেনা"
BUDGET = "বাজেট"
RECUR = "পুনরাবৃত্ত খরচ"
LEDGER = (DEBTS, BUDGET, RECUR)


def result(**overrides):
    """The response body, defaulted to a workbook with no ledger tabs.

    A helper rather than a literal in every assertion: adding a field to the
    contract should touch one line, not every full-body comparison — and a
    full-body comparison is what catches a field silently disappearing.
    """
    return {
        "rows": 0,
        "months": [],
        "unmapped": [],
        "debts": 0,
        "budget_categories": 0,
        "recurring": 0,
        "skipped_tabs": list(LEDGER),
        "created_tabs": [],
    } | overrides


def sheet_meta(*titles):
    return {"sheets": [{"properties": {"title": t}} for t in titles]}


def page(*records):
    """One DB result page — what ``execute().all()`` returns."""
    return SimpleNamespace(all=lambda: list(records))


def single(record):
    """One DB result row — what ``execute().first()`` returns."""
    return SimpleNamespace(first=lambda: record)


def debt(iso, party, direction, amount, note=None, settled=None):
    return (date.fromisoformat(iso), party, direction, Decimal(amount), note, settled)


def rule(cat, amount, freq, start, following, *, pay="cash", desc=None, active=True):
    return (
        cat,
        Decimal(amount),
        pay,
        desc,
        freq,
        date.fromisoformat(start),
        date.fromisoformat(following),
        active,
    )


def responses(*payloads):
    return [SimpleNamespace(status_code=200, json=lambda p=p: p) for p in payloads]


def written(http):
    """The single values:batchUpdate body, keyed by A1 range."""
    call = next(c for c in http.call_args_list if c.args[1].endswith("/values:batchUpdate"))
    assert call.kwargs["json"]["valueInputOption"] == "USER_ENTERED"
    return {entry["range"]: entry["values"] for entry in call.kwargs["json"]["data"]}


def rollover_fixture():
    metadata, summary, registry = template()
    # Expense-only fixture keeps the database queue focused on expenses.
    metadata["sheets"] = [s for s in metadata["sheets"] if s["properties"]["title"] != BUDGET]
    return metadata, summary, registry


async def test_new_year_sync_creates_structure_before_writing_values(api, google):
    metadata, summary, registry = rollover_fixture()
    client, db, _ = api
    row = (date(2027, 2, 1), None, "food", "চা", Decimal("42.00"), "cash", uuid.uuid4())
    db.execute.side_effect = [page(row), page()]
    http = google[3]
    http.side_effect = responses(metadata, {}, {"sheets": [summary]}, {"values": registry}, {}, {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2027-02"})
    assert response.status_code == 200, response.text
    assert response.json()["rows"] == 1
    assert len(response.json()["created_tabs"]) == 13
    posts = [c for c in http.call_args_list if c.args[0] == "POST"]
    assert len(posts) == 2
    assert posts[0].args[1].endswith(SHEET_ID + ":batchUpdate")
    assert posts[1].args[1].endswith("/values:batchUpdate")
    assert written(http)[f"'{google[0]._tab_name(2027, 2)}'!E4:F203"][0] == ["42.00", "নগদ টাকা"]


@pytest.mark.parametrize("stage", [2, 3, 4, 5])
async def test_rollover_remote_failure_does_not_continue_or_rollback(api, google, stage):
    metadata, summary, registry = rollover_fixture()
    http = google[3]
    http.side_effect = responses(metadata, {}, {"sheets": [summary]}, {"values": registry}, {}, {})[:stage] + [
        SimpleNamespace(status_code=500),
    ]
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2027-02"})
    error(response, 502, "sheets_upstream_error")
    assert len(http.call_args_list) == stage + 1
    # Do not delete newly created tabs on an ambiguous timeout: the write may
    # actually have committed. A retry reads metadata again before proceeding.
    assert not any("deleteSheet" in str(c.kwargs) for c in http.call_args_list)


async def test_retry_after_rollover_does_not_duplicate_or_clear_new_comments(api, google):
    metadata, _, _ = rollover_fixture()
    for i, title in enumerate([
        *[google[0]._tab_name(2027, m) for m in range(1, 13)], "বার্ষিক সারসংক্ষেপ ২০২৭",
    ], 50):
        metadata["sheets"].append({"properties": {"sheetId": i, "title": title}})
    http = google[3]
    http.side_effect = responses(metadata, {}, {})
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2027-02"})
    assert response.status_code == 200, response.text
    assert response.json()["created_tabs"] == []
    posts = [c for c in http.call_args_list if c.args[0] == "POST"]
    assert len(posts) == 1 and posts[0].args[1].endswith("/values:batchUpdate")
    assert all("G" not in r.split("!")[1] for r in written(http))


async def test_full_new_year_month_refuses_before_creating_any_tabs(api, google):
    metadata, _, _ = rollover_fixture()
    row = (date(2027, 2, 1), None, "food", "চা", Decimal("1.00"), "cash", uuid.uuid4())
    api[1].execute.side_effect = [page(*([row] * 201)), page()]
    google[3].side_effect = responses(metadata)
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2027-02"})
    error(response, 409, "sheets_month_full")
    assert len(google[3].call_args_list) == 1


async def test_full_ledger_refuses_before_creating_new_year(api, google):
    metadata, _, _ = rollover_fixture()
    metadata["sheets"].append({"properties": {"sheetId": 99, "title": DEBTS}})
    api[1].execute.side_effect = [page(), page(*([debt("2026-01-01", "person", "lend", "1")] * 101))]
    google[3].side_effect = responses(metadata, {})
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2027-02"})
    error(response, 409, "sheets_ledger_full")
    assert not any(c.args[0] == "POST" for c in google[3].call_args_list)


async def test_partial_year_refuses_to_rebuild_a_missing_month(api, google):
    metadata, summary, registry = rollover_fixture()
    metadata["sheets"].append({"properties": {"sheetId": 99, "title": google[0]._tab_name(2027, 2)}})
    google[3].side_effect = responses(metadata, {}, {"sheets": [summary]}, {"values": registry})
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2027-03"})
    error(response, 409, "sheets_year_template_invalid")
    assert not any(c.args[0] == "POST" for c in google[3].call_args_list)


async def test_writes_into_the_month_tab_in_sheet_column_order(api, google):
    """The workbook is date · desc · CATEGORY · group(formula) · amount · pay.

    The CSV this reuses is date · desc · GROUP · CATEGORY. Getting that wrong
    put the group in the category dropdown and overwrote the formula.
    """
    client, db, _ = api
    _, _creds, _factory, http = google
    rows = [
        (date(2026, 9, 7), "চা নাশতা", "food", "চা ও কফি", Decimal("120.50"), "bkash", uuid.uuid4()),
        (date(2026, 9, 8), None, "transport", "রিকশা / সিএনজি", Decimal("40.00"), "card", uuid.uuid4()),
    ]
    db.execute.side_effect = [SimpleNamespace(all=lambda: rows), SimpleNamespace(all=list)]
    http.side_effect = responses(
        sheet_meta(SEPT, "সেটিংস"),
        {"values": [["চা ও কফি", "রিকশা / সিএনজি"]]},
        {},
        {},
    )

    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.status_code == 200, response.text
    assert response.json() == result(rows=2, months=[SEPT])

    data = written(http)
    # Column D is untouched in both ranges — it is the sheet's group lookup.
    assert data[f"'{SEPT}'!A4:C203"][:2] == [
        ["2026-09-07", "চা নাশতা", "চা ও কফি"],
        ["2026-09-08", "", "রিকশা / সিএনজি"],
    ]
    assert data[f"'{SEPT}'!E4:F203"][:2] == [["120.50", "বিকাশ"], ["40.00", "ডেবিট / ক্রেডিট কার্ড"]]
    assert not any("D" in rng.split("!")[1] for rng in data)


async def test_amount_is_a_number_not_bengali_digits(api, google):
    """Bengali numerals arrive as text and every SUM on the sheet skips them."""
    client, db, _ = api
    _, _c, _f, http = google
    row = (date(2026, 9, 1), None, "food", "চা", Decimal("9999999999.99"), "cash", uuid.uuid4())
    db.execute.side_effect = [SimpleNamespace(all=lambda: [row]), SimpleNamespace(all=list)]
    http.side_effect = responses(sheet_meta(SEPT), {}, {})
    assert (await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})).status_code == 200
    amount = written(http)[f"'{SEPT}'!E4:F203"][0][0]
    assert amount == "9999999999.99"
    assert not any(ch in amount for ch in "০১২৩৪৫৬৭৮৯")


async def test_sync_replaces_the_month_instead_of_appending(api, google):
    client, db, _ = api
    _, _c, _f, http = google
    row = (date(2026, 9, 1), None, "food", "চা", Decimal("5.00"), "cash", uuid.uuid4())
    db.execute.side_effect = [SimpleNamespace(all=lambda: [row]), SimpleNamespace(all=list)]
    http.side_effect = responses(sheet_meta(SEPT), {}, {})
    await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    # One write replaces every owned cell, including stale trailing rows.
    data = written(http)
    assert set(data) == {f"'{SEPT}'!A4:C203", f"'{SEPT}'!E4:F203"}
    assert data[f"'{SEPT}'!A4:C203"][1:] == [["", "", ""]] * 199
    assert data[f"'{SEPT}'!E4:F203"][1:] == [["", ""]] * 199
    writes = [c for c in http.call_args_list if c.args[0] == "POST"]
    assert len(writes) == 1
    assert writes[0].args[1].endswith("/values:batchUpdate")
    assert not any(c.args[1].endswith(":append") for c in http.call_args_list)


async def test_an_emptied_month_is_cleared_even_with_no_rows(api, google):
    client, _db, _ = api
    _, _c, _f, http = google
    http.side_effect = responses(sheet_meta(SEPT), {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.json() == result(months=[SEPT])
    assert written(http) == {
        f"'{SEPT}'!A4:C203": [["", "", ""]] * 200,
        f"'{SEPT}'!E4:F203": [["", ""]] * 200,
    }


async def test_syncing_everything_splits_rows_across_month_tabs(api, google):
    client, db, _ = api
    _, _c, _f, http = google
    rows = [
        (date(2026, 8, 31), None, "food", "চা", Decimal("1.00"), "cash", uuid.uuid4()),
        (date(2026, 9, 1), None, "food", "চা", Decimal("2.00"), "cash", uuid.uuid4()),
    ]
    db.execute.side_effect = [SimpleNamespace(all=lambda: rows), SimpleNamespace(all=list)]
    http.side_effect = responses(sheet_meta(AUG, SEPT), {}, {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    assert response.json()["months"] == [AUG, SEPT]
    data = written(http)
    assert data[f"'{AUG}'!A4:C203"][0][0] == "2026-08-31"
    assert data[f"'{SEPT}'!A4:C203"][0][0] == "2026-09-01"


async def test_missing_month_tab_refuses_before_writing(api, google):
    """An incomplete custom workbook refuses before writing."""
    client, db, _ = api
    _, _c, _f, http = google
    row = (date(2026, 9, 1), None, "food", "চা", Decimal("5.00"), "cash", uuid.uuid4())
    db.execute.side_effect = [SimpleNamespace(all=lambda: [row]), SimpleNamespace(all=list)]
    http.side_effect = responses(sheet_meta("CustomTab"))
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    error(response, 409, "sheets_missing_month_tab")
    assert SEPT in response.json()["detail"]["message_bn"]
    assert len(http.call_args_list) == 1  # metadata only; nothing written


async def test_uninitialized_sheet_bootstraps_full_template_and_syncs(api, google):
    """A blank spreadsheet (Sheet1) is automatically bootstrapped with the 2026 template."""
    client, db, _ = api
    _, _c, _f, http = google
    row = (date(2026, 9, 1), None, "food", "চা", Decimal("5.00"), "cash", uuid.uuid4())
    db.execute.side_effect = [
        page(row),
        page(),
        page(),
        page(),
        single(None),
    ]
    from app.routers.sheets_bootstrap import (
        BN_MONTHS,
        SETTINGS,
        SUMMARY,
        TAB_BUDGET,
        TAB_DEBTS,
        TAB_RECURRING,
    )
    all_months = [f"{m} ২০২৬" for m in BN_MONTHS]
    created = [SUMMARY, TAB_RECURRING, TAB_DEBTS, TAB_BUDGET, SETTINGS, *all_months]
    http.side_effect = responses(
        {"sheets": [{"properties": {"title": "Sheet1", "sheetId": 0}}]},
        {},
        {},
        sheet_meta(*created),
        {"values": [["চা", "ডাল"]]},
        {},
    )
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["rows"] == 1
    assert SEPT in data["months"]
    assert len(data["created_tabs"]) > 0


async def test_uninitialized_sheet_bootstraps_english_template_for_english_user(api, google):
    """When user.lang == 'en', a blank sheet is bootstrapped with English tabs and headers."""
    client, db, app = api
    _, _c, _f, http = google
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=OWNER, lang="en")
    row = (date(2026, 9, 1), None, "food", "Tea", Decimal("5.00"), "cash", uuid.uuid4())
    db.execute.side_effect = [
        page(row),
        page(),
        page(),
        page(),
        single(None),
    ]
    from app.routers.sheets_locale import LOCALE_EN
    all_months = [f"{m} 2026" for m in LOCALE_EN.months]
    created = [
        LOCALE_EN.tab_summary,
        LOCALE_EN.tab_recurring,
        LOCALE_EN.tab_debts,
        LOCALE_EN.tab_budget,
        LOCALE_EN.tab_settings,
        *all_months,
    ]
    http.side_effect = responses(
        {"sheets": [{"properties": {"title": "Sheet1", "sheetId": 0}}]},
        {},
        {},
        sheet_meta(*created),
        {"values": [["Tea", "Coffee"]]},
        {},
    )
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["rows"] == 1
    assert "September 2026" in data["months"]
    assert "Settings" in data["created_tabs"]
    assert "Annual Summary" in data["created_tabs"]
    assert "Debts" in data["created_tabs"]
    assert "Budget" in data["created_tabs"]
    assert "Recurring Expenses" in data["created_tabs"]


def test_bootstrap_structural_includes_full_visual_styling():
    """Verify that build_bootstrap_structural creates requests for titles, headers, widths, and borders."""
    from app.routers.sheets_bootstrap import build_bootstrap_structural
    requests, delete_id, created_tabs = build_bootstrap_structural(
        {"sheets": [{"properties": {"sheetId": 0, "title": "Sheet1"}}]}
    )
    assert delete_id == 0
    assert len(created_tabs) == 17
    add_sheets = [r["addSheet"] for r in requests if "addSheet" in r]
    merges = [r["mergeCells"] for r in requests if "mergeCells" in r]
    repeats = [r["repeatCell"] for r in requests if "repeatCell" in r]
    dimensions = [r["updateDimensionProperties"] for r in requests if "updateDimensionProperties" in r]
    borders = [r["updateBorders"] for r in requests if "updateBorders" in r]

    assert len(add_sheets) == 17
    for s in add_sheets:
        assert s["properties"]["gridProperties"]["frozenRowCount"] in (1, 3)
        assert s["properties"]["tabColor"]["red"] == 0.122

    assert len(merges) >= 16
    assert len(repeats) > 0
    assert len(dimensions) > 0
    assert len(borders) >= 16


async def test_a_full_month_refuses_rather_than_truncating(api, google):
    client, db, _ = api
    _, _c, _f, http = google
    rows = [
        (date(2026, 9, 1), None, "food", "চা", Decimal("1.00"), "cash", uuid.uuid4())
        for _ in range(201)
    ]
    db.execute.side_effect = [SimpleNamespace(all=lambda: rows), SimpleNamespace(all=list)]
    http.side_effect = responses(sheet_meta(SEPT))
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    error(response, 409, "sheets_month_full")
    assert "201" in response.json()["detail"]["message_bn"]
    assert len(http.call_args_list) == 1


async def test_unmapped_categories_are_reported_not_rewritten(api, google):
    """The sheet's own reconciliation line names the amount; guessing a group
    would silently file money under the wrong heading."""
    client, db, _ = api
    _, _c, _f, http = google
    rows = [
        (date(2026, 9, 1), None, "transport", "রিক্সা", Decimal("250.00"), "cash", uuid.uuid4()),
        (date(2026, 9, 2), None, "food", "চা ও কফি", Decimal("30.00"), "cash", uuid.uuid4()),
    ]
    db.execute.side_effect = [SimpleNamespace(all=lambda: rows), SimpleNamespace(all=list)]
    http.side_effect = responses(
        sheet_meta(SEPT, "সেটিংস"),
        {"values": [["চা ও কফি", "রিকশা / সিএনজি"]]},
        {},
        {},
    )
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.json()["unmapped"] == ["রিক্সা"]
    # The row is still written, verbatim.
    assert written(http)[f"'{SEPT}'!A4:C203"][0][2] == "রিক্সা"


@pytest.mark.parametrize("stage", [0, 1, 2])
@pytest.mark.parametrize(
    "status,expected,code",
    [
        (403, 403, "sheets_permission_denied"),
        (500, 502, "sheets_upstream_error"),
        (404, 502, "sheets_upstream_error"),
        (302, 502, "sheets_upstream_error"),
    ],
)
async def test_google_errors(api, google, stage, status, expected, code):
    api[1].execute.side_effect = [
        SimpleNamespace(
            all=lambda: [
                (date(2026, 9, 1), None, "food", "চা", Decimal("5.00"), "cash", uuid.uuid4())
            ]
        ),
        SimpleNamespace(all=list),
    ]
    # Fail metadata, category-list reading, and the single replacement write.
    google[3].side_effect = responses(sheet_meta(SEPT, "সেটিংস"), {})[:stage] + [
        SimpleNamespace(status_code=status)
    ]
    error(
        await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"}), expected, code
    )


async def test_network_timeout(api, google):
    google[3].side_effect = requests.Timeout("private upstream details")
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID})
    error(response, 502, "sheets_upstream_error")
    assert "private" not in response.text


async def test_refresh_failure(api, google):
    from google.auth.exceptions import RefreshError

    google[1].refresh.side_effect = RefreshError("private key details")
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID})
    error(response, 502, "sheets_upstream_error")
    assert "private" not in response.text
    google[3].assert_not_called()


@pytest.mark.parametrize("metadata", [[], {"sheets": None}, {"sheets": [{}]}])
async def test_malformed_google_metadata(api, google, metadata):
    google[3].return_value = SimpleNamespace(status_code=200, json=lambda: metadata)
    error(await api[0].post(URL, json={"sheet_id": SHEET_ID}), 502, "sheets_upstream_error")


async def test_invalid_key_is_unconfigured(api, google):
    google[2].side_effect = ValueError("secret key contents")
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID})
    error(response, 503, "sheets_unconfigured")
    assert "secret" not in response.text


async def test_refresh_transport_has_timeout(api, google, monkeypatch):
    transport = Mock()
    monkeypatch.setattr(google[0].Request, "__call__", transport)
    google[1].refresh.side_effect = lambda request: request("https://oauth2.googleapis.com/token")
    assert (await api[0].post(URL, json={"sheet_id": SHEET_ID})).status_code == 200
    assert transport.call_args.kwargs["timeout"] == (5, 30)


@pytest.mark.parametrize("text", ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "\n=1", "  =1"])
async def test_every_text_column_is_formula_safe(api, google, text):
    row = (date(2026, 9, 1), text, "food", text, Decimal("12.30"), text, uuid.uuid4())
    api[1].execute.side_effect = [SimpleNamespace(all=lambda: [row]), SimpleNamespace(all=list)]
    google[3].side_effect = responses(sheet_meta(SEPT), {}, {})
    assert (
        await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    ).json()["rows"] == 1
    data = written(google[3])
    assert data[f"'{SEPT}'!A4:C203"][0][1] == "'" + text   # বিবরণ
    assert data[f"'{SEPT}'!A4:C203"][0][2] == "'" + text   # খাত
    # An unknown payment string falls through the map and must still be defused.
    assert data[f"'{SEPT}'!E4:F203"][0][1] == "'" + text


async def test_many_db_pages_become_one_write(api, google):
    """Keyset pagination yields several chunks; the sheet is written once."""
    row = (date(9999, 12, 31), "চা", "food", "চা", Decimal("1.00"), "cash", uuid.uuid4())
    api[1].execute.side_effect = [SimpleNamespace(all=lambda: [row])] * 2 + [
        SimpleNamespace(all=list)
    ]
    tab = "ডিসেম্বর ৯৯৯৯"
    google[3].side_effect = responses(sheet_meta(tab), {}, {})
    assert (
        await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "9999-12"})
    ).json()["rows"] == 2
    updates = [
        c for c in google[3].call_args_list if c.args[1].endswith("/values:batchUpdate")
    ]
    assert len(updates) == 1
    assert written(google[3])[f"'{tab}'!A4:C203"][:2] == [
        ["9999-12-31", "চা", "চা"],
        ["9999-12-31", "চা", "চা"],
    ]


# ── The whole-state ledger tabs ────────────────────────────────────────────
# The DB mock is a plain side-effect queue, so these tests also pin the ORDER
# the endpoint queries in: expense pages first (the last one empty), then
# debts, then recurring rules, then the budget.


async def test_debts_land_in_the_columns_the_sheet_does_not_compute(api, google):
    """F (অবস্থা) is the sheet's own formula over the settle date.

    Writing it here would let the column and the summary panel disagree, which
    is the class of bug column D already cost this integration once.
    """
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(
            debt("2026-08-02", "করিম", "lend", "5000.00", "নগদে দিয়েছি"),
            debt(
                "2026-07-11",
                "মুদি দোকান",
                "borrow",
                "800.00",
                settled=datetime(2026, 8, 30, 19, 45, tzinfo=UTC),
            ),
        ),
        page(),
        single(None),
    ]
    http.side_effect = responses(sheet_meta(*LEDGER), {})

    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    assert response.json() == result(debts=2, skipped_tabs=[])

    data = written(http)
    assert data[f"'{DEBTS}'!A4:E103"][:2] == [
        ["2026-08-02", "করিম", "ধার দিয়েছি", "5000.00", "নগদে দিয়েছি"],
        ["2026-07-11", "মুদি দোকান", "ধার নিয়েছি", "800.00", ""],
    ]
    # The settle date is the date part only, and an open debt clears the cell.
    assert data[f"'{DEBTS}'!G4:G103"][:2] == [[""], ["2026-08-30"]]
    assert not any(
        rng.startswith(f"'{DEBTS}'") and "F" in rng.split("!")[1] for rng in data
    )


async def test_recurring_rules_skip_the_group_and_monthly_equivalent(api, google):
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(),
        page(
            rule("বাড়ি ভাড়া", "12000.00", "monthly", "2026-01-05", "2026-10-05", pay="bank"),
            rule("চা ও কফি", "60.00", "daily", "2026-02-01", "2026-09-10", active=False),
        ),
        single(None),
    ]
    http.side_effect = responses(sheet_meta(*LEDGER), {})

    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    assert response.json() == result(recurring=2, skipped_tabs=[])

    data = written(http)
    assert data[f"'{RECUR}'!A4:A103"][:2] == [["বাড়ি ভাড়া"], ["চা ও কফি"]]
    assert data[f"'{RECUR}'!C4:I103"][:2] == [
        ["12000.00", "ব্যাংক ট্রান্সফার", "", "প্রতি মাসে", "2026-01-05", "2026-10-05", "চালু"],
        ["60.00", "নগদ টাকা", "", "প্রতিদিন", "2026-02-01", "2026-09-10", "বন্ধ"],
    ]
    # B (গ্রুপ) and J (মাসিক সমমান) are between and beyond the two spans.
    spans = {rng.split("!")[1] for rng in data if rng.startswith(f"'{RECUR}'")}
    assert spans == {"A4:A103", "C4:I103"}


async def test_budget_rows_follow_the_settings_sheet_order(api, google):
    """A JSON map has no order worth trusting; সেটিংস does."""
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(),
        page(),
        single((Decimal("30000.00"), {"মাছ": 4000, "চাল": "2000.5", "বাড়ি ভাড়া": 12000})),
    ]
    http.side_effect = responses(
        sheet_meta(*LEDGER, "সেটিংস"),
        {"values": [["চাল", "মাছ", "বাড়ি ভাড়া"]]},
        {},
    )

    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    assert response.json() == result(budget_categories=3, skipped_tabs=[])

    data = written(http)
    assert data[f"'{BUDGET}'!A4:B53"][:3] == [
        ["চাল", "2000.50"],
        ["মাছ", "4000.00"],
        ["বাড়ি ভাড়া", "12000.00"],
    ]
    assert data[f"'{BUDGET}'!D2"] == [["30000.00"]]


async def test_a_budget_category_the_workbook_lacks_sorts_last_and_is_named(api, google):
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(),
        page(rule("রিক্সা", "50.00", "daily", "2026-01-01", "2026-09-01")),
        single((Decimal("500.00"), {"অচেনা খাত": 100, "চাল": 400})),
    ]
    http.side_effect = responses(
        sheet_meta(*LEDGER, "সেটিংস"), {"values": [["চাল", "মাছ"]]}, {}
    )
    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    # Both the recurring rule's category and the budget row's are checked, not
    # only the expenses' — each leaves its গ্রুপ blank the same way.
    assert response.json()["unmapped"] == ["অচেনা খাত", "রিক্সা"]
    assert written(http)[f"'{BUDGET}'!A4:B53"][:2] == [["চাল", "400.00"], ["অচেনা খাত", "100.00"]]


@pytest.mark.parametrize("limit", ["", "abc", None, True, [], {"a": 1}, "NaN", "Infinity", "-1"])
async def test_an_unparseable_budget_limit_is_dropped_not_written(api, google, limit):
    """`cats` is free-form JSON. A limit the sheet cannot divide by would
    poison that row's ব্যবহার and অবস্থা without saying so."""
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(),
        page(),
        single((Decimal("100.00"), {"চাল": limit, "মাছ": 40})),
    ]
    http.side_effect = responses(sheet_meta(*LEDGER), {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    assert response.json()["budget_categories"] == 1
    assert written(http)[f"'{BUDGET}'!A4:B53"][0] == ["মাছ", "40.00"]


async def test_ledger_tabs_are_refreshed_by_a_single_month_sync_too(api, google):
    """`month` narrows which expense months are touched, nothing else.

    Refreshing the ledger only on a full sync would leave the sheet
    trustworthy only after the right kind of sync, with nothing on the sheet
    to say which kind was run last.
    """
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(debt("2026-01-02", "করিম", "lend", "10.00")),
        page(),
        single(None),
    ]
    http.side_effect = responses(sheet_meta(SEPT, *LEDGER), {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.json() == result(months=[SEPT], debts=1, skipped_tabs=[])
    assert f"'{DEBTS}'!A4:E103" in written(http)


async def test_a_workbook_without_ledger_tabs_still_syncs_its_months(api, google):
    """An older copy of the template is not a broken one. Refusing here would
    break the expense sync this integration already promises."""
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page((date(2026, 9, 1), None, "food", "চা", Decimal("5.00"), "cash", uuid.uuid4())),
        page(),
    ]
    http.side_effect = responses(sheet_meta(SEPT), {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID, "month": "2026-09"})
    assert response.json() == result(rows=1, months=[SEPT])
    assert set(written(http)) == {f"'{SEPT}'!A4:C203", f"'{SEPT}'!E4:F203"}
    # Two expense pages and no ledger query: a skipped tab costs nothing.
    assert db.execute.await_count == 2


async def test_emptied_ledger_tabs_are_cleared(api, google):
    """Deleting the last debt in the app has to delete it from the sheet."""
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [page(), page(), page(), single(None)]
    http.side_effect = responses(sheet_meta(*LEDGER), {})
    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    assert response.json() == result(skipped_tabs=[])
    data = written(http)
    assert data[f"'{DEBTS}'!A4:E103"] == [[""] * 5] * 100
    assert data[f"'{DEBTS}'!G4:G103"] == [[""]] * 100
    assert data[f"'{BUDGET}'!A4:B53"] == [[""] * 2] * 50
    assert data[f"'{BUDGET}'!D2"] == [[""]]
    assert data[f"'{RECUR}'!A4:A103"] == [[""]] * 100
    assert data[f"'{RECUR}'!C4:I103"] == [[""] * 7] * 100


@pytest.mark.parametrize(
    "which,records,limit",
    [
        (DEBTS, [debt("2026-01-01", "ক", "lend", "1.00")] * 101, 100),
        (RECUR, [rule("চাল", "1.00", "monthly", "2026-01-01", "2026-02-01")] * 101, 100),
    ],
)
async def test_a_full_ledger_sheet_refuses_before_writing(api, google, which, records, limit):
    """A ledger sheet holding 100 of 101 records reads as the whole ledger."""
    client, db, _ = api
    _, _c, _f, http = google
    queued = {
        DEBTS: [page(*records), page(), single(None)],
        RECUR: [page(), page(*records), single(None)],
    }[which]
    db.execute.side_effect = [page(), *queued]
    http.side_effect = responses(sheet_meta(*LEDGER))
    response = await client.post(URL, json={"sheet_id": SHEET_ID})
    error(response, 409, "sheets_ledger_full")
    assert f"{which}: 101 / {limit}" in response.json()["detail"]["message_bn"]
    assert len(http.call_args_list) == 1  # metadata only; nothing written


async def test_syncing_the_ledger_twice_writes_the_same_thing(api, google):
    client, db, _ = api
    _, _c, _f, http = google

    def queue():
        return [
            page(),
            page(debt("2026-08-02", "করিম", "lend", "5000.00")),
            page(rule("বাড়ি ভাড়া", "12000.00", "monthly", "2026-01-05", "2026-10-05")),
            single((Decimal("30000.00"), {"চাল": 2000})),
        ]

    db.execute.side_effect = queue()
    http.side_effect = responses(sheet_meta(*LEDGER), {})
    first = await client.post(URL, json={"sheet_id": SHEET_ID})
    before = written(http)

    http.reset_mock()
    db.execute.side_effect = queue()
    http.side_effect = responses(sheet_meta(*LEDGER), {})
    second = await client.post(URL, json={"sheet_id": SHEET_ID})

    assert first.json() == second.json()
    assert written(http) == before
    assert not any(c.args[1].endswith(":append") for c in http.call_args_list)


async def test_ledger_amounts_are_numbers_not_bengali_digits(api, google):
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(debt("2026-08-02", "করিম", "lend", "1234.50")),
        page(rule("চাল", "99.05", "monthly", "2026-01-01", "2026-02-01")),
        single((Decimal("30000.00"), {"চাল": 2000})),
    ]
    http.side_effect = responses(sheet_meta(*LEDGER), {})
    await client.post(URL, json={"sheet_id": SHEET_ID})
    data = written(http)
    figures = [
        data[f"'{DEBTS}'!A4:E103"][0][3],
        data[f"'{RECUR}'!C4:I103"][0][0],
        data[f"'{BUDGET}'!A4:B53"][0][1],
        data[f"'{BUDGET}'!D2"][0][0],
    ]
    assert figures == ["1234.50", "99.05", "2000.00", "30000.00"]
    assert not any(ch in figure for figure in figures for ch in "০১২৩৪৫৬৭৮৯")


@pytest.mark.parametrize("text", ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "  =1"])
async def test_every_ledger_text_column_is_formula_safe(api, google, text):
    client, db, _ = api
    _, _c, _f, http = google
    db.execute.side_effect = [
        page(),
        page(debt("2026-08-02", text, "lend", "1.00", text)),
        page(rule(text, "1.00", "monthly", "2026-01-01", "2026-02-01", pay=text, desc=text)),
        single((Decimal("1.00"), {text: 1})),
    ]
    http.side_effect = responses(sheet_meta(*LEDGER), {})
    await client.post(URL, json={"sheet_id": SHEET_ID})
    data = written(http)
    entry = data[f"'{DEBTS}'!A4:E103"][0]
    assert entry[1] == entry[4] == "'" + text                        # পক্ষ, নোট
    assert data[f"'{RECUR}'!A4:A103"][0][0] == "'" + text            # খাত
    assert data[f"'{RECUR}'!C4:I103"][0][1] == "'" + text            # unknown pay
    assert data[f"'{RECUR}'!C4:I103"][0][2] == "'" + text            # বিবরণ
    assert data[f"'{BUDGET}'!A4:B53"][0][0] == "'" + text            # খাত


async def test_openapi_uses_requested_sheet_field(api):
    schema = api[2].openapi()["components"]["schemas"]["SheetsExportRequest"]
    assert "sheet" in schema["properties"]
    assert schema["required"] == ["sheet"]


async def test_auth_required(api):
    client, _, app = api
    del app.dependency_overrides[get_current_user]
    assert (await client.get(URL + "/status")).status_code == 401
    assert (await client.post(URL, json={"sheet_id": SHEET_ID})).status_code == 401
