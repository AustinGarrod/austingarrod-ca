<?php

declare(strict_types=1);

const BINDER_SHOPIFY_TOKEN_LIFETIME = 3600;
const BINDER_SHOPIFY_REFRESH_MARGIN = 60;
const BINDER_SHOPIFY_TOKEN_RETRY = 10;
const BINDER_SHOPIFY_TOKEN_BUFFER = 32768;

function binder_shopify_config(string $webroot): ?array
{
    $root = realpath($webroot);
    if ($root === false || !is_dir($root)) {
        return null;
    }
    $directory = dirname($root) . '/private';
    $normalized = static fn(string $path): string => DIRECTORY_SEPARATOR === '\\'
        ? strtolower(str_replace('\\', '/', $path)) : $path;
    $resolved = realpath($directory);
    if ($resolved === false || !is_dir($resolved) || $normalized($directory) !== $normalized($resolved)) {
        return null;
    }

    $path = $directory . '/shopify-catalog.json';
    if (is_link($path) || !is_file($path)) {
        return null;
    }
    if (DIRECTORY_SEPARATOR !== '\\') {
        $directoryMode = @fileperms($directory);
        $fileMode = @fileperms($path);
        if ($directoryMode === false || ($directoryMode & 0022) !== 0 || $fileMode === false || ($fileMode & 0077) !== 0) {
            return null;
        }
    }
    $raw = @file_get_contents($path, false, null, 0, 4097);
    $config = is_string($raw) && strlen($raw) <= 4096 ? json_decode($raw, true, 8) : null;
    if (!is_array($config) || !binder_shopify_credential($config['client_id'] ?? null)
        || !binder_shopify_credential($config['client_secret'] ?? null)) {
        return null;
    }
    return ['clientId' => $config['client_id'], 'secret' => $config['client_secret'], 'cache' => $directory . '/shopify-catalog-token.json'];
}

function binder_shopify_credential(mixed $value, int $limit = 512): bool
{
    return is_string($value) && strlen($value) <= $limit && preg_match('~\A[A-Za-z0-9._\~+/=-]+\z~D', $value) === 1;
}

function binder_shopify_buyer_ip(array $server): ?string
{
    $remote = $server['REMOTE_ADDR'] ?? null;
    $packed = is_string($remote) ? @inet_pton($remote) : false;
    if ($packed === false) {
        return null;
    }
    if (strlen($packed) === 16 && str_starts_with($packed, str_repeat(chr(0), 10) . "\xff\xff")) {
        $packed = substr($packed, 12);
    }
    $first = ord($packed[0]);
    if (strlen($packed) === 4 ? ($first & 0xf0) === 0xe0 : $first === 0xff) {
        return null;
    }
    $ip = inet_ntop($packed);
    return is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE) !== false ? $ip : null;
}

function binder_shopify_token_response(string $body, int $now): ?array
{
    $decoded = json_decode($body, true, 16);
    $bearer = $decoded['access_token'] ?? null;
    if (!binder_shopify_credential($bearer, 8192)) {
        return null;
    }
    $expiry = $now + BINDER_SHOPIFY_TOKEN_LIFETIME;
    $expiresIn = $decoded['expires_in'] ?? null;
    if (isset($expiresIn)) {
        if (!is_int($expiresIn) || $expiresIn <= 0) {
            return null;
        }
        $expiry = $now + min(BINDER_SHOPIFY_TOKEN_LIFETIME, $expiresIn);
    }
    $parts = explode('.', $bearer, 4);
    if (count($parts) === 3) {
        $payload = base64_decode(strtr($parts[1], '-_', '+/'), true);
        $claims = is_string($payload) ? json_decode($payload, true, 16) : null;
        $jwtExpiry = $claims['exp'] ?? null;
        if (!is_int($jwtExpiry)) {
            return null;
        }
        // The expiry from the TLS response can shorten, never extend, our cache lifetime.
        $expiry = min($expiry, $jwtExpiry);
    }
    return $expiry > $now ? ['bearer' => $bearer, 'expiresAt' => $expiry] : null;
}

