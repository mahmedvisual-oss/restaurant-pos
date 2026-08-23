import os
import sqlite3
import socket
import hashlib
import hmac
import base64
import secrets
import json
import shutil
import tempfile
import atexit
import time
import threading
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, Response, send_file

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE, "restaurant.db")
BACKUP_DIR = os.path.join(BASE, "backups")
# على Vercel مجلد المشروع للقراءة فقط؛ نستخدم /tmp القابل للكتابة للنسخ
_ON_VERCEL = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"))
if _ON_VERCEL:
    BACKUP_DIR = os.path.join(tempfile.gettempdir(), "restaurant_backups")

# المنطقة الزمنية للمطعم (مهم لمطابقة اليومية والتقارير مع وقت العمل الفعلي)
TZ_NAME = os.environ.get("POS_TZ", "Asia/Jakarta")
os.environ["TZ"] = TZ_NAME
try:
    time.tzset()
except Exception:
    pass
TZ_OFFSET_HOURS = 7.0  # Asia/Jakarta = UTC+7 (قابل للتغيير عبر POS_TZ_OFFSET)
try:
    TZ_OFFSET_HOURS = float(os.environ.get("POS_TZ_OFFSET", "7"))
except (TypeError, ValueError):
    pass
_tz = None
try:
    from zoneinfo import ZoneInfo
    _tz = ZoneInfo(TZ_NAME)
except Exception:
    try:
        import pytz
        _tz = pytz.timezone(TZ_NAME)
    except Exception:
        _tz = None


def _now():
    """التاريخ/الوقت المحلي للمطعم موحّداً في كل النظام (يعمل حتى بدون مكتبات مناطق)."""
    if _tz is not None:
        try:
            return datetime.fromtimestamp(time.time(), _tz).replace(tzinfo=None)
        except Exception:
            pass
    return datetime.utcnow() + timedelta(hours=TZ_OFFSET_HOURS)


def _now_sql():
    """صيغة datetime سلسلة للـ DB (نص محلي بدون فرق توقيت)."""
    return _now().strftime("%Y-%m-%d %H:%M:%S")

METHOD_SYNONYMS = {
    "نقداً": "نقدي",
    "تحويل BCA": "BCA",
    "تحويل مانديري": "مانديري",
    "Transfer BCA": "BCA",
    "Transfer Mandiri": "مانديري",
}

def _canon_method(m):
    return METHOD_SYNONYMS.get(m, m)

def _report_method(m):
    m = _canon_method(m)
    return {
        "BCA": "تحويل بنكي - BCA",
        "مانديري": "تحويل بنكي - Mandiri",
    }.get(m, m)

app = Flask(__name__, static_folder="public", static_url_path="")
app.config["TEMPLATES_AUTO_RELOAD"] = True

_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
_asset_hash_cache = {}


@app.context_processor
def _inject_static_versions():
    def asset_ver(name):
        try:
            if name in _asset_hash_cache:
                return _asset_hash_cache[name]
            h = "0"
            # Try direct file read first (works locally)
            for path in [
                os.path.join(app.static_folder or "", name),
                os.path.join(_STATIC_DIR, name),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), name),
                os.path.join(os.getcwd(), "public", name),
            ]:
                if os.path.exists(path):
                    with open(path, "rb") as f:
                        h = hashlib.md5(f.read()).hexdigest()[:10]
                    break
            else:
                # Vercel serves /public via its own static pipeline;
                # self-fetch once to derive a stable content hash.
                try:
                    import urllib.request
                    host = request.headers.get("X-Forwarded-Host") or request.host
                    scheme = request.headers.get("X-Forwarded-Proto") or request.scheme
                    url = f"{scheme}://{host}/{name}"
                    with urllib.request.urlopen(url, timeout=3) as resp:
                        h = hashlib.md5(resp.read()).hexdigest()[:10]
                except Exception:
                    h = "0"
            _asset_hash_cache[name] = h
            return h
        except Exception:
            return "0"
    return {"asset_ver": asset_ver}


@app.after_request
def _no_cache(resp):
    path = request.path
    if path in ("/", "/kitchen"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp

_SECRET_KEY_ENV = os.environ.get("SECRET_KEY", "").strip()
sk_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret_key.txt")
if _SECRET_KEY_ENV:
    app.secret_key = _SECRET_KEY_ENV
elif os.path.exists(sk_path):
    app.secret_key = open(sk_path).read().strip()
else:
    app.secret_key = secrets.token_hex(32)
    try:
        with open(sk_path, "w") as f:
            f.write(app.secret_key)
    except Exception:
        pass

# جلسة دائمة تنتهي بعد 12 ساعة، وكوكي آمن على الإنتاج (HTTPS)
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = _ON_VERCEL

PIN_HASH_PREFIX = "$hs$"


def hash_pin(pin):
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 100000)
    return PIN_HASH_PREFIX + base64.b64encode(salt + h).decode()


def verify_pin(pin, stored):
    if not stored or not pin:
        return False
    if stored.startswith("sha256:"):
        prefix = "sha256:"
    elif not stored.startswith(PIN_HASH_PREFIX):
        return False
    else:
        prefix = PIN_HASH_PREFIX
    try:
        raw = base64.b64decode(stored[len(prefix):])
        salt, expected = raw[:16], raw[16:]
        h = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 100000)
        return hmac.compare_digest(h, expected)
    except Exception:
        return False


MENU = [
    {"emoji": "🥤", "name": "بيبسي", "category": "مشروبات", "price": 5},
    {"emoji": "🥤", "name": "سفن أب", "category": "مشروبات", "price": 5},
    {"emoji": "🍊", "name": "عصير برتقال", "category": "مشروبات", "price": 8},
    {"emoji": "☕", "name": "موكا", "category": "مشروبات", "price": 12},
    {"emoji": "☕", "name": "لاتيه", "category": "مشروبات", "price": 10},
    {"emoji": "☕", "name": "إسبريسو", "category": "مشروبات", "price": 8},
    {"emoji": "🍵", "name": "شاي", "category": "مشروبات", "price": 4},
    {"emoji": "☕", "name": "قهوة عربية", "category": "مشروبات", "price": 6},
    {"emoji": "🍔", "name": "برجر لحم", "category": "أطباق رئيسية", "price": 28},
    {"emoji": "🍗", "name": "برجر دجاج", "category": "أطباق رئيسية", "price": 22},
    {"emoji": "🍕", "name": "بيتزا مارغريتا", "category": "أطباق رئيسية", "price": 32},
    {"emoji": "🍕", "name": "بيتزا بحرية", "category": "أطباق رئيسية", "price": 45},
    {"emoji": "🍖", "name": "مشكل مشاوي", "category": "أطباق رئيسية", "price": 65},
    {"emoji": "🍗", "name": "دجاج مشوي", "category": "أطباق رئيسية", "price": 40},
    {"emoji": "🥗", "name": "سلطة سيزر", "category": "مقبلات", "price": 15},
    {"emoji": "🫘", "name": "حمص", "category": "مقبلات", "price": 12},
    {"emoji": "🍆", "name": "متبل", "category": "مقبلات", "price": 12},
    {"emoji": "🍮", "name": "كنافة", "category": "حلويات", "price": 22},
    {"emoji": "🍨", "name": "أم علي", "category": "حلويات", "price": 25},
    {"emoji": "🍰", "name": "تشيز كيك", "category": "حلويات", "price": 20},
]

CAT_COLORS = {
    "مشروبات": "#06b6d4",
    "أطباق رئيسية": "#f97316",
    "مقبلات": "#10b981",
    "حلويات": "#ec4899",
}

TAX_RATE = 0.03


# ===== وضع السحابة (Turso) =====
TURSO_URL = (os.environ.get("TURSO_URL") or os.environ.get("LIBSQL_URL") or "").strip().lstrip("\ufeff")
TURSO_AUTH_TOKEN = (os.environ.get("TURSO_AUTH_TOKEN") or os.environ.get("LIBSQL_AUTH_TOKEN") or "").strip().lstrip("\ufeff")

try:
    import turso_serverless as _ts
    _TS_AVAILABLE = True
except Exception:
    _ts = None
    _TS_AVAILABLE = False

CLOUD_DB = bool(TURSO_URL) and _TS_AVAILABLE
if _ON_VERCEL and not CLOUD_DB:
    raise RuntimeError("PRODUCTION DATABASE MISCONFIGURED: Turso is required on Vercel; refusing SQLite fallback")
DB_INTEGRITY = _ts.IntegrityError if CLOUD_DB else sqlite3.IntegrityError

# إعادة استخدام الاتصالات (keep-alive): الـ driver الأصلي يفتح اتصال HTTPS جديد مع كل
# جملة SQL (مصافحة TLS كاملة لكل استعلام = بطء شديد). نستبدل طبقة النقل بجلسة
# requests دائمة تتم فيها إعادة استخدام الاتصال عبر كل الجمل في نفس العملية.
_HTTP_POOL = None
if CLOUD_DB:
    try:
        import requests as _req_mod
        from turso_serverless import session as _ts_sess

        _HTTP_POOL = _req_mod.Session()
        _HTTP_POOL.headers.update({"Connection": "keep-alive"})

        def _pooled_post(self, path, body):
            url = f"{self._base_url}{path}"
            data = json.dumps(body, allow_nan=False).encode("utf-8")
            try:
                try:
                    resp = _HTTP_POOL.post(url, data=data, headers=self._headers(), timeout=25)
                except _req_mod.RequestException as e:
                    self._reset_stream()
                    raise _ts_sess.ProtocolError(f"request to {url} failed: {e}") from None
            except _ts_sess.ProtocolError:
                raise
            except Exception as e:
                self._reset_stream()
                raise _ts_sess.ProtocolError(f"request to {url} failed: {e!r}") from None
            if resp.status_code != 200:
                self._reset_stream()
                message = None
                try:
                    parsed = resp.json()
                    if isinstance(parsed, dict):
                        for key in ("error", "message"):
                            if isinstance(parsed.get(key), str):
                                message = parsed[key]
                                break
                except ValueError:
                    pass
                if message is not None:
                    raise _ts_sess.ProtocolError(f"HTTP status {resp.status_code}: {message}") from None
                raise _ts_sess.ProtocolError(f"HTTP status {resp.status_code}") from None
            return resp.content

        _ts_sess.Session._post = _pooled_post
    except Exception:
        _HTTP_POOL = None


# ===== اتصالات Turso المحدودة الالتزامن =====
# كل _ts.connect يفتح بث HTTP إلى Turso. فتح بث جديد لكل طلب مع الاقتراع الدوري
# والتبويبات المتعددة كان يستنزف حد الاتصالات ويُسقط الطلبات والاستيراد على البارد
# ("Database connections limit exceeded"). كما أن إعادة استخدام بث قديم في بركة
# يفشل بعد انتهاء صلاحية البث ("stream not found"). الحل: اتصال جديد لكل استخدام
# (لا بث منتهٍ أبداً) مع سيمافور يحدّ التزامن إلى _CONN_MAX فلا يتجاوز الحد أبداً.
if CLOUD_DB:
    _CONN_MAX = 3
    _CONN_SEM = threading.Semaphore(_CONN_MAX)

    class _TConn:
        """غلاف: close() يقفل البث فعلياً ويحرر فتحة التزامن."""
        __slots__ = ("_c",)

        def __init__(self, c):
            self._c = c

        def __getattr__(self, name):
            return getattr(self._c, name)

        def close(self):
            c, self._c = self._c, None
            if c is None:
                return
            try:
                c.rollback()
            except Exception:
                pass
            try:
                c.close()
            except Exception:
                pass
            _CONN_SEM.release()

def _raw_conn():
    if CLOUD_DB:
        _CONN_SEM.acquire()
        try:
            c = _ts.connect(TURSO_URL, auth_token=TURSO_AUTH_TOKEN)
        except Exception:
            _CONN_SEM.release()
            raise
        c.row_factory = lambda cur, row: row
        return _TConn(c)
    return sqlite3.connect(DB_PATH)


def get_db():
    conn = _raw_conn()
    if not CLOUD_DB:
        conn.row_factory = sqlite3.Row
    return conn


_SCHEMA_DONE = False


