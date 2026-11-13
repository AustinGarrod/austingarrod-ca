<?php
declare(strict_types=1);
// Only the localhost integration harness calls this helper.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
try {
    $dsn = (string) getenv('POKEDEX_TEST_DSN');
    $name = (string) getenv('POKEDEX_TEST_DATABASE');
    if (!preg_match('/^pokedex_test_[a-z0-9_]+$/D', $name) || strpos($dsn, 'mysql:') !== 0) throw new RuntimeException('Use an isolated localhost test database.');
    $parts = [];
    foreach (explode(';', substr($dsn, 6)) as $part) {
        $pair = explode('=', $part, 2);
        if (count($pair) === 2) $parts[strtolower(trim($pair[0]))] = trim($pair[1]);
    }
    if (!in_array($parts['host'] ?? '', ['127.0.0.1', 'localhost', '::1'], true) || isset($parts['unix_socket'])) throw new RuntimeException('Only localhost is allowed.');
    unset($parts['dbname']);
    $adminDsn = 'mysql:' . implode(';', array_map(static fn($key, $value) => $key . '=' . $value, array_keys($parts), array_values($parts)));
    $database = new PDO($adminDsn, getenv('POKEDEX_TEST_USER') ?: 'root', getenv('POKEDEX_TEST_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $action = $argv[1] ?? '';
    if ($action === 'drop') { $database->exec('DROP DATABASE IF EXISTS `' . $name . '`'); exit; }
    if ($action === 'audit') {
        $database->exec('USE `' . $name . '`');
        echo json_encode([
            'tombstones' => (int) $database->query('SELECT COUNT(*) FROM pokedex_binders WHERE deleted_at IS NOT NULL')->fetchColumn(),
            'retainedDeletedStates' => (int) $database->query('SELECT COUNT(*) FROM pokedex_binders WHERE deleted_at IS NOT NULL AND state_json IS NOT NULL')->fetchColumn(),
            'retainedDeletedClients' => (int) $database->query('SELECT COUNT(*) FROM pokedex_binder_clients c JOIN pokedex_binders b ON b.id = c.binder_id WHERE b.deleted_at IS NOT NULL')->fetchColumn(),
        ], JSON_THROW_ON_ERROR);
        exit;
    }
    if ($action !== 'create') throw new RuntimeException('Unsupported action.');
    $database->exec('CREATE DATABASE `' . $name . '` CHARACTER SET utf8mb4');
    $database->exec('USE `' . $name . '`');
    foreach (explode(';', file_get_contents(dirname(__DIR__) . '/server/pokedex-binder/schema.sql')) as $statement) if (trim($statement) !== '') $database->exec($statement);
    echo "Isolated localhost database ready.\n";
} catch (Throwable $error) {
    fwrite(STDERR, "Local test database setup failed. Check the localhost DSN, PDO MySQL, and database permissions.\n");
    exit(1);
}
