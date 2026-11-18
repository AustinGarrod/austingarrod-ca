<?php

declare(strict_types=1);
// Test router only. Not beneath public/, not included in the deployment, and
// started explicitly by the loopback integration runner. It cannot mutate files.
if (PHP_SAPI !== 'cli-server' || ($_SERVER['REMOTE_ADDR'] ?? '') !== '127.0.0.1') {
    http_response_code(404); exit;
}
require_once dirname(__DIR__, 2).'/public/api/v1/_common.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');
$active = function_exists('opcache_get_status') && is_array(opcache_get_status(false));
$meta = ['sapi' => PHP_SAPI, 'cacheActive' => $active,
    'enableCli' => filter_var(ini_get('opcache.enable_cli'), FILTER_VALIDATE_BOOLEAN),
    'validateTimestamps' => filter_var(ini_get('opcache.validate_timestamps'), FILTER_VALIDATE_BOOLEAN)];
if (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) === '/health') {
    echo json_encode($meta, JSON_THROW_ON_ERROR); exit;
}
$path = (string)getenv('ACCOUNTS_CACHE_HTTP_CONFIG');
$webroot = (string)getenv('ACCOUNTS_CACHE_HTTP_WEBROOT');
$action = $_GET['action'] ?? '';
try {
    if (!is_file($path) && $action === 'control') throw new RuntimeException('Missing local fixture');
    if ($action === 'control') {
        if (!$active || !function_exists('opcache_compile_file') || !opcache_compile_file($path)) {
            throw new RuntimeException('Actual OPcache compilation required');
        }
        $value = require $path;
    } elseif ($action === 'production') {
        $value = accounts_config($webroot, $path);
    } else {
        throw new RuntimeException('Unknown local fixture action');
    }
    $result = $meta + ['closed' => false, 'missing' => $value === null,
        'cached' => function_exists('opcache_is_script_cached') && opcache_is_script_cached($path)];
    if (is_array($value)) $result += [
        'enabled' => $value['enabled'] ?? null, 'migrationEnabled' => $value['migrationEnabled'] ?? null,
        'previewEnabled' => $value['preview']['enabled'] ?? false,
        'previewMigrationEnabled' => $value['preview']['migrationEnabled'] ?? false,
        'previewActive' => $value['previewActive'] ?? false,
    ];
    echo json_encode($result, JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    echo json_encode($meta + ['closed' => true], JSON_THROW_ON_ERROR);
}
