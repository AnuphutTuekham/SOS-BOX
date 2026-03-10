CREATE TABLE IF NOT EXISTS sosbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    lat REAL,
    lon REAL,
    status TEXT,
    batt INTEGER,
    wifi_count INTEGER DEFAULT 0,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO users (email, password_hash, created_at)
VALUES (
    'superadmin@sosbox.com',
    '973f26a76a4c7e2671be1962e0c5bd61fa704935f262a52aa70826cde7a00a01',
    CURRENT_TIMESTAMP
);