CREATE TABLE IF NOT EXISTS accounts_schema_migrations (version INT UNSIGNED PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_users (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_identities (
 provider VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(provider,subject), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_sessions (
 token_hash BINARY(32) PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 csrf_token CHAR(64) CHARACTER SET ascii NOT NULL,
 created_at BIGINT UNSIGNED NOT NULL, seen_at BIGINT UNSIGNED NOT NULL,
 INDEX(user_id), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_challenges (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 session_hash BINARY(32) NOT NULL,
 email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 code_hash BINARY(32) NOT NULL,
 expires_at BIGINT UNSIGNED NOT NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 consumed_at BIGINT UNSIGNED NULL,
 pending_google VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
 INDEX(session_hash)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_oauth (
 state_hash BINARY(32) PRIMARY KEY, session_hash BINARY(32) NOT NULL,
 nonce CHAR(64) CHARACTER SET ascii NOT NULL, verifier VARCHAR(128) CHARACTER SET ascii NOT NULL,
 return_to VARCHAR(1024) NOT NULL,
 link_user CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 expires_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_pending_google (
 session_hash BINARY(32) PRIMARY KEY,
 subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expires_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_rate_limits (
 bucket BINARY(32) PRIMARY KEY, window_start BIGINT UNSIGNED NOT NULL, request_count INT UNSIGNED NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_documents (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 app VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 document VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version INT UNSIGNED NOT NULL,
 revision BIGINT UNSIGNED NOT NULL,
 state_json MEDIUMTEXT NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY account_document(user_id,app,document), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS accounts_document_clients (
 resource_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 acknowledged_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(resource_id,client_id), FOREIGN KEY(resource_id) REFERENCES accounts_documents(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_operations (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(32) CHARACTER SET ascii NOT NULL, payload_hash BINARY(32) NOT NULL,
 result_json MEDIUMTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,operation_id), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS accounts_migration_stages (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 migration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 app VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 document VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 variant VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 schema_version INT UNSIGNED NOT NULL, base_revision BIGINT UNSIGNED NOT NULL,
 state_json MEDIUMTEXT NOT NULL, payload_hash BINARY(32) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,migration_id,app,document,variant), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS accounts_recovery (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 app VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 document VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 label VARCHAR(64) CHARACTER SET ascii NOT NULL,
 schema_version INT UNSIGNED NOT NULL, revision BIGINT UNSIGNED NOT NULL,
 state_json MEDIUMTEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(user_id,app,created_at), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS accounts_legacy_claims (
 key_hash BINARY(32) PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 migration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 legacy_binder_id BIGINT UNSIGNED NOT NULL,
 archive_json MEDIUMTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO accounts_schema_migrations(version) VALUES(1);
