"""Superadmin oversight endpoints added with the admin/user role split.

Covers the audit trail, role management, cross-user session control,
platform analytics, taxonomy merge, and the system/integrations probes.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from app.core.config import get_settings

PASSWORD = "password123"


async def _register(client: AsyncClient, email: str, name: str = "User") -> tuple[dict[str, str], str]:
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD, "name": name},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return {"Authorization": f"Bearer {body['accessToken']}"}, body["user"]["id"]


async def _admin(client: AsyncClient, email: str = "root@test.dev") -> tuple[dict[str, str], str]:
    """Register an account that is superadmin via the email allowlist."""
    get_settings().superadmin_emails = [email]
    return await _register(client, email, "Root Admin")


async def _expense(client: AsyncClient, headers: dict[str, str], **over: object) -> None:
    body: dict[str, object] = {
        "cat": "বাজার",
        "grp": "food",
        "amt": "100.00",
        "pay": "cash",
        "iso": "2026-09-01",
    }
    body.update(over)
    r = await client.post("/api/v1/expenses", headers=headers, json=body)
    assert r.status_code == 201, r.text


# --------------------------------------------------------------------------
# Stats
# --------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("database,environment", [(False, False), (True, False), (False, True), (True, True)])
async def test_inspector_reports_actual_grant_sources(client: AsyncClient, database: bool, environment: bool) -> None:
    admin_headers, _ = await _admin(client)
    _, target_id = await _register(client, "sources@test.dev")
    if database:
        result = await client.post(f"/api/v1/admin/users/{target_id}/role", headers=admin_headers, json={"superadmin": True})
        assert result.status_code == 200
    if environment:
        get_settings().superadmin_emails.append("SOURCES@TEST.DEV")
    result = await client.get(f"/api/v1/admin/users/{target_id}", headers=admin_headers)
    assert result.status_code == 200
    expected = (["database"] if database else []) + (["environment"] if environment else [])
    assert result.json()["adminSources"] == expected
    assert result.json()["user"]["isSuperadmin"] is (database or environment)


@pytest.mark.asyncio
async def test_member_cannot_read_any_inspector_endpoint(client: AsyncClient) -> None:
    _, admin_id = await _admin(client)
    member_headers, _ = await _register(client, "inspector-member@test.dev")
    for suffix in ("", "/expenses", "/debts", "/recurring"):
        result = await client.get(f"/api/v1/admin/users/{admin_id}{suffix}", headers=member_headers)
        assert result.status_code == 403


@pytest.mark.asyncio
async def test_stats_exposes_the_activity_fields_the_ui_labels(client: AsyncClient) -> None:
    """The web dict shipped an "active (30 days)" label with no field behind it."""
    admin_headers, _ = await _admin(client)
    user_headers, _ = await _register(client, "u1@test.dev")
    await _expense(client, user_headers)

    r = await client.get("/api/v1/admin/stats", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in (
        "activeUsers30d",
        "newUsers30d",
        "suspendedUsers",
        "superadminCount",
        "monthAmount",
    ):
        assert key in body, key
    assert body["newUsers30d"] == 2
    assert body["suspendedUsers"] == 0
    assert body["superadminCount"] == 1


# --------------------------------------------------------------------------
# Audit trail
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_requires_superadmin(client: AsyncClient) -> None:
    get_settings().superadmin_emails = ["nobody@test.dev"]
    headers, _ = await _register(client, "plain@test.dev")
    r = await client.get("/api/v1/admin/audit", headers=headers)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_suspend_and_delete_write_an_audit_trail(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    _victim_headers, victim_id = await _register(client, "victim@test.dev", "Victim")

    r = await client.post(
        f"/api/v1/admin/users/{victim_id}/suspend",
        headers=admin_headers,
        json={"suspended": True},
    )
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/admin/audit", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    entry = body["items"][0]
    assert entry["action"] == "user.suspend"
    assert entry["actorEmail"] == "root@test.dev"
    assert entry["targetId"] == victim_id
    # The label snapshots the target so a cascade-deleted user stays named.
    assert "victim@test.dev" in entry["targetLabel"]
    assert "user.suspend" in body["actions"]


@pytest.mark.asyncio
async def test_delete_audit_row_outlives_the_deleted_user(client: AsyncClient) -> None:
    """The point of the trail: after the cascade, nothing else names them."""
    admin_headers, _ = await _admin(client)
    _h, victim_id = await _register(client, "gone@test.dev", "Gone Forever")

    r = await client.delete(f"/api/v1/admin/users/{victim_id}", headers=admin_headers)
    assert r.status_code == 200, r.text

    r = await client.get("/api/v1/admin/users", headers=admin_headers)
    assert all(u["id"] != victim_id for u in r.json()["items"])

    r = await client.get(
        "/api/v1/admin/audit", headers=admin_headers, params={"action": "user.delete"}
    )
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["targetId"] == victim_id
    assert "gone@test.dev" in items[0]["targetLabel"]


@pytest.mark.asyncio
async def test_audit_search_and_action_filter(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    _h, a_id = await _register(client, "alpha@test.dev", "Alpha")
    _h2, b_id = await _register(client, "beta@test.dev", "Beta")

    await client.post(
        f"/api/v1/admin/users/{a_id}/suspend", headers=admin_headers, json={"suspended": True}
    )
    await client.delete(f"/api/v1/admin/users/{b_id}", headers=admin_headers)

    r = await client.get(
        "/api/v1/admin/audit", headers=admin_headers, params={"q": "alpha@test.dev"}
    )
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["action"] == "user.suspend"

    r = await client.get(
        "/api/v1/admin/audit", headers=admin_headers, params={"action": "user.delete"}
    )
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_no_audit_row_when_the_action_fails(client: AsyncClient) -> None:
    """The row shares the mutation's transaction, so a 4xx leaves no trail."""
    admin_headers, admin_id = await _admin(client)

    r = await client.post(
        f"/api/v1/admin/users/{admin_id}/suspend",
        headers=admin_headers,
        json={"suspended": True},
    )
    assert r.status_code == 400  # cannot suspend your own account

    r = await client.delete(f"/api/v1/admin/users/{uuid.uuid4()}", headers=admin_headers)
    assert r.status_code == 404

    r = await client.get("/api/v1/admin/audit", headers=admin_headers)
    assert r.json()["total"] == 0


