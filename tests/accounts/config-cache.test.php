<?php

declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2).'/public/api/v1/_common.php';
function cache_check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }

cache_check(function_exists('opcache_get_status') && is_array(opcache_get_status(false)), 'A real enabled OPcache is required for this regression');
cache_check(!filter_var(ini_get('opcache.validate_timestamps'), FILTER_VALIDATE_BOOLEAN), 'Timestamp validation must be disabled to exercise stale compiled flags');
$directory = sys_get_temp_dir().'/accounts-config-cache-'.bin2hex(random_bytes(12));
cache_check(mkdir($directory, 0700), 'Private fixture directory creation failed');
$path = $directory.'/accounts.php';
$mtime = time() - 60;
$base = ['enabled' => true, 'migrationEnabled' => true, 'dsn' => 'mysql:host=127.0.0.1;dbname=unused',
    'username' => 'fixture', 'password' => '', 'secret' => str_repeat('a', 64), 'allowedOrigin' => 'https://example.test'];
$write = function (array $value) use ($path, $mtime): void {
    file_put_contents($path, '<?php return '.var_export($value, true).';');
    chmod($path, 0600); touch($path, $mtime); clearstatcache(true, $path);
};
$webroot = dirname(__DIR__, 2).'/public';
try {
    $write($base);
    cache_check(opcache_compile_file($path) && opcache_is_script_cached($path), 'Original private config did not enter the actual opcode cache');
    $write([...$base, 'enabled' => false, 'migrationEnabled' => false]);
    cache_check((require $path)['enabled'] === true, 'Control require did not reproduce stale enabled flags');
    if (($argv[1] ?? '') === 'restricted') {
        $closed = false;
        try { accounts_config($webroot, $path); } catch (RuntimeException) { $closed = true; }
        cache_check($closed, 'Unverifiable active OPcache must fail closed instead of using old enabled flags');
        echo "Restricted OPcache regression passed: stale enabled config fails closed when invalidation is unavailable.\n";
        return;
    }
    $current = accounts_config($webroot, $path);
    cache_check($current !== null && !$current['enabled'] && !$current['migrationEnabled'], 'Public disable must bypass stale compiled configuration immediately');

    $_SERVER['REMOTE_ADDR'] = '192.0.2.10';
    $preview = [...$base, 'enabled' => false, 'migrationEnabled' => false,
        'preview' => ['enabled' => true, 'migrationEnabled' => true, 'addresses' => ['192.0.2.10']]];
    $write($preview);
    cache_check(accounts_config($webroot, $path)['migrationEnabled'], 'Operator preview did not enable normally');
    opcache_compile_file($path);
    $preview['preview']['enabled'] = false;
    $preview['preview']['migrationEnabled'] = false;
    $write($preview);
    cache_check((require $path)['preview']['enabled'] === true, 'Control require did not retain the prior preview');
    $current = accounts_config($webroot, $path);
    cache_check(!$current['enabled'] && !$current['migrationEnabled'] && !$current['previewActive'], 'Preview disable must bypass stale compiled configuration immediately');
    cache_check(filemtime($path) === $mtime, 'Fixture must retain its original mtime');
    unlink($path); clearstatcache(true, $path);
    cache_check(accounts_config($webroot, $path) === null, 'A missing private config must never reuse its cached contents');
    echo "Real OPcache regression passed: public/preview disable and missing private config are immediately effective.\n";
} finally {
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
    if (is_file($path)) unlink($path);
    rmdir($directory);
}
