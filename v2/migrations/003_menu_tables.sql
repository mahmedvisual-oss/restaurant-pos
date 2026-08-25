-- Menu, sections, tables, and modifiers.
-- This migration is intentionally compatible with the core schema and does not duplicate entities.

CREATE TABLE IF NOT EXISTS table_layouts (
    table_id INTEGER PRIMARY KEY REFERENCES dining_tables(id),
    shape TEXT NOT NULL DEFAULT 'round',
    pos_x REAL NOT NULL DEFAULT 0,
    pos_y REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modifier_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL UNIQUE,
    is_required INTEGER NOT NULL DEFAULT 0 CHECK(is_required IN (0,1)),
    min_select INTEGER NOT NULL DEFAULT 0 CHECK(min_select >= 0),
    max_select INTEGER NOT NULL DEFAULT 1 CHECK(max_select >= min_select),
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE IF NOT EXISTS modifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES modifier_groups(id),
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL,
    price_delta INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE IF NOT EXISTS menu_item_modifier_groups (
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    modifier_group_id INTEGER NOT NULL REFERENCES modifier_groups(id),
    PRIMARY KEY (menu_item_id, modifier_group_id)
);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id),
    modifier_id INTEGER NOT NULL REFERENCES modifiers(id),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    unit_price INTEGER NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0,
    UNIQUE(order_item_id, modifier_id)
);

CREATE INDEX IF NOT EXISTS idx_modifiers_group ON modifiers(group_id);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifier_groups ON menu_item_modifier_groups(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON order_item_modifiers(order_item_id);
