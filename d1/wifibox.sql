CREATE TABLE sosbox (
  id INTEGER PRIMARY KEY,
  name TEXT,
  lat REAL,
  lon REAL,
  status TEXT,
  batt INTEGER,
  wifi_count INTEGER DEFAULT 0,
  created_at TEXT
);
