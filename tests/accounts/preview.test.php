<?php

declare(strict_types=1);
require_once dirname(__DIR__, 2).'/public/api/v1/_common.php';

function preview_check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$originalServer = $_SERVER;
try {
    $private = ['enabled' => false, 'migrationEnabled' => false,
        'preview' => ['enabled' => true, 'migrationEnabled' => false, 'addresses' => ['192.0.2.10', '2001:db8::10']]];
    $_SERVER['REMOTE_ADDR'] = '192.0.2.10';
    $effective = accounts_rollout_flags($private);
    preview_check($effective['enabled'] && !$effective['migrationEnabled'] && $effective['previewActive'], 'Selected operator must retain a separate migration gate');
    preview_check(!$private['enabled'] && !$private['migrationEnabled'], 'Computing operator flags must leave public configuration unchanged');
    $private['preview']['migrationEnabled'] = true;
    preview_check(accounts_rollout_flags($private)['migrationEnabled'], 'Explicit preview migration flag must enable operator migration');

    $_SERVER['REMOTE_ADDR'] = '192.0.2.11';
    $_SERVER['HTTP_X_FORWARDED_FOR'] = '192.0.2.10';
    $_SERVER['HTTP_X_REAL_IP'] = '192.0.2.10';
    $_SERVER['HTTP_FORWARDED'] = 'for=192.0.2.10';
    $effective = accounts_rollout_flags($private);
    preview_check(!$effective['enabled'] && !$effective['migrationEnabled'] && !$effective['previewActive'], 'Unlisted client and spoofed forwarding headers must remain disabled');
    unset($_SERVER['REMOTE_ADDR']);
    preview_check(!accounts_rollout_flags($private)['enabled'], 'CLI or a missing remote address cannot grant preview');
    $_SERVER['REMOTE_ADDR'] = '2001:db8::10';
    preview_check(accounts_rollout_flags($private)['enabled'], 'Exact configured IPv6 address must work');
    $_SERVER['REMOTE_ADDR'] = '2001:0db8:0:0:0:0:0:10';
    preview_check(!accounts_rollout_flags($private)['enabled'], 'Preview must match the exact configured server-observed literal');

    $_SERVER['REMOTE_ADDR'] = '192.0.2.10';
    $private['preview']['enabled'] = false;
    preview_check(!accounts_rollout_flags($private)['enabled'], 'Disabled preview must override retained addresses');
    $private['enabled'] = true;
    preview_check(accounts_rollout_flags($private)['enabled'] && !accounts_rollout_flags($private)['migrationEnabled'], 'Public auth and migration flags must remain independent');
    $private['migrationEnabled'] = true;
    preview_check(accounts_rollout_flags($private)['migrationEnabled'], 'Normal public rollout flags must continue working');
    $private['enabled'] = false;
    preview_check(!accounts_rollout_flags($private)['migrationEnabled'], 'Public migration flag cannot bypass disabled public auth or a disabled preview');

    foreach ([['enabled' => 'true'], ['migrationEnabled' => 1], ['addresses' => ['192.0.2.0/24']], ['addresses' => ['operator.example']], ['addresses' => [null]], ['addresses' => ['name' => '192.0.2.10']], ['unknown' => true]] as $invalid) {
        $caught = false;
        try { accounts_rollout_flags(['preview' => $invalid]); } catch (RuntimeException) { $caught = true; }
        preview_check($caught, 'Invalid private preview configuration must fail closed');
    }
    echo "Private operator preview gates passed; no login or ownership bypass.\n";
} finally {
    $_SERVER = $originalServer;
}
