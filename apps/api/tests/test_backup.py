"""T15.3 backup/restore tests (ADR-0012): envelope shape, Decimal-exact
roundtrip into a second user, REPLACE semantics (old rows gone, budget
replaced not merged, fresh PKs / caller-scoped user_id), 401 battery, 422
battery (schema_version 3, negative amt, bad enums, malformed date, …), and
budget upsert semantics preserved after a restore.

T28.1 / ADR-0028 (v2): recurring rules join the envelope — v2 roundtrip
exactness (cursor ``next_run`` preserved verbatim, fresh ids), v1 documents
still restore and WIPE the caller's rules, ``recurring: []`` wipes too, and
a recurring 422/max-guard battery."""

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from helpers import debt_body, expense_body, recurring_body, register_user
from httpx import AsyncClient

from app.schemas.backup import MAX_BACKUP_ROWS

BACKUP = "/api/v1/export/backup.json"
RESTORE = "/api/v1/import/restore"
EXP = "/api/v1/expenses"
DEBTS = "/api/v1/debts"
BUDGETS = "/api/v1/budgets"
REC = "/api/v1/recurring"
RUN = "/api/v1/recurring/run"


def _envelope() -> dict[str, object]:
    """Minimal valid v1 restore envelope (all collections empty, no rules)."""
    return {
        "schema_version": 1,
        "exported_at": "2026-09-05T00:00:00Z",
        "counts": {"expenses": 0, "debts": 0, "budgets": 0},
        "expenses": [],
        "debts": [],
        "budgets": [],
    }


def _v2_envelope() -> dict[str, object]:
    """Minimal valid v2 restore envelope (ADR-0028): rules default to wiped."""
    return {
        **_envelope(),
        "schema_version": 2,
        "counts": {"expenses": 0, "debts": 0, "budgets": 0, "recurring": 0},
        "recurring": [],
    }


def _rule_row(**overrides: object) -> dict[str, object]:
    """One valid uploaded recurring row (the v2 export row shape)."""
    row: dict[str, object] = {
        "cat": "রুম ভাড়া",
        "grp": "housing",
        "amt": "12000.00",
        "pay": "cash",
        "desc": None,
        "freq": "monthly",
        "start_date": "2027-01-01",
        "next_run": "2027-01-01",
        "active": True,
    }
    row.update(overrides)
    return row


