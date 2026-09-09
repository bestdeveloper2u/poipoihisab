"""Application settings (pydantic-settings).

Every environment variable is prefixed with ``poipoihisab_`` (e.g.
``poipoihisab_DATABASE_URL``). Complex values such as ``cors_origins`` are parsed
from JSON (a list of origin strings).
"""

import secrets
import warnings
from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="POIPOIHISAB_", env_file=".env", extra="ignore", case_sensitive=False
    )

    app_name: str = "Poi Poi Hisab API"
    version: str = "0.28.0"
    env: str = "local"
    database_url: str = "sqlite+aiosqlite:///./poipoihisab.db"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:80",
    ]
    # --- Phase 1 auth (ADR-0002) -------------------------------------------
    # HS256 signing secret for access tokens. REQUIRED when poipoihisab_ENV=prod;
    # otherwise an ephemeral random secret is generated (with a warning) so
    # local/test runs stay hermetic (tokens do not survive restarts).
    jwt_secret: str = ""
    # Redis connection for sessions/rate-limits; empty -> in-process MemoryKV.
    kv_url: str = ""
    access_ttl: int = 900  # 15 min
    refresh_ttl: int = 2_592_000  # 30 days
    auth_rate_limit: int = 5  # requests per minute on credential endpoints
    # --- httpOnly-cookie refresh transport (ADR-0008 addendum) --------------
    # ``Secure`` attribute of the ``kh_refresh`` cookie. ALWAYS ON in real
    # environments; flip to ``poipoihisab_REFRESH_COOKIE_SECURE=0`` only for the
    # plain-http test client (http:// cannot carry Secure cookies).
    refresh_cookie_secure: bool = True
    # --- Google Sheets export (zero-AI-cost REST sync) -----------------------
    # Service-account JSON path for Sheets sync; empty -> export unconfigured.
    google_sheets_sa_file: str = ""
    # --- Superadmin access --------------------------------------------------
    # List of emails that automatically receive superadmin privileges.
    superadmin_emails: list[str] = ["iforuimran@gmail.com"]

    @field_validator("superadmin_emails", mode="before")
    @classmethod
    def _parse_superadmin_emails(cls, v: object) -> list[str]:
        if isinstance(v, str):
            import json

            if v.strip().startswith("[") and v.strip().endswith("]"):
                try:
                    return [str(e).strip().lower() for e in json.loads(v)]
                except (ValueError, TypeError):
                    pass
            return [e.strip().lower() for e in v.split(",") if e.strip()]
        if isinstance(v, (list, tuple, set)):
            return [str(e).strip().lower() for e in v if str(e).strip()]
        return ["iforuimran@gmail.com"]

    @model_validator(mode="after")
    def _resolve_jwt_secret(self) -> "Settings":
        if self.jwt_secret:
            return self
        if self.env.lower() in {"prod", "production"}:
            raise ValueError(
                "poipoihisab_JWT_SECRET is required when poipoihisab_ENV=prod"
            )
        warnings.warn(
            "poipoihisab_JWT_SECRET not set; generated an ephemeral secret "
            "(issued tokens will not survive a restart)",
            stacklevel=1,
        )
        self.jwt_secret = secrets.token_urlsafe(48)
        return self


@lru_cache
def get_settings() -> Settings:
    """Return the cached process-wide settings instance."""
    return Settings()
