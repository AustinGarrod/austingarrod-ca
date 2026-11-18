<?php
declare(strict_types=1);
// Copy OUTSIDE public_html to ~/private/pokedex-binder.php, chmod 0600.
// Generate rateLimitSecret with: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
return [
    'dsn' => 'mysql:host=localhost;dbname=CPANEL_DATABASE;charset=utf8mb4',
    'username' => 'CPANEL_DATABASE_USER',
    'password' => 'REPLACE_WITH_DATABASE_PASSWORD',
    'rateLimitDirectory' => '/home/CPANEL_USER/private/pokedex-rate-limits',
    'rateLimitSecret' => 'REPLACE_ME',
    'allowedOrigin' => 'https://austingarrod.ca',
];
