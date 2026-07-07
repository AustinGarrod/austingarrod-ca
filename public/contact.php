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

redirect_with_status($sent ? 'sent' : 'error');
