from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db.connection import Database, DatabaseConfig, DatabaseConfigurationError
from app.db.migrations import MigrationError, migrate


class DatabaseFoundationTests(unittest.TestCase):
    def test_local_database_is_explicit_and_foreign_keys_are_enabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pos.db"
            db = Database(DatabaseConfig(driver="sqlite", url=str(path)))
            conn = db.connect()
            try:
                self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            finally:
                conn.close()

    def test_production_requires_explicit_database_configuration(self):
        old = __import__("os").environ.get("V2_ENV")
        __import__("os").environ["V2_ENV"] = "production"
        try:
            with self.assertRaises(DatabaseConfigurationError):
                DatabaseConfig.from_environment()
        finally:
            if old is None:
                __import__("os").environ.pop("V2_ENV", None)
            else:
                __import__("os").environ["V2_ENV"] = old

    def test_migrations_are_idempotent_and_checksum_protected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "pos.db"
            migrations = root / "migrations"
            migrations.mkdir()
            migration = migrations / "001_test.sql"
            migration.write_text(
                "CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n"
                "INSERT INTO sample(id, name) VALUES (1, 'ok');\n",
                encoding="utf-8",
            )
            db = Database(DatabaseConfig(driver="sqlite", url=str(db_path)))

            self.assertEqual(migrate(db, migrations), ["1"])
            self.assertEqual(migrate(db, migrations), [])

            migration.write_text(
                "CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL, extra TEXT);\n",
                encoding="utf-8",
            )
            with self.assertRaises(MigrationError):
                migrate(db, migrations)

    def test_failed_migration_does_not_leave_partial_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            migrations = root / "migrations"
            migrations.mkdir()
            (migrations / "001_broken.sql").write_text(
                "CREATE TABLE should_rollback (id INTEGER PRIMARY KEY);\n"
                "INSERT INTO should_rollback(id) VALUES (1);\n"
                "THIS IS INVALID SQL;\n",
                encoding="utf-8",
            )
            db = Database(DatabaseConfig(driver="sqlite", url=str(root / "pos.db")))

            with self.assertRaises(MigrationError):
                migrate(db, migrations)

            conn = db.connect()
            try:
                exists = conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='should_rollback'"
                ).fetchone()
                self.assertIsNone(exists)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
