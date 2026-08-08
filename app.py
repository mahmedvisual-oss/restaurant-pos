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

app = Flask(__name__, static_folder="public", static_url_path="")
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.after_request
def _no_cache(resp):
    path = request.path
    if path.endswith(".css") or path.endswith(".js") or path in ("/", "/kitchen"):
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp

sk_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret_key.txt")
if os.path.exists(sk_path):
    app.secret_key = open(sk_path).read().strip()
else:
    app.secret_key = secrets.token_hex(32)
    try:
        with open(sk_path, "w") as f:
            f.write(app.secret_key)
    except Exception:
        pass

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
DB_INTEGRITY = _ts.IntegrityError if CLOUD_DB else sqlite3.IntegrityError


def _raw_conn():
    if CLOUD_DB:
        conn = _ts.connect(TURSO_URL, auth_token=TURSO_AUTH_TOKEN)
        conn.row_factory = lambda cur, row: row
        return conn
    return sqlite3.connect(DB_PATH)


def get_db():
    conn = _raw_conn()
    if not CLOUD_DB:
        conn.row_factory = sqlite3.Row
    return conn


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
            conn.close()
            return
    c.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_num INTEGER,
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
        active INTEGER DEFAULT 1
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
    c.execute('''CREATE TABLE IF NOT EXISTS promo_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT DEFAULT 'percent',
        discount_value REAL DEFAULT 0,
        min_order REAL DEFAULT 0,
        max_uses INTEGER DEFAULT 0,
        used_count INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        expires_at TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        quantity REAL DEFAULT 0,
        unit TEXT DEFAULT 'piece',
        min_stock REAL DEFAULT 0,
        cost REAL DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT UNIQUE,
        points INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        phone TEXT,
        table_num INTEGER,
        guests INTEGER DEFAULT 1,
        date TEXT,
        time TEXT,
        status TEXT DEFAULT 'confirmed',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        num INTEGER UNIQUE NOT NULL,
        section TEXT DEFAULT 'hall'
    )''')
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
    cols = [r[1] for r in c.execute("PRAGMA table_info(orders)")]
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
        secs = [("families", 1, 8), ("vip", 9, 12), ("hall", 13, 20), ("takeaway", 21, 24)]
        for sec, s, e in secs:
            for n in range(s, e + 1):
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
    c.execute('''CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT DEFAULT (datetime('now','localtime')),
        category TEXT DEFAULT 'عام',
        description TEXT DEFAULT '',
        amount REAL DEFAULT 0,
        added_by TEXT
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
    conn.commit()
    conn.close()


def require_user():
    return session.get("user")


def get_setting(key, default=""):
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row and row["value"] is not None else default


def set_setting(key, value):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
              (key, value, value))
    conn.commit()
    conn.close()


def get_tax_rate():
    try:
        return float(get_setting("tax_rate", "0.15"))
    except (TypeError, ValueError):
        return 0.15


def require_manager():
    u = require_user()
    if not u:
        return None, "سجل الدخول أولاً", 401
    if u["role"] != "manager":
        return None, "متاح للمدير فقط", 403
    return u, None, None


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
    audit("menu_delete", f"حذف صنف: {row['name'] if row else mid}")
    return jsonify({"ok": True})


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
    data = request.json or {}
    from_table = data.get("from_table")
    to_table = data.get("to_table")
    if not from_table or not to_table:
        return jsonify({"error": "الطاولتان مطلوبتان"}), 400
    conn = get_db()
    c = conn.cursor()
    order = c.execute("SELECT id FROM orders WHERE table_num=? AND status IN ('active','sent','ready')", (from_table,)).fetchone()
    if not order:
        conn.close()
        return jsonify({"error": "لا يوجد طلب نشط في هذه الطاولة"}), 404
    existing = c.execute("SELECT id FROM orders WHERE table_num=? AND status IN ('active','sent','ready')", (to_table,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "الطاولة الوجهة مشغولة بالفعل"}), 400
    c.execute("UPDATE orders SET table_num=? WHERE id=?", (to_table, order['id']))
    conn.commit()
    conn.close()
    audit("order_transfer", f"نقل طلب من طاولة {from_table} إلى {to_table}")
    return jsonify({"ok": True})


# ===== طلب إلغاء طلب (يحتاج موافقة المدير) =====
@app.route("/api/order/cancel-request", methods=["POST"])
def api_cancel_request():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_num = data.get("table_num")
    order_id = data.get("order_id")
    reason = data.get("reason", "")
    if not table_num:
        return jsonify({"error": "اختر طاولة"}), 400
    conn = get_db()
    c = conn.cursor()
    if not order_id:
        row = c.execute("SELECT id FROM orders WHERE table_num=? AND status IN ('active','sent','ready')", (table_num,)).fetchone()
        if row:
            order_id = row["id"]
    if not order_id:
        conn.close()
        return jsonify({"error": "لا يوجد طلب نشط لهذه الطاولة"}), 400
    existing = c.execute("SELECT id FROM cancellation_requests WHERE order_id=? AND status='pending'", (order_id,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "يوجد طلب إلغاء معلق بالفعل"}), 400
    c.execute("INSERT INTO cancellation_requests (order_id, table_num, requested_by, reason, status) VALUES (?,?,?,?,'pending')",
              (order_id, table_num, u["name"], reason))
    conn.commit()
    req_id = c.lastrowid
    conn.close()
    audit("cancel_request", f"طلب إلغاء طلب #{order_id} (طاولة {table_num}) من {u['name']}")
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
    row = c.execute("SELECT * FROM cancellation_requests WHERE id=? AND status='pending'", (req_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "طلب غير موجود أو تمت معالجته"}), 404
    # حماية الإلغاء: الطلبات الجاهزة/المدفوعة تحتاج PIN المدير
    order = c.execute("SELECT status, items, table_num FROM orders WHERE id=?", (row["order_id"],)).fetchone()
    sensitive = bool(order and order["status"] in ("sent", "ready", "completed"))
    if sensitive:
        pin = str(data.get("pin") or "")
        managers = c.execute("SELECT pin FROM employees WHERE active=1 AND role='manager'").fetchall()
        if not any(verify_pin(pin, m["pin"]) for m in managers):
            conn.close()
            return jsonify({"error": "هذا الإلغاء يتطلب PIN المدير"}), 403
    c.execute("UPDATE cancellation_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?",
              (u["name"], req_id))
    c.execute("UPDATE orders SET status='cancelled' WHERE id=?", (row["order_id"],))
    # إذا كان الطلب مدفوعاً سابقاً، أعد المخزون المُخصوم تلقائياً
    if order and order["status"] == "completed":
        try:
            items = _parse_items(order["items"])
            _restore_inventory(c, items)
        except Exception:
            pass
    conn.commit()
    conn.close()
    audit("cancel_approve", f"موافقة على إلغاء طلب #{row['order_id']} (طاولة {row['table_num']}) من {u['name']}"
          + (" مع PIN" if sensitive else ""))
    return jsonify({"ok": True, "sensitive": sensitive})


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
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT id, name, role FROM employees WHERE active=1 ORDER BY id").fetchall()
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
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO employees (name, pin, role) VALUES (?,?,?)", (name, hash_pin(pin), role))
    eid = c.lastrowid
    conn.commit()
    conn.close()
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
    if active == 0 and int(row["id"]) == int(u["id"]):
        conn.close()
        return jsonify({"error": "لا يمكنك تعطيل حسابك الخاص"}), 400
    if active == 0 and row["role"] == "manager":
        cnt = c.execute("SELECT COUNT(*) AS n FROM employees WHERE role='manager' AND active=1 AND id!=?", (eid,)).fetchone()["n"]
        if cnt == 0:
            conn.close()
            return jsonify({"error": "يجب بقاء مدير واحد نشط على الأقل"}), 400
    pin = str(data.get("pin", "")).strip()
    if pin:
        if len(pin) < 4 or not pin.isdigit():
            conn.close()
            return jsonify({"error": "PIN يجب أن يكون 4 أرقام على الأقل"}), 400
        c.execute("UPDATE employees SET name=?, role=?, active=?, pin=? WHERE id=?",
                  (name, role, int(active), hash_pin(pin), eid))
    else:
        c.execute("UPDATE employees SET name=?, role=?, active=? WHERE id=?",
                  (name, role, int(active), eid))
    conn.commit()
    conn.close()
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
    c.execute("UPDATE employees SET active=0 WHERE id=?", (eid,))
    conn.commit()
    conn.close()
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
    audit("settings", "تحديث الإعدادات")
    return jsonify({"ok": True, "tax_rate": get_tax_rate(),
                    "restaurant_name": get_setting("restaurant_name"),
                    "currency": get_setting("currency"),
                    "auto_backup": get_setting("auto_backup", "1") == "1",
                    "backup_freq": get_setting("backup_freq", "daily")})


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
    if row["expires_at"] and row["expires_at"] < datetime.now().strftime("%Y-%m-%d"):
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
    sql = "SELECT * FROM credit_ledger WHERE 1=1"
    params = []
    if status in ("open", "settled"):
        sql += " AND status=?"
        params.append(status)
    if q:
        sql += " AND customer_name LIKE ?"
        params.append(f"%{q}%")
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


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
        today = datetime.now().strftime("%Y-%m-%d")
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
    new_paid = round(row["paid"] + amount, 2)
    if new_paid > row["total"]:
        new_paid = row["total"]
    remaining = round(row["total"] - new_paid, 2)
    status = "settled" if remaining <= 0 else "open"
    c.execute("UPDATE credit_ledger SET paid=?, status=?, updated_at=datetime('now','localtime') WHERE id=?",
              (new_paid, status, lid))
    c.execute("INSERT INTO credit_payments (ledger_id, amount, method, employee, date) "
              "VALUES (?,?,?,?, datetime('now','localtime'))",
              (lid, amount, method, u["name"]))
    conn.commit()
    conn.close()
    audit("credit_pay", f"تحصيل آجل #{lid} بمبلغ {amount:.2f} ({method})")
    return jsonify({"ok": True, "remaining": remaining, "status": status})


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
    exp_date = str(data.get("date") or "").strip() or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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


@app.route("/api/customer", methods=["POST"])
def api_customer_create():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    if not name:
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn = get_db()
    conn.execute("INSERT INTO customers (name, phone) VALUES (?,?)", (name, phone))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/customer/<int:cid>", methods=["PUT"])
def api_customer_update(cid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    name = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    points = int(data.get("points", 0))
    if not name:
        return jsonify({"error": "الاسم مطلوب"}), 400
    conn = get_db()
    conn.execute("UPDATE customers SET name=?, phone=?, points=? WHERE id=?", (name, phone, points, cid))
    conn.commit()
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
    rows = conn.execute("SELECT * FROM reservations WHERE date >= date('now') ORDER BY date, time").fetchall()
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
    table_num = int(data.get("table_num", 0))
    date = str(data.get("date", "")).strip()
    time = str(data.get("time", "")).strip()
    guests = int(data.get("guests", 1))
    notes = str(data.get("notes", "")).strip()
    if not customer_name or not date or not time or not table_num:
        return jsonify({"error": "البيانات ناقصة"}), 400
    conn = get_db()
    conflict = conn.execute("SELECT id FROM reservations WHERE table_num=? AND date=? AND time=? AND status != 'cancelled'", (table_num, date, time)).fetchone()
    if conflict:
        conn.close()
        return jsonify({"error": "الطاولة محجوزة في هذا الوقت"}), 400
    conn.execute("INSERT INTO reservations (customer_name, phone, table_num, date, time, guests, notes, created_by) VALUES (?,?,?,?,?,?,?,?)",
                 (customer_name, phone, table_num, date, time, guests, notes, u["id"]))
    conn.commit()
    conn.close()
    audit("reservation_create", f"حجز طاولة {table_num}: {customer_name}")
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


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.json or {}
    emp_id = data.get("employee_id")
    pin = data.get("pin", "")
    conn = get_db()
    c = conn.cursor()
    row = c.execute("SELECT id, name, role, pin FROM employees WHERE id=? AND active=1", (emp_id,)).fetchone()
    conn.close()
    if row and verify_pin(pin, row["pin"]):
        session["user"] = {"id": row["id"], "name": row["name"], "role": row["role"]}
        audit("login", f"تسجيل دخول: {row['name']}")
        return jsonify({"ok": True, "user": session["user"]})
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
    conn = get_db()
    c = conn.cursor()
    managers = c.execute("SELECT pin FROM employees WHERE active=1 AND role='manager'").fetchall()
    conn.close()
    for m in managers:
        if verify_pin(pin, m["pin"]):
            return jsonify({"ok": True})
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
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


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
            today = datetime.now().strftime("%Y-%m-%d")
            week = datetime.now().strftime("%G-W%V")
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
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
    except Exception:
        pass
    items = []
    for fn in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if fn.endswith(".db"):
            p = os.path.join(BACKUP_DIR, fn)
            st = os.stat(p)
            items.append({"name": fn, "size": st.st_size, "date": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
    return jsonify({"backups": items})


@app.route("/api/backup/download/<name>")
def api_backup_download_one(name):
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    safe = _safe_backup_name(name)
    if not safe:
        return jsonify({"error": "اسم ملف غير صالح"}), 400
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


# ===== إغلاق اليوم =====
def _day_summary(c, day):
    rows = c.execute("SELECT * FROM orders WHERE status='completed' AND date(date)=?", (day,)).fetchall()
    total = round(sum(r["total"] or 0 for r in rows), 2)
    tax = round(sum(r["tax"] or 0 for r in rows), 2)
    by_method = {}
    opened = None
    for r in rows:
        m = r["payment_method"] or "نقدي"
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
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    today = datetime.now().strftime("%Y-%m-%d")
    conn = get_db()
    c = conn.cursor()
    s = _day_summary(c, today)
    cl = c.execute("SELECT * FROM day_closures WHERE date=?", (today,)).fetchone()
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
    return jsonify({"date": today, "closed": cl is not None, "closure": closure, **s})


@app.route("/api/day/close", methods=["POST"])
def api_day_close():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    data = request.json or {}
    try:
        counted = round(float(data.get("counted_cash", 0)), 2)
    except (TypeError, ValueError):
        counted = 0
    today = datetime.now().strftime("%Y-%m-%d")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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


@app.route("/api/day/reopen", methods=["POST"])
def api_day_reopen():
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    today = datetime.now().strftime("%Y-%m-%d")
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
def _serialize_items(items):
    try:
        return json.dumps([{"name": str(i["name"]), "qty": int(i["qty"]),
                            "price": float(i["price"]), "emoji": str(i.get("emoji", "")),
                            "menu_id": int(i.get("menu_id") or 0)} for i in items],
                          ensure_ascii=False)
    except Exception:
        return json.dumps([])


def _open_order_id(c, table_num, order_id=None, new_order=False):
    if new_order:
        return None
    if order_id:
        row = c.execute("SELECT id FROM orders WHERE id=? AND table_num=? AND status IN ('active','sent','ready')",
                        (order_id, table_num)).fetchone()
        if row:
            return row["id"]
    row = c.execute("SELECT id FROM orders WHERE table_num=? AND status IN ('active','sent','ready') ORDER BY id DESC LIMIT 1",
                    (table_num,)).fetchone()
    return row["id"] if row else None


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
    items = _parse_items(row["items"])
    return {
        "ok": True, "order_id": oid, "total": row["total"], "subtotal": row["subtotal"],
        "tax": row["tax"], "discount": row["discount"] or 0, "paid": row["paid"] or 0,
        "change": round((row["paid"] or 0) - row["total"], 2),
        "payment_method": row["payment_method"], "table_num": row["table_num"],
        "guests": row["guests"] or 1, "employee": row["employee"],
        "credit_name": row["credit_name"] if "credit_name" in row.keys() else None,
        "items": [{"name": i["name"], "qty": i["qty"], "price": float(i["price"]),
                   "subtotal": round(float(i["price"]) * int(i["qty"]), 2), "emoji": i.get("emoji", "")}
                  for i in items],
        "date": row["date"] or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


@app.route("/api/tables")
def api_tables():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("SELECT table_num, COUNT(*) AS cnt FROM orders WHERE status IN ('active','sent','ready') GROUP BY table_num").fetchall()
    active = {r["table_num"]: r["cnt"] for r in rows}
    tabs = c.execute("SELECT * FROM tables ORDER BY num").fetchall()
    conn.close()
    return jsonify([{"id": t["id"], "num": t["num"], "section": t["section"],
                     "pos_x": t["pos_x"], "pos_y": t["pos_y"],
                     "capacity": t["capacity"], "shape": t["shape"],
                     "active": t["num"] in active, "orders": active.get(t["num"], 0)} for t in tabs])


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
    if section not in ("families", "vip", "hall", "takeaway"):
        return jsonify({"error": "قسم غير صالح"}), 400
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


@app.route("/api/table_order/<int:tn>")
def api_table_order(tn):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    oid = _open_order_id(c, tn)
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
    table_num = data.get("table_num")
    items = data.get("items", [])
    order_id = data.get("order_id")
    if not table_num or not items:
        return jsonify({"error": "اختر طاولة وأضف أصنافاً"}), 400
    discount = _amount(data, "discount")
    guests = int(data.get("guests", 1) or 1)
    items_str = _serialize_items(items)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    c = conn.cursor()
    oid = _open_order_id(c, table_num, order_id, bool(data.get("new_order")))
    if oid:
        c.execute("UPDATE orders SET items=?, discount=?, guests=?, status='sent', sent_at=?, employee=?, date=? WHERE id=?",
                  (items_str, discount, guests, now, u["name"], now, oid))
    else:
        c.execute("INSERT INTO orders (table_num, items, subtotal, tax, discount, total, payment_method, employee, status, guests, sent_at, date) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (table_num, items_str, 0, 0, discount, 0, "", u["name"], "sent", guests, now,
                   now))
        oid = c.lastrowid
    conn.commit()
    conn.close()
    audit("save_order", f"حفظ طلب #{oid} - طاولة {table_num} - أصناف {len(items)}")
    return jsonify({"ok": True, "order_id": oid})


@app.route("/api/order/send", methods=["POST"])
def api_order_send():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_num = data.get("table_num")
    items = data.get("items", [])
    order_id = data.get("order_id")
    if not table_num or not items:
        return jsonify({"error": "اختر طاولة وأضف أصنافاً"}), 400
    discount = _amount(data, "discount")
    guests = int(data.get("guests", 1) or 1)
    items_str = _serialize_items(items)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    c = conn.cursor()
    oid = _open_order_id(c, table_num, order_id, bool(data.get("new_order")))
    if oid:
        c.execute("UPDATE orders SET items=?, discount=?, guests=?, status='sent', sent_at=?, date=?, employee=? WHERE id=?",
                  (items_str, discount, guests, now, now, u["name"], oid))
    else:
        c.execute("INSERT INTO orders (table_num, items, subtotal, tax, discount, total, payment_method, employee, status, guests, date, sent_at) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                  (table_num, items_str, 0, 0, discount, 0, "", u["name"], "sent", guests, now, now))
        oid = c.lastrowid
    conn.commit()
    conn.close()
    audit("send_to_kitchen", f"إرسال طلب #{oid} للمطبخ - طاولة {table_num} - أصناف {len(items)}")
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
        "SELECT id, table_num, items, status, guests, employee, sent_at, date FROM orders "
        "WHERE status IN ('sent','ready') ORDER BY COALESCE(sent_at, date) ASC, id ASC").fetchall()
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
            "id": r["id"], "table_num": r["table_num"], "status": r["status"],
            "guests": r["guests"] or 1, "employee": r["employee"],
            "sent_at": sent, "sent_ts": sent_ts, "items": _parse_items(r["items"]),
        })
    return jsonify({"orders": orders})


@app.route("/api/kitchen/order/<int:oid>/ready", methods=["POST"])
def api_kitchen_ready(oid):
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    conn = get_db()
    c = conn.cursor()
    c.execute("UPDATE orders SET status='ready' WHERE id=? AND status='sent'", (oid,))
    conn.commit()
    conn.close()
    audit("kitchen_ready", f"طلب #{oid} جاهز")
    return jsonify({"ok": True})


def _deduct_inventory(c, items):
    """خصم كميات المخزون تلقائياً عند بيع أصناف مرتبطة بمخزون."""
    for it in items:
        mid = int(it.get("menu_id") or 0)
        qty_sold = int(it.get("qty") or 0)
        if not mid or qty_sold <= 0:
            continue
        links = c.execute("SELECT inventory_id, qty_per FROM menu_inventory WHERE menu_id=?", (mid,)).fetchall()
        for link in links:
            consume = link["qty_per"] * qty_sold
            c.execute("UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE id=?", (consume, link["inventory_id"]))


def _restore_inventory(c, items):
    """إرجاع المخزون المُخصوم عند إلغاء طلب مدفوع."""
    for it in items:
        mid = int(it.get("menu_id") or 0)
        qty_sold = int(it.get("qty") or 0)
        if not mid or qty_sold <= 0:
            continue
        links = c.execute("SELECT inventory_id, qty_per FROM menu_inventory WHERE menu_id=?", (mid,)).fetchall()
        for link in links:
            restore = link["qty_per"] * qty_sold
            c.execute("UPDATE inventory SET quantity = quantity + ? WHERE id=?", (restore, link["inventory_id"]))


@app.route("/api/order/pay", methods=["POST"])
def api_order_pay():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    data = request.json or {}
    table_num = data.get("table_num")
    items = data.get("items", [])
    order_id = data.get("order_id")
    if not table_num or not items:
        return jsonify({"error": "اختر طاولة وأضف أصنافاً"}), 400
    paid = _amount(data, "paid")
    discount = _amount(data, "discount")
    payment_method = str(data.get("payment_method", "نقدي"))
    guests = int(data.get("guests", 1) or 1)
    credit_name = str(data.get("credit_name") or "").strip() or None
    subtotal = round(sum(float(i["price"]) * int(i["qty"]) for i in items), 2)
    tax = round(subtotal * get_tax_rate(), 2)
    max_discount = round(subtotal + tax, 2)
    if discount > max_discount:
        discount = max_discount
    total = round(subtotal + tax - discount, 2)
    if total < 0:
        total = 0
    if paid < total and payment_method != "آجل":
        return jsonify({"error": f"المبلغ المدفوع أقل من الإجمالي ({total:.2f})"}), 400
    items_str = _serialize_items(items)
    conn = get_db()
    c = conn.cursor()
    is_new = bool(data.get("new_order"))
    oid = _open_order_id(c, table_num, order_id, is_new)
    # الآجل الجزئي: سجّل الرصيد المتأخر في credit_ledger
    credit_name = (credit_name or "").strip() or None
    if oid:
        c.execute("UPDATE orders SET items=?, subtotal=?, tax=?, discount=?, total=?, paid=?, payment_method=?, "
                  "status='completed', guests=?, employee=?, date=?, credit_name=? WHERE id=?",
                  (items_str, subtotal, tax, discount, total, paid, payment_method, guests, u["name"],
                   datetime.now().strftime("%Y-%m-%d %H:%M:%S"), credit_name, oid))
    else:
        c.execute("INSERT INTO orders (table_num, items, subtotal, tax, discount, total, paid, payment_method, employee, status, guests, date, credit_name) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (table_num, items_str, subtotal, tax, discount, total, paid, payment_method, u["name"],
                   "completed", guests, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), credit_name))
        oid = c.lastrowid
    if is_new:
        # في وضع التقسيم يُنشأ طلب جديد لكل فاتورة؛ أغلق أي طلب مفتوح قديم
        # على نفس الطاولة (قبل التقسيم) حتى لا يعود للأصناف عند إعادة اختيارها
        c.execute("UPDATE orders SET status='closed' WHERE table_num=? AND status IN ('active','sent','ready') AND id != ?",
                  (table_num, oid))
    # نظام الآجل: إذا المدفوع أقل من الإجمالي (والطريقة آجل) سجّل رصيداً مفتوحاً
    if payment_method == "آجل" and total > paid:
        cname = (credit_name or "").strip() or "عميل آجل"
        c.execute("INSERT INTO credit_ledger (customer_name, order_id, table_num, total, paid, status, created_at) "
                  "VALUES (?,?,?,?,?, 'open', ?)",
                  (cname, oid, table_num, total, paid, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        lid = c.lastrowid
        if paid > 0:
            c.execute("INSERT INTO credit_payments (ledger_id, amount, method, employee, date) "
                      "VALUES (?,?,?,?, datetime('now','localtime'))",
                      (lid, paid, "آجل", u["name"]))
        audit("credit_open", f"فتح رصيد آجل {lid} للعميل {cname} - متبقي {round(total - paid, 2):.2f}")
    # خصم المخزون تلقائياً عند البيع
    _deduct_inventory(c, items)
    conn.commit()
    payload = _order_payload(c, oid)
    conn.close()
    audit("place_order", f"دفع طلب #{oid} - طاولة {table_num} - {payment_method} - إجمالي {total:.2f}")
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
    c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed' AND date(date) = date('now')")
    today = c.fetchone()
    conn.close()
    return jsonify({
        "count": row["cnt"], "total": row["tot"],
        "today_count": today["cnt"], "today_total": today["tot"],
    })


@app.route("/api/reports/cashier-daily")
def api_reports_cashier_daily():
    u = require_user()
    if not u:
        return jsonify({"error": "سجل الدخول أولاً"}), 401
    today = datetime.now().strftime("%Y-%m-%d")
    conn = get_db()
    c = conn.cursor()
    my = c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed' AND employee=? AND date(date)=?",
                   (u["name"], today)).fetchone()
    all_today = c.execute("SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS tot FROM orders WHERE status='completed' AND date(date)=?",
                          (today,)).fetchone()
    my_orders = c.execute("SELECT id, table_num, total, payment_method, date FROM orders WHERE status='completed' AND employee=? AND date(date)=? ORDER BY date",
                          (u["name"], today)).fetchall()
    conn.close()
    return jsonify({
        "my_count": my["cnt"], "my_total": my["tot"],
        "all_count": all_today["cnt"], "all_total": all_today["tot"],
        "my_orders": [dict(o) for o in my_orders],
    })


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
        nums = [str(x[0]) for x in c.execute("SELECT num FROM tables WHERE section=?", (section,))]
        if nums:
            filtered = [r for r in filtered if str(r["table_num"] or "") in nums]
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
            "employee": r["employee"] or "",
            "payment_method": r["payment_method"] or "",
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
        method = r["payment_method"] or "نقدي"
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
    cr_sql = "SELECT COALESCE(SUM(amount),0) AS t FROM credit_payments WHERE 1=1"
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
    u, err, code = require_manager()
    if err:
        return jsonify({"error": err}), code
    conn = get_db()
    c = conn.cursor()
    rows = c.execute("""
        SELECT l.id, l.customer_name, l.order_id, l.table_num, l.total, l.paid, c.phone,
               (l.total - l.paid) AS due, l.created_at
        FROM credit_ledger l LEFT JOIN customers c ON c.phone = l.phone
        WHERE l.status='open' ORDER BY due DESC""").fetchall()
    total_due = c.execute("SELECT COALESCE(SUM(total-paid),0) FROM credit_ledger WHERE status='open'").fetchone()[0]
    conn.close()
    return jsonify({"items": [dict(r) for r in rows], "total_due": round(total_due, 2)})


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
        m = (r["payment_method"] or "نقدي")
        b = by_method.setdefault(m, {"count": 0, "paid": 0.0, "total": 0.0})
        b["count"] += 1
        b["paid"] = round(b["paid"] + (r["paid"] or 0), 2)
        b["total"] = round(b["total"] + (r["total"] or 0), 2)
    by_method = [{"method": k, "count": v["count"], "paid": v["paid"], "total": v["total"]} for k, v in sorted(by_method.items())]

    # تحصيل الآجل خلال الفترة
    cr_where = "1=1"
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


# تهيئة قاعدة البيانات عند الاستيراد (للسحابة عبر Gunicorn)
init_db()
