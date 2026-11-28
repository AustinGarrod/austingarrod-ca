CREATE TABLE IF NOT EXISTS accounts_binder_stock_alerts (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 store VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 minimum TINYINT UNSIGNED NOT NULL,
 enabled TINYINT UNSIGNED NOT NULL DEFAULT 1,
 revision CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 next_check_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
 last_checked_at BIGINT UNSIGNED NULL,
 last_sent_at BIGINT UNSIGNED NULL,
 notified_json MEDIUMTEXT NOT NULL,
 PRIMARY KEY (user_id, store),
 INDEX (enabled, next_check_at, user_id, store),
 FOREIGN KEY (user_id) REFERENCES accounts_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accounts_binder_stock_observations (
 store VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 printing CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 next_check_at BIGINT UNSIGNED NOT NULL,
 checked_at BIGINT UNSIGNED NULL,
 offer_json TEXT NULL,
 PRIMARY KEY (store, printing),
 INDEX (next_check_at)
) ENGINE=InnoDB;
