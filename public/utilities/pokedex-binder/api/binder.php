<?php
declare(strict_types=1);
http_response_code(410);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
echo json_encode(['error' => ['code' => 'key_sync_retired', 'message' => 'Private-key sync has retired. Open Pokédex Binder to export your device copy or connect an account.']]);
