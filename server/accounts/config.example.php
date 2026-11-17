<?php

// Install as ~/private/accounts.php, outside public_html, owner-readable only.
return [
    'enabled' => false,
    'migrationEnabled' => false,
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
