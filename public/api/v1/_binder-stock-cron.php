<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

if (PHP_VERSION_ID < 80400) {
    fwrite(STDERR, "Stock alerts require PHP 8.4 or newer.\n");
    exit(1);
}

require_once __DIR__.'/_binder-stock-worker.php';
try {
    $root = dirname(__DIR__, 2);
    $config = accounts_config($root);
    if ($config === null || !$config['enabled'] || !is_array($config['smtp'] ?? null) || !extension_loaded('curl')) {
        throw new RuntimeException();
    }
    accounts_vendor($root);
    $db = accounts_database($config);
    if (($argv[1] ?? '') === '--check') {
        foreach (['accounts_binder_stock_alerts', 'accounts_binder_stock_observations'] as $table) {
            $db->query("SELECT 1 FROM $table LIMIT 1");
            $db->exec("INSERT INTO $table SELECT * FROM $table WHERE 1=0");
            $db->exec("UPDATE $table SET next_check_at=next_check_at WHERE 1=0");
            $db->exec("DELETE FROM $table WHERE 1=0");
        }
        echo gmdate(DATE_ATOM)." Stock alerts ready.\n";
        exit;
    }

    $lock = binder_offer_state_file('stock-alerts-worker');
    if ($lock === false) throw new RuntimeException();
    if (!flock($lock, LOCK_EX | LOCK_NB)) exit;
    try {
        echo gmdate(DATE_ATOM).' Stock alerts: '.binder_stock_run($db, $config, $root).".\n";
    } finally {
        fclose($lock);
    }
} catch (Throwable) {
    fwrite(STDERR, gmdate(DATE_ATOM)." Stock alert worker failed.\n");
    exit(1);
}
