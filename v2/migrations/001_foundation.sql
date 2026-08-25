-- V2 foundation. Intentionally independent from the legacy application.
-- This migration contains only global infrastructure. Business entities belong to later migrations.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_settings(key, value) VALUES
    ('default_locale', 'id'),
    ('timezone', 'Asia/Jakarta'),
    ('currency', 'IDR'),
    ('tax_rate', '0.03');
