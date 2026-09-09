"""Unit and integration tests for Super Admin endpoints."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings


async def _register_and_token(client: AsyncClient, email: str, name: str = "Test User") -> tuple[str, str]:
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "password123", "name": name},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return data["accessToken"], data["user"]["id"]


@pytest.mark.asyncio
async def test_admin_forbidden_for_regular_user(client: AsyncClient) -> None:
    token, _ = await _register_and_token(client, "regular@test.dev")
    headers = {"Authorization": f"Bearer {token}"}

    # Should return 403 Forbidden
    r = await client.get("/api/v1/admin/stats", headers=headers)
    assert r.status_code == 403
    assert r.json()["detail"] == "Superadmin access required"

    r = await client.get("/api/v1/admin/users", headers=headers)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_access_and_inspect_user_data(
    client: AsyncClient, sessionmaker: async_sessionmaker[AsyncSession]
) -> None:
    settings = get_settings()
    settings.superadmin_emails = ["superadmin@test.dev"]

    admin_token, _ = await _register_and_token(client, "superadmin@test.dev", "Super Admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Verify admin profile has isSuperadmin: True in /auth/me
    me_resp = await client.get("/api/v1/auth/me", headers=admin_headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["isSuperadmin"] is True

    # Register target user
    user_token, target_user_id = await _register_and_token(client, "customer@test.dev", "Customer User")
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # Target user creates an expense
    exp_resp = await client.post(
        "/api/v1/expenses",
        headers=user_headers,
        json={"cat": "বাজার", "grp": "food", "amt": "1500.00", "pay": "cash", "iso": "2026-09-08"},
    )
    assert exp_resp.status_code == 201

    # Target user creates a debt
    debt_resp = await client.post(
        "/api/v1/debts",
        headers=user_headers,
        json={"party": "করিম সাহেব", "dir": "lend", "amt": "500.00", "iso": "2026-09-08"},
    )
    assert debt_resp.status_code == 201

    # Target user creates a recurring rule
    rec_resp = await client.post(
        "/api/v1/recurring",
        headers=user_headers,
        json={"cat": "বাড়ি ভাড়া", "grp": "housing", "amt": "12000.00", "pay": "bank", "freq": "monthly", "interval": 1},
    )
    assert rec_resp.status_code == 201

    # Superadmin checks stats
    stats_resp = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["totalUsers"] >= 2
    assert stats["totalExpenses"] >= 1
    assert stats["activeRecurring"] >= 1

    # Superadmin lists users
    users_resp = await client.get("/api/v1/admin/users?q=customer", headers=admin_headers)
    assert users_resp.status_code == 200
    users_data = users_resp.json()
    assert users_data["total"] == 1
    u = users_data["items"][0]
    assert u["id"] == target_user_id
    assert u["expenseCount"] == 1
    assert u["totalExpense"] == "1500.00"
    assert u["debtCount"] == 1
    assert u["recurringCount"] == 1

    # Superadmin inspects user details
    detail_resp = await client.get(f"/api/v1/admin/users/{target_user_id}", headers=admin_headers)
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["user"]["id"] == target_user_id
    assert detail["totalLend"] == "500.00"
    assert detail["netDebt"] == "500.00"

    # Superadmin inspects user expenses
    user_exp_resp = await client.get(f"/api/v1/admin/users/{target_user_id}/expenses", headers=admin_headers)
    assert user_exp_resp.status_code == 200
    assert len(user_exp_resp.json()["items"]) == 1
    assert user_exp_resp.json()["items"][0]["cat"] == "বাজার"

    # Superadmin inspects user debts
    user_debts_resp = await client.get(f"/api/v1/admin/users/{target_user_id}/debts", headers=admin_headers)
    assert user_debts_resp.status_code == 200
    assert len(user_debts_resp.json()["items"]) == 1
    assert user_debts_resp.json()["items"][0]["party"] == "করিম সাহেব"

    # Superadmin inspects user recurring
    user_rec_resp = await client.get(f"/api/v1/admin/users/{target_user_id}/recurring", headers=admin_headers)
    assert user_rec_resp.status_code == 200
    assert len(user_rec_resp.json()["items"]) == 1
    assert user_rec_resp.json()["items"][0]["cat"] == "বাড়ি ভাড়া"


@pytest.mark.asyncio
async def test_admin_user_not_found(client: AsyncClient) -> None:
    settings = get_settings()
    settings.superadmin_emails = ["superadmin@test.dev"]
    admin_token, _ = await _register_and_token(client, "superadmin@test.dev")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    fake_id = str(uuid.uuid4())
    r = await client.get(f"/api/v1/admin/users/{fake_id}", headers=admin_headers)
    assert r.status_code == 404
    assert r.json()["detail"] == "User not found"
