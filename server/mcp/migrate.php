<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
if (PHP_VERSION_ID < 80400) {
    fwrite(STDERR, "Utility MCP requires PHP 8.4. No migration ran.\n");
    exit(1);
}
require_once dirname(__DIR__, 2).'/public/api/v1/_common.php';

try {
    $config = accounts_config(dirname(__DIR__, 2).'/public', $argv[1] ?? null);
    if ($config === null) {
        throw new RuntimeException();
    }
    $db = accounts_database($config);
    foreach (explode(';', file_get_contents(__DIR__.'/schema.sql')) as $sql) {
        if (trim($sql) !== '') {
            $db->exec($sql);
        }
    }
    fwrite(STDOUT, "Utility MCP schema ready.\n");
} catch (Throwable) {
    fwrite(STDERR, "Utility MCP migration failed. Check the private config and setup user privileges.\n");
    exit(1);
}
