<?php
declare(strict_types=1);

// Chrome can resolve the reporting host to a LAN address. Forward this binder's
// browser envelopes over HTTPS from the web server, using only the public SDK key.
const REPORTS_KEY = '8b561c6564244066bd2960053ed220cd';
const REPORTS_DSN = 'https://' . REPORTS_KEY . '@reports.garrod.house/8';
const REPORTS_INGEST = 'https://reports.garrod.house/api/8/envelope/?sentry_version=7&sentry_key=' . REPORTS_KEY;
const MAX_ENVELOPE_BYTES = 1024 * 1024;

header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}
if (($_SERVER['HTTP_ORIGIN'] ?? '') !== 'https://austingarrod.ca') {
    http_response_code(403);
    exit;
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_ENVELOPE_BYTES) {
    http_response_code(413);
    exit;
}
$body = file_get_contents('php://input', false, null, 0, MAX_ENVELOPE_BYTES + 1);
if ($body === false || strlen($body) > MAX_ENVELOPE_BYTES) {
    http_response_code($body === false ? 400 : 413);
    exit;
}
$newline = strpos($body, "\n");
$envelope = $newline === false ? null : json_decode(substr($body, 0, $newline), true);
if (($envelope['dsn'] ?? null) !== REPORTS_DSN) {
    http_response_code(400);
    exit;
}
if (!function_exists('curl_init') || !($curl = curl_init(REPORTS_INGEST))) {
    http_response_code(503);
    exit;
}
curl_setopt_array($curl, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => ['Content-Type: application/x-sentry-envelope'],
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADERFUNCTION => static function ($curl, string $line): int {
        if (stripos($line, 'Retry-After:') === 0 || stripos($line, 'X-Sentry-Rate-Limits:') === 0) {
            header(trim($line));
        }
        return strlen($line);
    },
]);
$sent = curl_exec($curl) !== false;
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
http_response_code($sent && $status >= 200 && $status < 600 ? $status : 502);
