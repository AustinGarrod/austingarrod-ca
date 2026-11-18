<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/public/utilities/pokedex-binder/api/_library.php';
try {
    $config = pokedex_configuration(dirname(__DIR__, 2) . '/public', $argv[1] ?? null);
    $database = new PDO($config['dsn'], $config['username'], $config['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]);
    $sql = file_get_contents(__DIR__ . '/schema.sql');
    if (!is_string($sql)) throw new RuntimeException('Schema unavailable.');
    foreach (explode(';', $sql) as $statement) if (trim($statement) !== '') $database->exec($statement);
    if ((int) $database->query('SELECT MAX(version) FROM pokedex_schema_migrations')->fetchColumn() !== 1) throw new RuntimeException('Unsupported schema.');
    fwrite(STDOUT, "Pokedex binder schema version 1 is ready. Existing binders were preserved.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Database setup failed. Check the private config, PDO MySQL extension, connection, and DDL permissions.\n");
    exit(1);
}
