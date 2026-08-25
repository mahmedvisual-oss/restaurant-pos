-- Financial core for V2.
-- Monetary values are integer IDR rupiah. Payment records are immutable facts.

CREATE TABLE IF NOT EXISTS order_totals (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id),
    subtotal INTEGER NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
    tax INTEGER NOT NULL DEFAULT 0 CHECK(tax >= 0),
    discount INTEGER NOT NULL DEFAULT 0 CHECK(discount >= 0),
    total INTEGER NOT NULL DEFAULT 0 CHECK(total >= 0),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE IF NOT EXISTS order_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    receipt_number TEXT NOT NULL UNIQUE,
    payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    amount INTEGER NOT NULL CHECK(amount > 0),
    reference TEXT,
    received_by INTEGER NOT NULL REFERENCES users(id),
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    refund_number TEXT NOT NULL UNIQUE,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    amount INTEGER NOT NULL CHECK(amount > 0),
    reason_key TEXT NOT NULL,
    approved_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date TEXT NOT NULL UNIQUE,
    opened_by INTEGER NOT NULL REFERENCES users(id),
    opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    opening_cash INTEGER NOT NULL DEFAULT 0 CHECK(opening_cash >= 0),
    closed_by INTEGER REFERENCES users(id),
    closed_at TEXT,
    counted_cash INTEGER CHECK(counted_cash >= 0),
    expected_cash INTEGER CHECK(expected_cash >= 0),
    difference INTEGER,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed'))
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
    movement_type TEXT NOT NULL CHECK(movement_type IN ('sale','refund','cash_in','cash_out','opening')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    reference_type TEXT,
    reference_id INTEGER,
    reason_key TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_date ON order_payments(received_at);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id, created_at);

INSERT OR IGNORE INTO payment_methods(code,name_key,sort_order) VALUES
('cash','payment.cash',1),
('card','payment.card',2),
('transfer','payment.transfer',3),
('other','payment.other',4);
