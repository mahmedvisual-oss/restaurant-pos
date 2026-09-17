# Vercel Python runtime entrypoint.
# app.py owns the Turso transport configuration.  In particular, it installs
# a requests-based keep-alive transport with a bounded timeout for serverless
# requests.  Do not restore turso_serverless.Session._post here: doing so
# replaces that bounded transport with urllib.request.urlopen() and can leave
# a Vercel invocation hanging until the platform's 60-second timeout.
from app import app

# The application itself remains in the repository root as app.py.
