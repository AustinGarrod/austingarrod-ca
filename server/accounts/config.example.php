<?php

// Install as ~/private/accounts.php, outside public_html, owner-readable only.
return [
    'enabled' => false,
    'migrationEnabled' => false,
    // On HostPapa, an optional sibling utility-mcp.json overrides these flags.
    'mcp' => [
        'pokedex-binder' => ['enabled' => false, 'previewAccounts' => []],
        'idle-slayer-companion' => ['enabled' => false, 'previewAccounts' => []],
    ],
    // Temporary operator-only live checks; exact REMOTE_ADDR IP literals only.
    // Clear these addresses and disable preview after the public rollout.
    'preview' => ['enabled' => false, 'migrationEnabled' => false, 'addresses' => []],
    // MUST be the existing Binder database for atomic migration/key revocation.
    'dsn' => 'mysql:host=localhost;dbname=CPANEL_DATABASE;charset=utf8mb4',
    'username' => 'CPANEL_ACCOUNTS_RUNTIME_USER',
    'password' => 'REPLACE_ME',
    'secret' => 'REPLACE_WITH_64_RANDOM_HEX_CHARACTERS',
    'allowedOrigin' => 'https://austingarrod.ca',
    'smtp' => [
        'host' => 'mail.austingarrod.ca', 'port' => 465, 'encryption' => 'smtps',
        'username' => 'accounts@austingarrod.ca', 'password' => 'REPLACE_ME',
        'from' => 'accounts@austingarrod.ca', 'name' => 'AustinGarrod.ca',
    ],
    'google' => ['clientId' => '', 'clientSecret' => ''],
];
