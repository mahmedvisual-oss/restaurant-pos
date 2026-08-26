# Save the driver's real transport method before app.py imports.
# app.py historically monkey-patches Session._post with requests, but that
# bypasses turso_serverless' libsql:// -> https:// URL normalization and can
# produce requests to an invalid "libsql://.../v3/cursor" URL on Vercel.
from turso_serverless import session as _turso_session

_ORIGINAL_SESSION_POST = _turso_session.Session._post

from app import app

# Restore the driver's native transport after app.py finishes importing.
# This keeps the existing application code/connection limits while letting
# turso_serverless handle URL normalization and cursor/pipeline requests.
_turso_session.Session._post = _ORIGINAL_SESSION_POST

# Vercel Python runtime entrypoint.
# The application itself remains in the repository root as app.py.
