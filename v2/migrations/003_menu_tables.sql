-- Menu, sections, and tables.
-- Table identity is table.id; num is only the human-facing number within a section.

CREATE TABLE IF NOT EXISTS table_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    table_number INTEGER NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 4,
    shape TEXT NOT NULL DEFAULT 'round',
    pos_x REAL NOT NULL DEFAULT 0,
    pos_y REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES table_sections(id),
    UNIQUE(section_id, table_number)
);

CREATE TABLE IF NOT EXISTS menu_categories_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL,
    description_key TEXT,
    price_minor INTEGER NOT NULL DEFAULT 0,
    cost_minor INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    emoji TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES menu_categories_v2(id),
    CHECK(price_minor >= 0),
    CHECK(cost_minor >= 0)
);

CREATE TABLE IF NOT EXISTS modifier_groups_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    min_select INTEGER NOT NULL DEFAULT 0,
    max_select INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    CHECK(min_select >= 0),
    CHECK(max_select >= min_select)
);

CREATE TABLE IF NOT EXISTS modifiers_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    name_key TEXT NOT NULL,
    price_delta_minor INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (group_id) REFERENCES modifier_groups_v2(id)
);

CREATE TABLE IF NOT EXISTS menu_item_modifier_groups_v2 (
    menu_item_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    PRIMARY KEY (menu_item_id, modifier_group_id),
    FOREIGN KEY (menu_item_id) REFERENCES menu_items_v2(id),
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_tables_section ON restaurant_tables(section_id, table_number);
CREATE INDEX IF NOT EXISTS idx_menu_category_v2 ON menu_items_v2(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_modifiers_group_v2 ON modifiers_v2(group_id);
