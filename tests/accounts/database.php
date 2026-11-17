<?php

declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once dirname(__DIR__, 2).'/public/api/v1/_common.php';
try {
    $dsn = (string)getenv('ACCOUNTS_TEST_DSN');
    $name = (string)getenv('ACCOUNTS_TEST_DATABASE');
    $action = $argv[1] ?? '';
    if (!preg_match('/^accounts_test_[a-z0-9_]+$/D', $name) || !str_starts_with($dsn, 'mysql:')) {
        throw new RuntimeException();
    }

    $parts = [];
    foreach (explode(';', substr($dsn, 6)) as $part) {
        $p = explode('=', $part, 2);
        if (count($p) === 2) {
            $parts[strtolower(trim($p[0]))] = trim($p[1]);
        }

    }

    if (!in_array($parts['host'] ?? '', ['127.0.0.1', 'localhost', '::1'], true) || isset($parts['unix_socket'])) {
        throw new RuntimeException();
    }
    unset($parts['dbname']);
    $admin = 'mysql:'.implode(';', array_map(fn ($k, $v) => $k.'='.$v, array_keys($parts), array_values($parts)));
    $db = new PDO($admin, getenv('ACCOUNTS_TEST_USER') ?: 'root', getenv('ACCOUNTS_TEST_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    if ($action === 'drop') {
        $db->exec('DROP DATABASE IF EXISTS `'.$name.'`');
        exit;
    }

    if ($action === 'create') {
        $db->exec('CREATE DATABASE `'.$name.'` CHARACTER SET utf8mb4');
        $db->exec('USE `'.$name.'`');
        foreach (['server/pokedex-binder/schema.sql', 'server/accounts/schema.sql'] as $file) {
            foreach (explode(';', file_get_contents(dirname(__DIR__, 2).'/'.$file)) as $sql) {
                if (trim($sql) !== '') {
                    $db->exec($sql);
                }

            }

        }
        echo "Local accounts database ready.\n";
        exit;
    }

    $db->exec('USE `'.$name.'`');
    if ($action === 'audit') {
        echo json_encode(['retainedLegacy' => (int)$db->query('SELECT COUNT(*) FROM pokedex_binders WHERE deleted_at IS NOT NULL AND state_json IS NOT NULL')->fetchColumn(), 'claims' => (int)$db->query('SELECT COUNT(*) FROM accounts_legacy_claims')->fetchColumn(), 'recoveries' => (int)$db->query('SELECT COUNT(*) FROM accounts_recovery')->fetchColumn(), 'users' => (int)$db->query('SELECT COUNT(*) FROM accounts_users')->fetchColumn()], JSON_THROW_ON_ERROR);
        exit;
    }

    if ($action === 'expire-challenges') {
        $db->exec('UPDATE accounts_challenges SET expires_at=0');
        exit;
    }

    if (in_array($action, ['seed-pending-google', 'read-google-identity'], true)) {
        // CLI-only fixtures within the generated loopback test database. The
        // production API has no OIDC/mock-auth bypass or fixture action.
        $subject = (string)getenv('ACCOUNTS_TEST_GOOGLE_SUBJECT');
        if (!preg_match('/^browser-fixture-[a-f0-9-]{36}$/D', $subject)) {
            throw new RuntimeException();
        }
        if ($action === 'read-google-identity') {
            $owner = accounts_query($db, "SELECT user_id FROM accounts_identities WHERE provider='google' AND subject=?", [$subject])->fetchColumn();
            echo json_encode(['userId' => $owner === false ? null : $owner], JSON_THROW_ON_ERROR);
            exit;
        }
        $token = (string)getenv('ACCOUNTS_TEST_SESSION_TOKEN');
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) {
            throw new RuntimeException();
        }
        $sessionHash = hash('sha256', $token, true);
        $user = accounts_query($db, 'SELECT u.id,u.email FROM accounts_sessions s JOIN accounts_users u ON u.id=s.user_id WHERE s.token_hash=?', [$sessionHash])->fetch();
        if (!is_array($user) || !str_ends_with($user['email'], '@example.test')) {
            throw new RuntimeException();
        }
        accounts_query($db, 'INSERT INTO accounts_pending_google(session_hash,subject,email,expires_at) VALUES(?,?,?,?)', [$sessionHash, $subject, $user['email'], time() + 600]);
        $config = accounts_config(dirname(__DIR__, 2).'/public');
        if ($config === null || !str_contains($config['dsn'], ';dbname='.$name)) {
            throw new RuntimeException();
        }
        // Only advance this dummy mailbox's resend window, avoiding another
        // minute of fixture waiting. Actual SMTP and OTP verification still run.
        $resendBucket = hash_hmac('sha256', 'email-resend|'.$user['email'], $config['secret'], true);
        accounts_query($db, 'DELETE FROM accounts_rate_limits WHERE bucket=?', [$resendBucket]);
        echo json_encode(['userId' => $user['id'], 'email' => $user['email']], JSON_THROW_ON_ERROR);
        exit;
    }

    throw new RuntimeException();
} catch (Throwable $e) {
    fwrite(STDERR, "Isolated accounts database setup failed. Check loopback DSN and permissions.\n");
    exit(1);
}
