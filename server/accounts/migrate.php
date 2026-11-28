<?php

declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

if (PHP_VERSION_ID < 80400) {
    fwrite(STDERR, "Accounts require PHP 8.4 or newer. No migration ran.\n");
    exit(1);
}

require_once dirname(__DIR__, 2).'/public/api/v1/_common.php';
try {
    $config = accounts_config(dirname(__DIR__, 2).'/public', $argv[1] ?? null);
    if ($config === null) {
        throw new RuntimeException();
    }

    $db = accounts_database($config, false);
    // DDL is deliberately explicit and CLI-only; runtime credentials need no DDL.
    foreach ([__DIR__.'/schema.sql', __DIR__.'/../pokedex-binder/stock-alerts.sql', __DIR__.'/../pokedex-binder/shares.sql'] as $file) {
        foreach (explode(';', file_get_contents($file)) as $sql) {
            if (trim($sql) !== '') {
                $db->exec($sql);
            }
        }
    }

    fwrite(STDOUT, "Accounts schema ready; existing data preserved.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Accounts migration failed. Verify private config, database, and setup privileges.\n");
    exit(1);
}
