<?php
declare(strict_types=1);
require_once dirname(__DIR__, 3) . '/reporting/bootstrap.php';
ini_set('serialize_precision', '-1');

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const CACHE_TTL_SECONDS = 86400;
const MIN_UPSTREAM_INTERVAL_MICROSECONDS = 1000000;

function json_response(array $payload, int $status = 200, array $extraHeaders = []): never
{
    if (function_exists('Sentry\\logger')) \Sentry\logger()->info('Geocode response', [], ['status' => $status, 'result_count' => count($payload['results'] ?? []), 'cache_hit' => $GLOBALS['geocodeCacheHit'] ?? false, 'upstream_status' => $GLOBALS['upstreamStatus'] ?? null]);
    if ($status >= 500 || $status === 429) report_failure('geocode.' . ($GLOBALS['geocodeStage'] ?? 'validation'), ['status' => $status, 'upstream_status' => $GLOBALS['upstreamStatus'] ?? null, 'duration_seconds' => $GLOBALS['upstreamTiming'] ?? null], $GLOBALS['geocodeCause'] ?? null);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    foreach ($extraHeaders as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'Method not allowed.'], 405, ['Cache-Control' => 'no-store']);
}

$queryValue = $_GET['q'] ?? '';
if (!is_string($queryValue)) {
    json_response(['error' => 'Enter a valid place or address.'], 400, ['Cache-Control' => 'no-store']);
}

$query = trim($queryValue);
$queryLength = strlen($query);
if ($queryLength < 2) {
    json_response(['error' => 'Enter at least 2 characters.'], 400, ['Cache-Control' => 'no-store']);
}
if ($queryLength > 200) {
    json_response(['error' => 'Keep the search under 200 characters.'], 400, ['Cache-Control' => 'no-store']);
}

$acceptLanguage = substr((string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? 'en'), 0, 96);
$geocodeStage = 'cache.directory';
$acceptLanguage = preg_replace('/[^A-Za-z0-9,;=.\-* ]/', '', $acceptLanguage) ?: 'en';
$cacheDirectory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'austingarrod-radius-map';
if (!is_dir($cacheDirectory) && !mkdir($cacheDirectory, 0700, true) && !is_dir($cacheDirectory)) {
    json_response(['error' => 'Location search is temporarily unavailable.'], 503, ['Cache-Control' => 'no-store']);
}

$cacheKey = hash('sha256', 'v3|' . strtolower($query) . '|' . strtolower($acceptLanguage));
$cacheFile = $cacheDirectory . DIRECTORY_SEPARATOR . $cacheKey . '.json';

function read_cached_results(string $path): ?array
{
    if (!is_file($path)) {
        return null;
    }
    $raw = file_get_contents($path);
    if ($raw === false) {
        return null;
    }
    $cached = json_decode($raw, true);
    if (!is_array($cached) || !isset($cached['expiresAt'], $cached['results']) || !is_array($cached['results'])) {
        return null;
    }
    return (int) $cached['expiresAt'] > time() ? $cached['results'] : null;
}

$cachedResults = read_cached_results($cacheFile);
$geocodeCacheHit = $cachedResults !== null;
if ($cachedResults !== null) {
    json_response(['results' => $cachedResults], 200, ['Cache-Control' => 'public, max-age=300']);
}

if (!function_exists('curl_init')) {
    $geocodeStage = 'curl.unavailable';
    json_response(['error' => 'Location search is temporarily unavailable.'], 503, ['Cache-Control' => 'no-store']);
}

$lockPath = $cacheDirectory . DIRECTORY_SEPARATOR . 'upstream-rate.lock';
$geocodeStage = 'upstream.lock';
$lockHandle = fopen($lockPath, 'c+');
if ($lockHandle === false || !flock($lockHandle, LOCK_EX)) {
    if (is_resource($lockHandle)) {
        fclose($lockHandle);
    }
    json_response(['error' => 'Location search is busy. Please try again.'], 503, ['Cache-Control' => 'no-store']);
}

$cachedResults = read_cached_results($cacheFile);
if ($cachedResults !== null) {
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    json_response(['results' => $cachedResults], 200, ['Cache-Control' => 'public, max-age=300']);
}

rewind($lockHandle);
$lastRequestRaw = stream_get_contents($lockHandle);
$lastRequestAt = is_string($lastRequestRaw) ? (float) trim($lastRequestRaw) : 0.0;
$waitSpan = reporting_span('geocode.rate-limit-wait');
$elapsedMicroseconds = (int) ((microtime(true) - $lastRequestAt) * 1000000);
if ($lastRequestAt > 0 && $elapsedMicroseconds < MIN_UPSTREAM_INTERVAL_MICROSECONDS) {
    usleep(MIN_UPSTREAM_INTERVAL_MICROSECONDS - max(0, $elapsedMicroseconds));
}
$waitSpan?->finish();

