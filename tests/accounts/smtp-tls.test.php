<?php
/** CLI-only caller for the real TLS SMTP integration sink. No database or web seam. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ini_set('display_errors', '0');
ini_set('log_errors', '0');
require_once dirname(__DIR__, 2).'/public/api/v1/_auth.php';

try {
    $fixture = json_decode(file_get_contents($argv[1] ?? ''), true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($fixture) || ($fixture['smtp']['host'] ?? '') !== '127.0.0.1'
        || ($fixture['smtp']['encryption'] ?? '') !== 'smtps'
        || !is_int($fixture['smtp']['port'] ?? null)
        || $fixture['smtp']['port'] < 1024 || $fixture['smtp']['port'] > 65535) {
        throw new RuntimeException('Invalid local SMTP fixture.');
    }
    $webroot = dirname(__DIR__, 2).'/public';
    if (($argv[2] ?? '') === 'unmapped-baseline') {
        // Independent reproduction of the former raw PHPMailer assignment.
        // This passes the config spelling to PHPMailer unchanged. It cannot
        // receive a greeting from an implicit-TLS server without a handshake.
        accounts_vendor($webroot);
        $mail = new PHPMailer\PHPMailer\PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $fixture['smtp']['host'];
        $mail->Port = $fixture['smtp']['port'];
        $mail->SMTPSecure = $fixture['smtp']['encryption'];
        $mail->SMTPAutoTLS = true;
        $mail->SMTPAuth = true;
        $mail->Username = $fixture['smtp']['username'];
        $mail->Password = $fixture['smtp']['password'];
        $mail->Timeout = 1;
        $mail->getSMTPInstance()->Timelimit = 1;
        $mail->SMTPDebug = 0;
        $mail->setFrom($fixture['smtp']['from'], 'Synthetic SMTP test');
        $mail->addAddress('sink@example.test');
        $mail->Subject = 'Synthetic SMTP mapping test';
        $mail->Body = 'Synthetic mapping baseline.';
        $mail->send();
    } elseif (($argv[2] ?? '') === 'production') {
        accounts_send_code($fixture, $webroot, 'sink@example.test', '724691');
    } else {
        throw new RuntimeException('Invalid local SMTP test mode.');
    }
    echo "{\"sent\":true}\n";
} catch (Throwable $error) {
    // SMTP/library errors can include recipient/server data. The test runner
    // needs only the outcome; never echo exception messages or transcripts.
    echo "{\"sent\":false}\n";
}
