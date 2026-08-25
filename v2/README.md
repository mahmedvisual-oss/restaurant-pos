# Restaurant POS V2

A clean rebuild of the restaurant POS system.

## Principles

- The legacy application is reference-only.
- V2 has a new database schema and migration history.
- Financial records are immutable/auditable wherever practical.
- Every business entity uses a stable primary key; table numbers are display attributes, not identifiers.
- UI translations are mandatory: user-visible text must come from the translation system, never hard-coded per-language strings in business logic.
- Default UI language: Indonesian.
- Arabic and other supported languages use the same translation keys and must not leak text from another language.
- Database, domain/business rules, API, and presentation are separated.
- Automated tests are part of every module.

## Initial architecture

```text
v2/
  app/
    core/
    db/
    models/
    repositories/
    services/
    routes/
    auth/
    accounting/
    i18n/
  migrations/
  templates/
  public/
  tests/
```

## First milestone

Build the database foundation and migration runner before implementing POS screens.
