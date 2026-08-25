"""Versioned, fail-fast migration runner for Restaurant POS V2."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from .connection import Database


_MIGRATION_NAME = re.compile(r"^(\d+)_([a-z0-9_]+)\.sql$")


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    sql: str
    checksum: str


def load_migrations(directory: str | Path) -> list[Migration]:
    root = Path(directory)
    if not root.is_dir():
        raise MigrationError(f"Migration directory does not exist: {root}")

    migrations: list[Migration] = []
    seen_versions: set[str] = set()
    for path in sorted(root.glob("*.sql")):
        match = _MIGRATION_NAME.match(path.name)
        if not match:
            raise MigrationError(f"Invalid migration filename: {path.name}")
        number, name = match.groups()
        version = str(int(number))
        if version in seen_versions:
            raise MigrationError(f"Duplicate migration version: {version}")
        seen_versions.add(version)
        sql = path.read_text(encoding="utf-8")
        migrations.append(
            Migration(
                version=version,
                name=name,
                sql=sql,
                checksum=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
            )
        )

    if not migrations:
        raise MigrationError("No migration files found")
    return sorted(migrations, key=lambda item: int(item.version))


def _ensure_metadata_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def migrate(db: Database, directory: str | Path) -> list[str]:
    migrations = load_migrations(directory)
    applied: list[str] = []

    with db.transaction() as conn:
        _ensure_metadata_table(conn)
        existing = {
            row[0]: row[1]
            for row in conn.execute("SELECT version, checksum FROM schema_migrations").fetchall()
        }

        for migration in migrations:
            previous = existing.get(migration.version)
            if previous is not None:
                if previous != migration.checksum:
                    raise MigrationError(
                        f"Migration {migration.version}_{migration.name} was modified after application"
                    )
                continue

            try:
                conn.executescript(migration.sql)
                conn.execute(
                    "INSERT INTO schema_migrations(version, checksum) VALUES (?, ?)",
                    (migration.version, migration.checksum),
                )
            except Exception as exc:
                raise MigrationError(
                    f"Migration {migration.version}_{migration.name} failed"
                ) from exc
            applied.append(migration.version)

    return applied
