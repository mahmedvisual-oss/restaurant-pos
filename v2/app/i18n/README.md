# Translation system

All user-visible strings must use translation keys.

Rules:

1. Indonesian (`id`) is the default UI language.
2. Arabic (`ar`) and English (`en`) are supported from the same key set.
3. A missing translation is a test failure, not a reason to display another language silently.
4. Business logic never contains UI translations.
5. Reports, receipts, kitchen screens, dialogs, validation errors, buttons, table labels, payment methods, and status labels all use translation keys.
6. Database values represent stable codes/IDs where possible; translated labels are resolved at presentation time.
7. Translation completeness will be tested automatically for every supported locale.
