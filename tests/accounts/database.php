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

    throw new RuntimeException();
} catch (Throwable $e) {
    fwrite(STDERR, "Isolated accounts database setup failed. Check loopback DSN and permissions.\n");
    exit(1);
}
