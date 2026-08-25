# Database layer

The V2 database layer has three responsibilities:

1. Open a configured database connection.
2. Apply versioned migrations in order.
3. Expose transaction boundaries to repositories/services.

It must not contain restaurant business rules.

## Migration rules

- Migration files are immutable after release.
- Each migration has a monotonic numeric prefix.
- Applied migrations are recorded in `schema_migrations`.
- A failed migration aborts startup; the application must not continue against a partially migrated schema.
- Migrations are never executed on every HTTP request.
- Production database configuration is explicit; there is no silent SQLite fallback.

## Transaction rules

Financial operations must be atomic. An operation that changes an order, payment, inventory movement, or cash balance must either complete all related writes or commit none of them.
