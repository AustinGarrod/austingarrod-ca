CREATE TABLE IF NOT EXISTS accounts_mcp_flows (
 id_hash BINARY(32) PRIMARY KEY, browser_hash BINARY(32) NOT NULL,
 request_json TEXT NOT NULL, expires_at BIGINT UNSIGNED NOT NULL, INDEX(expires_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_mcp_grants (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 app VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 client_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 can_write BOOLEAN NOT NULL, created_at BIGINT UNSIGNED NOT NULL,
 expires_at BIGINT UNSIGNED NOT NULL, revoked_at BIGINT UNSIGNED NULL,
 INDEX(user_id, revoked_at), INDEX(expires_at), FOREIGN KEY(user_id) REFERENCES accounts_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_mcp_tokens (
 token_hash BINARY(32) PRIMARY KEY,
 grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expires_at BIGINT UNSIGNED NOT NULL, used_at BIGINT UNSIGNED NULL,
 code_json TEXT NULL, INDEX(expires_at), INDEX(grant_id),
 FOREIGN KEY(grant_id) REFERENCES accounts_mcp_grants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS accounts_mcp_previews (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_json MEDIUMTEXT NOT NULL, receipt_json TEXT NULL,
 expires_at BIGINT UNSIGNED NOT NULL, INDEX(expires_at), INDEX(grant_id),
 FOREIGN KEY(grant_id) REFERENCES accounts_mcp_grants(id) ON DELETE CASCADE
) ENGINE=InnoDB;
