<?php
declare(strict_types=1);

$recipient = 'austin.r.garrod@gmail.com';
$siteName = 'AustinGarrod.ca';
$redirectBase = '/contact/';

function redirect_with_status(string $status): void
{
    global $redirectBase;
    header('Location: ' . $redirectBase . '?status=' . rawurlencode($status), true, 303);
    exit;
}

function clean_text(string $value, int $maxLength): string
{
    $value = trim($value);
    $value = str_replace(["\r", "\n"], ' ', $value);
    $value = preg_replace('/\s+/', ' ', $value) ?? '';
    return substr($value, 0, $maxLength);
}

function clean_message(string $value, int $maxLength): string
{
    $value = trim($value);
    $value = str_replace("\r\n", "\n", $value);
    $value = str_replace("\r", "\n", $value);
    return substr($value, 0, $maxLength);
}

function rate_limit_exceeded(string $clientId, int $limit = 3, int $windowSeconds = 600): bool
{
    $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'austingarrod-contact-rate';
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
        error_log('AustinGarrod.ca contact rate-limit directory could not be created.');
        return false;
    }

    $path = $directory . DIRECTORY_SEPARATOR . hash('sha256', $clientId) . '.json';
    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        error_log('AustinGarrod.ca contact rate-limit state could not be opened.');
        return false;
    }

    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        error_log('AustinGarrod.ca contact rate-limit state could not be locked.');
        return false;
    }

    rewind($handle);
    $stored = stream_get_contents($handle);
    $decoded = is_string($stored) && $stored !== '' ? json_decode($stored, true) : [];
    $timestamps = is_array($decoded) ? $decoded : [];
    $cutoff = time() - $windowSeconds;
    $recent = [];

    foreach ($timestamps as $timestamp) {
        if (is_int($timestamp) && $timestamp >= $cutoff) {
            $recent[] = $timestamp;
        }
    }

    $limited = count($recent) >= $limit;
    if (!$limited) {
        $recent[] = time();
    }

    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($recent));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    @chmod($path, 0600);

    return $limited;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    redirect_with_status('invalid');
}

$honeypot = trim((string)($_POST['website'] ?? ''));
if ($honeypot !== '') {
    redirect_with_status('sent');
}

$name = clean_text((string)($_POST['name'] ?? ''), 120);
$email = clean_text((string)($_POST['email'] ?? ''), 160);
$subject = clean_text((string)($_POST['subject'] ?? ''), 160);
$message = clean_message((string)($_POST['message'] ?? ''), 4000);

if ($name === '' || $email === '' || $subject === '' || $message === '') {
    redirect_with_status('invalid');
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    redirect_with_status('invalid');
}

if (strlen($message) < 20) {
    redirect_with_status('invalid');
}

$clientId = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
if (rate_limit_exceeded($clientId)) {
    error_log('AustinGarrod.ca contact rate limit reached.');
    redirect_with_status('error');
}

$safeSubject = '[' . $siteName . '] ' . $subject;
$bodyLines = [
    'Name: ' . $name,
    'Email: ' . $email,
    '',
    'Message:',
    $message,
    '',
    'Sent from ' . $siteName
];
$body = implode("\n", $bodyLines);

$headers = [
    'From: ' . $siteName . ' <no-reply@austingarrod.ca>',
    'Reply-To: ' . $name . ' <' . $email . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'X-Mailer: PHP/' . phpversion()
];

$sent = @mail($recipient, $safeSubject, $body, implode("\r\n", $headers));

if (!$sent) {
    error_log('AustinGarrod.ca contact mail() call was not accepted by the local mail system.');
}

redirect_with_status($sent ? 'sent' : 'error');
