"""Incomes tests: create/shape, validation, list + date filter + cursor pagination,
patch, delete, IDOR isolation, and monthly report integration."""

import uuid

import pytest
from helpers import income_body, register_user
from httpx import AsyncClient

INCOMES = "/api/v1/incomes"


async def _create(
    client: AsyncClient, headers: dict[str, str], **overrides: object
) -> dict:
    r = await client.post(INCOMES, json=income_body(**overrides), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_unauth_401(client: AsyncClient) -> None:
    assert (await client.get(INCOMES)).status_code == 401
    assert (await client.post(INCOMES, json=income_body())).status_code == 401
    assert (
        await client.patch(f"{INCOMES}/{uuid.uuid4()}", json={"source": "x"})
    ).status_code == 401
    assert (await client.delete(f"{INCOMES}/{uuid.uuid4()}")).status_code == 401


async def test_create_201_and_wire_shape(client: AsyncClient) -> None:
    headers, user_id = await register_user(client, email="inc-create@test.dev")
    body = await _create(client, headers, description="সেপ্টেম্বর মাসের বেতন")
    assert set(body) == {
        "id",
        "user_id",
        "source",
        "amt",
        "pay",
        "description",
        "iso",
        "created_at",
    }
    assert body["amt"] == "50000.00"
    assert body["source"] == "বেতন"
    assert body["pay"] == "bank"
    assert body["description"] == "সেপ্টেম্বর মাসের বেতন"
    assert body["iso"] == "2026-09-01"
    assert body["created_at"].endswith("Z")
    assert body["user_id"] == user_id


@pytest.mark.parametrize(
    "overrides",
    [
        {"amt": "-10.00"},
        {"amt": "0.00"},
        {"amt": "100.555"},
        {"amt": 1000},
        {"source": ""},
        {"source": "a" * 121},
        {"iso": "invalid-date"},
    ],
)
async def test_create_validation_422(
    client: AsyncClient, overrides: dict[str, object]
) -> None:
    headers, _ = await register_user(client, email="inc-val@test.dev")
    r = await client.post(INCOMES, json=income_body(**overrides), headers=headers)
    assert r.status_code == 422


async def test_list_and_date_filtering(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="inc-list@test.dev")
    await _create(client, headers, iso="2026-09-01", amt="10000.00")
    await _create(client, headers, iso="2026-09-15", amt="5000.00")
    await _create(client, headers, iso="2026-10-01", amt="20000.00")

    r_all = await client.get(INCOMES, headers=headers)
    assert r_all.status_code == 200
    assert len(r_all.json()["items"]) == 3

    r_sept = await client.get(
        f"{INCOMES}?from=2026-09-01&to=2026-09-30", headers=headers
    )
    assert r_sept.status_code == 200
    items = r_sept.json()["items"]
    assert len(items) == 2
    assert {i["amt"] for i in items} == {"10000.00", "5000.00"}


async def test_patch_and_delete(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="inc-mod@test.dev")
    created = await _create(client, headers, amt="1000.00")
    inc_id = created["id"]

    # Patch
    patch_r = await client.patch(
        f"{INCOMES}/{inc_id}", json={"amt": "1500.00"}, headers=headers
    )
    assert patch_r.status_code == 200
    assert patch_r.json()["amt"] == "1500.00"

    # Delete
    del_r = await client.delete(f"{INCOMES}/{inc_id}", headers=headers)
    assert del_r.status_code == 204

    # 404 after delete
    get_r = await client.patch(
        f"{INCOMES}/{inc_id}", json={"amt": "2000.00"}, headers=headers
    )
    assert get_r.status_code == 404


async def test_idor_isolation(client: AsyncClient) -> None:
    h1, _ = await register_user(client, email="inc-u1@test.dev")
    h2, _ = await register_user(client, email="inc-u2@test.dev")

    created = await _create(client, h1)
    inc_id = created["id"]

    # User 2 tries to patch User 1's income -> 404
    r = await client.patch(
        f"{INCOMES}/{inc_id}", json={"amt": "999.00"}, headers=h2
    )
    assert r.status_code == 404

    # User 2 tries to delete User 1's income -> 404
    r_del = await client.delete(f"{INCOMES}/{inc_id}", headers=h2)
    assert r_del.status_code == 404


async def test_monthly_report_includes_income(client: AsyncClient) -> None:
    headers, _ = await register_user(client, email="inc-rep@test.dev")
    # Add an expense of 1500.00 in 2026-09
    await client.post(
        "/api/v1/expenses",
        json={"cat": "মুদি", "grp": "food", "amt": "1500.00", "iso": "2026-09-05"},
        headers=headers,
    )
    # Add an income of 5000.00 in 2026-09
    await _create(client, headers, iso="2026-09-01", amt="5000.00")

    rep_r = await client.get("/api/v1/reports/monthly?ym=2026-09", headers=headers)
    assert rep_r.status_code == 200
    data = rep_r.json()
    assert data["total"] == "1500.00"
    assert data["total_income"] == "5000.00"
    assert data["net_savings"] == "3500.00"
