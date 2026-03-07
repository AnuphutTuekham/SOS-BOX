```sqlite
CREATE TABLE `sosbox` (
	`id` INTEGER PRIMARY KEY AUTOINCREMENT,
	`name` TEXT,
	`lat` REAL,
	`lon` REAL,
	`status` TEXT,
	`batt` INTEGER,
	`wifi_count` INTEGER DEFAULT 0,
	`created_at` TEXT
)
```
CREATE TABLE `sosbox` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT, `lat` REAL, `lon` REAL, `status` TEXT, `batt` INTEGER, `created_at` TEXT)