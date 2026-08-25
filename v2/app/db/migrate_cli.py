"""Command-line entry point for V2 database migrations."""

from __future__ import annotations

import argparse
from pathlib import Path

from .connection import Database, DatabaseConfigurationError
from .migrations import MigrationError, migrate


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MIGRATIONS = ROOT / "migrations"


def main() -> int:
    parser = argparse.ArgumentParser(description="Restaurant POS V2 database migrations")
    parser.add_argument("--migrations", default=str(DEFAULT_MIGRATIONS))
    args = parser.parse_args()

    try:
        applied = migrate(Database(), args.migrations)
    except (DatabaseConfigurationError, MigrationError) as exc:
        print(f"Migration failed: {exc}")
        return 1

    if applied:
        print("Applied migrations:", ", ".join(applied))
    else:
        print("Database schema is already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
