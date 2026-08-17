import os
import sys
from pathlib import Path

# Keep the test module importable from the repository root.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_credit_is_not_a_real_collection_method():
    import app
    assert app._canon_method("آجل") == "آجل"
    assert app._canon_method("نقداً") == "نقدي"


def test_real_payment_methods_are_canonicalized():
    import app
    assert app._canon_method("تحويل BCA") == "BCA"
    assert app._canon_method("تحويل مانديري") == "مانديري"


def test_tax_rate_is_configurable_without_hardcoding_reports():
    import app
    assert hasattr(app, "get_tax_rate")
