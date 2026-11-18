<?php

declare(strict_types=1);

$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($route === '/callback') {
    echo 'Local OAuth callback fixture';
    return true;
}
if (str_starts_with($route, '/api/v1/_') || str_starts_with($route, '/reporting/')) {
    http_response_code(403);
    return true;
}
if (str_starts_with($route, '/api/v1/mcp/') || str_starts_with($route, '/.well-known/oauth-')) {
    require $_SERVER['DOCUMENT_ROOT'].'/api/v1/mcp.php';
    return true;
}
return false;