ftruncate($lockHandle, 0);
rewind($lockHandle);
fwrite($lockHandle, sprintf('%.6F', microtime(true)));
fflush($lockHandle);

$upstreamUrl = NOMINATIM_SEARCH_URL . '?' . http_build_query([
    'format' => 'jsonv2',
    'limit' => 5,
    'q' => $query,
]);
$retryAfter = null;
$geocodeStage = 'upstream.request';
$curl = curl_init($upstreamUrl);
if ($curl === false) {
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
    json_response(['error' => 'Location search is temporarily unavailable.'], 502, ['Cache-Control' => 'no-store']);
}

curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'Accept-Language: ' . $acceptLanguage,
        'User-Agent: AustinGarrodRadiusMap/1.0 (+https://austingarrod.ca/utilities/radius-map/)',
    ],
    CURLOPT_HEADERFUNCTION => static function ($curlHandle, string $headerLine) use (&$retryAfter): int {
        if (stripos($headerLine, 'Retry-After:') === 0) {
            $retryAfter = trim(substr($headerLine, strlen('Retry-After:')));
        }
        return strlen($headerLine);
    },
]);

$upstreamSpan = reporting_span('http.client.nominatim');
$upstreamBody = curl_exec($curl);
$curlError = curl_error($curl);
$curlErrno = curl_errno($curl);
$upstreamTiming = curl_getinfo($curl, CURLINFO_TOTAL_TIME);
$upstreamStatus = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$curlFailed = $upstreamBody === false;
$upstreamSpan?->setData(['http.response.status_code' => $upstreamStatus, 'duration_seconds' => $upstreamTiming, 'curl_errno' => $curlErrno]);
$upstreamSpan?->finish();
curl_close($curl);
flock($lockHandle, LOCK_UN);
fclose($lockHandle);

if ($curlFailed) {
    $geocodeStage = 'upstream.transport';
    $geocodeCause = new RuntimeException('cURL ' . $curlErrno . ': ' . $curlError);
    json_response(['error' => 'Location search is temporarily unavailable.'], 502, ['Cache-Control' => 'no-store']);
}
if ($upstreamStatus === 429) {
    $geocodeStage = 'upstream.rate-limit';
    $headers = ['Cache-Control' => 'no-store'];
    if (is_string($retryAfter) && preg_match('/^[0-9]+$/', $retryAfter)) {
        $headers['Retry-After'] = $retryAfter;
    }
    json_response(['error' => 'Search is busy. Please wait a moment and try again.'], 429, $headers);
}
if ($upstreamStatus < 200 || $upstreamStatus >= 300) {
    $geocodeStage = 'upstream.status';
    json_response(['error' => 'Location search is temporarily unavailable.'], 502, ['Cache-Control' => 'no-store']);
}

$rows = json_decode((string) $upstreamBody, true);
$geocodeStage = 'upstream.decode';
if (!is_array($rows)) {
    $geocodeCause = json_last_error() !== JSON_ERROR_NONE
        ? new JsonException(json_last_error_msg(), json_last_error())
        : new UnexpectedValueException('Nominatim returned ' . get_debug_type($rows) . ' instead of an array.');
    json_response(['error' => 'Location search returned an unexpected response.'], 502, ['Cache-Control' => 'no-store']);
}

$results = [];
foreach ($rows as $row) {
    if (!is_array($row)) {
        continue;
    }
    $label = isset($row['display_name']) && is_string($row['display_name']) ? trim($row['display_name']) : '';
    $latitude = isset($row['lat']) ? (float) $row['lat'] : NAN;
    $longitude = isset($row['lon']) ? (float) $row['lon'] : NAN;
    if ($label === '' || !is_finite($latitude) || !is_finite($longitude) || $latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
        continue;
    }
    $results[] = [
        'id' => isset($row['place_id']) ? (string) $row['place_id'] : $latitude . ',' . $longitude,
        'label' => $label,
        'lat' => round($latitude, 7),
        'lng' => round($longitude, 7),
    ];
    if (count($results) === 5) {
        break;
    }
}

$cachePayload = json_encode([
    'expiresAt' => time() + CACHE_TTL_SECONDS,
    'results' => $results,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if (is_string($cachePayload)) {
    file_put_contents($cacheFile, $cachePayload, LOCK_EX);
}

json_response(['results' => $results], 200, ['Cache-Control' => 'public, max-age=300']);