@pytest.mark.asyncio
async def test_full_user_export_is_audited(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    await _register(client, "dumped@test.dev")

    r = await client.get("/api/v1/admin/export/users.csv", headers=admin_headers)
    assert r.status_code == 200

    r = await client.get(
        "/api/v1/admin/audit", headers=admin_headers, params={"action": "user.export"}
    )
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["affected"] == 2


# --------------------------------------------------------------------------
# Roles
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grant_and_revoke_superadmin(client: AsyncClient) -> None:
    admin_headers, admin_id = await _admin(client)
    # Persist the root admin in the database too, so the durable-record guard
    # (covered separately below) is not what this test is exercising.
    assert (
        await client.post(
            f"/api/v1/admin/users/{admin_id}/role",
            headers=admin_headers,
            json={"superadmin": True},
        )
    ).status_code == 200
    promoted_headers, promoted_id = await _register(client, "promote@test.dev", "Promoted")

    # Before: the promoted account cannot reach /admin at all.
    assert (await client.get("/api/v1/admin/stats", headers=promoted_headers)).status_code == 403

    r = await client.post(
        f"/api/v1/admin/users/{promoted_id}/role",
        headers=admin_headers,
        json={"superadmin": True},
    )
    assert r.status_code == 200, r.text
    assert (await client.get("/api/v1/admin/stats", headers=promoted_headers)).status_code == 200

    r = await client.post(
        f"/api/v1/admin/users/{promoted_id}/role",
        headers=admin_headers,
        json={"superadmin": False},
    )
    assert r.status_code == 200, r.text
    assert (await client.get("/api/v1/admin/stats", headers=promoted_headers)).status_code == 403

    r = await client.get("/api/v1/admin/audit", headers=admin_headers)
    actions = [i["action"] for i in r.json()["items"]]
    assert actions.count("user.role_grant") == 2  # root self-grant + promoted
    assert "user.role_revoke" in actions


@pytest.mark.asyncio
async def test_cannot_revoke_superadmin_from_self(client: AsyncClient) -> None:
    admin_headers, admin_id = await _admin(client)
    r = await client.post(
        f"/api/v1/admin/users/{admin_id}/role",
        headers=admin_headers,
        json={"superadmin": False},
    )
    assert r.status_code == 400
    assert "own account" in r.json()["detail"]


@pytest.mark.asyncio
async def test_revoking_an_env_allowlisted_admin_reports_the_real_cause(
    client: AsyncClient,
) -> None:
    """Clearing the flag would be a no-op — the env var still grants access."""
    admin_headers, _ = await _admin(client, "root@test.dev")
    other_headers, other_id = await _register(client, "other@test.dev", "Other Admin")
    get_settings().superadmin_emails = ["root@test.dev", "other@test.dev"]

    r = await client.post(
        f"/api/v1/admin/users/{other_id}/role",
        headers=admin_headers,
        json={"superadmin": False},
    )
    assert r.status_code == 409
    assert "POIPOIHISAB_SUPERADMIN_EMAILS" in r.json()["detail"]
    # Access genuinely unchanged, which is exactly why 200 would have lied.
    assert (await client.get("/api/v1/admin/stats", headers=other_headers)).status_code == 200


@pytest.mark.asyncio
async def test_env_only_admin_cannot_empty_the_db_of_superadmins(
    client: AsyncClient,
) -> None:
    """The silent lockout: env config is not a durable admin record."""
    admin_headers, _ = await _admin(client)
    _h, only_id = await _register(client, "only@test.dev", "Only DB Admin")

    r = await client.post(
        f"/api/v1/admin/users/{only_id}/role",
        headers=admin_headers,
        json={"superadmin": True},
    )
    assert r.status_code == 200

    for call in (
        client.post(
            f"/api/v1/admin/users/{only_id}/role",
            headers=admin_headers,
            json={"superadmin": False},
        ),
        client.post(
            f"/api/v1/admin/users/{only_id}/suspend",
            headers=admin_headers,
            json={"suspended": True},
        ),
        client.delete(f"/api/v1/admin/users/{only_id}", headers=admin_headers),
    ):
        r = await call
        assert r.status_code == 409, r.text
        assert "last superadmin" in r.json()["detail"]


@pytest.mark.asyncio
async def test_guard_allows_the_action_once_a_second_db_admin_exists(
    client: AsyncClient,
) -> None:
    admin_headers, _admin_id = await _admin(client)
    _h, first_id = await _register(client, "first@test.dev")
    _h2, second_id = await _register(client, "second@test.dev")

    for uid in (first_id, second_id):
        r = await client.post(
            f"/api/v1/admin/users/{uid}/role", headers=admin_headers, json={"superadmin": True}
        )
        assert r.status_code == 200

    r = await client.post(
        f"/api/v1/admin/users/{first_id}/role",
        headers=admin_headers,
        json={"superadmin": False},
    )
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_sees_and_revokes_another_users_sessions(client: AsyncClient) -> None:
    """/auth/sessions is self-scoped; suspension was the only prior lever."""
    admin_headers, _ = await _admin(client)
    user_headers, user_id = await _register(client, "phone@test.dev", "Phone Owner")

    r = await client.get("/api/v1/admin/sessions", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totalSessions"] >= 2
    listed = {i["userId"]: i for i in body["items"]}
    assert listed[user_id]["sessionCount"] == 1
    assert listed[user_id]["maxExpiresIn"] > 0
    # Tests run on MemoryKV, which is exactly the condition worth flagging.
    assert body["kvBackend"] == "MemoryKV"
    assert body["kvEphemeral"] is True

    r = await client.post(
        f"/api/v1/admin/users/{user_id}/revoke-sessions", headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["revoked"] == 1

    # Signed out everywhere, but NOT suspended — they can log back in.
    assert (await client.get("/api/v1/auth/me", headers=user_headers)).status_code == 401
    again = await client.post(
        "/api/v1/auth/login", json={"email": "phone@test.dev", "password": PASSWORD}
    )
    assert again.status_code == 200, again.text

    r = await client.get(
        "/api/v1/admin/audit",
        headers=admin_headers,
        params={"action": "user.sessions_revoke"},
    )
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_revoke_sessions_unknown_user_404(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    r = await client.post(
        f"/api/v1/admin/users/{uuid.uuid4()}/revoke-sessions", headers=admin_headers
    )
    assert r.status_code == 404


# --------------------------------------------------------------------------
# Analytics
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_analytics_aggregates_across_users(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    a_headers, a_id = await _register(client, "spender@test.dev", "Big Spender")
    b_headers, _b_id = await _register(client, "saver@test.dev", "Saver")

    await _expense(client, a_headers, cat="মাছ", grp="food", amt="900.00", pay="cash")
    await _expense(client, a_headers, cat="রিকশা", grp="transport", amt="60.00", pay="bkash")
    await _expense(client, b_headers, cat="মাছ", grp="food", amt="100.00", pay="cash")

    r = await client.get("/api/v1/admin/analytics", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()

    groups = {g["label"]: g for g in body["byGroup"]}
    assert groups["food"]["count"] == 2
    assert groups["food"]["amount"] == "1000.00"
    assert groups["transport"]["amount"] == "60.00"

    cats = {c["label"]: c for c in body["byCategory"]}
    assert cats["মাছ"]["count"] == 2

    pays = {p["label"] for p in body["byPayment"]}
    assert {"cash", "bkash"} <= pays

    # Trend covers a rolling window of months, newest last.
    assert len(body["trend"]) == 12
    assert body["trend"][0]["month"] < body["trend"][-1]["month"]
    assert sum(pt["expenses"] for pt in body["trend"]) == 3

    top = body["topUsers"]
    assert top[0]["userId"] == a_id
    assert top[0]["totalExpense"] == "960.00"

    # Aggregate-only: no individual expense rows leak out of this endpoint.
    assert "items" not in body


@pytest.mark.asyncio
async def test_analytics_window_zero_months_and_all_time_totals(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.routers import admin as admin_router

    class SeptemberClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 9, 10, tzinfo=UTC)

    monkeypatch.setattr(admin_router, "datetime", SeptemberClock)
    headers, _ = await _admin(client)
    for iso, amount in [("2025-09-30", "900.00"), ("2025-10-01", "0.25"), ("2026-09-01", "0.50"), ("2026-10-01", "700.00")]:
        await _expense(client, headers, iso=iso, amt=amount)
    debt = await client.post("/api/v1/debts", headers=headers, json={"party": "QA borrower", "dir": "lend", "amt": "80.00"})
    assert debt.status_code == 201
    paid = await client.post(f"/api/v1/debts/{debt.json()['id']}/pay", headers=headers, json={"amt": "80.00"})
    assert paid.status_code == 200
    body = (await client.get("/api/v1/admin/analytics", headers=headers)).json()
    assert body["trend"][0]["month"] == "2025-10"
    assert body["trend"][-1]["month"] == "2026-09"
    assert len(body["trend"]) == 12
    assert body["trend"][0]["amount"] == "0.25"
    assert body["trend"][1]["amount"] == "0.00"
    assert body["trend"][1]["expenses"] == 0
    assert body["trend"][-1]["amount"] == "0.50"
    assert sum(point["expenses"] for point in body["trend"]) == 2
    # These panels are all-time, not filtered by the trend's rolling window.
    assert body["byGroup"][0]["amount"] == "1600.75"
    assert body["topUsers"][0]["totalExpense"] == "1600.75"
    # A settled row retains its amount, so this is not outstanding debt.
    assert body["debtLend"] == "80.00"
    assert "items" not in body


@pytest.mark.asyncio
async def test_analytics_empty_platform_has_zero_filled_trend(client: AsyncClient) -> None:
    headers, _ = await _admin(client)
    result = await client.get("/api/v1/admin/analytics", headers=headers)
    assert result.status_code == 200
    body = result.json()
    assert len(body["trend"]) == 12
    assert all(point["amount"] == "0.00" and point["expenses"] == 0 for point in body["trend"])
    assert all(body[key] == [] for key in ("byGroup", "byCategory", "byPayment", "topUsers"))
    assert body["debtLend"] == body["debtBorrow"] == "0.00"


@pytest.mark.asyncio
async def test_analytics_requires_superadmin(client: AsyncClient) -> None:
    get_settings().superadmin_emails = ["nobody@test.dev"]
    headers, _ = await _register(client, "nosy@test.dev")
    assert (await client.get("/api/v1/admin/analytics", headers=headers)).status_code == 403


# --------------------------------------------------------------------------
# Taxonomy
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_category_merge_rewrites_every_users_rows(client: AsyncClient) -> None:
    """cat/grp are free text, so the same thing gets spelled several ways."""
    admin_headers, _ = await _admin(client)
    a_headers, _a = await _register(client, "one@test.dev")
    b_headers, _b = await _register(client, "two@test.dev")

    await _expense(client, a_headers, cat="রিক্সা", grp="transport", amt="40.00")
    await _expense(client, b_headers, cat="রিক্সা", grp="other", amt="50.00")
    await _expense(client, b_headers, cat="রিকশা", grp="transport", amt="60.00")

    r = await client.get("/api/v1/admin/categories", headers=admin_headers)
    assert r.status_code == 200, r.text
    labels = {(i["cat"], i["grp"]): i for i in r.json()["items"]}
    assert labels[("রিক্সা", "transport")]["userCount"] == 1
    assert labels[("রিক্সা", "other")]["count"] == 1

    r = await client.post(
        "/api/v1/admin/categories/merge",
        headers=admin_headers,
        json={"fromCat": "রিক্সা", "toCat": "রিকশা", "toGrp": "transport"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["affectedCount"] == 2

    r = await client.get("/api/v1/admin/categories", headers=admin_headers)
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["cat"] == "রিকশা"
    assert items[0]["grp"] == "transport"
    assert items[0]["count"] == 3
    assert items[0]["userCount"] == 2

    r = await client.get(
        "/api/v1/admin/audit", headers=admin_headers, params={"action": "category.merge"}
    )
    entry = r.json()["items"][0]
    assert entry["affected"] == 2
    assert entry["targetLabel"] == "রিক্সা → রিকশা"


@pytest.mark.asyncio
async def test_category_merge_rejects_unknown_and_noop(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    user_headers, _ = await _register(client, "cat@test.dev")
    await _expense(client, user_headers, cat="চা")

    r = await client.post(
        "/api/v1/admin/categories/merge",
        headers=admin_headers,
        json={"fromCat": "নেই", "toCat": "চা"},
    )
    assert r.status_code == 404

    r = await client.post(
        "/api/v1/admin/categories/merge",
        headers=admin_headers,
        json={"fromCat": "চা", "toCat": "চা"},
    )
    assert r.status_code == 400


# --------------------------------------------------------------------------
# Bulk-delete limits
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_delete_refuses_an_oversized_batch(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    r = await client.post(
        "/api/v1/admin/users/bulk-delete",
        headers=admin_headers,
        json={"userIds": [str(uuid.uuid4()) for _ in range(101)]},
    )
    assert r.status_code == 400
    assert "smaller batches" in r.json()["detail"]


@pytest.mark.asyncio
async def test_bulk_delete_is_rate_limited_per_admin(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    body = {"userIds": [str(uuid.uuid4())]}
    for _ in range(5):
        r = await client.post(
            "/api/v1/admin/users/bulk-delete", headers=admin_headers, json=body
        )
        assert r.status_code == 200, r.text
    r = await client.post("/api/v1/admin/users/bulk-delete", headers=admin_headers, json=body)
    assert r.status_code == 429
    assert r.headers.get("Retry-After")


# --------------------------------------------------------------------------
# System & integrations
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_system_probe_flags_the_ephemeral_kv_fallback(client: AsyncClient) -> None:
    """The failure with no other symptom anywhere in the UI."""
    admin_headers, _ = await _admin(client)
    r = await client.get("/api/v1/admin/system", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["dbOk"] is True
    assert body["dbDialect"] == "sqlite"
    assert body["kvBackend"] == "MemoryKV"
    assert body["kvEphemeral"] is True
    assert body["kvConfigured"] is False
    assert body["auditTablePresent"] is True
    assert any("POIPOIHISAB_KV_URL" in warning for warning in body["warnings"])
    assert body["env"] == "local"
    assert body["version"]


@pytest.mark.asyncio
async def test_integrations_never_echoes_the_credential(client: AsyncClient) -> None:
    admin_headers, _ = await _admin(client)
    settings = get_settings()
    previous = settings.google_sheets_sa_file
    settings.google_sheets_sa_file = '{"client_email":"svc@example.iam.gserviceaccount.com"}'
    try:
        r = await client.get("/api/v1/admin/integrations", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["sheetsSaFile"] == "(inline JSON)"
        assert "client_email" not in str(body)
        assert body["usersTotal"] == 1
    finally:
        settings.google_sheets_sa_file = previous


@pytest.mark.asyncio
async def test_system_and_integrations_require_superadmin(client: AsyncClient) -> None:
    get_settings().superadmin_emails = ["nobody@test.dev"]
    headers, _ = await _register(client, "curious@test.dev")
    assert (await client.get("/api/v1/admin/system", headers=headers)).status_code == 403
    assert (await client.get("/api/v1/admin/integrations", headers=headers)).status_code == 403