def _ensure_schema(conn, c, log=True):
    """أضف الأعمدة والجداول الجديدة بأمان (تُنفَّذ مرة واحدة لكل عملية خادم فقط).

    كل عبارة SQL عبر HTTP على Turso = رحلة HTTP منفصلة (~20+ رحلة لكل استدعاء)،
    وتنفيذها لكل طلب مع الاقتراع المتزامن يستنزف حد الاتصالات ويُسبب مهلات 60s.
    لذلك تُنفَّذ مرة واحدة وتُتخطى بعدها حتى إعادة الإقلاع.
    """
    global _SCHEMA_DONE
    if _SCHEMA_DONE:
        return
    try:
        ocols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
        for col, ddl in (
            ("kitchen_status", "ALTER TABLE orders ADD COLUMN kitchen_status TEXT"),
            ("transfer_ref", "ALTER TABLE orders ADD COLUMN transfer_ref TEXT"),
            ("transfer_name", "ALTER TABLE orders ADD COLUMN transfer_name TEXT"),
            ("credit_name", "ALTER TABLE orders ADD COLUMN credit_name TEXT"),
            ("table_section", "ALTER TABLE orders ADD COLUMN table_section TEXT"),
            ("table_id", "ALTER TABLE orders ADD COLUMN table_id INTEGER"),
            ("reservation_id", "ALTER TABLE orders ADD COLUMN reservation_id INTEGER"),
        ):
            if col not in ocols:
                c.execute(ddl)
        c.execute("UPDATE orders SET kitchen_status='sent' WHERE kitchen_status IS NULL AND status='sent'")
        c.execute("UPDATE orders SET kitchen_status='ready' WHERE kitchen_status IS NULL AND status IN ('ready','completed','closed','cancelled')")
    except Exception as e:
        if log:
            print("ENSURE ORDERS ERR:", repr(e))
    try:
        c.execute("SELECT 1 FROM refund_receipts LIMIT 1").fetchone()
    except Exception:
        try:
            c.execute('''CREATE TABLE IF NOT EXISTS refund_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_no TEXT UNIQUE,
                order_id INTEGER NOT NULL,
                items TEXT,
                subtotal REAL DEFAULT 0,
                tax REAL DEFAULT 0,
                discount REAL DEFAULT 0,
                total REAL DEFAULT 0,
                refund_method TEXT DEFAULT 'نقدي',
                refund_ref TEXT,
                reason TEXT DEFAULT '',
                requested_by TEXT,
                approved_by TEXT,
                date TEXT DEFAULT (datetime('now','localtime'))
            )''')
        except Exception as e:
            if log:
                print("ENSURE REFUNDS ERR:", repr(e))
    try:
        c.execute("SELECT 1 FROM deposit_vouchers LIMIT 1").fetchone()
    except Exception:
        try:
            c.execute('''CREATE TABLE IF NOT EXISTS deposit_vouchers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_no TEXT UNIQUE,
                customer_name TEXT,
                phone TEXT,
                party_date TEXT,
                description TEXT,
                amount REAL DEFAULT 0,
                method TEXT DEFAULT 'نقدي',
                transfer_ref TEXT,
                transfer_name TEXT,
                employee TEXT,
                date TEXT DEFAULT (datetime('now','localtime'))
            )''')
        except Exception as e:
            if log:
                print("ENSURE VOUCHERS ERR:", repr(e))
    try:
        c.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
            ip TEXT NOT NULL,
            employee_id INTEGER,
            target TEXT DEFAULT 'login',
            attempts INTEGER DEFAULT 0,
            lock_until REAL DEFAULT 0,
            PRIMARY KEY (ip, employee_id, target)
        )''')
    except Exception as e:
        if log:
            print("ENSURE LOGIN_ATTEMPTS ERR:", repr(e))
    try:
        rcols = [r[1] for r in c.execute("PRAGMA table_info(reservations)").fetchall()]
        if "created_by" not in rcols:
            c.execute("ALTER TABLE reservations ADD COLUMN created_by INTEGER")
    except Exception as e:
        if log:
            print("ENSURE RESERVATIONS ERR:", repr(e))
    try:
        ecols = [r[1] for r in c.execute("PRAGMA table_info(employees)").fetchall()]
        for col, ddl in (
            ("phone", "ALTER TABLE employees ADD COLUMN phone TEXT DEFAULT ''"),
            ("salary", "ALTER TABLE employees ADD COLUMN salary REAL DEFAULT 0"),
            ("hire_date", "ALTER TABLE employees ADD COLUMN hire_date TEXT DEFAULT ''"),
            ("shift", "ALTER TABLE employees ADD COLUMN shift TEXT DEFAULT ''"),
            ("department", "ALTER TABLE employees ADD COLUMN department TEXT DEFAULT ''"),
            ("status", "ALTER TABLE employees ADD COLUMN status TEXT DEFAULT 'active'"),
            ("discount_limit", "ALTER TABLE employees ADD COLUMN discount_limit REAL DEFAULT 20"),
        ):
            if col not in ecols:
                c.execute(ddl)
    except Exception as e:
        if log:
            print("ENSURE EMPLOYEES ERR:", repr(e))
    try:
        c.execute('''CREATE TABLE IF NOT EXISTS discount_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee TEXT,
            employee_id INTEGER,
            order_id INTEGER,
            table_num TEXT,
            subtotal REAL DEFAULT 0,
            tax REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            limit_pct REAL DEFAULT 0,
            date TEXT DEFAULT (datetime('now','localtime'))
        )''')
    except Exception as e:
        if log:
            print("ENSURE DISCOUNT_LOG ERR:", repr(e))
    try:
        # تنظيف الدفع الزائد: لا رصيد برصيد سالب ولا paid أكبر من total (يُحسب الفرق كباقي رُدّ)
        c.execute("UPDATE credit_ledger SET paid=total WHERE paid > total AND total IS NOT NULL AND total >= 0")
    except Exception as e:
        if log:
            print("ENSURE OVERPAID CLEANUP ERR:", repr(e))
    try:
        # أعمدة سندات القبض وربط العملاء بالآجل (تُنفَّذ دائماً على السحابة/المحلي)
        _cp_cols = [r[1] for r in c.execute("PRAGMA table_info(credit_payments)").fetchall()]
        if "receipt_no" not in _cp_cols:
            c.execute("ALTER TABLE credit_payments ADD COLUMN receipt_no TEXT")
        if "deposit_voucher_id" not in _cp_cols:
            c.execute("ALTER TABLE credit_payments ADD COLUMN deposit_voucher_id INTEGER")
    except Exception as e:
        if log:
            print("ENSURE CREDIT PAYMENTS COL ERR:", repr(e))
    try:
        _cl_cols = [r[1] for r in c.execute("PRAGMA table_info(credit_ledger)").fetchall()]
        if "customer_id" not in _cl_cols:
            c.execute("ALTER TABLE credit_ledger ADD COLUMN customer_id INTEGER")
    except Exception as e:
        if log:
            print("ENSURE CREDIT LEDGER COL ERR:", repr(e))
    try:
        _o_cols = [r[1] for r in c.execute("PRAGMA table_info(orders)").fetchall()]
        if "credit_phone" not in _o_cols:
            c.execute("ALTER TABLE orders ADD COLUMN credit_phone TEXT")
    except Exception as e:
        if log:
            print("ENSURE ORDERS CREDIT PHONE ERR:", repr(e))
    try:
        # إزالة سجلات خصم الأوامر المحذوفة (لا تبقى أيتاماً)
        c.execute("DELETE FROM discount_log WHERE order_id IS NOT NULL AND order_id NOT IN (SELECT id FROM orders)")
    except Exception as e:
        if log:
            print("ENSURE DISCOUNT ORPHAN CLEANUP ERR:", repr(e))
    try:
        # أعمدة القسم للجداول المرتبطة بالطاولات (للعرض والتصفية)
        for tbl, col, ddl in (
            ("reservations", "table_section", "ALTER TABLE reservations ADD COLUMN table_section TEXT"),
            ("reservations", "table_id", "ALTER TABLE reservations ADD COLUMN table_id INTEGER"),
            ("credit_ledger", "table_section", "ALTER TABLE credit_ledger ADD COLUMN table_section TEXT"),
            ("credit_ledger", "table_id", "ALTER TABLE credit_ledger ADD COLUMN table_id INTEGER"),
            ("cancellation_requests", "table_section", "ALTER TABLE cancellation_requests ADD COLUMN table_section TEXT"),
            ("cancellation_requests", "table_id", "ALTER TABLE cancellation_requests ADD COLUMN table_id INTEGER"),
            ("discount_log", "table_section", "ALTER TABLE discount_log ADD COLUMN table_section TEXT"),
        ):
            try:
                cols = [r[1] for r in c.execute(f"PRAGMA table_info({tbl})").fetchall()]
                if col not in cols:
                    c.execute(ddl)
            except Exception:
                pass
    except Exception as e:
        if log:
            print("ENSURE TABLE SECTIONS ERR:", repr(e))
    try:
        # هجرة الطاولات: ترقيم كل قسم من 1 + قيد UNIQUE(num, section) بدل UNIQUE(num) العام.
        # النمط القديم: القسم يبدأ ترقيمه من غير 1 (مثلاً vip تبدأ من 9). عند اكتشافه نعيد
        # البناء في executescript واحد (رحلة HTTP واحدة) ونعيد الترقيم داخل كل قسم.
        old_min = c.execute("SELECT section, MIN(num) AS mn FROM tables GROUP BY section").fetchall()
        needs_renumber = any(r["mn"] > 1 for r in old_min)
        if needs_renumber:
            tcols = [r[1] for r in c.execute("PRAGMA table_info(tables)").fetchall()]
            col_map = {"pos_x": "REAL DEFAULT 0", "pos_y": "REAL DEFAULT 0",
                       "capacity": "INTEGER DEFAULT 4", "shape": "TEXT DEFAULT 'round'"}
            extra_cols = [x for x in ("pos_x", "pos_y", "capacity", "shape") if x in tcols]
            extra_def = ", " + ", ".join(f"{x} {col_map[x]}" for x in extra_cols) if extra_cols else ""
            extra_sel = ", " + ", ".join(extra_cols) if extra_cols else ""
            script = (
                "CREATE TABLE tables_new (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "num INTEGER NOT NULL, section TEXT DEFAULT 'hall'"
                f"{extra_def}, UNIQUE(num, section));"
                f"INSERT INTO tables_new (id, num, section{extra_sel}) "
                "SELECT id, ROW_NUMBER() OVER (PARTITION BY section ORDER BY num, id), "
                f"section{extra_sel} FROM tables ORDER BY section, num, id;"
                "DROP TABLE tables;"
                "ALTER TABLE tables_new RENAME TO tables;"
            )
            c.executescript(script)
    except Exception as e:
        if log:
            print("ENSURE TABLES RENUMBER ERR:", repr(e))
    try:
        conn.commit()
    except Exception:
        pass
    _SCHEMA_DONE = True


def init_db():
    conn = get_db()
    c = conn.cursor()
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
    except Exception:
        pass
    if CLOUD_DB:
        # المسار السريع للسحابة: القاعدة ممتلئة ومهاجرة بالفعل، ففحص واحد يكفي
        # بدلاً من ~25 رحلة HTTP بطيئة (كانت تتسبب بأخطاء عند كل بداية باردة).
        try:
            seed = c.execute("SELECT COUNT(*) FROM menu_items").fetchone()[0]
        except Exception:
            seed = 0
        if seed > 0:
            # مهاجرة خفيفة للأعمدة الجديدة دون إعادة بناء الجداول
            _ensure_schema(conn, c)
            conn.close()
            return
    c.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_num INTEGER,
        table_section TEXT,
        items TEXT,
        subtotal REAL,
        tax REAL,
        discount REAL DEFAULT 0,
        total REAL,
        payment_method TEXT,
        employee TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        pin TEXT NOT NULL,
        role TEXT DEFAULT 'cashier',
        active INTEGER DEFAULT 1,
        phone TEXT DEFAULT '',
        salary REAL DEFAULT 0,
        hire_date TEXT DEFAULT '',
        shift TEXT DEFAULT '',
        department TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        discount_limit REAL DEFAULT 20
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee TEXT,
        action TEXT,
        details TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        emoji TEXT,
        name TEXT NOT NULL,
        category TEXT,
        price REAL DEFAULT 0,
        active INTEGER DEFAULT 1
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS day_closures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE,
        opened_at TEXT,
        closed_at TEXT,
        total_sales REAL,
        order_count INTEGER,
        tax_total REAL,
        by_method TEXT,
        expected_cash REAL,
        counted_cash REAL,
        difference REAL,
        closed_by TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        points INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS table_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '🪑',
        sort_order INTEGER DEFAULT 0
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        num INTEGER NOT NULL,
        section TEXT DEFAULT 'hall',
        UNIQUE(num, section)
    )''')

    # الأقسام الافتراضية
    default_sections = [
        ("families", "العائلات", "👨‍👩‍👧", 1),
        ("vip", "VIP", "⭐", 2),
        ("hall", "الصالة", "🛋️", 3),
        ("takeaway", "طلبات خارجية", "🛍️", 4),
    ]

    for sid, name, icon, order in default_sections:
        c.execute(
            """
            INSERT OR IGNORE INTO table_sections
            (section_id, name, icon, sort_order)
            VALUES (?,?,?,?)
            """,
            (sid, name, icon, order)
        )

    c.execute('''CREATE TABLE IF NOT EXISTS category_order (
        category TEXT PRIMARY KEY,
        sort_order INTEGER DEFAULT 0
    )''')

    defaults = {"restaurant_name": "مطعم الذوق الرفيع", "tax_rate": "0.03", "currency": "Rp", "auto_backup": "1"}
    for k, v in defaults.items():
        c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)", (k, v))
    cols = [r[1] for r in c.execute("PRAGMA table_info(orders)")]
    if "employee" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN employee TEXT")
    if "status" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'completed'")
    if "guests" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN guests INTEGER DEFAULT 1")
    if "paid" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN paid REAL DEFAULT 0")
    if "sent_at" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN sent_at TEXT")
    if "kitchen_status" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN kitchen_status TEXT")
        c.execute("UPDATE orders SET kitchen_status='sent' WHERE status='sent'")
        c.execute("UPDATE orders SET kitchen_status='ready' WHERE kitchen_status IS NULL AND status IN ('ready','completed','closed','cancelled')")
    cols = [r[1] for r in c.execute("PRAGMA table_info(orders)")]
    if "transfer_ref" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN transfer_ref TEXT")
    if "transfer_name" not in cols:
        c.execute("ALTER TABLE orders ADD COLUMN transfer_name TEXT")
    c.execute('''CREATE TABLE IF NOT EXISTS refund_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_no TEXT UNIQUE,
        order_id INTEGER NOT NULL,
        items TEXT,
        subtotal REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        total REAL DEFAULT 0,
        refund_method TEXT DEFAULT 'نقدي',
        refund_ref TEXT,
        reason TEXT DEFAULT '',
        requested_by TEXT,
        approved_by TEXT,
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    if c.execute("SELECT COUNT(*) FROM employees").fetchone()[0] == 0:
        c.execute("INSERT INTO employees (name, pin, role) VALUES (?,?,?)",
                  ("مدير", hash_pin("9999"), "manager"))
        c.execute("INSERT INTO employees (name, pin, role) VALUES (?,?,?)",
                  ("كاشير", hash_pin("1111"), "cashier"))
    if c.execute("SELECT COUNT(*) FROM menu_items").fetchone()[0] == 0:
        for it in MENU:
            c.execute("INSERT INTO menu_items (emoji, name, category, price) VALUES (?,?,?,?)",
                      (it["emoji"], it["name"], it["category"], it["price"]))
    if c.execute("SELECT COUNT(*) FROM tables").fetchone()[0] == 0:
        secs = [("families", 8), ("vip", 4), ("hall", 8), ("takeaway", 4)]
        for sec, cnt in secs:
            for n in range(1, cnt + 1):
                c.execute("INSERT INTO tables (num, section) VALUES (?,?)", (n, sec))
    c.execute('''CREATE TABLE IF NOT EXISTS cancellation_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        table_num INTEGER NOT NULL,
        requested_by TEXT NOT NULL,
        reason TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS menu_inventory (
        menu_id INTEGER NOT NULL,
        inventory_id INTEGER NOT NULL,
        qty_per INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (menu_id, inventory_id)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS modifier_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        required INTEGER DEFAULT 0,
        max_select INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS modifiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price_add REAL DEFAULT 0,
        active INTEGER DEFAULT 1
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS menu_modifiers (
        menu_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        PRIMARY KEY (menu_id, group_id)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS credit_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT,
        order_id INTEGER,
        table_num INTEGER,
        total REAL DEFAULT 0,
        paid REAL DEFAULT 0,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS credit_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        amount REAL DEFAULT 0,
        method TEXT DEFAULT 'نقدي',
        employee TEXT,
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS deposit_vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_no TEXT UNIQUE,
        customer_name TEXT,
        phone TEXT,
        party_date TEXT,
        description TEXT,
        amount REAL DEFAULT 0,
        method TEXT DEFAULT 'نقدي',
        transfer_ref TEXT,
        transfer_name TEXT,
        employee TEXT,
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT DEFAULT (datetime('now','localtime')),
        category TEXT DEFAULT 'عام',
        description TEXT DEFAULT '',
        amount REAL DEFAULT 0,
        added_by TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT NOT NULL,
        employee_id INTEGER,
        target TEXT DEFAULT 'login',
        attempts INTEGER DEFAULT 0,
        lock_until REAL DEFAULT 0,
        PRIMARY KEY (ip, employee_id, target)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS discount_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee TEXT,
        employee_id INTEGER,
        order_id INTEGER,
        table_num TEXT,
        subtotal REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        limit_pct REAL DEFAULT 0,
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    cols_t = [r[1] for r in c.execute("PRAGMA table_info(tables)")]
    if "pos_x" not in cols_t:
        c.execute("ALTER TABLE tables ADD COLUMN pos_x REAL DEFAULT 0")
    if "pos_y" not in cols_t:
        c.execute("ALTER TABLE tables ADD COLUMN pos_y REAL DEFAULT 0")
    if "capacity" not in cols_t:
        c.execute("ALTER TABLE tables ADD COLUMN capacity INTEGER DEFAULT 4")
    if "shape" not in cols_t:
        c.execute("ALTER TABLE tables ADD COLUMN shape TEXT DEFAULT 'round'")
    c.execute('''CREATE TABLE IF NOT EXISTS credit_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT,
        order_id INTEGER,
        table_num INTEGER,
        total REAL DEFAULT 0,
        paid REAL DEFAULT 0,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS credit_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        amount REAL DEFAULT 0,
        method TEXT DEFAULT 'نقدي',
        employee TEXT,
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    cols_cl = [r[1] for r in c.execute("PRAGMA table_info(credit_ledger)")]
    if "due_date" not in cols_cl:
        c.execute("ALTER TABLE credit_ledger ADD COLUMN due_date TEXT")
    if "table_id" not in cols_cl:
        c.execute("ALTER TABLE credit_ledger ADD COLUMN table_id INTEGER")
    if "table_section" not in cols_cl:
        c.execute("ALTER TABLE credit_ledger ADD COLUMN table_section TEXT")
    if "customer_id" not in cols_cl:
        c.execute("ALTER TABLE credit_ledger ADD COLUMN customer_id INTEGER")
    cols_cp = [r[1] for r in c.execute("PRAGMA table_info(credit_payments)")]
    if "receipt_no" not in cols_cp:
        c.execute("ALTER TABLE credit_payments ADD COLUMN receipt_no TEXT")
    # تهجير الأعمدة أولاً (credit_name/table_section/...) قبل أي backfill يعتمد عليها
    _ensure_schema(conn, c, log=False)
    # backfill: سجّل الطلبات الآجلة القديمة المدفوعة/الجزئية في credit_ledger إذا لم تُسجل بعد
    c.execute("SELECT id, table_num, table_section, total, paid, credit_name, date FROM orders "
              "WHERE payment_method='آجل' AND id NOT IN (SELECT order_id FROM credit_ledger WHERE order_id IS NOT NULL)")
    for ro in c.fetchall():
        cname = (ro["credit_name"] or "").strip() or "عميل آجل"
        closed_paid = min(ro["paid"] or 0, ro["total"] or 0)  # لا دين سالب أبداً
        due = (_now() + timedelta(days=30)).strftime("%Y-%m-%d")
        c.execute("INSERT INTO credit_ledger (customer_name, order_id, table_id, table_num, table_section, total, paid, status, created_at, due_date) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (cname, ro["id"], None, ro["table_num"], ro["table_section"] if "table_section" in ro.keys() else None, ro["total"], closed_paid, "open", ro["date"] or _now_sql(), due))
        lid = c.lastrowid
        # IMPORTANT: creating an invoice on credit is NOT a collection.
        # Do not create credit_payments here; payments are created only by an
        # actual collection/receipt endpoint. Legacy fake rows are cleaned below.
    # Remove legacy rows that were incorrectly created with the invoice method "آجل".
    # They are not real collections and must never inflate customer payments.
    c.execute("DELETE FROM credit_payments WHERE method='آجل'")
    # تنظيف الدفع الزائد القديم: لا رصيد برصيد سالب ولا paid أكبر من total (يُحسب الفرق كباقي رُدّ)
    c.execute("UPDATE credit_ledger SET paid=total WHERE paid > total")
    c.execute("UPDATE credit_payments SET amount=(SELECT total FROM credit_ledger WHERE credit_ledger.id=credit_payments.ledger_id) "
              "WHERE ledger_id IN (SELECT id FROM credit_ledger WHERE paid >= total AND amount > (SELECT total FROM credit_ledger WHERE credit_ledger.id=credit_payments.ledger_id))")
    c.execute('''CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        quantity REAL DEFAULT 0,
        unit TEXT DEFAULT 'piece',
        min_stock REAL DEFAULT 0,
        cost REAL DEFAULT 0
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS menu_inventory (
        menu_id INTEGER NOT NULL,
        inventory_id INTEGER NOT NULL,
        qty_per INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (menu_id, inventory_id)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS modifier_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        required INTEGER DEFAULT 0,
        max_select INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS modifiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price_add REAL DEFAULT 0,
        active INTEGER DEFAULT 1
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS menu_modifiers (
        menu_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        PRIMARY KEY (menu_id, group_id)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS supplier_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_name TEXT NOT NULL,
        phone TEXT,
        description TEXT DEFAULT '',
        total REAL DEFAULT 0,
        paid REAL DEFAULT 0,
        status TEXT DEFAULT 'open',
        due_date TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        amount REAL DEFAULT 0,
        method TEXT DEFAULT 'نقدي',
        employee TEXT,
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS credit_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        method TEXT DEFAULT 'whatsapp',
        message TEXT DEFAULT '',
        sent_by TEXT DEFAULT '',
        status TEXT DEFAULT 'sent',
        date TEXT DEFAULT (datetime('now','localtime'))
    )''')
    _ensure_schema(conn, c, log=False)
    conn.commit()
    conn.close()


def require_user():
    return session.get("user")


_SETTINGS_CACHE = {}
_SETTINGS_CACHE_TS = 0.0
_SETTINGS_CACHE_TTL = 5.0


def _load_settings():
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


def get_setting(key, default=""):
    """إعدادات بكاش قصير الأمد: قراءة واحدة لجميع الإعدادات بدل رحلة لكل مفتاح."""
    global _SETTINGS_CACHE, _SETTINGS_CACHE_TS
    now = time.time()
    if not _SETTINGS_CACHE or now - _SETTINGS_CACHE_TS > _SETTINGS_CACHE_TTL:
        try:
            _SETTINGS_CACHE = _load_settings()
            _SETTINGS_CACHE_TS = now
        except Exception:
            pass
    v = _SETTINGS_CACHE.get(key)
    return v if v is not None else default


def set_setting(key, value):
    global _SETTINGS_CACHE
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
              (key, value, value))
    conn.commit()
    conn.close()
    _SETTINGS_CACHE[key] = value


def get_tax_rate():
    try:
        return float(get_setting("tax_rate", "0.03"))
    except (TypeError, ValueError):
        return 0.03


def require_manager():
    u = require_user()
    if not u:
        return None, "سجل الدخول أولاً", 401
    if u["role"] != "manager":
        return None, "متاح للمدير فقط", 403
    return u, None, None


# ===== قفل محاولات الدخول (rate limit) =====
MAX_LOGIN_ATTEMPTS = 5
LOGIN_LOCK_MINUTES = 15


def _client_ip():
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _login_lock_state(emp_id, target="login"):
    """راجع حالة القفل: (عدد المحاولات، ثواني البقاء مقفلاً إن وُجد)."""
    ip = _client_ip()
    try:
        conn = get_db()
        c = conn.cursor()
        row = c.execute(
            "SELECT attempts, lock_until FROM login_attempts WHERE ip=? AND employee_id=? AND target=?",
            (ip, emp_id, target),
        ).fetchone()
        conn.close()
    except Exception:
        return 0, 0
    if not row:
        return 0, 0
    attempts, lock_until = row[0], row[1]
    if lock_until and lock_until > time.time():
        return attempts, int(lock_until - time.time())
    return attempts, 0


def _register_login_fail(emp_id, target="login"):
    ip = _client_ip()
    now = time.time()
    try:
        conn = get_db()
        c = conn.cursor()
        row = c.execute(
            "SELECT attempts, lock_until FROM login_attempts WHERE ip=? AND employee_id=? AND target=?",
            (ip, emp_id, target),
        ).fetchone()
        if row:
            attempts = row[0] + 1
            lock_until = row[1] if (row[1] and row[1] > now) else 0
            if attempts >= MAX_LOGIN_ATTEMPTS:
                lock_until = now + LOGIN_LOCK_MINUTES * 60
                attempts = 0
            c.execute(
                "UPDATE login_attempts SET attempts=?, lock_until=? WHERE ip=? AND employee_id=? AND target=?",
                (attempts, lock_until, ip, emp_id, target),
            )
        else:
            c.execute(
                "INSERT INTO login_attempts (ip, employee_id, target, attempts, lock_until) VALUES (?,?,?,?,?)",
                (ip, emp_id, target, 1, 0),
            )
        conn.commit()
        conn.close()
    except Exception:
        pass


def _reset_login_fail(emp_id, target="login"):
    ip = _client_ip()
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "DELETE FROM login_attempts WHERE ip=? AND employee_id=? AND target=?",
            (ip, emp_id, target),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def _employee_exists(emp_id):
    try:
        conn = get_db()
        row = conn.execute("SELECT 1 FROM employees WHERE id=?", (emp_id,)).fetchone()
        conn.close()
        return bool(row)
    except Exception:
        return False


# مقياس بسيط في الذاكرة لمنع الكشط الآلي للقوائم العامة
_PUBLIC_THROTTLE = {}
_PUBLIC_THROTTLE_LIMIT = 30
_PUBLIC_THROTTLE_WINDOW = 60.0


def _throttled(key, limit=_PUBLIC_THROTTLE_LIMIT, window=_PUBLIC_THROTTLE_WINDOW):
    now = time.time()
    ts_list = _PUBLIC_THROTTLE.get(key, [])
    ts_list = [t for t in ts_list if now - t < window]
    if len(ts_list) >= limit:
        _PUBLIC_THROTTLE[key] = ts_list
        return True
    ts_list.append(now)
    _PUBLIC_THROTTLE[key] = ts_list
    return False


def audit(action, details=""):
    u = session.get("user") or {}
    name = u.get("name", "؟")
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("INSERT INTO audit_log (employee, action, details) VALUES (?,?,?)", (name, action, details))
        conn.commit()
        conn.close()
    except Exception:
        pass


# ===== الواجهة =====
@app.route("/")
def index():
    return render_template("index.html", restaurant_name=get_setting("restaurant_name", "مطعم الذوق الرفيع"))


@app.route("/api/menu")
def api_menu():
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT id, emoji, name, category, price FROM menu_items WHERE active=1 ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ===== ترتيب الأقسام =====
@app.route("/api/categories/order", methods=["GET"])
def api_categories_order():
    conn = get_db()
    rows = conn.execute("SELECT category, sort_order FROM category_order ORDER BY sort_order").fetchall()
    conn.close()
    return jsonify({r["category"]: r["sort_order"] for r in rows})


@app.route("/api/categories/reorder", methods=["POST"])
def api_reorder_category():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    cat = data.get("category")
    direction = data.get("direction")
    if not cat or direction not in ("up", "down"):
        return jsonify({"error": "بيانات ناقصة"}), 400
    conn = get_db()
    c = conn.cursor()
    cats = c.execute("SELECT DISTINCT category FROM menu_items WHERE category != '' ORDER BY category").fetchall()
    cat_list = [r["category"] for r in cats]
    order_rows = c.execute("SELECT category, sort_order FROM category_order").fetchall()
    order_map = {r["category"]: r["sort_order"] for r in order_rows}
    cat_list.sort(key=lambda x: order_map.get(x, 0))
    if cat not in cat_list:
        conn.close()
        return jsonify({"error": "القسم غير موجود"}), 404
    idx = cat_list.index(cat)
    if direction == "up" and idx > 0:
        cat_list[idx], cat_list[idx - 1] = cat_list[idx - 1], cat_list[idx]
    elif direction == "down" and idx < len(cat_list) - 1:
        cat_list[idx], cat_list[idx + 1] = cat_list[idx + 1], cat_list[idx]
    else:
        conn.close()
        return jsonify({"ok": True})
    for i, c_name in enumerate(cat_list):
        c.execute("INSERT OR REPLACE INTO category_order (category, sort_order) VALUES (?, ?)", (c_name, i))
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    return jsonify({"ok": True, "order": cat_list})


@app.route("/api/menu/all")
def api_menu_all():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT id, emoji, name, category, price, active FROM menu_items ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/menu/item", methods=["POST"])
def api_menu_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "أدخل اسم الصنف"}), 400
    try:
        price = round(float(data.get("price", 0)), 2)
    except (TypeError, ValueError):
        price = 0
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO menu_items (emoji, name, category, price, active) VALUES (?,?,?,?,1)",
              (data.get("emoji", "🍽️"), name, data.get("category", "").strip(), price))
    mid = c.lastrowid
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("menu_add", f"إضافة صنف: {name} ({price})")
    return jsonify({"ok": True, "id": mid})


@app.route("/api/menu/item/<int:mid>", methods=["PUT"])
def api_menu_update(mid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "أدخل اسم الصنف"}), 400
    try:
        price = round(float(data.get("price", 0)), 2)
    except (TypeError, ValueError):
        price = 0
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE menu_items SET emoji=?, name=?, category=?, price=? WHERE id=?",
              (data.get("emoji", "🍽️"), name, data.get("category", "").strip(), price, mid))
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("menu_edit", f"تعديل صنف #{mid}: {name} ({price})")
    return jsonify({"ok": True})


@app.route("/api/menu/item/<int:mid>", methods=["DELETE"])
def api_menu_delete(mid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT name FROM menu_items WHERE id=?", (mid,)).fetchone()
    c.execute("UPDATE menu_items SET active=0 WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("menu_delete", f"حذف صنف: {row['name'] if row else mid}")
    return jsonify({"ok": True})


@app.route("/api/menu/reset-default", methods=["POST"])
def api_menu_reset_default():
    """استبدال القائمة الحالية بقائمة مؤقتة جاهزة (يمكن تعديلها لاحقاً)."""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    ids = [r["id"] for r in c.execute("SELECT id FROM menu_items").fetchall()]
    if ids:
        c.execute("UPDATE menu_items SET active=0 WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)
    for it in MENU:
        c.execute("INSERT INTO menu_items (emoji, name, category, price, active) VALUES (?,?,?,?,1)",
                  (it["emoji"], it["name"], it["category"], it["price"]))
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("menu_reset", f"إعادة ضبط القائمة على الافتراضية ({len(MENU)} صنف)")
    return jsonify({"ok": True, "count": len(MENU)})


# ===== التعديلات (Modifiers) =====
@app.route("/api/modifiers/<int:menu_id>")
def api_modifiers(menu_id):
    conn = get_db()
    c = conn.cursor()
    groups = c.execute("""
        SELECT mg.id, mg.name, mg.required, mg.max_select
        FROM modifier_groups mg
        JOIN menu_modifiers mm ON mm.group_id = mg.id
        WHERE mm.menu_id = ?
        ORDER BY mg.sort_order
    """, (menu_id,)).fetchall()
    result = []
    for g in groups:
        mods = c.execute("SELECT id, name, price_add FROM modifiers WHERE group_id=? AND active=1", (g['id'],)).fetchall()
        result.append({
            "id": g['id'], "name": g['name'], "required": g['required'],
            "max_select": g['max_select'],
            "options": [dict(m) for m in mods]
        })
    conn.close()
    return jsonify(result)


@app.route("/api/modifiers", methods=["POST"])
def api_modifiers_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    group_id = data.get("group_id")
    name = str(data.get("name", "")).strip()
    price = float(data.get("price_add", 0))
    if not group_id or not name:
        return jsonify({"error": "الاسم والمجموعة مطلوبان"}), 400
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO modifiers (group_id, name, price_add) VALUES (?,?,?)", (group_id, name, price))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ===== نقل الطلب =====
@app.route("/api/order/transfer", methods=["POST"])
def api_order_transfer():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401

    data = request.json or {}
    from_table = data.get("from_table")
    to_table = data.get("to_table")
    merge = bool(data.get("merge"))

    if not from_table or not to_table:
        return jsonify({"error": "الطاولتان مطلوبتان"}), 400

    try:
        from_table = int(from_table)
        to_table = int(to_table)
    except (TypeError, ValueError):
        return jsonify({"error": "رقم الطاولة غير صحيح"}), 400

    if from_table == to_table:
        return jsonify({"error": "لا يمكن النقل إلى نفس الطاولة"}), 400

    conn = get_db()
    c = conn.cursor()

    try:
        # الطلب النشط في الطاولة المصدر
        order = c.execute(
            "SELECT * FROM orders "
            "WHERE table_id=? AND status IN ('active','sent','ready') "
            "ORDER BY id DESC LIMIT 1",
            (from_table,)
        ).fetchone()

        if not order:
            conn.close()
            return jsonify({"error": "لا يوجد طلب نشط في هذه الطاولة"}), 404

        # الطلب النشط في الطاولة الهدف
        existing = c.execute(
            "SELECT * FROM orders "
            "WHERE table_id=? AND status IN ('active','sent','ready') "
            "ORDER BY id DESC LIMIT 1",
            (to_table,)
        ).fetchone()

        # إذا كانت الطاولة مشغولة ولم يطلب المستخدم الدمج
        if existing and not merge:
            conn.close()
            return jsonify({
                "error": "الطاولة الوجهة مشغولة بالفعل",
                "can_merge": True
            }), 400

        num, section = _table_ref(c, to_table)

        # ==================================================
        # دمج الطلب المصدر داخل الطلب الموجود في الطاولة الهدف
        # ==================================================
        if existing and merge:
            source_items = _parse_items(order["items"])
            target_items = _parse_items(existing["items"])

            # دمج الأصناف المتطابقة فقط:
            # نفس menu_id + الاسم + السعر + الملاحظة.
            merged_items = []

            for item in target_items + source_items:
                try:
                    item_name = str(item.get("name", ""))
                    item_price = round(float(item.get("price", 0)), 2)
                    item_menu_id = int(item.get("menu_id") or 0)
                    item_note = str(item.get("note", "") or "")

                    found = None

                    for existing_item in merged_items:
                        same_item = (
                            int(existing_item.get("menu_id") or 0) == item_menu_id
                            and str(existing_item.get("name", "")) == item_name
                            and round(float(existing_item.get("price", 0)), 2) == item_price
                            and str(existing_item.get("note", "") or "") == item_note
                        )

                        if same_item:
                            found = existing_item
                            break

                    if found is not None:
                        found["qty"] = int(found.get("qty", 0)) + int(item.get("qty", 0))
                    else:
                        merged_items.append({
                            "name": item_name,
                            "qty": int(item.get("qty", 0)),
                            "price": item_price,
                            "emoji": str(item.get("emoji", "") or ""),
                            "menu_id": item_menu_id,
                            "open": bool(item.get("open", False)),
                            "note": item_note
                        })

                except Exception:
                    # إذا كان الصنف غير صالح، نحتفظ به بدل إسقاطه أثناء الدمج.
                    merged_items.append(item)

            # إعادة حساب القيم المالية من الأصناف المدمجة.
            merged_subtotal = round(
                sum(
                    float(i.get("price", 0)) * int(i.get("qty", 0))
                    for i in merged_items
                ),
                2
            )

            merged_tax = round(
                merged_subtotal * get_tax_rate(),
                2
            )

            # جمع الخصومات الحالية للطلبين.
            source_discount = float(order["discount"] or 0)
            target_discount = float(existing["discount"] or 0)

            merged_discount = round(
                target_discount + source_discount,
                2
            )

            max_merged_discount = round(
                merged_subtotal + merged_tax,
                2
            )

            if merged_discount > max_merged_discount:
                merged_discount = max_merged_discount

            merged_total = round(
                merged_subtotal + merged_tax - merged_discount,
                2
            )

            if merged_total < 0:
                merged_total = 0

            # جمع عدد الأشخاص.
            source_guests = int(order["guests"] or 1)
            target_guests = int(existing["guests"] or 1)

            merged_guests = target_guests + source_guests

            # تحديث الطلب الهدف.
            # paid/payment_method لا يتم تغييرهما أثناء النقل/الدمج.
            c.execute(
                "UPDATE orders SET "
                "items=?, "
                "subtotal=?, "
                "tax=?, "
                "discount=?, "
                "total=?, "
                "guests=?, "
                "table_num=?, "
                "table_section=? "
                "WHERE id=?",
                (
                    _serialize_items(merged_items),
                    merged_subtotal,
                    merged_tax,
                    merged_discount,
                    merged_total,
                    merged_guests,
                    num,
                    section,
                    existing["id"]
                )
            )

            # إغلاق الطلب المصدر حتى لا يظهر كطلب مستقل.
            c.execute(
                "UPDATE orders SET "
                "status='closed', "
                "kitchen_status='ready' "
                "WHERE id=?",
                (order["id"],)
            )

            # إذا كان هناك حجز مرتبط بالمصدر فقط،
            # ننقله إلى الطلب الرئيسي.
            try:
                source_reservation = order["reservation_id"]
                target_reservation = existing["reservation_id"]

                if source_reservation and not target_reservation:
                    c.execute(
                        "UPDATE orders SET reservation_id=? WHERE id=?",
                        (
                            source_reservation,
                            existing["id"]
                        )
                    )
            except Exception:
                pass

            conn.commit()
            conn.close()

            audit(
                "order_merge",
                f"دمج طلب طاولة {from_table} في طاولة {to_table} "
                f"(المصدر #{order['id']} ← الهدف #{existing['id']}) "
                f"- الإجمالي الجديد {merged_total:.2f}"
            )

            return jsonify({
                "ok": True,
                "merged": True,
                "order_id": existing["id"],
                "source_order_id": order["id"],
                "table_num": num,
                "subtotal": merged_subtotal,
                "tax": merged_tax,
                "discount": merged_discount,
                "total": merged_total
            })

        # ==================================================
        # نقل عادي إلى طاولة فارغة
        # ==================================================
        c.execute(
            "UPDATE orders SET "
            "table_id=?, "
            "table_num=?, "
            "table_section=? "
            "WHERE id=?",
            (
                to_table,
                num,
                section,
                order["id"]
            )
        )

        conn.commit()
        conn.close()

        audit(
            "order_transfer",
            f"نقل طلب من طاولة {from_table} إلى {to_table}"
        )

        return jsonify({
            "ok": True,
            "merged": False,
            "order_id": order["id"],
            "table_num": num
        })

    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass

        print("ORDER TRANSFER/MERGE ERROR:", repr(e))

        return jsonify({
            "error": "حدث خطأ أثناء نقل أو دمج الطلب",
            "details": str(e)
        }), 500



# ===== طلب إلغاء طلب (يحتاج موافقة المدير) =====
@app.route("/api/order/cancel-request", methods=["POST"])
def api_cancel_request():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_id = data.get("table_id")
    order_id = data.get("order_id")
    reason = data.get("reason", "")
    if not table_id:
        return jsonify({"error": "اختر طاولة"}), 400
    conn = get_db()
    c = conn.cursor()
    if not order_id:
        row = c.execute("SELECT id FROM orders WHERE table_id=? AND status IN ('active','sent','ready')", (table_id,)).fetchone()
        if row:
            order_id = row["id"]
    if not order_id:
        conn.close()
        return jsonify({"error": "لا يوجد طلب نشط لهذه الطاولة"}), 400
    existing = c.execute("SELECT id FROM cancellation_requests WHERE order_id=? AND status='pending'", (order_id,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "يوجد طلب إلغاء معلق بالفعل"}), 400
    num, section = _table_ref(c, table_id)
    c.execute("INSERT INTO cancellation_requests (order_id, table_id, table_num, table_section, requested_by, reason, status) VALUES (?,?,?,?,?,?,'pending')",
              (order_id, table_id, num, section, u["name"], reason))
    conn.commit()
    req_id = c.lastrowid
    conn.close()
    audit("cancel_request", f"طلب إلغاء طلب #{order_id} (طاولة {num}) من {u['name']}")
    return jsonify({"ok": True, "request_id": req_id})


@app.route("/api/cancel-requests")
def api_cancel_requests():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    if u["role"] == "manager":
        rows = c.execute("""SELECT cr.*, o.table_num AS o_table, o.total AS o_total, o.items AS o_items, o.status AS o_status
            FROM cancellation_requests cr LEFT JOIN orders o ON cr.order_id=o.id
            WHERE cr.status='pending' ORDER BY cr.created_at""").fetchall()
    else:
        rows = c.execute("""SELECT cr.*, o.table_num AS o_table, o.total AS o_total
            FROM cancellation_requests cr LEFT JOIN orders o ON cr.order_id=o.id
            WHERE cr.requested_by=? ORDER BY cr.created_at""", (u["name"],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/cancel-approve", methods=["POST"])
def api_cancel_approve():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    req_id = data.get("request_id")
    if not req_id:
        return jsonify({"error": "request_id مطلوب"}), 400
    conn = get_db()
    c = conn.cursor()
    _ensure_schema(conn, c)
    row = c.execute("SELECT * FROM cancellation_requests WHERE id=? AND status='pending'", (req_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "طلب غير موجود أو تمت معالجته"}), 404
    # حماية الإلغاء: الطلبات الجاهزة/المدفوعة تحتاج PIN المدير
    order = c.execute("SELECT * FROM orders WHERE id=?", (row["order_id"],)).fetchone()
    sensitive = bool(order and order["status"] in ("sent", "ready", "completed"))
    if sensitive:
        pin = str(data.get("pin") or "")
        managers = c.execute("SELECT pin FROM employees WHERE active=1 AND role='manager'").fetchall()
        if not any(verify_pin(pin, m["pin"]) for m in managers):
            conn.close()
            return jsonify({"error": "هذا الإلغاء يتطلب PIN المدير"}), 403
    c.execute("UPDATE cancellation_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?",
              (u["name"], req_id))
    c.execute("UPDATE orders SET status='cancelled', kitchen_status='ready' WHERE id=?", (row["order_id"],))
    refund_receipt = None
    was_paid = bool(order and order["status"] == "completed")
    # إذا كان الطلب مدفوعاً سابقاً، أعد المخزون المُخصوم تلقائياً وأنشئ سند مردودات
    if order and order["status"] == "completed":
        try:
            items = _parse_items(order["items"])
            _restore_inventory(c, items)
        except Exception:
            items = []
        refund_method = str(data.get("refund_method") or order["payment_method"] or "نقدي")
        refund_ref = str(data.get("refund_ref") or "").strip() or None
        c.execute("INSERT INTO refund_receipts (order_id, items, subtotal, tax, discount, total, refund_method, refund_ref, reason, requested_by, approved_by, date) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
                  (row["order_id"], order["items"], order["subtotal"] or 0, order["tax"] or 0, order["discount"] or 0,
                   order["total"] or 0, refund_method, refund_ref, row["reason"] or "", row["requested_by"], u["name"]))
        rid = c.lastrowid
        receipt_no = "SR-%d-%05d" % (_now().year, rid)
        c.execute("UPDATE refund_receipts SET receipt_no=? WHERE id=?", (receipt_no, rid))
        refund_receipt = {
            "id": rid, "receipt_no": receipt_no, "order_id": row["order_id"],
            "table_num": order["table_num"], "items": _parse_items(order["items"]),
            "subtotal": order["subtotal"] or 0, "tax": order["tax"] or 0,
            "discount": order["discount"] or 0, "total": order["total"] or 0,
            "refund_method": refund_method, "refund_ref": refund_ref,
            "reason": row["reason"] or "", "requested_by": row["requested_by"],
            "approved_by": u["name"], "date": _now_sql(),
            "payment_method": order["payment_method"] or "",
        }
    # إلغاء فاتورة آجل: أغلق رصيد الدفتر المرتبط بها
    if order and (order["payment_method"] or "").strip() == "آجل":
        try:
            c.execute("UPDATE credit_ledger SET status='closed', updated_at=datetime('now','localtime') WHERE order_id=? AND status='open'",
                      (row["order_id"],))
        except Exception:
            pass
    conn.commit()
    conn.close()
    audit("cancel_approve", f"موافقة على إلغاء طلب #{row['order_id']} (طاولة {row['table_num']}) من {u['name']}"
          + (" مع PIN" if sensitive else "") + (f" - مردود {refund_receipt['total']:.2f} ({refund_receipt['receipt_no']})" if refund_receipt else ""))
    return jsonify({"ok": True, "sensitive": sensitive, "refund_receipt": refund_receipt})


@app.route("/api/cancel-reject", methods=["POST"])
def api_cancel_reject():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    req_id = data.get("request_id")
    if not req_id:
        return jsonify({"error": "request_id مطلوب"}), 400
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT * FROM cancellation_requests WHERE id=? AND status='pending'", (req_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "طلب غير موجود أو تمت معالجته"}), 404
    c.execute("UPDATE cancellation_requests SET status='rejected', reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?",
              (u["name"], req_id))
    conn.commit()
    conn.close()
    audit("cancel_reject", f"رفض إلغاء طلب #{row['order_id']} (طاولة {row['table_num']}) من {u['name']}")
    return jsonify({"ok": True})


@app.route("/api/admin/delete-order/<int:oid>", methods=["POST"])
def api_admin_delete_order(oid):
    """أداة صيانة (PIN المدير): حذف نهائي لطلب تجريبي/مكرر مع ما يتعلق به وسجل تدقيق."""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    pin = str(data.get("pin") or "")
    conn = get_db()
    c = conn.cursor()
    managers = c.execute("SELECT pin FROM employees WHERE active=1 AND role='manager'").fetchall()
    if not any(verify_pin(pin, m["pin"]) for m in managers):
        conn.close()
        return jsonify({"error": "يتطلب PIN المدير"}), 403
    row = c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "طلب غير موجود"}), 404
    # أعد المخزون المُخصوم إن كان الطلب مدفوعاً
    if row["status"] == "completed":
        try:
            _restore_inventory(c, _parse_items(row["items"]))
        except Exception:
            pass
    # احذف سندات المردودات وطلبات الإلغاء المرتبطة
    try:
        c.execute("DELETE FROM refund_receipts WHERE order_id=?", (oid,))
    except Exception:
        pass
    try:
        c.execute("DELETE FROM cancellation_requests WHERE order_id=?", (oid,))
    except Exception:
        pass
    # احذف أرصدة/تحصيلات الآجل المرتبطة
    try:
        ledgers = c.execute("SELECT id FROM credit_ledger WHERE order_id=?", (oid,)).fetchall()
        for lg in ledgers:
            c.execute("DELETE FROM credit_payments WHERE ledger_id=?", (lg["id"],))
        c.execute("DELETE FROM credit_ledger WHERE order_id=?", (oid,))
    except Exception:
        pass
    # احذف سجلات الخصم المرتبطة
    try:
        c.execute("DELETE FROM discount_log WHERE order_id=?", (oid,))
    except Exception:
        pass
    c.execute("DELETE FROM orders WHERE id=?", (oid,))
    conn.commit()
    audit("admin_delete_order", f"حذف نهائي لطلب #{oid} (طاولة {row['table_num']}) من {u['name']} - صيانة")
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/cancel-count")
def api_cancel_count():
    u = require_user()
    if not u:
        return jsonify({"count": 0})
    if u["role"] != "manager":
        return jsonify({"count": 0})
    conn = get_db()
    row = conn.execute("SELECT COUNT(*) AS cnt FROM cancellation_requests WHERE status='pending'").fetchone()
    conn.close()
    return jsonify({"count": row["cnt"]})


# ===== تسجيل الدخول =====
@app.route("/api/employees")
def api_employees():
    if _throttled("employees:" + _client_ip()):
        return jsonify({"error": "محاولات كثيرة، حاول لاحقاً"}), 429
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT id, name, role, phone, salary, hire_date, shift, department, status, discount_limit FROM employees WHERE active=1 ORDER BY id").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/employees", methods=["POST"])
def api_employees_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    role = str(data.get("role", "cashier"))
    pin = str(data.get("pin", "")).strip()
    if not name or not pin:
        return jsonify({"error": "الاسم ورقم PIN مطلوبان"}), 400
    if role not in ("cashier", "manager"):
        role = "cashier"
    if len(pin) < 4 or not pin.isdigit():
        return jsonify({"error": "PIN يجب أن يكون 4 أرقام على الأقل"}), 400
    phone = str(data.get("phone", "")).strip()
    try:
        salary = float(data.get("salary") or 0)
    except (TypeError, ValueError):
        salary = 0
    hire_date = str(data.get("hire_date", "")).strip()
    shift = str(data.get("shift", "")).strip()
    department = str(data.get("department", "")).strip()
    try:
        discount_limit = float(data.get("discount_limit", 20) or 20)
    except (TypeError, ValueError):
        discount_limit = 20
    if discount_limit < 0:
        discount_limit = 0
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO employees (name, pin, role, phone, salary, hire_date, shift, department, discount_limit) VALUES (?,?,?,?,?,?,?,?,?)",
              (name, hash_pin(pin), role, phone, salary, hire_date, shift, department, discount_limit))
    eid = c.lastrowid
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("add_employee", f"إضافة موظف: {name} ({role})")
    return jsonify({"ok": True, "id": eid})


@app.route("/api/employees/<int:eid>", methods=["PUT"])
def api_employees_update(eid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT * FROM employees WHERE id=?", (eid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "موظف غير موجود"}), 404
    name = str(data.get("name", row["name"])).strip() or row["name"]
    role = str(data.get("role", row["role"]))
    if role not in ("cashier", "manager"):
        role = row["role"]
    active = data.get("active", row["active"])
    status = str(data.get("status", row["status"] or "active"))
    if status not in ("active", "on_leave", "suspended"):
        status = "active"
    if status == "suspended":
        active = 0
    elif status == "active":
        active = 1
    if active == 0 and int(row["id"]) == int(u["id"]):
        conn.close()
        return jsonify({"error": "لا يمكنك تعطيل حسابك الخاص"}), 400
    if active == 0 and row["role"] == "manager":
        cnt = c.execute("SELECT COUNT(*) AS n FROM employees WHERE role='manager' AND active=1 AND id!=?", (eid,)).fetchone()["n"]
        if cnt == 0:
            conn.close()
            return jsonify({"error": "يجب بقاء مدير واحد نشط على الأقل"}), 400
    pin = str(data.get("pin", "")).strip()
    phone = str(data.get("phone", row["phone"] or "")).strip()
    try:
        salary = float(data.get("salary", row["salary"] or 0))
    except (TypeError, ValueError):
        salary = row["salary"] or 0
    hire_date = str(data.get("hire_date", row["hire_date"] or "")).strip()
    shift = str(data.get("shift", row["shift"] or "")).strip()
    department = str(data.get("department", row["department"] or "")).strip()
    try:
        discount_limit = float(data.get("discount_limit", row["discount_limit"] if "discount_limit" in row.keys() else 20) or 0)
    except (TypeError, ValueError):
        discount_limit = float(row["discount_limit"] if "discount_limit" in row.keys() else 20)
    if discount_limit < 0:
        discount_limit = 0
    if pin:
        if len(pin) < 4 or not pin.isdigit():
            conn.close()
            return jsonify({"error": "PIN يجب أن يكون 4 أرقام على الأقل"}), 400
        c.execute("UPDATE employees SET name=?, role=?, active=?, status=?, phone=?, salary=?, hire_date=?, shift=?, department=?, discount_limit=?, pin=? WHERE id=?",
                  (name, role, int(active), status, phone, salary, hire_date, shift, department, discount_limit, hash_pin(pin), eid))
    else:
        c.execute("UPDATE employees SET name=?, role=?, active=?, status=?, phone=?, salary=?, hire_date=?, shift=?, department=?, discount_limit=? WHERE id=?",
                  (name, role, int(active), status, phone, salary, hire_date, shift, department, discount_limit, eid))
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("update_employee", f"تعديل موظف #{eid}: {name}")
    return jsonify({"ok": True})


@app.route("/api/employees/<int:eid>", methods=["DELETE"])
def api_employees_delete(eid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT * FROM employees WHERE id=?", (eid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "موظف غير موجود"}), 404
    if int(row["id"]) == int(u["id"]):
        conn.close()
        return jsonify({"error": "لا يمكنك حذف حسابك الخاص"}), 400
    if row["role"] == "manager":
        cnt = c.execute("SELECT COUNT(*) AS n FROM employees WHERE role='manager' AND active=1 AND id!=?", (eid,)).fetchone()["n"]
        if cnt == 0:
            conn.close()
            return jsonify({"error": "يجب بقاء مدير واحد نشط على الأقل"}), 400
    c.execute("UPDATE employees SET active=0, status='suspended' WHERE id=?", (eid,))
    conn.commit()
    conn.close()
    _invalidate_boot_cache()
    audit("delete_employee", f"حذف موظف #{eid}: {row['name']}")
    return jsonify({"ok": True})


@app.route("/api/settings")
def api_settings():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    return jsonify({
        "restaurant_name": get_setting("restaurant_name", "مطعم الذوق الرفيع"),
        "tax_rate": get_tax_rate(),
        "currency": get_setting("currency", "ر.س"),
        "auto_backup": get_setting("auto_backup", "1") == "1",
        "backup_freq": get_setting("backup_freq", "daily"),
        "day_close_remind_hour": int(get_setting("day_close_remind_hour", "21")),
    })


@app.route("/api/settings", methods=["POST"])
def api_settings_save():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    if "restaurant_name" in data:
        set_setting("restaurant_name", str(data["restaurant_name"]).strip()[:50])
    if "tax_rate" in data:
        try:
            r = float(data["tax_rate"])
            if r < 0 or r > 1:
                return jsonify({"error": "نسبة الضريبة بين 0 و 1 (مثال 0.15)"}), 400
            set_setting("tax_rate", str(r))
        except (TypeError, ValueError):
            return jsonify({"error": "نسبة ضريبة غير صالحة"}), 400
    if "currency" in data:
        set_setting("currency", str(data["currency"]).strip()[:5])
    if "auto_backup" in data:
        set_setting("auto_backup", "1" if data["auto_backup"] else "0")
    if "backup_freq" in data:
        freq = str(data["backup_freq"])
        if freq in ("daily", "weekly"):
            set_setting("backup_freq", freq)
    if "day_close_remind_hour" in data:
        try:
            hr = int(data["day_close_remind_hour"])
            if 0 <= hr <= 23:
                set_setting("day_close_remind_hour", str(hr))
        except (TypeError, ValueError):
            pass
    _invalidate_boot_cache()
    audit("settings", "تحديث الإعدادات")
    return jsonify({"ok": True, "tax_rate": get_tax_rate(),
                    "restaurant_name": get_setting("restaurant_name"),
                    "currency": get_setting("currency"),
                    "auto_backup": get_setting("auto_backup", "1") == "1",
                    "backup_freq": get_setting("backup_freq", "daily"),
                    "day_close_remind_hour": int(get_setting("day_close_remind_hour", "21"))})


_BOOT_TTL = 8
_boot_cache = {"ts": 0.0, "payload": None}


def _invalidate_boot_cache():
    """يُطلب بعد أي تعديل على بيانات الإقلاع شبه الثابتة لتفريغ الكاش فوراً."""
    _boot_cache["ts"] = 0.0


def _bootstrap_static(conn):
    """بيانات شبه ثابتة (إعدادات، منيو، أقسام، موظفون، مخزون منخفض، طلبات إلغاء)
    تُستخرج في استعلام UNION واحد وتُخزَّن في الكاش بدل إعادتها مع كل إقلاع."""
    c = conn.cursor()
    branches = [
        "SELECT 'setting' AS kind, key AS a, value AS b, '' AS c, '' AS d, '' AS e, '' AS f FROM settings",
        "SELECT 'catorder' AS kind, category AS a, CAST(sort_order AS TEXT) AS b, '' AS c, '' AS d, '' AS e, '' AS f FROM category_order",
        "SELECT 'employee' AS kind, CAST(id AS TEXT) AS a, name AS b, role AS c, '' AS d, '' AS e, '' AS f FROM employees WHERE active=1",
        "SELECT 'menu' AS kind, CAST(id AS TEXT) AS a, emoji AS b, name AS c, category AS d, CAST(price AS TEXT) AS e, '' AS f FROM menu_items WHERE active=1",
        "SELECT 'lowstock' AS kind, item_name AS a, CAST(quantity AS TEXT) AS b, unit AS c, CAST(min_stock AS TEXT) AS d, '' AS e, '' AS f FROM inventory WHERE quantity <= min_stock AND min_stock > 0",
        "SELECT 'cancelcount' AS kind, CAST(COUNT(*) AS TEXT) AS a, '' AS b, '' AS c, '' AS d, '' AS e, '' AS f FROM cancellation_requests WHERE status='pending'",
    ]
    rows = c.execute(" UNION ALL ".join(branches)).fetchall()
    raw_settings = {}
    menu = []
    catorder = {}
    employees = []
    low_stock = []
    cancel_count = 0
    for r in rows:
        kind = r["kind"]
        v1, v2, v3, v4, v5, v6 = r["a"], r["b"], r["c"], r["d"], r["e"], r["f"]
        if kind == "setting":
            raw_settings[v1] = v2
        elif kind == "catorder":
            catorder[v1] = int(v2)
        elif kind == "employee":
            employees.append({"id": int(v1), "name": v2, "role": v3})
        elif kind == "menu":
            menu.append({"id": int(v1), "emoji": v2, "name": v3, "category": v4, "price": float(v5)})
        elif kind == "lowstock":
            low_stock.append({"item_name": v1, "quantity": float(v2), "unit": v3, "min_stock": float(v4)})
        elif kind == "cancelcount":
            cancel_count = int(v1)
    try:
        tax_rate = float(raw_settings.get("tax_rate", 0.03))
    except (TypeError, ValueError):
        tax_rate = 0.03
    settings = {
        "restaurant_name": raw_settings.get("restaurant_name", "مطعم الذوق الرفيع"),
        "tax_rate": tax_rate,
        "currency": raw_settings.get("currency", "ر.س"),
        "auto_backup": raw_settings.get("auto_backup", "1") == "1",
        "backup_freq": raw_settings.get("backup_freq", "daily"),
        "day_close_remind_hour": int(raw_settings.get("day_close_remind_hour", "21")),
    }
    return (settings, menu, catorder, employees, low_stock, cancel_count)


@app.route("/api/bootstrap")
def api_bootstrap():
    """بيانات الإقلاع موحّدة في طلب واحد: استعلام مباشر واحد للطاولات فقط
    + كاش قصير TTL للبيانات شبه الثابتة (بدلاً من ~8 رحلات متتابعة)."""
    u = require_user()
    conn = get_db()
    try:
        c = conn.cursor()
        now = time.time()
        if _boot_cache["payload"] is None or now - _boot_cache["ts"] > _BOOT_TTL:
            _boot_cache["ts"] = now
            _boot_cache["payload"] = _bootstrap_static(conn)
        settings, menu, catorder, employees, low_stock, cancel_count = _boot_cache["payload"]

        tabs = c.execute(
            "SELECT t.id, t.num, t.section, t.pos_x, t.pos_y, t.capacity, t.shape, "
            "(SELECT COUNT(*) FROM orders o WHERE o.table_id = t.id AND o.status IN ('active','sent','ready')) AS active_cnt "
            "FROM tables t ORDER BY t.section, t.num").fetchall()
        tables = [{"id": t["id"], "num": t["num"], "section": t["section"],
                   "pos_x": t["pos_x"], "pos_y": t["pos_y"],
                   "capacity": t["capacity"], "shape": t["shape"],
                   "active": t["active_cnt"] > 0, "orders": t["active_cnt"]} for t in tabs]
    finally:
        conn.close()
    return jsonify({
        "user": u,
        "settings": settings,
        "menu": menu,
        "category_order": catorder,
        "tables": tables,
        "employees": employees,
        "low_stock": low_stock,
        "cancel_count": cancel_count,
    })


@app.route("/api/promo/list")
def api_promo_list():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("SELECT * FROM promo_codes ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/promo", methods=["POST"])
def api_promo_create():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    promo_code = str(data.get("code", "")).strip().upper()
    discount_type = data.get("discount_type", "percent")
    discount_value = float(data.get("discount_value", 0))
    min_order = float(data.get("min_order", 0))
    max_uses = int(data.get("max_uses", 0))
    expires_at = data.get("expires_at", "")
    if not promo_code:
        return jsonify({"error": "الاسم مطلوب"}), 400
    if discount_type not in ("percent", "fixed"):
        return jsonify({"error": "نوع الخصم غير صالح"}), 400
    if discount_value <= 0:
        return jsonify({"error": "قيمة الخصم غير صالحة"}), 400
    conn = get_db()
    try:
        conn.execute("INSERT INTO promo_codes (code, discount_type, discount_value, min_order, max_uses, expires_at) VALUES (?,?,?,?,?,?)",
                     (promo_code, discount_type, discount_value, min_order, max_uses, expires_at))
        conn.commit()
        audit("promo_add", f"إضافة كود خصم: {promo_code}")
    except DB_INTEGRITY:
        conn.close()
        return jsonify({"error": "الكود موجود مسبقاً"}), 400
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/promo/<int:pid>", methods=["DELETE"])
def api_promo_delete(pid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    conn.execute("DELETE FROM promo_codes WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    audit("promo_delete", f"حذف كود خصم #{pid}")
    return jsonify({"ok": True})


@app.route("/api/promo/<int:pid>", methods=["PUT"])
def api_promo_update(pid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM promo_codes WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "الكود غير موجود"}), 404
    promo_code = str(data.get("code", row["code"])).strip().upper()
    discount_type = data.get("discount_type", row["discount_type"])
    discount_value = float(data.get("discount_value", row["discount_value"]))
    min_order = float(data.get("min_order", row["min_order"]))
    max_uses = int(data.get("max_uses", row["max_uses"]))
    expires_at = data.get("expires_at", row["expires_at"])
    active = data.get("active", row["active"])
    if not promo_code:
        conn.close()
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn.execute("""UPDATE promo_codes SET code=?, discount_type=?, discount_value=?, min_order=?, max_uses=?, expires_at=?, active=? WHERE id=?""",
                 (promo_code, discount_type, discount_value, min_order, max_uses, expires_at, active, pid))
    conn.commit()
    conn.close()
    audit("promo_update", f"تحديث كود خصم: {promo_code}")
    return jsonify({"ok": True})


@app.route("/api/promo/verify", methods=["POST"])
def api_promo_verify():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    code = str(data.get("code", "")).strip().upper()
    order_total = float(data.get("order_total", 0))
    if not code:
        return jsonify({"error": "أدخل كود الخصم"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM promo_codes WHERE code=? AND active=1", (code,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "كود غير صالح"}), 400
    if row["max_uses"] > 0 and row["used_count"] >= row["max_uses"]:
        conn.close()
        return jsonify({"error": "تم استخدام هذا الكود بالفعل"}), 400
    if row["expires_at"] and row["expires_at"] < _now().strftime("%Y-%m-%d"):
        conn.close()
        return jsonify({"error": "انتهت صلاحية الكود"}), 400
    if order_total < row["min_order"]:
        conn.close()
        return jsonify({"error": f"الحد الأدنى للطلب {row['min_order']}"}), 400
    discount = row["discount_value"] if row["discount_type"] == "fixed" else order_total * row["discount_value"] / 100
    if discount > order_total:
        discount = order_total
    conn.close()
    return jsonify({"ok": True, "discount": discount, "type": row["discount_type"], "value": row["discount_value"]})


@app.route("/api/inventory/list")
def api_inventory_list():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("SELECT * FROM inventory ORDER BY item_name").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/inventory", methods=["POST"])
def api_inventory_create():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    item_name = str(data.get("item_name", "")).strip()
    quantity = float(data.get("quantity", 0))
    unit = str(data.get("unit", "piece")).strip()
    min_stock = float(data.get("min_stock", 0))
    cost = float(data.get("cost", 0))
    if not item_name:
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn = get_db()
    conn.execute("INSERT INTO inventory (item_name, quantity, unit, min_stock, cost) VALUES (?,?,?,?,?)",
                 (item_name, quantity, unit, min_stock, cost))
    conn.commit()
    conn.close()
    audit("inventory_add", f"إضافة مخزون: {item_name}")
    return jsonify({"ok": True})


@app.route("/api/inventory/<int:iid>", methods=["PUT"])
def api_inventory_update(iid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    conn = get_db()
    item_name = str(data.get("item_name", "")).strip()
    quantity = float(data.get("quantity", 0))
    unit = str(data.get("unit", "piece")).strip()
    min_stock = float(data.get("min_stock", 0))
    cost = float(data.get("cost", 0))
    if not item_name:
        conn.close()
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn.execute("UPDATE inventory SET item_name=?, quantity=?, unit=?, min_stock=?, cost=?, last_updated=CURRENT_TIMESTAMP WHERE id=?",
                 (item_name, quantity, unit, min_stock, cost, iid))
    conn.commit()
    conn.close()
    audit("inventory_update", f"تحديث مخزون #{iid}: {item_name}")
    return jsonify({"ok": True})


@app.route("/api/inventory/<int:iid>", methods=["DELETE"])
def api_inventory_delete(iid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    conn.execute("DELETE FROM inventory WHERE id=?", (iid,))
    conn.commit()
    conn.close()
    audit("inventory_delete", f"حذف مخزون #{iid}")
    return jsonify({"ok": True})


@app.route("/api/inventory/low")
def api_inventory_low():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("SELECT * FROM inventory WHERE quantity <= min_stock AND min_stock > 0 ORDER BY item_name").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ===== ربط المنيو بالمخزون =====
@app.route("/api/menu-inventory/<int:menu_id>")
def api_menu_inventory(menu_id):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("""
        SELECT mi.inventory_id, mi.qty_per, inv.item_name, inv.unit, inv.quantity, inv.min_stock
        FROM menu_inventory mi
        JOIN inventory inv ON inv.id = mi.inventory_id
        WHERE mi.menu_id = ?
        ORDER BY inv.item_name
    """, (menu_id,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/menu-inventory/<int:menu_id>", methods=["POST"])
def api_menu_inventory_add(menu_id):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    inventory_id = data.get("inventory_id")
    qty_per = _amount(data, "qty_per", 1)
    if not inventory_id:
        return jsonify({"error": "اختر مادة مخزون"}), 400
    if qty_per <= 0:
        qty_per = 1
    conn = get_db()
    c = conn.cursor()
    if not c.execute("SELECT id FROM menu_items WHERE id=?", (menu_id,)).fetchone():
        conn.close()
        return jsonify({"error": "الصنف غير موجود"}), 404
    if not c.execute("SELECT id FROM inventory WHERE id=?", (inventory_id,)).fetchone():
        conn.close()
        return jsonify({"error": "المادة المخزنية غير موجودة"}), 404
    try:
        c.execute("INSERT OR REPLACE INTO menu_inventory (menu_id, inventory_id, qty_per) VALUES (?,?,?)",
                  (menu_id, inventory_id, qty_per))
        conn.commit()
    except DB_INTEGRITY:
        conn.close()
        return jsonify({"error": "تعذر الربط"}), 400
    conn.close()
    audit("menu_inventory_link", f"ربط صنف #{menu_id} بمخزون #{inventory_id} (كمية {qty_per})")
    return jsonify({"ok": True})


@app.route("/api/menu-inventory/<int:menu_id>/<int:inventory_id>", methods=["DELETE"])
def api_menu_inventory_del(menu_id, inventory_id):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    conn.execute("DELETE FROM menu_inventory WHERE menu_id=? AND inventory_id=?", (menu_id, inventory_id))
    conn.commit()
    conn.close()
    audit("menu_inventory_unlink", f"فك ربط صنف #{menu_id} من مخزون #{inventory_id}")
    return jsonify({"ok": True})


# ===== نظام الآجل (أرصدة) =====
@app.route("/api/credit/list")
def api_credit_list():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    q = (request.args.get("q") or "").strip()
    status = request.args.get("status") or ""
    conn = get_db()
    rows = []
    sql = "SELECT id, customer_name, order_id, table_num, table_section, total, paid, status, created_at FROM credit_ledger WHERE 1=1"
    params = []
    if status in ("open", "settled"):
        sql += " AND status=?"
        params.append(status)
    if q:
        sql += " AND customer_name LIKE ?"
        params.append(f"%{q}%")
    sql += " ORDER BY id DESC"
    for r in conn.execute(sql, params).fetchall():
        d = dict(r)
        d["src"] = "ledger"
        rows.append(d)
    # فواتير الآجل المسدّدة بالكامل غير المقيّدة في الدفتر: تُعرض أيضاً مع اسم الدائن
    if status != "open":
        osql = ("SELECT id, credit_name, table_num, table_section, total, paid, date FROM orders "
                "WHERE payment_method='آجل' AND id NOT IN "
                "(SELECT DISTINCT order_id FROM credit_ledger WHERE order_id IS NOT NULL)")
        oparams = []
        if q:
            osql += " AND credit_name LIKE ?"
            oparams.append(f"%{q}%")
        osql += " ORDER BY id DESC"
        for r in conn.execute(osql, oparams).fetchall():
            rows.append({
                "id": r["id"], "customer_name": r["credit_name"] or "",
                "order_id": r["id"], "table_num": r["table_num"],
                "table_section": r["table_section"] if "table_section" in r.keys() else None,
                "total": r["total"] or 0, "paid": r["paid"] or 0,
                "status": "settled", "created_at": r["date"], "src": "order",
            })
    conn.close()
    rows.sort(key=lambda x: (x.get("created_at") or ""), reverse=True)
    return jsonify(rows)


@app.route("/api/credit/<int:lid>/payments")
def api_credit_payments(lid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("SELECT * FROM credit_payments WHERE ledger_id=? ORDER BY id ASC", (lid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/credit/summary")
def api_credit_summary():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    try:
        total_due = conn.execute("SELECT COALESCE(SUM(total),0) FROM credit_ledger WHERE status='open'").fetchone()[0]
        total_paid = conn.execute("SELECT COALESCE(SUM(paid),0) FROM credit_ledger WHERE status='open'").fetchone()[0]
        settled = conn.execute("SELECT COUNT(*) FROM credit_ledger WHERE status='settled'").fetchone()[0]
        settled += conn.execute(
            "SELECT COUNT(*) FROM orders WHERE payment_method='آجل' AND id NOT IN "
            "(SELECT DISTINCT order_id FROM credit_ledger WHERE order_id IS NOT NULL)").fetchone()[0]
        today = _now().strftime("%Y-%m-%d")
        today_collected = conn.execute(
            "SELECT COALESCE(SUM(amount),0) FROM credit_payments WHERE date(date) = ?", (today,)).fetchone()[0]
        today_opened = conn.execute(
            "SELECT COUNT(*) FROM credit_ledger WHERE date(created_at) = ?", (today,)).fetchone()[0]
        open_count = conn.execute("SELECT COUNT(*) FROM credit_ledger WHERE status='open'").fetchone()[0]
    finally:
        conn.close()
    return jsonify({"total_due": round(total_due, 2), "total_paid": round(total_paid, 2),
                    "remaining": round(total_due - total_paid, 2), "open_count": open_count,
                    "settled": settled, "today_collected": round(today_collected, 2),
                    "today_opened": today_opened})


@app.route("/api/credit/settle", methods=["POST"])
def api_credit_settle():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    lid = data.get("ledger_id")
    amount = _amount(data, "amount", 0)
    method = str(data.get("method") or "نقدي")
    if not lid:
        return jsonify({"error": "معرف الرصيد مطلوب"}), 400
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT * FROM credit_ledger WHERE id=? AND status='open'", (lid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "الرصيد غير موجود أو مقفل"}), 404
    if amount <= 0:
        conn.close()
        return jsonify({"error": "مبلغ غير صالح"}), 400
    remaining_before = round((row["total"] or 0) - (row["paid"] or 0), 2)
    if amount > remaining_before + 0.001:
        conn.close()
        return jsonify({"error": f"المبلغ أكبر من المتبقي ({remaining_before:.2f})"}), 400
    new_paid = round((row["paid"] or 0) + amount, 2)
    remaining = round((row["total"] or 0) - new_paid, 2)
    status = "settled" if remaining <= 0.001 else "open"
    now_sql = _now_sql()
    try:
        # A customer collection is a real receipt: create the deposit voucher
        # and the credit payment together so neither record can exist alone.
        c.execute(
            "INSERT INTO deposit_vouchers "
            "(receipt_no, customer_name, phone, party_date, description, amount, method, transfer_ref, transfer_name, employee, date) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (None, row["customer_name"] or "", row["phone"] or "", now_sql[:10],
             f"تحصيل آجل #{lid}", amount, method,
             str(data.get("transfer_ref") or "").strip() or None,
             str(data.get("transfer_name") or "").strip() or None,
             u["name"], now_sql))
        voucher_id = c.lastrowid
        receipt_no = "QC-%d-%05d" % (_now().year, voucher_id)
        c.execute("UPDATE deposit_vouchers SET receipt_no=? WHERE id=?", (receipt_no, voucher_id))

        c.execute("UPDATE credit_ledger SET paid=?, status=?, updated_at=datetime('now','localtime') WHERE id=?",
                  (new_paid, status, lid))
        c.execute(
            "INSERT INTO credit_payments (ledger_id, amount, method, employee, date, transfer_ref, transfer_name, receipt_no, deposit_voucher_id) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (lid, amount, method, u["name"], now_sql,
             str(data.get("transfer_ref") or "").strip() or None,
             str(data.get("transfer_name") or "").strip() or None,
             receipt_no, voucher_id))
        pid = c.lastrowid
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    conn.close()
    receipt = {"receipt_no": receipt_no, "voucher_id": voucher_id, "payment_id": pid,
               "ledger_id": lid, "customer_name": row["customer_name"],
               "phone": row["phone"] or "", "amount": amount, "method": method,
               "employee": u["name"], "date": now_sql}
    audit("credit_pay", f"تحصيل آجل #{lid} بمبلغ {amount:.2f} ({method}) - {receipt_no}")
    return jsonify({"ok": True, "remaining": remaining, "status": status, "receipt": receipt})


@app.route("/api/credit/receipts")
def api_credit_receipts():
    """سندات قبض تحصيل الآجل (لتقرير سندات القبض)."""
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    c = conn.cursor()
    where = "1=1"
    params = []
    if from_d:
        where += " AND date(p.date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(p.date) <= ?"
        params.append(to_d)
    rows = c.execute(
        f"SELECT p.id, p.receipt_no, p.ledger_id, p.amount, p.method, p.employee, p.date, "
        f"l.customer_name, l.phone, l.order_id, l.table_num "
        f"FROM credit_payments p LEFT JOIN credit_ledger l ON p.ledger_id=l.id "
        f"WHERE {where} ORDER BY p.id DESC", params).fetchall()
    conn.close()
    items = [{"id": r["id"], "receipt_no": r["receipt_no"], "ledger_id": r["ledger_id"],
              "customer_name": r["customer_name"] or "", "phone": r["phone"] or "",
              "order_id": r["order_id"], "table_num": r["table_num"],
              "amount": round(r["amount"] or 0, 2), "method": r["method"] or "نقدي",
              "employee": r["employee"] or "", "date": r["date"] or ""} for r in rows]
    total = round(sum(i["amount"] for i in items), 2)
    return jsonify({"items": items, "count": len(items), "total": total})


# ===== ذمم المدينة (المورّدين) =====
@app.route("/api/supplier/list")
def api_supplier_list():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    q = (request.args.get("q") or "").strip()
    status = request.args.get("status") or ""
    conn = get_db()
    sql = "SELECT * FROM supplier_ledger WHERE 1=1"
    params = []
    if status in ("open", "settled"):
        sql += " AND status=?"
        params.append(status)
    if q:
        sql += " AND supplier_name LIKE ?"
        params.append(f"%{q}%")
    sql += " ORDER BY id DESC"
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    conn.close()
    return jsonify(rows)


@app.route("/api/supplier/summary")
def api_supplier_summary():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    total_due = conn.execute("SELECT COALESCE(SUM(total),0) FROM supplier_ledger WHERE status='open'").fetchone()[0]
    total_paid = conn.execute("SELECT COALESCE(SUM(paid),0) FROM supplier_ledger WHERE status='open'").fetchone()[0]
    open_count = conn.execute("SELECT COUNT(*) FROM supplier_ledger WHERE status='open'").fetchone()[0]
    settled_count = conn.execute("SELECT COUNT(*) FROM supplier_ledger WHERE status='settled'").fetchone()[0]
    today = _now().strftime("%Y-%m-%d")
    today_paid = conn.execute("SELECT COALESCE(SUM(amount),0) FROM supplier_payments WHERE date(date)=?", (today,)).fetchone()[0]
    conn.close()
    return jsonify({"total_due": round(total_due,2), "total_paid": round(total_paid,2),
                    "remaining": round(total_due - total_paid,2), "open_count": open_count,
                    "settled_count": settled_count, "today_paid": round(today_paid,2)})


@app.route("/api/supplier/add", methods=["POST"])
def api_supplier_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    name = (data.get("supplier_name") or "").strip()
    if not name:
        return jsonify({"error": "اسم المورد مطلوب"}), 400
    total = _amount(data, "total", 0)
    paid = _amount(data, "paid", 0)
    phone = (data.get("phone") or "").strip()
    description = (data.get("description") or "").strip()
    due_date = (data.get("due_date") or "").strip() or None
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO supplier_ledger (supplier_name, phone, description, total, paid, status, due_date, created_at) "
              "VALUES (?,?,?,?,?,?,?,?, datetime('now','localtime'))",
              (name, phone, description, total, paid, "open" if total > paid else "settled", due_date))
    lid = c.lastrowid
    if paid > 0:
        c.execute("INSERT INTO supplier_payments (ledger_id, amount, method, employee, date) "
                  "VALUES (?,?,?,?, datetime('now','localtime'))",
                  (lid, paid, data.get("method") or "نقدي", u["name"]))
    conn.commit()
    conn.close()
    audit("supplier_open", f"فتح رصيد مورد {name} - {total:.2f}")
    return jsonify({"ok": True, "id": lid})


@app.route("/api/supplier/<int:lid>/pay", methods=["POST"])
def api_supplier_pay(lid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    amount = _amount(data, "amount", 0)
    method = str(data.get("method") or "نقدي")
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT * FROM supplier_ledger WHERE id=? AND status='open'", (lid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "الرصيد غير موجود أو مقفل"}), 404
    if amount <= 0:
        conn.close()
        return jsonify({"error": "مبلغ غير صالح"}), 400
    new_paid = round(row["paid"] + amount, 2)
    if new_paid > row["total"]:
        new_paid = row["total"]
    remaining = round(row["total"] - new_paid, 2)
    status = "settled" if remaining <= 0 else "open"
    c.execute("UPDATE supplier_ledger SET paid=?, status=?, updated_at=datetime('now','localtime') WHERE id=?",
              (new_paid, status, lid))
    c.execute("INSERT INTO supplier_payments (ledger_id, amount, method, employee, date) "
              "VALUES (?,?,?,?, datetime('now','localtime'))",
              (lid, amount, method, u["name"]))
    conn.commit()
    conn.close()
    audit("supplier_pay", f"دفع لمورد #{lid} بمبلغ {amount:.2f}")
    return jsonify({"ok": True, "remaining": remaining, "status": status})


@app.route("/api/supplier/<int:lid>/payments")
def api_supplier_payments(lid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("SELECT * FROM supplier_payments WHERE ledger_id=? ORDER BY id ASC", (lid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ===== المصروفات =====
@app.route("/api/expenses")
def api_expenses():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    sql = "SELECT * FROM expenses WHERE 1=1"
    params = []
    if from_d:
        sql += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        sql += " AND date(date) <= ?"
        params.append(to_d)
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, params).fetchall()
    total = conn.execute("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE 1=1" +
                         (" AND date(date) >= ?" if from_d else "") +
                         (" AND date(date) <= ?" if to_d else ""),
                         ([from_d] if from_d else []) + ([to_d] if to_d else [])).fetchone()[0]
    conn.close()
    return jsonify({"items": [dict(r) for r in rows], "total": round(total, 2)})


@app.route("/api/expenses", methods=["POST"])
def api_expenses_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    description = str(data.get("description", "")).strip()
    amount = _amount(data, "amount", 0)
    category = str(data.get("category") or "عام").strip() or "عام"
    if not description:
        return jsonify({"error": "وصف المصروف مطلوب"}), 400
    if amount <= 0:
        return jsonify({"error": "مبلغ غير صالح"}), 400
    exp_date = str(data.get("date") or "").strip() or _now_sql()
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO expenses (date, category, description, amount, added_by) VALUES (?,?,?,?,?)",
              (exp_date, category, description, amount, u["name"]))
    eid = c.lastrowid
    conn.commit()
    conn.close()
    audit("expense_add", f"إضافة مصروف #{eid}: {description} ({amount:.2f})")
    return jsonify({"ok": True, "id": eid})


@app.route("/api/expenses/<int:eid>", methods=["DELETE"])
def api_expenses_del(eid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    conn.execute("DELETE FROM expenses WHERE id=?", (eid,))
    conn.commit()
    conn.close()
    audit("expense_delete", f"حذف مصروف #{eid}")
    return jsonify({"ok": True})


@app.route("/api/customer/list")
def api_customer_list():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    rows = conn.execute("SELECT * FROM customers ORDER BY name").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/customer/analytics")
def api_customer_analytics():
    """مرجع العملاء: لكل عميل إجمالي الأموال/المدفوع/المتبقي/آخر دفعة/طرق الدفع والفواتير."""
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    q = (request.args.get("q") or "").strip().lower()
    conn = get_db()
    c = conn.cursor()
    customers = c.execute("SELECT id, name, phone, points FROM customers ORDER BY name").fetchall()
    ledgers = c.execute("SELECT id, customer_id, customer_name, phone, order_id, table_num, total, paid, status, created_at, due_date FROM credit_ledger").fetchall()
    pandas = c.execute("SELECT ledger_id, amount, method, employee, receipt_no, date FROM credit_payments").fetchall()
    try:
        dv_rows = c.execute("SELECT id, receipt_no, customer_name, phone, party_date, description, amount, method, transfer_ref, employee, date FROM deposit_vouchers").fetchall()
    except Exception:
        dv_rows = []
    conn.close()
    # دفع مسددة: ledger_id -> [payments]
    pays_by = {}
    for p in pandas:
        pays_by.setdefault(p["ledger_id"], []).append(dict(p))
    # فهرسة العملاء المسجلين
    phone_to_cid = {}
    name_to_cid = {}
    for cu in customers:
        if cu["phone"]:
            phone_to_cid[str(cu["phone"]).strip().lower()] = cu["id"]
        name_to_cid[(cu["name"] or "").strip().lower()] = cu["id"]
    customers_map = {cu["id"]: cu for cu in customers}

    def resolve_key(l):
        if l["customer_id"] and l["customer_id"] in customers_map:
            return ("id", l["customer_id"])
        if l["phone"] and str(l["phone"]).strip().lower() in phone_to_cid:
            return ("id", phone_to_cid[str(l["phone"]).strip().lower()])
        nm = (l["customer_name"] or "").strip().lower()
        if nm in name_to_cid:
            return ("id", name_to_cid[nm])
        return ("name", nm or "—")

    agg = {}

    def ensure(key):
        a = agg.get(key)
        if not a:
            a = {"key": key, "cid": None, "name": "", "phone": "", "points": 0,
                 "total": 0.0, "paid": 0.0, "remaining": 0.0,
                 "open_count": 0, "settled_count": 0,
                 "methods": {}, "last_payment": None, "invoices": [], "receipts": []}
            agg[key] = a
        return a

    # تسجيل العملاء الموجودين (حتى لو بلا ذمم)
    for cu in customers:
        a = ensure(("id", cu["id"]))
        a["cid"] = cu["id"]
        a["name"] = cu["name"] or ""
        a["phone"] = cu["phone"] or ""
        a["points"] = cu["points"] or 0

    for l in ledgers:
        a = ensure(resolve_key(l))
        if not a["name"]:
            a["name"] = l["customer_name"] or ""
        if not a["phone"]:
            a["phone"] = l["phone"] or ""
        a["total"] = round(a["total"] + (l["total"] or 0), 2)
        a["paid"] = round(a["paid"] + (l["paid"] or 0), 2)
        if l["status"] == "open":
            a["open_count"] += 1
        else:
            a["settled_count"] += 1
        inv = {"ledger_id": l["id"], "order_id": l["order_id"], "table_num": l["table_num"],
               "date": l["created_at"], "due_date": l["due_date"],
               "total": l["total"] or 0, "paid": l["paid"] or 0,
               "remaining": round((l["total"] or 0) - (l["paid"] or 0), 2),
               "status": l["status"],
               "payments": pays_by.get(l["id"], [])}
        a["invoices"].append(inv)
        for p in pays_by.get(l["id"], []):
            m = p["method"] or "نقدي"
            a["methods"][m] = round(a["methods"].get(m, 0) + (p["amount"] or 0), 2)
            pd = (p["date"] or "")[:10]
            if not a["last_payment"] or pd > a["last_payment"]:
                a["last_payment"] = pd
            if p.get("receipt_no"):
                a["receipts"].append({"receipt_no": p["receipt_no"], "kind": "credit_payment",
                                      "date": p["date"] or "", "amount": p["amount"] or 0,
                                      "method": m, "employee": p["employee"] or "",
                                      "ledger_id": p["ledger_id"]})

    # سندات قبض الحفلات (مقدمات) لنفس العميل
    dv_by_phone = {}
    dv_by_name = {}
    for v in dv_rows:
        if v["phone"]:
            dv_by_phone.setdefault(str(v["phone"]).strip().lower(), []).append(v)
        dv_by_name.setdefault((v["customer_name"] or "").strip().lower(), []).append(v)
    for a in list(agg.values()):
        a_phone = (a.get("phone") or "").strip().lower()
        for v in (dv_by_phone.get(a_phone, []) if a_phone else []) + dv_by_name.get((a.get("name") or "").strip().lower(), []):
            if v["receipt_no"] and not any(r["receipt_no"] == v["receipt_no"] for r in a["receipts"]):
                a["receipts"].append({"receipt_no": v["receipt_no"], "kind": "deposit",
                                      "date": v["date"] or "", "amount": v["amount"] or 0,
                                      "method": v["method"] or "نقدي", "employee": v["employee"] or "",
                                      "party_date": v["party_date"] or ""})

    result = []
    for a in agg.values():
        a["remaining"] = round(a["total"] - a["paid"], 2)
        a["methods"] = [{"method": k, "amount": v} for k, v in sorted(a["methods"].items(), key=lambda x: -x[1])]
        a["invoices"].sort(key=lambda x: x["date"] or "", reverse=True)
        a["receipts"].sort(key=lambda x: x["date"] or "", reverse=True)
        result.append(a)

    if q:
        result = [a for a in result if q in a["name"].lower() or q in a["phone"].lower()]

    result.sort(key=lambda a: (-a["remaining"], a["name"]))
    totals = {"invoiced": round(sum(a["total"] for a in result), 2),
              "paid": round(sum(a["paid"] for a in result), 2),
              "remaining": round(sum(a["remaining"] for a in result), 2),
              "count": len(result)}
    return jsonify({"customers": result, "totals": totals})


@app.route("/api/customer", methods=["POST"])
def api_customer_create():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip() or None
    if not name:
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn = get_db()
    try:
        conn.execute("INSERT INTO customers (name, phone) VALUES (?,?)", (name, phone))
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "رقم الهاتف مسجّل لعميل آخر"}), 409
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/customer/<int:cid>", methods=["PUT"])
def api_customer_update(cid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip() or None
    points = int(data.get("points", 0))
    if not name:
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn = get_db()
    try:
        conn.execute("UPDATE customers SET name=?, phone=?, points=? WHERE id=?", (name, phone, points, cid))
        conn.commit()
    except Exception:
        conn.close()
        return jsonify({"error": "رقم الهاتف مسجّل لعميل آخر"}), 409
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/customer/lookup")
def api_customer_lookup():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    phone = request.args.get("phone", "").strip()
    if not phone:
        return jsonify({"error": "أدخل رقم الهاتف"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM customers WHERE phone=?", (phone,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "عميل غير موجود"}), 404
    return jsonify(dict(row))


@app.route("/api/customer/<int:cid>/points", methods=["POST"])
def api_customer_add_points(cid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    points = int(data.get("points", 0))
    if points == 0:
        return jsonify({"error": "نقطة غير صالحة"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "عميل غير موجود"}), 404
    new_points = max(0, row["points"] + points)
    conn.execute("UPDATE customers SET points=? WHERE id=?", (new_points, cid))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "points": new_points})


@app.route("/api/reservation/list")
def api_reservation_list():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    today = _now().strftime("%Y-%m-%d")
    rows = conn.execute("SELECT * FROM reservations WHERE date >= ? ORDER BY date, time", (today,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/reservation", methods=["POST"])
def api_reservation_create():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    customer_name = str(data.get("customer_name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    table_id = data.get("table_id")
    date = str(data.get("date", "")).strip()
    time = str(data.get("time", "")).strip()
    guests = int(data.get("guests", 1))
    notes = str(data.get("notes", "")).strip()
    if not customer_name or not date or not time or not table_id:
        return jsonify({"error": "البيانات ناقصة"}), 400
    conn = get_db()
    conflict = conn.execute("SELECT id FROM reservations WHERE table_id=? AND date=? AND time=? AND status != 'cancelled'", (table_id, date, time)).fetchone()
    if conflict:
        conn.close()
        return jsonify({"error": "الطاولة محجوزة في هذا الوقت"}), 400
    num, section = _table_ref(conn.cursor(), table_id)
    conn.execute("INSERT INTO reservations (customer_name, phone, table_id, table_num, table_section, date, time, guests, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (customer_name, phone, table_id, num, section, date, time, guests, notes, u["id"]))
    conn.commit()
    conn.close()
    audit("reservation_create", f"حجز طاولة {num} ({section}): {customer_name}")
    return jsonify({"ok": True})


@app.route("/api/reservation/<int:rid>", methods=["PUT"])
def api_reservation_update(rid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    status = str(data.get("status", "")).strip()
    if status not in ("confirmed", "cancelled"):
        return jsonify({"error": "حالة غير صالحة"}), 400
    conn = get_db()
    conn.execute("UPDATE reservations SET status=? WHERE id=?", (status, rid))
    conn.commit()
    conn.close()
    audit("reservation_update", f"تحديث حجز #{rid}: {status}")
    return jsonify({"ok": True})


@app.route("/api/reservation/table")
def api_reservation_table():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    table_id = request.args.get("table_id")
    if not table_id:
        return jsonify([])
    conn = get_db()
    today = _now().strftime("%Y-%m-%d")
    rows = conn.execute("SELECT * FROM reservations WHERE table_id=? AND date=? AND status IN ('pending','confirmed') ORDER BY time ASC",
                        (table_id, today)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/reservation/arrive", methods=["POST"])
def api_reservation_arrive():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_id = data.get("table_id")
    if not table_id:
        return jsonify({"error": "اختر طاولة"}), 400
    conn = get_db()
    c = conn.cursor()
    today = _now().strftime("%Y-%m-%d")
    rsv = c.execute("SELECT * FROM reservations WHERE table_id=? AND date=? AND status IN ('pending','confirmed') ORDER BY time ASC LIMIT 1",
                    (table_id, today)).fetchone()
    if not rsv:
        conn.close()
        return jsonify({"error": "لا يوجد حجز اليوم لهذه الطاولة"}), 404
    c.execute("UPDATE reservations SET status='arrived' WHERE id=?", (rsv["id"],))
    oid = _open_order_id(c, table_id)
    if oid:
        c.execute("UPDATE orders SET reservation_id=? WHERE id=? AND reservation_id IS NULL", (rsv["id"], oid))
    conn.commit()
    conn.close()
    audit("reservation_arrive", f"تسجيل وصول حاجز الحجز #{rsv['id']} - طاولة {rsv['table_num']} ({rsv['customer_name']})")
    return jsonify({"ok": True, "reservation": dict(rsv)})


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.json or {}
    emp_id = data.get("employee_id")
    pin = data.get("pin", "")
    try:
        emp_id_int = int(emp_id)
    except (TypeError, ValueError):
        emp_id_int = 0
    attempts, lock_left = _login_lock_state(emp_id_int)
    if lock_left > 0:
        return jsonify({"error": f"تم قفل الدخول مؤقتاً، حاول بعد {lock_left} ثانية"}), 429
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT id, name, role, pin, discount_limit FROM employees WHERE id=? AND active=1 AND status='active'", (emp_id,)).fetchone()
    conn.close()
    if not row and _employee_exists(emp_id):
        _register_login_fail(emp_id_int)
        return jsonify({"error": "الحساب غير نشط حالياً"}), 403
    if row and verify_pin(pin, row["pin"]):
        _reset_login_fail(emp_id_int)
        session.permanent = True
        session["user"] = {"id": row["id"], "name": row["name"], "role": row["role"],
                           "discount_limit": float(row["discount_limit"] or 20)}
        audit("login", f"تسجيل دخول: {row['name']}")
        return jsonify({"ok": True, "user": session["user"]})
    _register_login_fail(emp_id_int)
    return jsonify({"error": "PIN غير صحيح"}), 401


@app.route("/api/logout")
def api_logout():
    audit("logout", "تسجيل خروج")
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
def api_me():
    u = require_user()
    if not u:
        return jsonify({"error": "غير مسجل"}), 401
    return jsonify({"user": u})


@app.route("/api/manager/verify", methods=["POST"])
def api_manager_verify():
    pin = (request.json or {}).get("pin", "")
    attempts, lock_left = _login_lock_state(0, target="manager")
    if lock_left > 0:
        return jsonify({"error": f"تم قفل التحقق مؤقتاً، حاول بعد {lock_left} ثانية"}), 429
    conn = get_db()
    c = conn.cursor()
    managers = c.execute("SELECT pin FROM employees WHERE active=1 AND role='manager'").fetchall()
    conn.close()
    for m in managers:
        if verify_pin(pin, m["pin"]):
            _reset_login_fail(0, target="manager")
            return jsonify({"ok": True})
    _register_login_fail(0, target="manager")
    return jsonify({"error": "PIN المدير غير صحيح"}), 403


# ===== سجل التدقيق =====
@app.route("/api/audit/action", methods=["POST"])
def api_audit_action():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    audit(data.get("action", ""), data.get("details", ""))
    return jsonify({"ok": True})


@app.route("/api/audit")
def api_audit():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    if u["role"] != "manager":
        return jsonify({"error": "متاح للمدير فقط"}), 403
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT id, employee, action, details, date FROM audit_log ORDER BY id DESC LIMIT 200").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ===== النسخ الاحتياطي =====
def _stamp():
    return _now().strftime("%Y-%m-%d_%H-%M-%S")


def _dump_remote_to_file(dst_path):
    """تصدير قاعدة السحابة (Turso) إلى ملف SQLite محلي."""
    src = _raw_conn()
    dst = sqlite3.connect(dst_path)
    try:
        objs = src.execute(
            "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL"
        ).fetchall()
        for o in objs:
            dst.execute(o["sql"])
        for o in objs:
            if o["type"] != "table":
                continue
            tname = o["name"]
            cols = [r[1] for r in src.execute('PRAGMA table_info("' + tname + '")').fetchall()]
            col_list = ", ".join('"' + c + '"' for c in cols)
            qmarks = ",".join("?" * len(cols))
            for r in src.execute('SELECT * FROM "' + tname + '"').fetchall():
                dst.execute('INSERT INTO "' + tname + '" (' + col_list + ") VALUES (" + qmarks + ")",
                            tuple(r[i] for i in range(len(cols))))
        dst.commit()
    finally:
        dst.close()
        src.close()


def make_backup(prefix="backup"):
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
    except Exception:
        pass
    dest = os.path.join(BACKUP_DIR, f"{prefix}_{_stamp()}.db")
    if CLOUD_DB:
        _dump_remote_to_file(dest)
    else:
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
    return dest


# ===== النسخ الاحتياطي إلى Vercel Blob (للإنتاج على السحابة) =====
_BLOB_BASE = "https://blob.vercel-storage.com"


def _blob_token():
    return (os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip() or "").strip('"')


def _blob_headers(extra=None):
    h = {
        "authorization": f"Bearer {_blob_token()}",
        "x-api-version": "10",
    }
    if extra:
        h.update(extra)
    return h


def _blob_make_backup(prefix="backup"):
    if not _blob_token():
        return None
    tmp = os.path.join(tempfile.gettempdir(), f"{prefix}_{_stamp()}.db")
    if CLOUD_DB:
        _dump_remote_to_file(tmp)
    else:
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
    try:
        with open(tmp, "rb") as f:
            data = f.read()
        try:
            import requests
            pathname = f"backups/{os.path.basename(tmp)}"
            r = requests.put(
                f"{_BLOB_BASE}/?pathname={pathname}",
                data=data,
                headers=_blob_headers({
                    "x-content-type": "application/octet-stream",
                    "x-vercel-blob-access": "private",
                    "x-cache-control-max-age": "0",
                    "x-add-random-suffix": "0",
                }),
                timeout=30,
            )
            if r.status_code != 200:
                return None
            return os.path.basename(tmp)
        except Exception:
            return None
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass


def _blob_list():
    if not _blob_token():
        return []
    try:
        import requests
        r = requests.get(f"{_BLOB_BASE}/", headers=_blob_headers(), params={"limit": "1000"}, timeout=20)
        if r.status_code != 200:
            return []
        blobs = r.json().get("blobs", [])
    except Exception:
        return []
    items = []
    for b in blobs:
        pathname = b.get("pathname", "") or ""
        name = os.path.basename(pathname)
        if pathname.startswith("backups/") and name.endswith(".db"):
            items.append({
                "name": name,
                "size": b.get("size", 0),
                "date": b.get("uploadedAt", ""),
                "url": b.get("url", ""),
            })
    items.sort(key=lambda x: x["name"], reverse=True)
    return items


def _blob_download(name, dst):
    if not _blob_token():
        return False
    for b in _blob_list():
        if b["name"] == name:
            try:
                import requests
                r = requests.get(b["url"], headers=_blob_headers(), timeout=30)
                if r.status_code != 200:
                    return False
                with open(dst, "wb") as f:
                    f.write(r.content)
                return True
            except Exception:
                return False
    return False


def _blob_cleanup(keep=40):
    if not _blob_token():
        return
    old = _blob_list()[keep:]
    if not old:
        return
    try:
        import requests
        r = requests.post(
            f"{_BLOB_BASE}/delete",
            headers=_blob_headers({"content-type": "application/json"}),
            json={"urls": [b["url"] for b in old]},
            timeout=30,
        )
    except Exception:
        pass


def _cleanup_old_backups(keep=40):
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        files = sorted([f for f in os.listdir(BACKUP_DIR) if f.endswith(".db")], reverse=True)
        for f in files[keep:]:
            try:
                os.remove(os.path.join(BACKUP_DIR, f))
            except Exception:
                pass
    except Exception:
        pass


def auto_backup_now(prefix):
    try:
        if get_setting("auto_backup", "1") != "1":
            return
        make_backup(prefix)
        _cleanup_old_backups()
    except Exception:
        pass


def backup_scheduler():
    """نسخ احتياطي يومي موقوت: يحفظ آخر نسخة في ذاكرة، ولا يكرر ما حدث لليوم."""
    while True:
        try:
            time.sleep(60)
            if get_setting("auto_backup", "1") != "1":
                continue
            freq = get_setting("backup_freq", "daily")
            schedule_key = "scheduled_daily" if freq == "daily" else "scheduled_weekly"
            last = get_setting(schedule_key, "")
            today = _now().strftime("%Y-%m-%d")
            week = _now().strftime("%G-W%V")
            cut = today if freq == "daily" else (week if freq == "weekly" else today)
            if last == cut:
                continue
            # تجنّب التكرار أثناء التشغيل: انتظر حتى مرور 5 دقائق من بدء الخادم
            make_backup("sched" if freq == "daily" else "weekly")
            _cleanup_old_backups()
            set_setting(schedule_key, cut)
        except Exception:
            pass


def _safe_backup_name(name):
    name = os.path.basename(name or "")
    if not name.endswith(".db"):
        return None
    return name


def _restore_from_file(path):
    """استعادة نسخة احتياطية من ملف SQLite محلي (محلياً أو إلى السحابة)."""
    if not CLOUD_DB:
        shutil.copy(path, DB_PATH)
        return
    src = sqlite3.connect(path)
    conn = _raw_conn()
    try:
        for line in src.iterdump():
            line = line.strip()
            if not line or line.startswith("BEGIN") or line.startswith("COMMIT") or line.startswith("PRAGMA"):
                continue
            conn.execute(line)
        conn.commit()
    finally:
        conn.close()
        src.close()


@app.route("/api/backup/download")
def api_backup_download():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    tmp = os.path.join(tempfile.gettempdir(), f"download_{_stamp()}.db")
    if CLOUD_DB:
        _dump_remote_to_file(tmp)
    else:
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
    try:
        return send_file(tmp, as_attachment=True,
                         download_name=f"backup_{_stamp()}.db",
                         mimetype="application/octet-stream")
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass


@app.route("/api/backup/list")
def api_backup_list():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    if _blob_token():
        return jsonify({"backups": _blob_list()})
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
    except Exception:
        pass
    items = []
    try:
        names = sorted(os.listdir(BACKUP_DIR), reverse=True)
    except Exception:
        names = []
    for fn in names:
        if fn.endswith(".db"):
            p = os.path.join(BACKUP_DIR, fn)
            try:
                st = os.stat(p)
                items.append({"name": fn, "size": st.st_size, "date": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
            except Exception:
                pass
    return jsonify({"backups": items})


@app.route("/api/backup/download/<name>")
def api_backup_download_one(name):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    safe = _safe_backup_name(name)
    if not safe:
        return jsonify({"error": "اسم ملف غير صالح"}), 400
    if _blob_token():
        tmp = os.path.join(tempfile.gettempdir(), f"dl_{safe}")
        if not _blob_download(safe, tmp):
            return jsonify({"error": "النسخة غير موجودة"}), 404
        try:
            return send_file(tmp, as_attachment=True, download_name=safe, mimetype="application/octet-stream")
        finally:
            try:
                os.remove(tmp)
            except Exception:
                pass
    p = os.path.join(BACKUP_DIR, safe)
    if not os.path.exists(p):
        return jsonify({"error": "النسخة غير موجودة"}), 404
    return send_file(p, as_attachment=True, download_name=safe, mimetype="application/octet-stream")


@app.route("/api/backup/restore/<name>", methods=["POST"])
def api_backup_restore_one(name):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    safe = _safe_backup_name(name)
    if not safe:
        return jsonify({"error": "اسم ملف غير صالح"}), 400
    if _blob_token():
        p = os.path.join(tempfile.gettempdir(), f"restore_{safe}")
        if not _blob_download(safe, p):
            return jsonify({"error": "النسخة غير موجودة"}), 404
        try:
            con = sqlite3.connect(p)
            ok = con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            con.close()
            if not ok:
                return jsonify({"error": "النسخة تالفة"}), 400
            make_backup("auto_before_restore")
            _restore_from_file(p)
            audit("restore_backup", f"استعادة نسخة: {safe}")
            return jsonify({"ok": True, "message": "تمت الاستعادة بنجاح"})
        except Exception:
            return jsonify({"error": "تعذر فتح النسخة"}), 400
        finally:
            try:
                os.remove(p)
            except Exception:
                pass
    p = os.path.join(BACKUP_DIR, safe)
    if not os.path.exists(p):
        return jsonify({"error": "النسخة غير موجودة"}), 404
    try:
        con = sqlite3.connect(p)
        ok = con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        con.close()
        if not ok:
            return jsonify({"error": "النسخة تالفة"}), 400
    except Exception:
        return jsonify({"error": "تعذر فتح النسخة"}), 400
    make_backup("auto_before_restore")
    _restore_from_file(p)
    audit("restore_backup", f"استعادة نسخة: {safe}")
    return jsonify({"ok": True, "message": "تمت الاستعادة بنجاح"})


@app.route("/api/backup/cron", methods=["POST"])
def api_backup_cron():
    """يستدعيها Vercel Cron: ينشئ نسخة مجدولة على Blob (يومي/أسبوعي حسب الإعدادات)."""
    if request.headers.get("x-vercel-cron") is None and not require_user():
        return jsonify({"error": "غير مصرح"}), 403
    try:
        if get_setting("auto_backup", "1") != "1":
            return jsonify({"ok": True, "skipped": "auto_backup off"})
        freq = get_setting("backup_freq", "daily")
        schedule_key = "scheduled_daily" if freq == "daily" else "scheduled_weekly"
        last = get_setting(schedule_key, "")
        now = _now()
        today = now.strftime("%Y-%m-%d")
        week = now.strftime("%G-W%V")
        cut = today if freq == "daily" else (week if freq == "weekly" else today)
        if last == cut:
            return jsonify({"ok": True, "skipped": "already done"})
        if _blob_token():
            name = _blob_make_backup("sched" if freq == "daily" else "weekly")
            _blob_cleanup()
        else:
            name = make_backup("sched" if freq == "daily" else "weekly")
            _cleanup_old_backups()
        set_setting(schedule_key, cut)
        audit("scheduled_backup", f"نسخة مجدولة: {name}")
        return jsonify({"ok": True, "backup": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===== إغلاق اليوم =====
def _day_summary(c, day):
    rows = c.execute("SELECT * FROM orders WHERE status='completed' AND date(date)=?", (day,)).fetchall()
    total = round(sum(r["total"] or 0 for r in rows), 2)
    tax = round(sum(r["tax"] or 0 for r in rows), 2)
    by_method = {}
    opened = None
    for r in rows:
        m = _report_method(r["payment_method"] or "نقدي")
        bm = by_method.setdefault(m, {"total": 0.0, "count": 0})
        bm["total"] = round(bm["total"] + (r["total"] or 0), 2)
        bm["count"] += 1
        if opened is None or (r["date"] or "") < opened:
            opened = r["date"] or ""
    return {
        "total_sales": total, "order_count": len(rows), "tax_total": tax,
        "expected_cash": round(by_method.get("نقدي", {}).get("total", 0), 2),
        "by_method": [{"method": k, "total": v["total"], "count": v["count"]} for k, v in sorted(by_method.items())],
        "opened_at": opened,
    }


@app.route("/api/day/status")
def api_day_status():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    today = _now().strftime("%Y-%m-%d")
    conn = get_db()
    c = conn.cursor()
    s = _day_summary(c, today)
    cl = c.execute("SELECT * FROM day_closures WHERE date=?", (today,)).fetchone()
    try:
        last_cl = c.execute("SELECT COALESCE(MAX(date), '') FROM day_closures").fetchone()[0]
    except Exception:
        last_cl = ""
    conn.close()
    closure = None
    if cl:
        try:
            by_method = json.loads(cl["by_method"])
        except Exception:
            by_method = []
        closure = {"id": cl["id"], "closed_at": cl["closed_at"], "total_sales": cl["total_sales"],
                   "order_count": cl["order_count"], "tax_total": cl["tax_total"], "by_method": by_method,
                   "expected_cash": cl["expected_cash"], "counted_cash": cl["counted_cash"],
                   "difference": cl["difference"], "closed_by": cl["closed_by"]}
    return jsonify({"date": today, "closed": cl is not None, "closure": closure, "last_closed": last_cl, **s})


@app.route("/api/day/close", methods=["POST"])
def api_day_close():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    try:
        counted = round(float(data.get("counted_cash", 0)), 2)
    except (TypeError, ValueError):
        counted = 0
    today = _now().strftime("%Y-%m-%d")
    now = _now_sql()
    conn = get_db()
    c = conn.cursor()
    if c.execute("SELECT id FROM day_closures WHERE date=?", (today,)).fetchone():
        conn.close()
        return jsonify({"error": "اليوم مغلق بالفعل"}), 409
    s = _day_summary(c, today)
    difference = round(counted - s["expected_cash"], 2)
    c.execute("INSERT INTO day_closures (date, opened_at, closed_at, total_sales, order_count, tax_total, by_method, expected_cash, counted_cash, difference, closed_by) "
              "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (today, s["opened_at"], now, s["total_sales"], s["order_count"], s["tax_total"],
               json.dumps(s["by_method"], ensure_ascii=False), s["expected_cash"], counted, difference, u["name"]))
    cid = c.lastrowid
    conn.commit()
    conn.close()
    audit("day_close", f"إغلاق اليوم {today} - إجمالي {s['total_sales']:.2f} - فرق {difference:.2f}")
    return jsonify({"ok": True, "id": cid, "date": today, **s, "difference": difference, "counted_cash": counted})


@app.route("/api/day/start", methods=["POST"])
def api_day_start():
    """بداية اليوم: يفتح حساب اليوم الحالي (يحذف أي إغلاق سابق لليوم)."""
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    today = _now().strftime("%Y-%m-%d")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM day_closures WHERE date=?", (today,))
    conn.commit()
    conn.close()
    audit("day_start", f"بداية اليوم {today}")
    return jsonify({"ok": True})


@app.route("/api/day/reopen", methods=["POST"])
def api_day_reopen():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    today = _now().strftime("%Y-%m-%d")
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM day_closures WHERE date=?", (today,))
    conn.commit()
    conn.close()
    audit("day_reopen", f"إعادة فتح اليوم {today}")
    return jsonify({"ok": True})


@app.route("/api/day/closures")
def api_day_closures():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT * FROM day_closures ORDER BY date DESC LIMIT 30").fetchall()
    conn.close()
    items = []
    for cl in rows:
        try:
            by_method = json.loads(cl["by_method"])
        except Exception:
            by_method = []
        items.append({"id": cl["id"], "date": cl["date"], "closed_at": cl["closed_at"],
                      "total_sales": cl["total_sales"], "order_count": cl["order_count"],
                      "counted_cash": cl["counted_cash"], "difference": cl["difference"],
                      "closed_by": cl["closed_by"], "by_method": by_method})
    return jsonify({"closures": items})


@app.route("/api/backup/import", methods=["POST"])
def api_backup_import():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "اختر ملف نسخة احتياطية (.db)"}), 400
    tmp = os.path.join(tempfile.gettempdir(), f"upload_{_stamp()}.db")
    f.save(tmp)
    try:
        with open(tmp, "rb") as fh:
            header = fh.read(16)
    except Exception:
        os.remove(tmp)
        return jsonify({"error": "تعذر قراءة الملف"}), 400
    if header != b"SQLite format 3\x00":
        os.remove(tmp)
        return jsonify({"error": "الملف ليس قاعدة بيانات SQLite صالحة"}), 400
    try:
        con = sqlite3.connect(tmp)
        ok = con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        con.close()
        if not ok:
            os.remove(tmp)
            return jsonify({"error": "قاعدة البيانات تالفة أو غير مكتملة"}), 400
    except Exception:
        os.remove(tmp)
        return jsonify({"error": "تعذر فتح الملف"}), 400
    make_backup("auto_before_restore")
    _restore_from_file(tmp)
    os.remove(tmp)
    audit("restore_backup", "استعادة نسخة احتياطية")
    return jsonify({"ok": True, "message": "تمت الاستعادة بنجاح"})
def _sql_lit(v):
    """تحويل قيمة Python إلى SQL literal مهرّب (للاستخدام داخل executescript)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def _serialize_items(items):
    try:
        return json.dumps([{"name": str(i["name"]), "qty": int(i["qty"]),
                            "price": float(i["price"]), "emoji": str(i.get("emoji", "")),
                            "menu_id": int(i.get("menu_id") or 0),
                            "open": bool(i.get("open", False)),
                            "note": str(i.get("note", "") or "")} for i in items],
                          ensure_ascii=False)
    except Exception:
        return json.dumps([])


def _attach_reservation(c, table_id, oid):
    """يربط الطلب بحجز وصل حاجزه اليوم لنفس الطاولة."""
    if not oid or not table_id:
        return
    try:
        today = _now().strftime("%Y-%m-%d")
        rsv = c.execute("SELECT id FROM reservations WHERE table_id=? AND date=? AND status='arrived' ORDER BY id DESC LIMIT 1",
                        (table_id, today)).fetchone()
        if rsv:
            c.execute("UPDATE orders SET reservation_id=? WHERE id=? AND reservation_id IS NULL", (rsv["id"], oid))
    except Exception:
        pass


def _open_order_id(c, table_id, order_id=None, new_order=False):
    if new_order:
        return None
    if order_id:
        row = c.execute("SELECT id FROM orders WHERE id=? AND table_id=? AND status IN ('active','sent','ready')",
                        (order_id, table_id)).fetchone()
        if row:
            return row["id"]
    row = c.execute("SELECT id FROM orders WHERE table_id=? AND status IN ('active','sent','ready') ORDER BY id DESC LIMIT 1",
                    (table_id,)).fetchone()
    return row["id"] if row else None


def _table_ref(c, table_id):
    """يُرجع (num, section) للطاولة عبر id، أو (None, None) إذا لم توجد."""
    try:
        row = c.execute("SELECT num, section FROM tables WHERE id=?", (int(table_id),)).fetchone()
        if row:
            return row["num"], row["section"]
    except Exception:
        pass
    return None, None


def _parse_items(raw):
    try:
        return json.loads(raw) if raw else []
    except Exception:
        return []


def _amount(data, key, default=0):
    try:
        return round(float(data.get(key, default)), 2)
    except (TypeError, ValueError):
        return default


def _order_payload(c, oid):
    row = c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
    if row is None:
        # انقطاع اتصال مؤقت على Turso ("stream not found"): أعد الاستعلام باتصال جديد
        try:
            n = get_db()
            row = n.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
            n.close()
        except Exception:
            row = None
    if row is None:
        return None
    items = _parse_items(row["items"])
    return {
        "ok": True, "order_id": oid, "total": row["total"], "subtotal": row["subtotal"],
        "tax": row["tax"], "discount": row["discount"] or 0, "paid": row["paid"] or 0,
        "change": round((row["paid"] or 0) - row["total"], 2),
        "payment_method": row["payment_method"], "table_num": row["table_num"],
        "table_section": row["table_section"] if "table_section" in row.keys() else None,
        "guests": row["guests"] or 1, "employee": row["employee"],
        "credit_name": row["credit_name"] if "credit_name" in row.keys() else None,
        "transfer_ref": row["transfer_ref"] if "transfer_ref" in row.keys() else None,
        "transfer_name": row["transfer_name"] if "transfer_name" in row.keys() else None,
        "items": [{"name": i["name"], "qty": i["qty"], "price": float(i["price"]),
                   "subtotal": round(float(i["price"]) * int(i["qty"]), 2), "emoji": i.get("emoji", ""),
                   "open": bool(i.get("open", False))}
                  for i in items],
        "date": row["date"] or _now_sql(),
    }


@app.route("/api/tables")
def api_tables():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT table_id, COUNT(*) AS cnt FROM orders WHERE table_id IS NOT NULL AND status IN ('active','sent','ready') GROUP BY table_id").fetchall()
    active = {r["table_id"]: r["cnt"] for r in rows}
    today = _now().strftime("%Y-%m-%d")
    res = c.execute("SELECT DISTINCT table_id FROM reservations WHERE date = ? AND status NOT IN ('cancelled','arrived') AND table_id IS NOT NULL", (today,)).fetchall()
    reserved = {r["table_id"] for r in res}
    tabs = c.execute("SELECT * FROM tables ORDER BY section, num").fetchall()
    conn.close()
    return jsonify([{"id": t["id"], "num": t["num"], "section": t["section"],
                     "pos_x": t["pos_x"], "pos_y": t["pos_y"],
                     "capacity": t["capacity"], "shape": t["shape"],
                     "active": t["id"] in active, "orders": active.get(t["id"], 0),
                     "reserved": t["id"] in reserved} for t in tabs])


@app.route("/api/tables", methods=["POST"])
def api_tables_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    try:
        num = int(data.get("num"))
    except (TypeError, ValueError):
        return jsonify({"error": "رقم الطاولة غير صالح"}), 400

    if num < 1 or num > 999:
        return jsonify({"error": "رقم الطاولة بين 1 و 999"}), 400

    section = str(data.get("section") or "hall")

    pos_x = float(data.get("pos_x", 0))
    pos_y = float(data.get("pos_y", 0))
    capacity = int(data.get("capacity", 4))

    shape = str(data.get("shape") or "round")
    if shape not in ("round", "square", "rectangle"):
        shape = "round"
    conn = get_db()
    try:
        conn.execute("INSERT INTO tables (num, section, pos_x, pos_y, capacity, shape) VALUES (?,?,?,?,?,?)",
                     (num, section, pos_x, pos_y, capacity, shape))
        conn.commit()
    except DB_INTEGRITY:
        conn.close()
        return jsonify({"error": "رقم الطاولة موجود مسبقاً"}), 400
    conn.close()
    audit("tables", "إضافة طاولة رقم " + str(num))
    return jsonify({"ok": True})


@app.route("/api/tables/<int:tid>", methods=["PUT"])
def api_tables_edit(tid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    conn = get_db()
    row = conn.execute("SELECT * FROM tables WHERE id=?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "الطاولة غير موجودة"}), 404
    num = row["num"]
    section = row["section"]
    pos_x = row["pos_x"]
    pos_y = row["pos_y"]
    capacity = row["capacity"]
    shape = row["shape"]
    if "num" in data:
        try:
            num = int(data["num"])
        except (TypeError, ValueError):
            conn.close()
            return jsonify({"error": "رقم الطاولة غير صالح"}), 400
        if num < 1 or num > 999:
            conn.close()
            return jsonify({"error": "رقم الطاولة بين 1 و 999"}), 400
    if data.get("section") in ("families", "vip", "hall", "takeaway"):
        section = data["section"]
    if "pos_x" in data:
        pos_x = float(data["pos_x"])
    if "pos_y" in data:
        pos_y = float(data["pos_y"])
    if "capacity" in data:
        capacity = int(data["capacity"])
    if "shape" in data and data["shape"] in ("round", "square", "rectangle"):
        shape = data["shape"]
    if num != row["num"]:
        other = conn.execute("SELECT id FROM tables WHERE num=? AND id!=?", (num, tid)).fetchone()
        if other:
            tmp = -abs(tid) - 1000
            conn.execute("UPDATE tables SET num=? WHERE id=?", (tmp, other["id"]))
            conn.execute("UPDATE tables SET num=?, section=?, pos_x=?, pos_y=?, capacity=?, shape=? WHERE id=?",
                         (num, section, pos_x, pos_y, capacity, shape, tid))
            conn.commit()
            try:
                conn.execute("UPDATE tables SET num=? WHERE id=?", (row["num"], other["id"]))
                conn.commit()
            except DB_INTEGRITY:
                pass
            conn.close()
            audit("tables", "تعديل طاولة رقم " + str(num))
            return jsonify({"ok": True})
    try:
        conn.execute("UPDATE tables SET num=?, section=?, pos_x=?, pos_y=?, capacity=?, shape=? WHERE id=?",
                     (num, section, pos_x, pos_y, capacity, shape, tid))
        conn.commit()
    except DB_INTEGRITY:
        conn.close()
        return jsonify({"error": "رقم الطاولة موجود مسبقاً"}), 400
    conn.close()
    audit("tables", "تعديل طاولة رقم " + str(num))
    return jsonify({"ok": True})


@app.route("/api/tables/<int:tid>", methods=["DELETE"])
def api_tables_delete(tid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    row = conn.execute("SELECT * FROM tables WHERE id=?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "الطاولة غير موجودة"}), 404
    conn.execute("DELETE FROM tables WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    audit("tables", "حذف طاولة رقم " + str(row["num"]))
    return jsonify({"ok": True})
# ===== إدارة أقسام الطاولات =====

@app.route("/api/table-sections")
def api_table_sections():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401

    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, section_id, name, icon FROM table_sections ORDER BY id"
        ).fetchall()
    except Exception as e:
        conn.close()
        return jsonify({"error": str(e)}), 500
    conn.close()

    return jsonify([
        {
            "id": r["id"],
            "section_id": r["section_id"],
            "name": r["name"],
            "icon": r["icon"]
        }
        for r in rows
    ])


@app.route("/api/table-sections", methods=["POST"])
def api_table_sections_add():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code

    data = request.json or {}

    section_id = str(data.get("section_id") or "").strip()
    name = str(data.get("name") or "").strip()
    icon = str(data.get("icon") or "🪑").strip()

    if not section_id or not name:
        return jsonify({"error": "بيانات القسم ناقصة"}), 400

    conn = get_db()

    try:
        conn.execute(
            """
            INSERT INTO table_sections
            (section_id, name, icon)
            VALUES (?,?,?)
            """,
            (section_id, name, icon)
        )
        conn.commit()

    except Exception:
        conn.close()
        return jsonify({"error": "القسم موجود مسبقاً"}), 400

    conn.close()

    audit("table_sections", "إضافة قسم " + name)

    return jsonify({"ok": True})


@app.route("/api/table-sections/<int:sid>", methods=["DELETE"])
def api_table_sections_delete(sid):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code

    conn = get_db()

    row = conn.execute(
        "SELECT * FROM table_sections WHERE id=?",
        (sid,)
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "القسم غير موجود"}), 404

    conn.execute(
        "DELETE FROM table_sections WHERE id=?",
        (sid,)
    )

    conn.commit()
    conn.close()

    audit("table_sections", "حذف قسم " + row["name"])

    return jsonify({"ok": True})



@app.route("/api/tables/positions", methods=["PUT"])
def api_tables_positions():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    positions = data.get("positions", [])
    if not positions:
        return jsonify({"error": "لا توجد بيانات"}), 400
    conn = get_db()
    for pos in positions:
        tid = pos.get("id")
        x = float(pos.get("pos_x", 0))
        y = float(pos.get("pos_y", 0))
        conn.execute("UPDATE tables SET pos_x=?, pos_y=? WHERE id=?", (x, y, tid))
    conn.commit()
    conn.close()
    audit("tables", "تحديث مواقع الطاولات")
    return jsonify({"ok": True})


@app.route("/api/table_order/<int:tid>")
def api_table_order(tid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    oid = _open_order_id(c, tid)
    if not oid:
        conn.close()
        return jsonify({"order": None})
    row = c.execute("SELECT id, items, discount, guests FROM orders WHERE id=?", (oid,)).fetchone()
    conn.close()
    return jsonify({"order": {
        "id": row["id"], "items": _parse_items(row["items"]),
        "discount": row["discount"] or 0, "guests": row["guests"] or 1}})


@app.route("/api/order/save", methods=["POST"])
def api_order_save():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_id = data.get("table_id")
    items = data.get("items", [])
    order_id = data.get("order_id")
    if not table_id or not items:
        return jsonify({"error": "اختر طاولة وأضف أصنافاً"}), 400
    discount = _amount(data, "discount")
    guests = int(data.get("guests", 1) or 1)
    items_str = _serialize_items(items)
    now = _now_sql()
    conn = get_db()
    c = conn.cursor()
    num, section = _table_ref(c, table_id)
    oid = _open_order_id(c, table_id, order_id, bool(data.get("new_order")))
    if oid:
        c.execute("UPDATE orders SET items=?, discount=?, guests=?, status='sent', sent_at=?, employee=?, date=?, kitchen_status='sent', table_num=?, table_section=? WHERE id=?",
                  (items_str, discount, guests, now, u["name"], now, oid, num, section))
    else:
        c.execute("INSERT INTO orders (table_num, table_section, table_id, items, subtotal, tax, discount, total, payment_method, employee, status, guests, sent_at, date, kitchen_status) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (num, section, table_id, items_str, 0, 0, discount, 0, "", u["name"], "sent", guests, now,
                   now, "sent"))
        oid = c.lastrowid
    _attach_reservation(c, table_id, oid)
    conn.commit()
    conn.close()
    audit("save_order", f"حفظ طلب #{oid} - طاولة {num} - أصناف {len(items)}")
    return jsonify({"ok": True, "order_id": oid})


@app.route("/api/order/send", methods=["POST"])
def api_order_send():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_id = data.get("table_id")
    items = data.get("items", [])
    order_id = data.get("order_id")
    if not table_id or not items:
        return jsonify({"error": "اختر طاولة وأضف أصنافاً"}), 400
    discount = _amount(data, "discount")
    guests = int(data.get("guests", 1) or 1)
    items_str = _serialize_items(items)
    now = _now_sql()
    conn = get_db()
    c = conn.cursor()
    num, section = _table_ref(c, table_id)
    oid = _open_order_id(c, table_id, order_id, bool(data.get("new_order")))
    if oid:
        c.execute("UPDATE orders SET items=?, discount=?, guests=?, status='sent', sent_at=?, date=?, employee=?, kitchen_status='sent', table_num=?, table_section=? WHERE id=?",
                  (items_str, discount, guests, now, now, u["name"], oid, num, section))
    else:
        c.execute("INSERT INTO orders (table_num, table_section, table_id, items, subtotal, tax, discount, total, payment_method, employee, status, guests, date, sent_at, kitchen_status) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (num, section, table_id, items_str, 0, 0, discount, 0, "", u["name"], "sent", guests, now, now, "sent"))
        oid = c.lastrowid
    _attach_reservation(c, table_id, oid)
    conn.commit()
    conn.close()
    audit("send_to_kitchen", f"إرسال طلب #{oid} للمطبخ - طاولة {num} - أصناف {len(items)}")
    return jsonify({"ok": True, "order_id": oid})


# ===== شاشة المطبخ =====
@app.route("/kitchen")
def kitchen_page():
    return render_template("kitchen.html")


@app.route("/api/kitchen/orders")
def api_kitchen_orders():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    rows = c.execute(
        "SELECT id, table_num, table_section, items, status, guests, employee, sent_at, date, paid, payment_method, kitchen_status "
        "FROM orders WHERE kitchen_status='sent' OR (kitchen_status='ready' AND status IN ('sent','ready')) "
        "ORDER BY COALESCE(sent_at, date) ASC, id ASC").fetchall()
    conn.close()
    orders = []
    for r in rows:
        sent = r["sent_at"] or r["date"] or ""
        sent_ts = None
        try:
            sent_ts = datetime.strptime(sent, "%Y-%m-%d %H:%M:%S").timestamp()
        except Exception:
            pass
        orders.append({
            "id": r["id"], "table_num": r["table_num"],
            "table_section": r["table_section"] if "table_section" in r.keys() else None,
            "status": r["status"],
            "kitchen_status": r["kitchen_status"] if "kitchen_status" in r.keys() else "sent",
            "guests": r["guests"] or 1, "employee": r["employee"],
            "sent_at": sent, "sent_ts": sent_ts, "items": _parse_items(r["items"]),
            "paid": r["paid"] or 0, "payment_method": r["payment_method"] or "",
        })
    return jsonify({"orders": orders})


@app.route("/api/kitchen/order/<int:oid>/ready", methods=["POST"])
def api_kitchen_ready(oid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE orders SET kitchen_status='ready', "
              "status=CASE WHEN status='sent' THEN 'ready' ELSE status END "
              "WHERE id=? AND kitchen_status='sent'", (oid,))
    conn.commit()
    conn.close()
    audit("kitchen_ready", f"طلب #{oid} جاهز")
    return jsonify({"ok": True})


@app.route("/api/kitchen/clear", methods=["POST"])
def api_kitchen_clear():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE orders SET kitchen_status='ready', status=CASE WHEN status IN ('sent','ready') THEN 'closed' ELSE status END "
              "WHERE kitchen_status='sent' OR (kitchen_status='ready' AND status IN ('sent','ready'))")
    cleared = c.rowcount
    conn.commit()
    conn.close()
    audit("kitchen_clear", f"تنظيف شاشة المطبخ - {cleared} طلب")
    return jsonify({"ok": True, "cleared": cleared})


def _deduct_inventory(c, items):
    """خصم كميات المخزون تلقائياً عند بيع أصناف مرتبطة بمخزون."""
    try:
        for it in items:
            mid = int(it.get("menu_id") or 0)
            qty_sold = int(it.get("qty") or 0)
            if not mid or qty_sold <= 0:
                continue
            links = c.execute("SELECT inventory_id, qty_per FROM menu_inventory WHERE menu_id=?", (mid,)).fetchall()
            for link in links:
                consume = link["qty_per"] * qty_sold
                c.execute("UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE id=?", (consume, link["inventory_id"]))
    except Exception as e:
        print("DEDUCT INVENTORY ERR:", repr(e))


def _restore_inventory(c, items):
    """إرجاع المخزون المُخصوم عند إلغاء طلب مدفوع."""
    try:
        for it in items:
            mid = int(it.get("menu_id") or 0)
            qty_sold = int(it.get("qty") or 0)
            if not mid or qty_sold <= 0:
                continue
            links = c.execute("SELECT inventory_id, qty_per FROM menu_inventory WHERE menu_id=?", (mid,)).fetchall()
            for link in links:
                restore = link["qty_per"] * qty_sold
                c.execute("UPDATE inventory SET quantity = quantity + ? WHERE id=?", (restore, link["inventory_id"]))
    except Exception as e:
        print("RESTORE INVENTORY ERR:", repr(e))


def _is_stream_error(e):
    """خطأ اتصال عابر من Turso يستحق إعادة محاولة على اتصال جديد."""
    msg = str(e)
    return "stream not found" in msg or "connections limit" in msg or "limit exceeded" in msg \
        or "1008" in msg or "try to reduce concurrency" in msg


@app.route("/api/order/pay", methods=["POST"])
def api_order_pay():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    for _attempt in range(3):
        try:
            return _do_pay(u, data)
        except Exception as e:
            if _is_stream_error(e) and _attempt < 2:
                import time as _t
                _t.sleep(0.8 * (_attempt + 1))
                continue
            return jsonify({"error": f"خطأ في حفظ الطلب: {e}"}), 500


def _do_pay(u, data):
    table_id = data.get("table_id")
    items = data.get("items", [])
    order_id = data.get("order_id")
    if not table_id or not items:
        return jsonify({"error": "اختر طاولة وأضف أصنافاً"}), 400
    paid = _amount(data, "paid")
    discount = _amount(data, "discount")
    payment_method = str(data.get("payment_method", "نقدي"))
    guests = int(data.get("guests", 1) or 1)
    credit_name = str(data.get("credit_name") or "").strip() or None
    transfer_ref = str(data.get("transfer_ref") or "").strip()
    if transfer_ref in ("", "0", "None", "null"):
        transfer_ref = None
    transfer_name = str(data.get("transfer_name") or "").strip() or None
    if payment_method in ("BCA", "مانديري", "كيروس") and not transfer_ref:
        return jsonify({"error": "التحويل البنكي يتطلب رقم مرجع التحويل"}), 400
    subtotal = round(sum(float(i["price"]) * int(i["qty"]) for i in items), 2)
    tax = round(subtotal * get_tax_rate(), 2)
    max_discount = round(subtotal + tax, 2)
    if discount > max_discount:
        discount = max_discount
    emp_limit_pct = 100.0
    manual_discount = discount
    try:
        manual_discount = round(float(data.get("manual_discount") or 0), 2)
    except (TypeError, ValueError):
        pass
    if u.get("role") != "manager" and manual_discount > 0:
        emp_limit_pct = float(u.get("discount_limit") or 20)
        if "discount_limit" not in u:
            try:
                tmp = get_db()
                rmax = tmp.execute("SELECT discount_limit FROM employees WHERE id=? AND active=1", (u["id"],)).fetchone()
                tmp.close()
                if rmax and rmax["discount_limit"] is not None:
                    emp_limit_pct = float(rmax["discount_limit"] or 20)
            except Exception:
                pass
        emp_limit_amt = round(max_discount * emp_limit_pct / 100.0, 2)
        if manual_discount > emp_limit_amt:
            return jsonify({"error": f"تجاوزت حد الخصم المسموح لك ({emp_limit_pct:.0f}% = {emp_limit_amt:.2f}). المدير فقط يمكنه خصم أكثر"}), 400
    total = round(subtotal + tax - discount, 2)
    if total < 0:
        total = 0
    if paid < total and payment_method != "آجل":
        return jsonify({"error": f"المبلغ المدفوع أقل من الإجمالي ({total:.2f})"}), 400
    items_str = _serialize_items(items)
    now_str = _now_sql()
    due_str = (_now() + timedelta(days=30)).strftime("%Y-%m-%d")
    emp_name = _sql_lit(u["name"])
    emp_id = _sql_lit(u["id"])

    # ── Batch save: كل الكتابات في executescript واحد (رحلة HTTP واحدة) ──
    # الخطوات: pre-query → INSERT/UPDATE orders → executescript لكل الباقي → payload
    # المجموع: ~4-5 رحلات بدلاً من ~15
    conn = get_db()
    c = conn.cursor()
    _ensure_schema(conn, c)
    is_new = bool(data.get("new_order"))
    num, section = _table_ref(c, table_id)
    oid = _open_order_id(c, table_id, order_id, is_new)

    # 1) INSERT/UPDATE orders → oid
    if oid:
        c.execute("UPDATE orders SET items=?, subtotal=?, tax=?, discount=?, total=?, paid=?, payment_method=?, "
                  "status='completed', guests=?, employee=?, date=?, credit_name=?, transfer_ref=?, transfer_name=?, table_num=?, table_section=? WHERE id=?",
                  (items_str, subtotal, tax, discount, total, paid, payment_method, guests, u["name"],
                   now_str, credit_name, transfer_ref, transfer_name, num, section, oid))
    else:
        c.execute("INSERT INTO orders (table_num, table_section, table_id, items, subtotal, tax, discount, total, paid, payment_method, employee, status, guests, date, credit_name, transfer_ref, transfer_name) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (num, section, table_id, items_str, subtotal, tax, discount, total, paid, payment_method, u["name"],
                   "completed", guests, now_str, credit_name, transfer_ref, transfer_name))
        oid = c.lastrowid

    # 2) قراءة روابط المخزون مرة واحدة (رحلة HTTP واحدة بدلاً من loops)
    menu_ids = []
    for it in items:
        mid = int(it.get("menu_id") or 0)
        if mid and mid not in menu_ids:
            menu_ids.append(mid)
    inv_links = []
    if menu_ids:
        placeholders = ",".join("?" * len(menu_ids))
        try:
            inv_links = c.execute(
                f"SELECT menu_id, inventory_id, qty_per FROM menu_inventory WHERE menu_id IN ({placeholders})",
                menu_ids
            ).fetchall()
        except Exception:
            inv_links = []

    # 3) بناء السكربت المجمّع (كل الكتابات المتبقية في رحلة HTTP واحدة)
    S = []
    # 3a) إغلاق طلبات قديمة في نفس الطاولة (وضع التقسيم)
    if is_new:
        S.append(f"UPDATE orders SET status='closed', kitchen_status='ready' WHERE table_id={_sql_lit(int(table_id))} AND status IN ('active','sent','ready') AND id != {oid};")
    # 3b) سجل الخصومات
    if discount > 0:
        S.append(
            f"INSERT INTO discount_log (employee, employee_id, order_id, table_num, table_section, subtotal, tax, discount, limit_pct, date) "
            f"VALUES ({emp_name},{emp_id},{oid},{_sql_lit(num)},{_sql_lit(section)},{subtotal},{tax},{discount},{emp_limit_pct},{_sql_lit(now_str)});"
        )
    # 3c) نظام الآجل: credit_ledger + credit_payments
    if payment_method == "آجل":
        cname = _sql_lit((credit_name or "").strip() or "عميل آجل")
        # ربط/إنشاء عميل تلقائياً في قاعدة بيانات العملاء
        cid_lit = "NULL"
        try:
            cname_raw = (credit_name or "").strip() or "عميل آجل"
            cph = str(data.get("credit_phone") or "").strip() or None
            cust = None
            if cph:
                cust = c.execute("SELECT id FROM customers WHERE phone=?", (cph,)).fetchone()
            if not cust:
                cust = c.execute("SELECT id FROM customers WHERE lower(name)=lower(?) LIMIT 1", (cname_raw,)).fetchone()
            if not cust:
                c.execute("INSERT INTO customers (name, phone) VALUES (?,?)", (cname_raw, cph))
                cust = {"id": c.lastrowid}
            cid_lit = str(int(cust["id"]))
        except Exception:
            cid_lit = "NULL"
        ledger_paid = min(paid, total)
        overpaid = paid > total
        S.append(
            f"INSERT INTO credit_ledger (customer_name, order_id, table_id, table_num, table_section, total, paid, status, created_at, due_date, customer_id) "
            f"VALUES ({cname},{oid},{_sql_lit(int(table_id))},{_sql_lit(num)},{_sql_lit(section)},{total},{ledger_paid},'open',{_sql_lit(now_str)},{_sql_lit(due_str)},{cid_lit});"
        )
        if ledger_paid > 0:
            S.append(
                f"INSERT INTO credit_payments (ledger_id, amount, method, employee, date) "
                f"VALUES (last_insert_rowid(),{ledger_paid},'آجل',{emp_name},{_sql_lit(now_str)});"
            )
        credit_cname = (credit_name or "").strip() or "عميل آجل"
        audit_details = f"فتح رصيد آجل للعميل {credit_cname} - متبقي {round(total - ledger_paid, 2):.2f}"
        S.append(
            f"INSERT INTO audit_log (employee, action, details) VALUES ({emp_name},'credit_open',{_sql_lit(audit_details)});"
        )
        if overpaid:
            overpay_details = f"دفع زائد على رصيد آجل: المدفوع {paid:.2f} أكبر من الإجمالي {total:.2f} - الفرق {round(paid - total, 2):.2f} رُدّ كباقي"
            S.append(
                f"INSERT INTO audit_log (employee, action, details) VALUES ({emp_name},'credit_overpaid',{_sql_lit(overpay_details)});"
            )
    # 3d) خصم المخزون تلقائياً عند البيع
    for it in items:
        mid = int(it.get("menu_id") or 0)
        qty_sold = int(it.get("qty") or 0)
        if not mid or qty_sold <= 0:
            continue
        for link in inv_links:
            if link["menu_id"] == mid:
                consume = link["qty_per"] * qty_sold
                S.append(
                    f"UPDATE inventory SET quantity = MAX(0, quantity - {_sql_lit(consume)}) WHERE id={_sql_lit(link['inventory_id'])};"
                )
    # 3e) سجل العملية في audit_log
    place_details = f"دفع طلب #{oid} - طاولة {num} - {payment_method} - إجمالي {total:.2f}"
    S.append(
        f"INSERT INTO audit_log (employee, action, details) VALUES ({emp_name},'place_order',{_sql_lit(place_details)});"
    )

    # تنفيذ السكربت المجمّع (رحلة HTTP واحدة عبر pipeline)
    if S:
        script = "\n".join(S)
        c.executescript(script)

    # 4) جلب بيانات الفاتورة النهائية (رحلة واحدة)
    payload = _order_payload(c, oid)
    conn.close()
    if not payload:
        print(f"ORDER SAVE LOST: oid={oid} table={num}")
        raise RuntimeError("connection lost during save: stream not found")
    return jsonify(payload)


@app.route("/api/reports")
def api_reports():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed'")
    row = c.fetchone()
    today = _now().strftime("%Y-%m-%d")
    c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed' AND date(date) = ?", (today,))
    row_today = c.fetchone()
    conn.close()
    today_count = row_today["cnt"]
    today_total = row_today["tot"]
    return jsonify({
        "count": row["cnt"], "total": row["tot"],
        "today_count": today_count, "today_total": today_total,
    })


@app.route("/api/reports/cashier-daily")
def api_reports_cashier_daily():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    today = _now().strftime("%Y-%m-%d")
    conn = get_db()
    c = conn.cursor()
    my = c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed' AND employee=? AND date(date)=?",
                   (u["name"], today)).fetchone()
    all_today = c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed' AND date(date)=?",
                          (today,)).fetchone()
    my_orders = c.execute("SELECT id, table_num, table_section, total, payment_method, date FROM orders WHERE status='completed' AND employee=? AND date(date)=? ORDER BY date",
                          (u["name"], today)).fetchall()
    conn.close()
    return jsonify({
        "my_count": my["cnt"], "my_total": my["tot"],
        "all_count": all_today["cnt"], "all_total": all_today["tot"],
        "my_orders": [dict(o) for o in my_orders],
    })


@app.route("/api/reports/discounts")
def api_reports_discounts():
    """سجل الخصومات: كل خصم مع الموظف الذي أضافه (للمدير)"""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    employee = (request.args.get("employee") or "").strip()
    conn = get_db()
    c = conn.cursor()
    _ensure_schema(conn, c)
    where = "1=1"
    params = []
    if from_d:
        where += " AND date(d.date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(d.date) <= ?"
        params.append(to_d)
    if employee:
        where += " AND d.employee = ?"
        params.append(employee)
    rows = conn.execute(
        f"SELECT d.* FROM discount_log d WHERE {where} ORDER BY d.id DESC LIMIT 500", params).fetchall()
    conn.close()
    total = round(sum((r["discount"] or 0) for r in rows), 2)
    count = len(rows)
    return jsonify({"discounts": [dict(r) for r in rows], "total": total, "count": count})


def _report_filtered(c, from_d, to_d, args):
    """يعيد طلبات status='completed' ضمن الفترة مع تطبيق فلاتر التفاصيل."""
    where = "status='completed'"
    params = []
    if from_d:
        where += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(date) <= ?"
        params.append(to_d)
    rows = c.execute(f"SELECT * FROM orders WHERE {where} ORDER BY date", params).fetchall()

    method = (args.get("method") or "").strip()
    employee = (args.get("employee") or "").strip()
    item = (args.get("item") or "").strip()
    table = (args.get("table") or "").strip()
    customer = (args.get("customer") or "").strip()
    day = (args.get("day") or "").strip()
    month = (args.get("month") or "").strip()
    hour = (args.get("hour") or "").strip()
    filtered = []
    for r in rows:
        if method and (r["payment_method"] or "") != method:
            continue
        if employee and (r["employee"] or "") != employee:
            continue
        if table and str(r["table_num"] or "") != table:
            continue
        if customer and customer.lower() not in (r["credit_name"] or "").lower():
            continue
        date_str = r["date"] or ""
        if day and date_str[:10] != day:
            continue
        if month and date_str[:7] != month:
            continue
        if hour:
            try:
                h = int(date_str[11:13])
            except Exception:
                h = None
            if h != int(hour):
                continue
        if item:
            names = [str(i.get("name", "")).strip() for i in _parse_items(r["items"])]
            if not any(item.lower() in n.lower() for n in names):
                continue
        filtered.append(r)

    section = (args.get("section") or "").strip()
    if section:
        nums_all = set(str(x[0]) for x in c.execute("SELECT num FROM tables WHERE section=?", (section,)))
        # الأوامر الجديدة تخزن القسم مباشرة؛ القديمة نطابقها عبر أرقام طاولات القسم
        def _in_section(r):
            s = r["table_section"] if "table_section" in r.keys() else None
            if s:
                return s == section
            return str(r["table_num"] or "") in nums_all
        filtered = [r for r in filtered if _in_section(r)]
    return filtered


@app.route("/api/reports/orders")
def api_reports_orders():
    """تفاصيل الفواتير الفعلية خلف أي تجميع (مع فلاتر التفاصيل)."""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    from_d = request.args.get("from", "")
    to_d = request.args.get("to", "")
    rows = _report_filtered(c, from_d, to_d, request.args)
    orders = []
    for r in rows:
        orders.append({
            "id": r["id"],
            "date": r["date"] or "",
            "table_num": r["table_num"],
            "table_section": r["table_section"] if "table_section" in r.keys() else None,
            "employee": r["employee"] or "",
            "payment_method": r["payment_method"] or "",
            "credit_name": r["credit_name"] if "credit_name" in r.keys() else None,
            "subtotal": round(r["subtotal"] or 0, 2),
            "discount": round(r["discount"] or 0, 2),
            "tax": round(r["tax"] or 0, 2),
            "total": round(r["total"] or 0, 2),
            "paid": round(r["paid"] or 0, 2),
            "guests": r["guests"] or 1,
            "items": _parse_items(r["items"]),
        })
    conn.close()
    return jsonify({"count": len(orders), "orders": orders})


@app.route("/api/orders/<int:oid>")
def api_order_get(oid):
    """بيانات فاتورة واحدة كاملة (لإعادة الطباعة)."""
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    payload = _order_payload(c, oid)
    conn.close()
    if not payload:
        return jsonify({"error": "الفاتورة غير موجودة"}), 404
    return jsonify(payload)


@app.route("/api/reports/advanced")
def api_reports_advanced():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    from_d = request.args.get("from", "")
    to_d = request.args.get("to", "")
    rows = _report_filtered(c, from_d, to_d, request.args)

    total = round(sum(r["total"] or 0 for r in rows), 2)
    count = len(rows)
    tax_total = round(sum(r["tax"] or 0 for r in rows), 2)
    avg = round(total / count, 2) if count else 0

    by_method = {}
    by_employee = {}
    top_items = {}
    daily = {}
    by_hour = {}
    cash_received = 0.0
    total_discount = 0.0
    # خريطة تكلفة الأصناف الفعلية: menu_id -> (cost, qty_per)
    cost_map = {}
    for (mid, inv_id, qp) in c.execute("SELECT mi.menu_id, mi.qty_per, inv.cost FROM menu_inventory mi JOIN inventory inv ON inv.id=mi.inventory_id"):
        existing = cost_map.setdefault(mid, 0.0)
        cost_map[mid] = existing + float(qp or 0) * float(inv.cost or 0)
    cogs = 0.0
    for r in rows:
        method = _report_method(r["payment_method"] or "نقدي")
        m = by_method.setdefault(method, {"total": 0.0, "count": 0})
        m["total"] = round(m["total"] + (r["total"] or 0), 2)
        m["count"] += 1
        emp = r["employee"] or "؟"
        e = by_employee.setdefault(emp, {"total": 0.0, "count": 0})
        e["total"] = round(e["total"] + (r["total"] or 0), 2)
        e["count"] += 1
        cash_received += (r["paid"] or 0)
        total_discount += (r["discount"] or 0)
        for i in _parse_items(r["items"]):
            name = i.get("name", "؟")
            qty = int(i.get("qty", 1))
            mid2 = int(i.get("menu_id") or 0)
            t = top_items.setdefault(name, {"qty": 0, "revenue": 0.0})
            t["qty"] += qty
            t["revenue"] = round(t["revenue"] + float(i.get("price", 0)) * qty, 2)
            if mid2 in cost_map:
                cogs += cost_map[mid2] * qty
        day = (r["date"] or "")[:10]
        d = daily.setdefault(day, {"total": 0.0, "count": 0})
        d["total"] = round(d["total"] + (r["total"] or 0), 2)
        d["count"] += 1
        hr = 0
        try:
            hr = int((r["date"] or "")[11:13]) if len(r["date"] or "") >= 13 else 0
        except Exception:
            pass
        h = by_hour.setdefault(hr, {"count": 0, "total": 0.0})
        h["count"] += 1
        h["total"] = round(h["total"] + (r["total"] or 0), 2)

    by_method = [{"method": k, "total": v["total"], "count": v["count"]} for k, v in sorted(by_method.items())]
    by_employee = [{"employee": k, "total": v["total"], "count": v["count"]} for k, v in sorted(by_employee.items(), key=lambda x: -x[1]["total"])]
    top_items = [{"name": k, "qty": v["qty"], "revenue": v["revenue"]} for k, v in sorted(top_items.items(), key=lambda x: -x[1]["qty"])]
    daily = [{"date": k, "total": v["total"], "count": v["count"]} for k, v in sorted(daily.items())]
    by_hour = [{"hour": k, "count": v["count"], "total": v["total"]} for k, v in sorted(by_hour.items())]

    # المصروفات خلال نفس الفترة (بحساب صافي الربح)
    exp_sql = "SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE 1=1"
    exp_params = []
    if from_d:
        exp_sql += " AND date(date) >= ?"
        exp_params.append(from_d)
    if to_d:
        exp_sql += " AND date(date) <= ?"
        exp_params.append(to_d)
    expenses_total = round(c.execute(exp_sql, exp_params).fetchone()["t"], 2)

    # تحصيل الآجل خلال الفترة (تدفقات دافعة)
    cr_sql = "SELECT COALESCE(SUM(amount),0) AS t FROM credit_payments WHERE COALESCE(method, '') != 'آجل'"
    cr_params = []
    if from_d:
        cr_sql += " AND date(date) >= ?"
        cr_params.append(from_d)
    if to_d:
        cr_sql += " AND date(date) <= ?"
        cr_params.append(to_d)
    credit_collected = round(c.execute(cr_sql, cr_params).fetchone()["t"], 2)

    # ذمم مدينة حالية (مفتوح آجل)
    ar_total = round(c.execute("SELECT COALESCE(SUM(total-paid),0) FROM credit_ledger WHERE status='open'").fetchone()[0], 2)

    cogs = round(cogs, 2)
    cash_received = round(cash_received, 2)
    total_discount = round(total_discount, 2)
    # بيان التدفقات النقدية (تشغيلي):
    cash_in = round(cash_received + credit_collected, 2)
    cash_out = expenses_total
    net_cash_flow = round(cash_in - cash_out, 2)
    # صافي الربح الفعلي
    gross_profit = round(total - tax_total - cogs, 2)
    net_profit = round(gross_profit - expenses_total, 2)

    conn.close()

    return jsonify({
        "from": from_d or "البداية", "to": to_d or "الآن",
        "total_sales": total, "order_count": count, "avg_order": avg, "total_tax": tax_total,
        "by_method": by_method, "by_employee": by_employee, "top_items": top_items, "daily": daily,
        "by_hour": by_hour, "expenses_total": expenses_total,
        "cogs_actual": cogs, "total_discount": total_discount,
        "cash_received": cash_received, "credit_collected": credit_collected,
        "receivable_total": ar_total,
        "cash_in": cash_in, "cash_out": cash_out, "net_cash_flow": net_cash_flow,
        "gross_profit": gross_profit, "net_profit": net_profit,
    })


@app.route("/api/reports/ar")
def api_reports_ar():
    """تقرير آجل/ذمم مدينة بمستوى محاسب ومراجع حسابات: كشوف عملاء،
    تحليل أعمار الذمم، سجل الدفعات، وتسوية الفوارق (الفاتورة = المدفوع + المتبقي)."""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    c = conn.cursor()
    today = _now().strftime("%Y-%m-%d")

    # backfill فوري: أي طلب آجل لم يُسجل بعد في credit_ledger يُضاف الآن (كله رصيد مفتوح)
    try:
        c.execute("""
    UPDATE credit_ledger
    SET status = CASE
        WHEN COALESCE(paid, 0) >= COALESCE(total, 0) THEN 'settled'
        ELSE 'open'
    END
    WHERE order_id IN (
        SELECT id FROM orders WHERE payment_method='آجل'
    )
""")
        c.execute("SELECT id, table_num, total, paid, credit_name, date FROM orders "
                  "WHERE payment_method='آجل' AND id NOT IN (SELECT order_id FROM credit_ledger WHERE order_id IS NOT NULL)")
        _backfilled = 0
        for ro in c.fetchall():
            cname = (ro["credit_name"] or "").strip() or "عميل آجل"
            closed_paid = min(ro["paid"] or 0, ro["total"] or 0)  # لا دين سالب أبداً
            due = (_now() + timedelta(days=30)).strftime("%Y-%m-%d")
            c.execute("INSERT INTO credit_ledger (customer_name, order_id, table_num, total, paid, status, created_at, due_date) "
                      "VALUES (?,?,?,?,?,?,?,?)",
                      (cname, ro["id"], ro["table_num"], ro["total"], closed_paid, "open",
                       ro["date"] or _now_sql(), due))
            lid = c.lastrowid
            if closed_paid > 0:
                c.execute("INSERT INTO credit_payments (ledger_id, amount, method, employee, date) "
                          "VALUES (?,?,?,?,?)", (lid, closed_paid, "آجل", "مدير",
                                                 ro["date"] or _now_sql()))
            _backfilled += 1
        if _backfilled:
            conn.commit()
    except Exception as e:
        print("AR BACKFILL ERR:", repr(e))

    rows = c.execute("SELECT * FROM credit_ledger ORDER BY id DESC").fetchall()
    paymap = {}
    for p in c.execute("SELECT * FROM credit_payments WHERE COALESCE(method, '') != 'آجل' ORDER BY date ASC, id ASC").fetchall():
        paymap.setdefault(p["ledger_id"], []).append(dict(p))

    pmt_where = "COALESCE(p.method, '') != 'آجل'"
    pmt_params = []
    if from_d:
        pmt_where += " AND date(p.date) >= ?"
        pmt_params.append(from_d)
    if to_d:
        pmt_where += " AND date(p.date) <= ?"
        pmt_params.append(to_d)
    payments = c.execute(
        f"SELECT p.id, p.ledger_id, p.amount, p.method, p.employee, p.date, l.customer_name "
        f"FROM credit_payments p LEFT JOIN credit_ledger l ON l.id=p.ledger_id "
        f"WHERE {pmt_where} ORDER BY p.date ASC, p.id ASC", pmt_params).fetchall()

    summary = {"open_count": 0, "settled_count": 0, "total_invoiced": 0.0, "total_paid": 0.0,
               "total_open_due": 0.0, "overpaid_count": 0, "overpaid_amount": 0.0}
    aging = {"current": [0, 0.0], "31_60": [0, 0.0], "61_90": [0, 0.0], "90_plus": [0, 0.0]}
    customers = []
    for r in rows:
        rec = dict(r)
        total = rec["total"] or 0
        paid = rec["paid"] or 0
        raw_due = round(total - paid, 2)
        due = round(max(raw_due, 0), 2)  # لا يُظهر ديناً سالباً أبداً (حماية الدفع الزائد)
        is_open = rec["status"] == "open"
        summary["total_invoiced"] += total
        summary["total_paid"] += paid
        if is_open:
            summary["open_count"] += 1
            summary["total_open_due"] += due
        else:
            summary["settled_count"] += 1
        if paid > total + 0.001:
            summary["overpaid_count"] += 1
            summary["overpaid_amount"] += paid - total
        days = 0
        if rec["created_at"]:
            try:
                days = (datetime.strptime(today, "%Y-%m-%d")
                        - datetime.strptime((rec["created_at"] or "")[:10], "%Y-%m-%d")).days
            except Exception:
                days = 0
        if is_open:
            if days <= 30:
                aging["current"][0] += 1; aging["current"][1] += due
            elif days <= 60:
                aging["31_60"][0] += 1; aging["31_60"][1] += due
            elif days <= 90:
                aging["61_90"][0] += 1; aging["61_90"][1] += due
            else:
                aging["90_plus"][0] += 1; aging["90_plus"][1] += due
        rec["due"] = due
        rec["days_open"] = max(days, 0)
        rec["due_date"] = rec.get("due_date") or ""
        overdue_days = 0
        if rec.get("due_date") and is_open:
            try:
                overdue_days = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(rec["due_date"], "%Y-%m-%d")).days
            except Exception:
                overdue_days = 0
        rec["overdue_days"] = max(overdue_days, 0)
        rec["payments"] = paymap.get(rec["id"], [])
        customers.append(rec)

    period_collected = round(sum(p["amount"] for p in payments), 2)
    if from_d and to_d:
        period_new = round(c.execute(
            "SELECT COALESCE(SUM(total),0) FROM credit_ledger WHERE date(created_at)>=? AND date(created_at)<=?",
            (from_d, to_d)).fetchone()[0], 2)
    else:
        period_new = round(summary["total_invoiced"], 2)

    conn.close()
    return jsonify({
        "as_of": today, "from": from_d, "to": to_d,
        "summary": {"open_count": summary["open_count"], "settled_count": summary["settled_count"],
                    "total_invoiced": round(summary["total_invoiced"], 2),
                    "total_paid": round(summary["total_paid"], 2),
                    "total_open_due": round(summary["total_open_due"], 2),
                    "overpaid_count": summary["overpaid_count"],
                    "overpaid_amount": round(summary["overpaid_amount"], 2)},
        "aging": [
            {"bucket": "current", "count": aging["current"][0], "total": round(aging["current"][1], 2)},
            {"bucket": "31_60", "count": aging["31_60"][0], "total": round(aging["31_60"][1], 2)},
            {"bucket": "61_90", "count": aging["61_90"][0], "total": round(aging["61_90"][1], 2)},
            {"bucket": "90_plus", "count": aging["90_plus"][0], "total": round(aging["90_plus"][1], 2)},
        ],
        "customers": customers,
        "payments": [dict(p) for p in payments],
        "period_collected": period_collected,
        "period_new": period_new,
    })


# ===== إدارة المتاخرات =====
@app.route("/api/credit/overdue")
def api_credit_overdue():
    """قائمة الحسابات المتأخرة (due_date pasado و status='open')"""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    today = _now().strftime("%Y-%m-%d")
    rows = conn.execute(
        "SELECT *, (total - paid) as due FROM credit_ledger "
        "WHERE status='open' AND due_date IS NOT NULL AND due_date != '' AND due_date < ? "
        "ORDER BY due_date ASC", (today,)).fetchall()
    result = []
    for r in rows:
        rec = dict(r)
        rec["due"] = round(max(rec.get("due") or 0, 0), 2)  # لا دين سالب أبداً
        try:
            rec["overdue_days"] = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(rec["due_date"], "%Y-%m-%d")).days
        except Exception:
            rec["overdue_days"] = 0
        last_reminder = conn.execute(
            "SELECT date FROM credit_reminders WHERE ledger_id=? ORDER BY id DESC LIMIT 1",
            (rec["id"],)).fetchone()
        rec["last_reminder"] = dict(last_reminder)["date"] if last_reminder else ""
        result.append(rec)
    conn.close()
    return jsonify({"overdue": result, "count": len(result),
                    "total_overdue": round(sum(r["due"] for r in result), 2)})


@app.route("/api/credit/overdue/auto-update", methods=["POST"])
def api_credit_auto_update_overdue():
    """ تحديث تلقائي: تغيير حالة الحسابات التي تجاوزت due_date إلى 'overdue' """
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    today = _now().strftime("%Y-%m-%d")
    rows = c.execute(
        "SELECT id, due_date FROM credit_ledger "
        "WHERE status='open' AND due_date IS NOT NULL AND due_date != '' AND due_date < ?",
        (today,)).fetchall()
    updated = []
    for r in rows:
        c.execute("UPDATE credit_ledger SET updated_at=datetime('now','localtime') WHERE id=?", (r["id"],))
        updated.append(r["id"])
    conn.commit()
    conn.close()
    audit("credit_auto_update", f"تم تحديث {len(updated)} حساب متأخر تلقائياً")
    return jsonify({"ok": True, "updated": len(updated), "ids": updated})


@app.route("/api/credit/overdue/export")
def api_credit_overdue_export():
    """تصدير قائمة المتأخرين كـ CSV"""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    today = _now().strftime("%Y-%m-%d")
    rows = conn.execute(
        "SELECT *, (total - paid) as due FROM credit_ledger "
        "WHERE status='open' AND due_date IS NOT NULL AND due_date != '' AND due_date < ? "
        "ORDER BY due_date ASC", (today,)).fetchall()
    lines = ["العميل,رقم الفاتورة,الطاولة,الإجمالي,المدفوع,المتبقي,تاريخ الاستحقاق,أيام التأخر"]
    for r in rows:
        try:
            odays = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(r["due_date"], "%Y-%m-%d")).days
        except Exception:
            odays = 0
        due = round(max(float(r["total"] or 0) - float(r["paid"] or 0), 0), 2)
        lines.append(f"{r['customer_name']},{r['order_id'] or ''},{r['table_num'] or ''},{r['total']},{r['paid']},{due},{r['due_date']},{odays}")
    conn.close()
    from io import BytesIO
    buf = BytesIO(("\ufeff" + "\n".join(lines)).encode("utf-8-sig"))
    from flask import send_file
    return send_file(buf, mimetype="text/csv; charset=utf-8",
                     as_attachment=True, download_name=f"overdue_{today}.csv")


@app.route("/api/credit/reminder", methods=["POST"])
def api_credit_reminder():
    """إرسال تذكير لعميل متأخر + تسجيل في credit_reminders"""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    lid = data.get("ledger_id")
    method = data.get("method", "whatsapp")
    message = data.get("message", "")
    if not lid:
        return jsonify({"error": "معرف الرصيد مطلوب"}), 400
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT * FROM credit_ledger WHERE id=?", (lid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "الرصيد غير موجود"}), 404
    due = round((row["total"] or 0) - (row["paid"] or 0), 2)
    auto_msg = message or f"مرحباً {row['customer_name']}، تذكير: متبقي آجل {due:.2f} ريال (استحقاق: {row['due_date'] or '-'}) — مطعم {get_setting('restaurant_name', 'مطعم الذوق الرفيع')}"
    c.execute("INSERT INTO credit_reminders (ledger_id, method, message, sent_by, status) VALUES (?,?,?,?,?)",
              (lid, method, auto_msg, u["name"], "sent"))
    conn.commit()
    conn.close()
    audit("credit_reminder", f"أُرسل تذكير {method} للعميل {row['customer_name']} #{lid}")
    return jsonify({"ok": True, "message": auto_msg})


@app.route("/api/credit/reminders/<int:lid>")
def api_credit_reminders_list(lid):
    """سجل تذكيرات عميل معين"""
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM credit_reminders WHERE ledger_id=? ORDER BY id DESC", (lid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/reports/cancelled")
def api_reports_cancelled():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    c = conn.cursor()
    where = "status='cancelled'"
    params = []
    if from_d:
        where += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(date) <= ?"
        params.append(to_d)
    rows = c.execute(f"SELECT * FROM orders WHERE {where} ORDER BY date DESC", params).fetchall()
    cancelled_total = round(sum(r["total"] or 0 for r in rows), 2)
    conn.close()
    return jsonify({"items": [dict(r) for r in rows], "count": len(rows), "total": cancelled_total})


@app.route("/api/refunds")
def api_refunds():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    c = conn.cursor()
    _ensure_schema(conn, c)
    where = "1=1"
    params = []
    if from_d:
        where += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(date) <= ?"
        params.append(to_d)
    rows = c.execute(f"SELECT rr.*, o.table_num AS o_table FROM refund_receipts rr "
                     f"LEFT JOIN orders o ON rr.order_id=o.id WHERE {where} ORDER BY rr.id DESC", params).fetchall()
    refunded_total = round(sum(r["total"] or 0 for r in rows), 2)
    conn.close()
    items_out = []
    for r in rows:
        d = dict(r)
        d["items"] = _parse_items(r["items"])
        d["table_num"] = r["o_table"]
        items_out.append(d)
    return jsonify({"items": items_out, "count": len(items_out), "total": refunded_total})


@app.route("/api/deposit-voucher", methods=["POST"])
def api_deposit_voucher_create():
    """إنشاء سند قبض وربطه تلقائياً بذمم العميل المفتوحة من الأقدم إلى الأحدث."""
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401

    data = request.json or {}
    customer_name = str(data.get("customer_name") or "").strip()
    phone = str(data.get("phone") or "").strip()
    party_date = str(data.get("party_date") or "").strip()
    description = str(data.get("description") or "").strip()
    amount = _amount(data, "amount", 0)
    method = str(data.get("method") or "نقدي")
    transfer_ref = str(data.get("transfer_ref") or "").strip() or None
    transfer_name = str(data.get("transfer_name") or "").strip() or None

    if amount <= 0:
        return jsonify({"error": "أدخل مبلغاً صحيحاً"}), 400
    if not customer_name and not phone:
        return jsonify({"error": "اسم العميل أو رقم الهاتف مطلوب لربط سند القبض"}), 400
    if method in ("BCA", "مانديري", "كيروس") and not transfer_ref:
        return jsonify({"error": "التحويل البنكي يتطلب رقم مرجع التحويل"}), 400

    conn = get_db()
    c = conn.cursor()
    _ensure_schema(conn, c)

    try:
        # 1) العثور على العميل بالهاتف أولاً، ثم الاسم؛ وإن لم يوجد ننشئ سجلاً له.
        customer = None
        if phone:
            customer = c.execute(
                "SELECT id, name, phone FROM customers WHERE phone=? LIMIT 1", (phone,)
            ).fetchone()
        if not customer and customer_name:
            customer = c.execute(
                "SELECT id, name, phone FROM customers WHERE lower(trim(name))=lower(trim(?)) LIMIT 1",
                (customer_name,),
            ).fetchone()
        if not customer:
            c.execute(
                "INSERT INTO customers (name, phone) VALUES (?,?)",
                (customer_name or "عميل", phone or None),
            )
            customer = c.execute(
                "SELECT id, name, phone FROM customers WHERE id=?", (c.lastrowid,)
            ).fetchone()

        customer_id = int(customer["id"])
        resolved_name = (customer["name"] or customer_name or "عميل").strip()
        resolved_phone = (customer["phone"] or phone or "").strip()

        # 2) البحث عن الذمم المفتوحة لهذا العميل. نستخدم customer_id للبيانات الجديدة
        #    ونعيد مطابقة الهاتف/الاسم للذمم القديمة التي لم يكن لها customer_id.
        ledgers = c.execute(
            """
            SELECT * FROM credit_ledger
            WHERE status='open'
              AND ROUND(COALESCE(total,0)-COALESCE(paid,0),2) > 0
              AND (
                    customer_id=?
                 OR (phone IS NOT NULL AND phone!='' AND ?!='' AND trim(phone)=trim(?))
                 OR lower(trim(customer_name))=lower(trim(?))
              )
            ORDER BY datetime(COALESCE(created_at,'1970-01-01')) ASC, id ASC
            """,
            (customer_id, resolved_phone, resolved_phone, resolved_name),
        ).fetchall()

        outstanding = round(sum(
            max(float(r["total"] or 0) - float(r["paid"] or 0), 0)
            for r in ledgers
        ), 2)

        # إذا كان للعميل دين مفتوح، لا نسمح بسند قبض مستقل عن الذمم.
        # ويجب أن يغطي المبلغ كامل السند؛ لا نضع فائضاً غير معروف محاسبياً في voucher فقط.
        if ledgers and amount > outstanding + 0.001:
            conn.rollback()
            conn.close()
            return jsonify({
                "error": f"مبلغ سند القبض ({amount:.2f}) أكبر من إجمالي الذمم المفتوحة ({outstanding:.2f}) للعميل. "
                         "قسّم السند أو سجّل الفائض كسلفة/رصيد مستقل بعد تعريف حسابه."
            }), 400

        # 3) إنشاء سند القبض نفسه حتى يبقى محفوظاً في تقرير سندات القبض.
        c.execute(
            "INSERT INTO deposit_vouchers "
            "(customer_name, phone, party_date, description, amount, method, transfer_ref, transfer_name, employee, date) "
            "VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
            (
                resolved_name, resolved_phone or None, party_date or None,
                description or None, amount, method, transfer_ref, transfer_name, u["name"],
            ),
        )
        vid = c.lastrowid
        receipt_no = "QC-%d-%05d" % (_now().year, vid)
        c.execute("UPDATE deposit_vouchers SET receipt_no=? WHERE id=?", (receipt_no, vid))

        # 4) توزيع سند القبض على أقدم الذمم أولاً، وإنشاء credit_payments لكل جزء.
        remaining = round(amount, 2)
        allocations = []
        for ledger in ledgers:
            if remaining <= 0:
                break
            due = round(max(float(ledger["total"] or 0) - float(ledger["paid"] or 0), 0), 2)
            if due <= 0:
                continue
            applied = round(min(remaining, due), 2)
            new_paid = round(float(ledger["paid"] or 0) + applied, 2)
            new_status = "settled" if new_paid >= float(ledger["total"] or 0) - 0.001 else "open"

            c.execute(
                "UPDATE credit_ledger SET paid=?, status=?, updated_at=datetime('now','localtime'), customer_id=? WHERE id=?",
                (new_paid, new_status, customer_id, ledger["id"]),
            )
            c.execute(
                "INSERT INTO credit_payments "
                "(ledger_id, amount, method, employee, date, receipt_no, deposit_voucher_id) "
                "VALUES (?,?,?,?,datetime('now','localtime'),?,?)",
                (ledger["id"], applied, method, u["name"], receipt_no, vid),
            )
            allocations.append({
                "ledger_id": ledger["id"],
                "order_id": ledger["order_id"],
                "amount": applied,
                "remaining_invoice": round(max(float(ledger["total"] or 0) - new_paid, 0), 2),
                "status": new_status,
            })
            remaining = round(remaining - applied, 2)

        conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()
        print("DEPOSIT VOUCHER ERR:", repr(e))
        return jsonify({"error": "تعذّر إنشاء سند القبض أو ربطه بالذمم"}), 500

    conn.close()

    applied_total = round(amount - remaining, 2)
    voucher = {
        "id": vid, "receipt_no": receipt_no,
        "customer_name": resolved_name, "phone": resolved_phone,
        "party_date": party_date or "", "description": description or "",
        "amount": amount, "method": method,
        "transfer_ref": transfer_ref, "transfer_name": transfer_name,
        "employee": u["name"], "date": _now_sql(),
        "customer_id": customer_id,
        "applied_to_credit": applied_total,
        "unallocated": remaining,
        "allocations": allocations,
    }
    audit(
        "deposit_voucher",
        f"سند قبض {receipt_no} بمبلغ {amount:.2f} ({method}) - العميل {resolved_name} - "
        f"مسدد من الآجل {applied_total:.2f}",
    )
    return jsonify({"ok": True, "voucher": voucher})


@app.route("/api/deposit-vouchers")
def api_deposit_vouchers_list():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    c = conn.cursor()
    _ensure_schema(conn, c)
    where = "1=1"
    params = []
    if from_d:
        where += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(date) <= ?"
        params.append(to_d)
    rows = c.execute(f"SELECT * FROM deposit_vouchers WHERE {where} ORDER BY id DESC", params).fetchall()
    total = round(sum(r["amount"] or 0 for r in rows), 2)
    conn.close()
    return jsonify({"items": [dict(r) for r in rows], "count": len(rows), "total": total})


@app.route("/api/reports/income")
def api_reports_income():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = (request.args.get("from") or "").strip()
    to_d = (request.args.get("to") or "").strip()
    conn = get_db()
    c = conn.cursor()
    where = "status!='cancelled'"
    params = []
    if from_d:
        where += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(date) <= ?"
        params.append(to_d)
    rows = c.execute(f"SELECT * FROM orders WHERE {where} ORDER BY date", params).fetchall()

    total_sales = round(sum(r["total"] or 0 for r in rows), 2)
    total_discount = round(sum(r["discount"] or 0 for r in rows), 2)
    total_tax = round(sum(r["tax"] or 0 for r in rows), 2)
    cash_received = round(sum(r["paid"] or 0 for r in rows), 2)

    # تحليل حسب طريقة الدفع (مبالغ مقبوضة فعلاً)
    by_method = {}
    for r in rows:
        m = _report_method(r["payment_method"] or "نقدي")
        b = by_method.setdefault(m, {"count": 0, "paid": 0.0, "total": 0.0})
        b["count"] += 1
        b["paid"] = round(b["paid"] + (r["paid"] or 0), 2)
        b["total"] = round(b["total"] + (r["total"] or 0), 2)
    by_method = [{"method": k, "count": v["count"], "paid": v["paid"], "total": v["total"]} for k, v in sorted(by_method.items())]

    # تحصيل الآجل خلال الفترة
    cr_where = "COALESCE(method, '') != 'آجل'"
    cr_params = []
    if from_d:
        cr_where += " AND date(date) >= ?"
        cr_params.append(from_d)
    if to_d:
        cr_where += " AND date(date) <= ?"
        cr_params.append(to_d)
    credit_collected = round(c.execute(f"SELECT COALESCE(SUM(amount),0) FROM credit_payments WHERE {cr_where}", cr_params).fetchone()[0], 2)

    # الإلغاءات (مرتجعات) خلال الفترة
    can_where = "status='cancelled'"
    can_params = []
    if from_d:
        can_where += " AND date(date) >= ?"
        can_params.append(from_d)
    if to_d:
        can_where += " AND date(date) <= ?"
        can_params.append(to_d)
    cancelled = c.execute(f"SELECT * FROM orders WHERE {can_where}", can_params).fetchall()
    cancelled_total = round(sum(r["total"] or 0 for r in cancelled), 2)
    cancelled_count = len(cancelled)

    # المصروفات خلال الفترة
    exp_where = "1=1"
    exp_params = []
    if from_d:
        exp_where += " AND date(date) >= ?"
        exp_params.append(from_d)
    if to_d:
        exp_where += " AND date(date) <= ?"
        exp_params.append(to_d)
    expenses_total = round(c.execute(f"SELECT COALESCE(SUM(amount),0) FROM expenses WHERE {exp_where}", exp_params).fetchone()[0], 2)

    # الذمم المفتوحة الجديدة خلال الفترة (المتبقي غير المحصل)
    ar_where = "status='open'"
    ar_params = []
    if from_d:
        ar_where += " AND date(created_at) >= ?"
        ar_params.append(from_d)
    if to_d:
        ar_where += " AND date(created_at) <= ?"
        ar_params.append(to_d)
    ar_new = round(c.execute(f"SELECT COALESCE(SUM(total-paid),0) FROM credit_ledger WHERE {ar_where}", ar_params).fetchone()[0], 2)

    # التدفقات النقدية الصافية
    cash_in = round(cash_received + credit_collected, 2)
    cash_out = round(expenses_total + cancelled_total, 2)
    net_cash_flow = round(cash_in - cash_out, 2)
    # صافي الدخل الإجمالي
    net_income = round(total_sales - total_tax - total_discount + credit_collected - expenses_total - cancelled_total, 2)

    conn.close()
    return jsonify({
        "total_sales": total_sales, "total_discount": total_discount, "total_tax": total_tax,
        "cash_received": cash_received, "credit_collected": credit_collected,
        "by_method": by_method, "cancelled_total": cancelled_total, "cancelled_count": cancelled_count,
        "expenses_total": expenses_total, "ar_new": ar_new,
        "cash_in": cash_in, "cash_out": cash_out, "net_cash_flow": net_cash_flow,
        "net_income": net_income,
    })


@app.route("/api/reports/advanced/csv")
def api_reports_advanced_csv():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    from_d = request.args.get("from", "")
    to_d = request.args.get("to", "")
    conn = get_db()
    c = conn.cursor()
    where = "status='completed'"
    params = []
    if from_d:
        where += " AND date(date) >= ?"
        params.append(from_d)
    if to_d:
        where += " AND date(date) <= ?"
        params.append(to_d)
    rows = c.execute(f"SELECT * FROM orders WHERE {where} ORDER BY date", params).fetchall()
    conn.close()
    import io
    import csv
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["رقم", "التاريخ", "الطاولة", "الكاشير", "طريقة الدفع", "الإجمالي", "الضريبة", "الخصم", "الأصناف"])
    for r in rows:
        names = ", ".join(f"{i.get('name','')} x{i.get('qty',1)}" for i in _parse_items(r["items"]))
        w.writerow([r["id"], r["date"], r["table_num"], r["employee"], r["payment_method"],
                    r["total"], r["tax"], r["discount"], names])
    resp = Response(buf.getvalue().encode("utf-8-sig"), mimetype="text/csv; charset=utf-8")
    resp.headers["Content-Disposition"] = "attachment; filename=reports.csv"
    return resp


if __name__ == "__main__":
    init_db()
    auto_backup_now("start")
    atexit.register(lambda: auto_backup_now("stop"))
    threading.Thread(target=backup_scheduler, daemon=True).start()
    hostname = socket.gethostname()
    try:
        local_ip = socket.gethostbyname(hostname)
    except Exception:
        local_ip = "127.0.0.1"
    port = int(os.environ.get("PORT", 5002))
    print("مطعم الذوق الرفيع - POS Web")
    print(f"  Phone:  http://{local_ip}:{port}")
    print(f"  PC:     http://localhost:{port}")
    print("  مدير: 9999  |  كاشير: 1111")
    app.run(host="0.0.0.0", port=port, debug=False)


# تهيئة قاعدة البيانات عند الاستيراد (للسحابة عبر Gunicorn).
# الفشل هنا (حد اتصالات مزدحم مثلاً) يجب ألا يُسقط العملية/الاستيراد:
# الأعمدة والجداول موجودة أصلاً على السحابة، وستُعاد محاولة التهيئة عند أول طلب.
try:
    init_db()
except Exception:
    import traceback
    traceback.print_exc()
    print("INIT DB NOT READY YET - will retry per request via _ensure_schema")

