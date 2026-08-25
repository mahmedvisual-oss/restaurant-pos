# Database layer

The V2 database layer has three responsibilities:

1. Open a configured database connection.
2. Apply versioned migrations in order.
3. Expose transaction boundaries to repositories/services.

It must not contain restaurant business rules.

## Configuration

- Local development defaults to `instance/restaurant_v2.db`.
- Production requires an explicit `DATABASE_URL` or `TURSO_URL`.
- If Turso is selected, `TURSO_AUTH_TOKEN` is mandatory.
- There is no silent production SQLite fallback.

## Migration rules

- Migration files are immutable after release.
- Each migration has a monotonic numeric prefix.
- Applied migrations are recorded in `schema_migrations` with a SHA-256 checksum.
- A modified already-applied migration is a startup error.
- A failed migration is rolled back and aborts startup.
- Migrations are never executed on every HTTP request.

## Transaction rules

Financial operations must be atomic. An operation that changes an order, payment, inventory movement, or cash balance must either complete all related writes or commit none of them.

The migration runner deliberately executes statements under explicit transaction control instead of using SQLite `executescript`, so a failed migration cannot leave a partially applied schema.
