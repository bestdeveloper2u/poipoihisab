"""Sheets export contract: mocked DB, credentials and HTTP; no external services."""

import importlib
import json
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import requests
from httpx import ASGITransport, AsyncClient

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


@pytest.mark.parametrize("existing", [False, True])
async def test_export_create_or_existing_tab(api, google, existing):
    client, db, _ = api
    _, creds, factory, http = google
    rows = [
        (
            date(2026, 9, 7),
            '=IMPORTXML("evil")',
            "food",
            "চা",
            Decimal("9999999999.99"),
            "cash",
            uuid.uuid4(),
        ),
        (date(2026, 9, 8), None, "food", " \t=1+1", Decimal("0.10"), "cash", uuid.uuid4()),
    ]
    db.execute.side_effect = [SimpleNamespace(all=lambda: rows), SimpleNamespace(all=list)]
    metadata = {"sheets": [{"properties": {"title": "Poi Poi Hisab" if existing else "Other"}}]}
    http.side_effect = [SimpleNamespace(status_code=200, json=lambda: metadata)] + [
        SimpleNamespace(status_code=200, json=dict)
    ] * (1 if existing else 2)
    response = await client.post(
        URL,
        json={
            "sheet_id": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?usp=sharing#gid=0",
            "month": "2026-09",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"rows": 2}
    creds.refresh.assert_called_once()
    factory.assert_called_once()
    assert factory.call_args.args == ({"client_email": "export@example.iam.gserviceaccount.com"},)
    assert factory.call_args.kwargs["scopes"] == ["https://www.googleapis.com/auth/spreadsheets"]
    calls = http.call_args_list
    assert len(calls) == (2 if existing else 3)
    assert calls[0].args[0] == "GET"
    if not existing:
        assert calls[1].args[1].endswith(":batchUpdate")
        assert calls[1].kwargs["json"] == {
            "requests": [{"addSheet": {"properties": {"title": "Poi Poi Hisab"}}}]
        }
    append = calls[-1]
    assert append.args[1].endswith(":append")
    assert append.kwargs["params"]["valueInputOption"] == "USER_ENTERED"
    values = append.kwargs["json"]["values"]
    assert values[0] == ["তারিখ", "বিবরণ", "গ্রুপ", "খাত", "পরিমাণ (৳)", "পেমেন্ট"]
    assert values[1] == ["2026-09-07", '\'=IMPORTXML("evil")', "food", "চা", "৯৯৯৯৯৯৯৯৯৯.৯৯", "cash"]
    assert values[2][1] == ""
    assert values[2][3] == "' \t=1+1"
    assert values[2][4] == "০.১০"
    for call in calls:
        assert call.kwargs["timeout"] == (5, 30)
        assert call.kwargs["allow_redirects"] is False
        assert call.kwargs["headers"]["Authorization"] == "Bearer test-token"
    for call in db.execute.call_args_list:
        statement = call.args[0]
        compiled = statement.compile()
        assert OWNER in compiled.params.values()
        assert date(2026, 9, 1) in compiled.params.values()
        assert date(2026, 9, 30) in compiled.params.values()
        assert "expenses.user_id =" in str(compiled)
        assert "ORDER BY expenses.iso, expenses.id" in str(compiled)
        assert 500 in compiled.params.values()
    assert "(expenses.iso, expenses.id) >" in str(db.execute.call_args.args[0])


async def test_empty_export(api, google):
    response = await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": None})
    assert response.json() == {"rows": 0}
    assert len(google[3].call_args.kwargs["json"]["values"]) == 1


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
    google[3].side_effect = [SimpleNamespace(status_code=200, json=dict)] * stage + [
        SimpleNamespace(status_code=status)
    ]
    error(await api[0].post(URL, json={"sheet_id": SHEET_ID}), expected, code)


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
async def test_all_text_columns_formula_safe(api, google, text):
    row = (date(2026, 9, 1), text, text, text, Decimal("12.30"), text, uuid.uuid4())
    api[1].execute.side_effect = [SimpleNamespace(all=lambda: [row]), SimpleNamespace(all=list)]
    assert (await api[0].post(URL, json={"sheet_id": SHEET_ID})).json() == {"rows": 1}
    values = google[3].call_args.kwargs["json"]["values"][1]
    assert all(values[index] == "'" + text for index in (1, 2, 3, 5))


async def test_multiple_batches_one_header(api, google):
    row = (date(9999, 12, 31), "চা", "food", "চা", Decimal("1.00"), "cash", uuid.uuid4())
    api[1].execute.side_effect = [SimpleNamespace(all=lambda: [row])] * 2 + [
        SimpleNamespace(all=list)
    ]
    assert (await api[0].post(URL, json={"sheet_id": SHEET_ID, "month": "9999-12"})).json() == {
        "rows": 2
    }
    appends = [call for call in google[3].call_args_list if call.args[1].endswith(":append")]
    assert [len(call.kwargs["json"]["values"]) for call in appends] == [2, 1]


async def test_openapi_uses_requested_sheet_field(api):
    schema = api[2].openapi()["components"]["schemas"]["SheetsExportRequest"]
    assert "sheet" in schema["properties"]
    assert schema["required"] == ["sheet"]


async def test_auth_required(api):
    client, _, app = api
    del app.dependency_overrides[get_current_user]
    assert (await client.get(URL + "/status")).status_code == 401
    assert (await client.post(URL, json={"sheet_id": SHEET_ID})).status_code == 401