function binder_shopify_exchange(string $clientId, string $secret): ?array
{
    if (!function_exists('curl_init')) {
        return null;
    }
    $curl = curl_init('https://api.shopify.com/auth/access_token');
    if ($curl === false) {
        return null;
    }
    $body = '';
    $issuedAt = time();
    try {
        $options = [
            CURLOPT_POSTFIELDS => json_encode([
                'client_id' => $clientId,
                'client_secret' => $secret,
                'grant_type' => 'client_credentials',
            ], JSON_THROW_ON_ERROR),
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT_MS => 2500,
            CURLOPT_TIMEOUT_MS => 5000,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
                if (strlen($body) + strlen($chunk) > BINDER_SHOPIFY_TOKEN_BUFFER) {
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ];
        if (!curl_setopt_array($curl, $options) || curl_exec($curl) !== true || curl_getinfo($curl, CURLINFO_RESPONSE_CODE) !== 200) {
            return null;
        }
        return binder_shopify_token_response($body, $issuedAt);
    } catch (Throwable) {
        return null;
    } finally {
        curl_close($curl);
    }
}

function binder_shopify_cached_token(string $path, string $fingerprint, ?string $rejectedToken, callable $exchange): ?string
{
    if (is_link($path) || file_exists($path) && !is_file($path)) {
        return null;
    }
    $handle = @fopen($path, 'c+b');
    if ($handle === false) {
        return null;
    }
    try {
        if (!@flock($handle, LOCK_EX)) {
            return null;
        }
        if (DIRECTORY_SEPARATOR !== '\\' && !@chmod($path, 0600)) {
            return null;
        }
        $raw = @stream_get_contents($handle, BINDER_SHOPIFY_TOKEN_BUFFER + 1);
        $saved = is_string($raw) && strlen($raw) <= BINDER_SHOPIFY_TOKEN_BUFFER ? json_decode($raw, true, 8) : null;
        if (($saved['fingerprint'] ?? null) !== $fingerprint) {
            $saved = [];
        }
        $now = time();
        $bearer = $saved['bearer'] ?? null;
        $expiry = $saved['expiresAt'] ?? null;
        $usable = binder_shopify_credential($bearer, 8192) && $bearer !== $rejectedToken
            && is_int($expiry) && $expiry > $now;
        if ($usable && $expiry > $now + BINDER_SHOPIFY_REFRESH_MARGIN) {
            return $bearer;
        }
        if (is_int($saved['retryAt'] ?? null) && $saved['retryAt'] > $now) {
            return $usable ? $bearer : null;
        }

        $replacement = $exchange();
        $now = time();
        if ($replacement !== null && $replacement['bearer'] !== $rejectedToken && $replacement['expiresAt'] > $now) {
            $updated = ['fingerprint' => $fingerprint, ...$replacement];
        } else {
            $updated = ['fingerprint' => $fingerprint, 'retryAt' => $now + BINDER_SHOPIFY_TOKEN_RETRY];
            if ($usable && $expiry > $now) {
                $updated += ['bearer' => $bearer, 'expiresAt' => $expiry];
            }
        }
        $encoded = json_encode($updated, JSON_THROW_ON_ERROR);
        if (!@rewind($handle) || !@ftruncate($handle, 0) || @fwrite($handle, $encoded) !== strlen($encoded) || !@fflush($handle)) {
            return null;
        }
        return $updated['bearer'] ?? null;
    } catch (Throwable) {
        return null;
    } finally {
        fclose($handle);
    }
}

function binder_shopify_token(string $webroot, ?string $rejectedToken = null): ?string
{
    $settings = binder_shopify_config($webroot);
    if ($settings === null) {
        return null;
    }
    $clientId = $settings['clientId'];
    $secret = $settings['secret'];
    return binder_shopify_cached_token(
        $settings['cache'],
        hash('sha256', $clientId . "\0" . $secret),
        $rejectedToken,
        static fn(): ?array => binder_shopify_exchange($clientId, $secret),
    );
}

function binder_shopify_auth(?string $rejectedToken = null): ?array
{
    $buyerIp = binder_shopify_buyer_ip($_SERVER);
    $token = $buyerIp === null ? null : binder_shopify_token(dirname(__DIR__, 3), $rejectedToken);
    return $token === null ? null : ['token' => $token, 'buyerIp' => $buyerIp];
}
