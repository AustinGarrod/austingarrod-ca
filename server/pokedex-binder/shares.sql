CREATE TABLE IF NOT EXISTS accounts_binder_shares (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 binder_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version BIGINT UNSIGNED NOT NULL,
 token CHAR(68) CHARACTER SET ascii COLLATE ascii_bin NULL,
 PRIMARY KEY (user_id, binder_key),
 UNIQUE (token),
 FOREIGN KEY (user_id) REFERENCES accounts_users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
