"""Health endpoint contract tests (Phase 1)."""

from httpx import AsyncClient
from pytest import MonkeyPatch

from app.core.config import Settings, get_settings


def test_runtime_version_override_remains_supported(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("POIPOIHISAB_VERSION", "0.28.0-staging.1")
    settings = Settings(_env_file=None, env="test", jwt_secret="version-test-only")
    assert settings.version == "0.28.0-staging.1"


async def test_root_healthz(client: AsyncClient) -> None:
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ok",
        "version": get_settings().version,
        "env": "local",
    }


async def test_api_v1_healthz(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/healthz")
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ok",
        "version": get_settings().version,
        "env": "local",
    }