async def _make_rule(
    client: AsyncClient, headers: dict[str, str], **overrides: object
) -> dict[str, object]:
    """POST /recurring; return the created rule (RecurringOut shape)."""
    r = await client.post(REC, json=recurring_body(**overrides), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _by_freq(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Order recurring rows by freq (freqs are unique in these fixtures)."""
    return sorted(rows, key=lambda row: str(row["freq"]))


async def _seed_full_ledger(client: AsyncClient, headers: dict[str, str]) -> None:
    """Expenses (mixed grp/pay/desc), an open + a settled debt, and a budget."""
    seeds = [
        {
            "iso": "2026-09-01",
            "cat": "চা",
            "grp": "food",
            "amt": "30.00",
            "pay": "cash",
            "desc": "চা ও পরোটা",
        },
        {"iso": "2026-08-20", "cat": "কফি", "grp": "other", "amt": "120.55", "pay": "card"},
        {"iso": "2026-09-03", "cat": "রিকশা", "grp": "transport", "amt": "40.00", "pay": "bkash"},
    ]
    for body in seeds:
        r = await client.post(EXP, json=expense_body(**body), headers=headers)
        assert r.status_code == 201, r.text
    r = await client.post(
        DEBTS,
        json=debt_body(
            party="রফিক", dir="lend", amt="2000.00", iso="2026-08-30", note="এমারজেন্সি"
        ),
        headers=headers,
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        DEBTS,
        json=debt_body(party="করিম চাচা", dir="borrow", amt="500.00", iso="2026-08-12"),
        headers=headers,
    )
    assert r.status_code == 201, r.text
    settle = await client.post(
        f"{DEBTS}/{r.json()['id']}/pay", json={"amt": "600.00"}, headers=headers
    )
    assert settle.status_code == 200 and settle.json()["status"] == "FULL"
    r = await client.put(
        BUDGETS,
        json={"total": "25000.00", "cats": {"চা": "3000.00", "রিকশা": "1500.00"}},
        headers=headers,
    )
    assert r.status_code == 200


def _ledger_content(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rows minus the regenerated PK and the user scope."""
    return [{k: v for k, v in row.items() if k not in ("id", "user_id")} for row in rows]


async def test_unauth_401(client: AsyncClient) -> None:
    assert (await client.get(BACKUP)).status_code == 401
    assert (await client.post(RESTORE, json={})).status_code == 401
    junk = {"Authorization": "Bearer not-a-token"}
    assert (await client.get(BACKUP, headers=junk)).status_code == 401
    assert (await client.post(RESTORE, json={}, headers=junk)).status_code == 401


async def test_empty_user_backup_shape(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="backup-empty@test.dev")
    r = await client.get(BACKUP, headers=headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert set(body) == {
        "schema_version",
        "exported_at",
        "counts",
        "expenses",
        "debts",
        "budgets",
        "recurring",
    }
    assert body["schema_version"] == 2
    assert body["counts"] == {"expenses": 0, "debts": 0, "budgets": 0, "recurring": 0}
    assert body["expenses"] == []
    assert body["debts"] == []
    assert body["budgets"] == []
    assert body["recurring"] == []
    # RFC 3339 UTC with trailing Z.
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", body["exported_at"])


async def test_roundtrip_into_second_user_decimal_exact(client: AsyncClient) -> None:
    a_headers, _ = await register_user(client, email="backup-a@test.dev")
    await _seed_full_ledger(client, a_headers)
    r = await client.get(BACKUP, headers=a_headers)
    assert r.status_code == 200
    original = r.json()
    assert original["counts"] == {"expenses": 3, "debts": 2, "budgets": 1, "recurring": 0}
    # Money is exact 2dp decimal strings in the backup itself.
    assert [row["amt"] for row in original["expenses"]] == ["120.55", "30.00", "40.00"]

    b_headers, b_id = await register_user(client, email="backup-b@test.dev")
    r = await client.post(RESTORE, json=original, headers=b_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"restored": {"expenses": 3, "debts": 2, "budgets": 1, "recurring": 0}}

    r = await client.get(BACKUP, headers=b_headers)
    assert r.status_code == 200
    restored = r.json()
    assert restored["counts"] == original["counts"]
    # Decimal-exact, field-for-field equality (except PK + user scope):
    # includes desc, pay, iso, created_at, settled_at, budget total/cats.
    assert _ledger_content(restored["expenses"]) == _ledger_content(original["expenses"])
    assert _ledger_content(restored["debts"]) == _ledger_content(original["debts"])
    assert _ledger_content(restored["budgets"]) == _ledger_content(original["budgets"])
    assert [row["amt"] for row in restored["expenses"]] == ["120.55", "30.00", "40.00"]
    # Fresh PKs; everything belongs to the RESTORING user, never the file's.
    a_ids = {row["id"] for row in original["expenses"] + original["debts"]}
    b_ids = {row["id"] for row in restored["expenses"] + restored["debts"]}
    assert b_ids.isdisjoint(a_ids)
    b_rows = restored["expenses"] + restored["debts"] + restored["budgets"]
    assert all(row["user_id"] == b_id for row in b_rows)


async def test_restore_replaces_old_rows(client: AsyncClient) -> None:
    headers, user_id = await register_user(client, email="backup-replace@test.dev")
    old_expense_ids = []
    for i, amt in enumerate(("10.00", "20.00")):
        r = await client.post(
            EXP, json=expense_body(iso=f"2026-07-{i + 1:02d}", amt=amt), headers=headers
        )
        assert r.status_code == 201
        old_expense_ids.append(r.json()["id"])
    r = await client.post(
        DEBTS, json=debt_body(party="পুরানো", amt="99.00", iso="2026-07-05"), headers=headers
    )
    assert r.status_code == 201
    old_debt_id = r.json()["id"]
    r = await client.put(
        BUDGETS, json={"total": "999.00", "cats": {"Old": "1.00"}}, headers=headers
    )
    assert r.status_code == 200

    payload = {
        "schema_version": 1,
        "exported_at": "2026-09-05T00:00:00Z",
        "counts": {"expenses": 1, "debts": 1, "budgets": 1, "recurring": 0},
        "expenses": [
            {
                "id": str(uuid.uuid4()),  # must be ignored — fresh PK below
                "user_id": str(uuid.uuid4()),  # must be ignored — caller scope
                "cat": "চা",
                "grp": "food",
                "amt": "12.34",
                "pay": "cash",
                "desc": None,
                "iso": "2026-01-01",
                "created_at": "2026-01-01T08:30:00Z",  # preserved for ordering
            }
        ],
        "debts": [
            {
                "id": str(uuid.uuid4()),
                "user_id": str(uuid.uuid4()),
                "party": "নতুন",
                "dir": "borrow",
                "amt": "77.00",
                "note": None,
                "iso": "2026-02-02",
                "settled_at": None,
                "created_at": "2026-02-02T10:00:00Z",
            }
        ],
        "budgets": [
            {
                "user_id": str(uuid.uuid4()),
                "total": "5000.00",
                "cats": {"চা": "100.00"},
                "updated_at": "2026-03-03T00:00:00Z",
            }
        ],
    }
    r = await client.post(RESTORE, json=payload, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"restored": {"expenses": 1, "debts": 1, "budgets": 1, "recurring": 0}}

    r = await client.get(BACKUP, headers=headers)
    body = r.json()
    assert body["counts"] == payload["counts"]
    # Old rows are gone after the replace.
    assert all(row["id"] not in old_expense_ids for row in body["expenses"])
    assert body["debts"][0]["id"] != old_debt_id
    [exp] = body["expenses"]
    assert exp["id"] != payload["expenses"][0]["id"]  # fresh PK
    assert exp["user_id"] == user_id  # IDOR-safe: scoped to the caller
    assert exp["created_at"] == "2026-01-01T08:30:00Z"  # timestamps preserved
    # The budget was REPLACED, not merged with ("Old" must not survive).
    assert body["budgets"] == [{**payload["budgets"][0], "user_id": user_id}]


async def test_budget_upsert_still_works_after_restore(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="backup-budget@test.dev")
    envelope = {
        **_envelope(),
        "budgets": [{"total": "5000.00", "cats": {"চা": "100.00"}}],
    }
    r = await client.post(RESTORE, json=envelope, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"restored": {"expenses": 0, "debts": 0, "budgets": 1, "recurring": 0}}

    # PUT after restore must UPDATE the restored row (PK is user_id — a second
    # row cannot exist), keeping the single-row upsert semantics.
    r = await client.put(BUDGETS, json={"total": "31000.00"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["total"] == "31000.00"
    assert r.json()["cats"] == {"চা": "100.00"}  # partial upsert kept restored cats
    r = await client.get(BACKUP, headers=headers)
    assert r.json()["budgets"][0]["total"] == "31000.00"


@pytest.mark.parametrize(
    ("broken", "code"),
    [
        pytest.param({"schema_version": 3}, "unsupported_backup_version", id="schema-v3"),
        pytest.param({"schema_version": "junk"}, "unsupported_backup_version", id="schema-junk"),
        pytest.param(
            {"expenses": [{"cat": "চা", "grp": "food", "amt": "-5.00", "iso": "2026-09-01"}]},
            "invalid_backup_row",
            id="negative-amt",
        ),
        pytest.param(
            {"expenses": [{"cat": "চা", "grp": "food", "amt": "5.00", "pay": "paypal", "iso": "2026-09-01"}]},
            "invalid_backup_row",
            id="bad-pay-enum",
        ),
        pytest.param(
            {"expenses": [{"cat": "চা", "grp": "junk", "amt": "5.00", "iso": "2026-09-01"}]},
            "invalid_backup_row",
            id="bad-grp-enum",
        ),
        pytest.param(
            {"expenses": [{"cat": "চা", "grp": "food", "amt": "5.00", "iso": "01-09-2026"}]},
            "invalid_backup_row",
            id="malformed-date",
        ),
        pytest.param(
            {"expenses": [{"cat": "", "grp": "food", "amt": "5.00", "iso": "2026-09-01"}]},
            "invalid_backup_row",
            id="empty-cat",
        ),
        pytest.param(
            {"debts": [{"party": "রফিক", "dir": "sideways", "amt": "5.00", "iso": "2026-09-01"}]},
            "invalid_backup_row",
            id="bad-debt-dir",
        ),
        pytest.param(
            {"debts": [{"party": "রফিক", "dir": "lend", "amt": "0.00", "iso": "2026-09-01"}]},
            "invalid_backup_row",
            id="zero-debt-amt",
        ),
        pytest.param(
            {"budgets": [{"total": "10.5"}]},
            "invalid_backup_row",
            id="budget-1dp",
        ),
        pytest.param(
            {"budgets": [{"total": "10.00"}, {"total": "20.00"}]},
            "invalid_backup_row",
            id="two-budget-rows",
        ),
    ],
)
async def test_restore_422_battery(
    client: AsyncClient, broken: dict[str, object], code: str
) -> None:
    headers, _ = await register_user(client, email="backup-422@test.dev")
    r = await client.post(RESTORE, json=_envelope() | broken, headers=headers)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    # House bn/en error triple (ADR-0004 §7).
    assert set(detail) == {"code", "message_bn", "message_en"}
    assert detail["code"] == code
    assert isinstance(detail["message_bn"], str) and detail["message_bn"]
    assert isinstance(detail["message_en"], str) and detail["message_en"]


async def test_restore_422_row_hint_locates_bad_row(client: AsyncClient) -> None:
    """T30: the invalid-row triple names the offending row's JSON path.

    A user restoring an edited backup must be able to FIND the bad row —
    the messages carry the pydantic loc as a JSON-path hint (found while
    dispositioning the cycle-29 probe's false-alarm 422: its synth doc used
    grp "need", which was never a valid ExpenseGroup value).
    """
    headers, _ = await register_user(client, email="backup-hint@test.dev")
    broken = _envelope() | {
        "recurring": [
            {
                "cat": "চা",
                "grp": "need",  # never a valid ExpenseGroup — exactly the probe's mistake
                "amt": "500.00",
                "pay": "cash",
                "desc": None,
                "freq": "monthly",
                "start_date": "2026-09-01",
                "next_run": "2026-10-01",
                "active": True,
            }
        ]
    }
    r = await client.post(RESTORE, json=broken, headers=headers)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert set(detail) == {"code", "message_bn", "message_en"}  # triple shape stable
    assert detail["code"] == "invalid_backup_row"
    assert "(recurring[0].grp)" in detail["message_en"]
    assert "(recurring[0].grp)" in detail["message_bn"]


# --- T28.1 / ADR-0028: recurring rules in the v2 envelope --------------------


async def test_v2_roundtrip_recurring_exact(client: AsyncClient) -> None:
    a_headers, _ = await register_user(client, email="backup-rec-a@test.dev")
    today = datetime.now(UTC).date()
    future = (today + timedelta(days=60)).isoformat()  # never due on run day
    rule_a = await _make_rule(
        client,
        a_headers,
        cat="টিউশন",
        grp="education",
        amt="2000.00",
        pay="bkash",
        desc="বিবির টিউশন",
        freq="monthly",
        start_date=future,
    )
    assert rule_a["next_run"] == future  # create sets cursor = start_date
    await _make_rule(
        client, a_headers, cat="চা", grp="food", amt="30.00", freq="daily",
        start_date=today.isoformat(),
    )
    off = await client.patch(
        f"{REC}/{rule_a['id']}", json={"active": False}, headers=a_headers
    )
    assert off.status_code == 200 and off.json()["active"] is False
    run = await client.post(RUN, headers=a_headers)  # advances the daily cursor
    assert run.status_code == 200, run.text
    assert run.json()["rules"] == 1 and run.json()["created"] == 1

    r = await client.get(BACKUP, headers=a_headers)
    assert r.status_code == 200
    original = r.json()
    assert original["schema_version"] == 2
    assert original["counts"] == {
        "expenses": 1,
        "debts": 0,
        "budgets": 0,
        "recurring": 2,
    }
    rows = original["recurring"]
    assert len(rows) == 2
    by = {row["freq"]: row for row in rows}
    assert set(rows[0]) == {
        "cat", "grp", "amt", "pay", "desc", "freq",
        "start_date", "next_run", "active", "created_at", "updated_at",
    }  # export carries every column EXCEPT id/user_id (ADR-0028)
    # amt stays an exact 2dp decimal string; dates and the cursor verbatim.
    assert by["monthly"]["amt"] == "2000.00" and by["daily"]["amt"] == "30.00"
    assert by["monthly"]["start_date"] == by["monthly"]["next_run"] == future
    assert by["monthly"]["active"] is False
    assert by["monthly"]["desc"] == "বিবির টিউশন" and by["monthly"]["pay"] == "bkash"
    assert by["daily"]["start_date"] == today.isoformat()
    assert by["daily"]["next_run"] > by["daily"]["start_date"]  # cursor advanced
    assert re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", by["daily"]["created_at"]
    )

    b_headers, b_id = await register_user(client, email="backup-rec-b@test.dev")
    r = await client.post(RESTORE, json=original, headers=b_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "restored": {"expenses": 1, "debts": 0, "budgets": 0, "recurring": 2}
    }

    r = await client.get(BACKUP, headers=b_headers)
    assert r.status_code == 200
    restored = r.json()
    assert restored["counts"]["recurring"] == 2
    # Field-for-field identical export rows: no id/user_id to differ, and
    # created_at/updated_at + the forward cursor survived the roundtrip.
    # (Export orders by created_at, id — created_at ties re-tie-break by the
    # fresh ids after a restore, so compare order-insensitively.)
    assert _by_freq(restored["recurring"]) == _by_freq(original["recurring"])
    # Fresh PKs under the RESTORING user (never the file's scope).
    a_items = (await client.get(REC, headers=a_headers)).json()["items"]
    b_items = (await client.get(REC, headers=b_headers)).json()["items"]
    assert len(b_items) == 2
    assert {i["id"] for i in b_items}.isdisjoint({i["id"] for i in a_items})
    assert all(i["user_id"] == b_id for i in b_items)
    cursor = {i["freq"]: i for i in b_items}
    assert cursor["daily"]["next_run"] > cursor["daily"]["start_date"]
    assert cursor["monthly"]["next_run"] == future  # verbatim, not re-derived


async def test_v1_document_restores_and_wipes_rules(client: AsyncClient) -> None:
    a_headers, _ = await register_user(client, email="backup-v1-a@test.dev")
    await _make_rule(client, a_headers, freq="weekly", start_date="2026-08-01")
    r = await client.get(BACKUP, headers=a_headers)
    original = r.json()
    assert original["counts"]["recurring"] == 1
    # Demote the export to a genuine v1 (v0.13.0-era) document: no rules key.
    v1_doc = {k: v for k, v in original.items() if k != "recurring"}
    v1_doc["schema_version"] = 1
    v1_doc["counts"] = {k: v for k, v in v1_doc["counts"].items() if k != "recurring"}

    # A v1 file predates rules, so restoring it wipes the caller's rules —
    # REPLACE means the ledger ends up equal to the file (ADR-0028).
    b_headers, _ = await register_user(client, email="backup-v1-b@test.dev")
    await _make_rule(client, b_headers, freq="daily", start_date="2026-09-01")
    r = await client.post(RESTORE, json=v1_doc, headers=b_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"restored": {**v1_doc["counts"], "recurring": 0}}
    r = await client.get(REC, headers=b_headers)
    assert r.json()["items"] == []
    r = await client.get(BACKUP, headers=b_headers)
    body = r.json()
    assert body["schema_version"] == 2  # re-export is v2 again
    assert body["recurring"] == [] and body["counts"]["recurring"] == 0


async def test_v2_empty_recurring_wipes_rules(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="backup-v2-wipe@test.dev")
    await _make_rule(
        client, headers, amt="500.00", freq="yearly", start_date="2026-01-01"
    )
    r = await client.post(RESTORE, json=_v2_envelope(), headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "restored": {"expenses": 0, "debts": 0, "budgets": 0, "recurring": 0}
    }
    r = await client.get(REC, headers=headers)
    assert r.json()["items"] == []


async def test_recurring_restore_preserves_created_updated_at(client: AsyncClient) -> None:
    headers, user_id = await register_user(client, email="backup-rec-stamps@test.dev")
    envelope = _v2_envelope() | {
        "recurring": [
            _rule_row(
                cat="গ্যাস", grp="utility", amt="1100.00",
                created_at="2026-05-01T06:30:00Z",
                updated_at="2026-06-01T07:45:00Z",
            )
        ]
    }
    r = await client.post(RESTORE, json=envelope, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "restored": {"expenses": 0, "debts": 0, "budgets": 0, "recurring": 1}
    }
    r = await client.get(BACKUP, headers=headers)
    [row] = r.json()["recurring"]
    assert row["created_at"] == "2026-05-01T06:30:00Z"
    assert row["updated_at"] == "2026-06-01T07:45:00Z"
    r = await client.get(REC, headers=headers)
    [item] = r.json()["items"]
    assert item["user_id"] == user_id
    assert item["created_at"] == "2026-05-01T06:30:00Z"
    assert item["updated_at"] == "2026-06-01T07:45:00Z"


async def test_unauth_401_both_endpoints_v2(client: AsyncClient) -> None:
    envelope = _v2_envelope() | {"recurring": [_rule_row()]}
    assert (await client.get(BACKUP)).status_code == 401
    assert (await client.post(RESTORE, json=envelope)).status_code == 401
    junk = {"Authorization": "Bearer not-a-token"}
    assert (await client.get(BACKUP, headers=junk)).status_code == 401
    assert (await client.post(RESTORE, json=envelope, headers=junk)).status_code == 401


@pytest.mark.parametrize(
    "row",
    [
        pytest.param(_rule_row(freq="biweekly"), id="bad-freq"),
        pytest.param(_rule_row(amt="-5.00"), id="negative-amt"),
        pytest.param(_rule_row(amt="5.5"), id="amt-1dp"),
        pytest.param(_rule_row(amt="12000"), id="amt-no-decimals"),
        pytest.param(
            {k: v for k, v in _rule_row().items() if k != "next_run"},
            id="missing-next-run",
        ),
        pytest.param(
            {k: v for k, v in _rule_row().items() if k != "start_date"},
            id="missing-start-date",
        ),
        pytest.param(
            {k: v for k, v in _rule_row().items() if k != "freq"}, id="missing-freq"
        ),
        pytest.param(_rule_row(active="maybe"), id="bad-active-type"),
        pytest.param(_rule_row(grp="groceries"), id="bad-grp-enum"),
        pytest.param(_rule_row(pay="paypal"), id="bad-pay-enum"),
    ],
)
async def test_recurring_restore_422_battery(
    client: AsyncClient, row: dict[str, object]
) -> None:
    headers, _ = await register_user(client, email="backup-rec-422@test.dev")
    r = await client.post(
        RESTORE, json=_v2_envelope() | {"recurring": [row]}, headers=headers
    )
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert set(detail) == {"code", "message_bn", "message_en"}
    assert detail["code"] == "invalid_backup_row"


async def test_recurring_rows_over_max_guard_422(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="backup-rec-cap@test.dev")
    rows = [_rule_row(cat=f"ক্যাট {i:05d}") for i in range(MAX_BACKUP_ROWS + 1)]
    r = await client.post(
        RESTORE, json=_v2_envelope() | {"recurring": rows}, headers=headers
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "invalid_backup_row"
    # Sanity: the guard is the collection cap, not an off-by-one —
    # exactly MAX_BACKUP_ROWS rows validates and restores.
    rows = rows[:-1]
    r = await client.post(
        RESTORE, json=_v2_envelope() | {"recurring": rows}, headers=headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["restored"]["recurring"] == MAX_BACKUP_ROWS
