-- Customers, credit sales, and inventory foundation.

CREATE TABLE IF NOT EXISTS credit_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    account_code TEXT NOT NULL UNIQUE,
    credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES credit_accounts(id),
    order_id INTEGER REFERENCES orders(id),
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('charge','payment','adjustment','refund')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    reference TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL UNIQUE,
    unit_key TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    minimum_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_quantity >= 0),
    cost INTEGER NOT NULL DEFAULT 0 CHECK(cost >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_item_inventory (
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    quantity_per_item REAL NOT NULL DEFAULT 1 CHECK(quantity_per_item > 0),
    PRIMARY KEY(menu_item_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    movement_type TEXT NOT NULL CHECK(movement_type IN ('purchase','sale','waste','adjustment','return')),
    quantity REAL NOT NULL CHECK(quantity > 0),
    reference_type TEXT,
    reference_id INTEGER,
    reason_key TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_account ON credit_transactions(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(inventory_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_menu_item_inventory_item ON menu_item_inventory(inventory_item_id);
