"""V2 database connection and transaction primitives."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator


class DatabaseConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class DatabaseConfig:
    driver: str
    url: str
    auth_token: str = ""

    @classmethod
    def from_environment(cls) -> "DatabaseConfig":
        url = (os.getenv("DATABASE_URL") or "").strip()
        turso_url = (os.getenv("TURSO_URL") or "").strip()
        turso_token = (os.getenv("TURSO_AUTH_TOKEN") or "").strip()

        if turso_url:
            if not turso_token:
                raise DatabaseConfigurationError("TURSO_AUTH_TOKEN is required when TURSO_URL is configured")
            return cls(driver="turso", url=turso_url, auth_token=turso_token)

        if url.startswith("turso://"):
            raise DatabaseConfigurationError("Turso requires TURSO_AUTH_TOKEN")

        if url:
            if url.startswith("sqlite:///"):
                return cls(driver="sqlite", url=url.removeprefix("sqlite:///"))
            raise DatabaseConfigurationError("Unsupported DATABASE_URL; V2 currently supports SQLite or Turso")

        # Local development only. Production must provide an explicit database URL.
        if os.getenv("V2_ENV", "development").lower() == "production":
            raise DatabaseConfigurationError("DATABASE_URL or TURSO_URL is required in production")
        return cls(driver="sqlite", url=os.path.join("instance", "restaurant_v2.db"))


class Database:
    def __init__(self, config: DatabaseConfig | None = None):
        self.config = config or DatabaseConfig.from_environment()

    def connect(self):
        if self.config.driver == "sqlite":
            path = self.config.url
            if path != ":memory:":
                os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 5000")
            return conn

        try:
            import turso_serverless
        except Exception as exc:  # pragma: no cover - environment dependent
            raise DatabaseConfigurationError("Turso driver is not installed") from exc
        conn = turso_serverless.connect(self.config.url, auth_token=self.config.auth_token)
        conn.row_factory = lambda cur, row: row
        return conn

    @contextmanager
    def transaction(self) -> Iterator[object]:
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            finally:
                conn.close()
            raise
        else:
            conn.close()
