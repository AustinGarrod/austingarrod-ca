<?php
declare(strict_types=1);

// Reporting is optional. Keep endpoint helpers available on legacy HostPapa PHP
// before loading the PHP 8.1+ Composer bundle or touching any SDK classes.
$GLOBALS['portfolioReportingReady'] = false;

function reporting_request_context(\Sentry\Event $event): \Sentry\Event
{
    if (substr((string) ($_SERVER['SCRIPT_NAME'] ?? ''), -12) === '/geocode.php') {
        $request = $event->getRequest();
        unset($request['query_string'], $request['data']);
        if (isset($request['url'])) $request['url'] = explode('?', $request['url'])[0];
        $event->setRequest($request);
    }
    return $event;
}

function report_failure(string $operation, array $context = [], ?Throwable $cause = null): void
{
    if (empty($GLOBALS['portfolioReportingReady'])) return;
    try {
        \Sentry\withScope(static function (\Sentry\State\Scope $scope) use ($operation, $context, $cause): void {
            $scope->setTag('operation', $operation);
            $scope->setContext('operation', $context);
            \Sentry\captureException(new RuntimeException($operation, 0, $cause));
        });
    } catch (Throwable $error) { error_log('Reporting capture failed: ' . $error->getMessage()); }
}

function reporting_span(string $operation): ?\Sentry\Tracing\Span
{
    if (empty($GLOBALS['portfolioReportingReady'])) return null;
    try {
        $parent = \Sentry\SentrySdk::getCurrentHub()->getSpan();
        return $parent ? $parent->startChild(\Sentry\Tracing\SpanContext::make()->setOp($operation)->setDescription($operation)) : null;
    } catch (Throwable $error) {
        error_log('Reporting span failed: ' . $error->getMessage());
        return null;
    }
}

function reporting_finish_span($span, array $data = []): void
{
    if (empty($GLOBALS['portfolioReportingReady']) || $span === null) return;
    try {
        if ($data !== []) $span->setData($data);
        $span->finish();
    } catch (Throwable $error) { error_log('Reporting span finish failed: ' . $error->getMessage()); }
}

function reporting_log(string $message, array $attributes = []): void
{
    if (empty($GLOBALS['portfolioReportingReady'])) return;
    try {
        \Sentry\logger()->info($message, [], $attributes);
    } catch (Throwable $error) { error_log('Reporting log failed: ' . $error->getMessage()); }
}

// Do not let Composer's platform check emit a 500 before the endpoint can run.
// The SDK remains fully enabled on supported hosts; no dependency is downgraded.
if (PHP_VERSION_ID < 80100 || !extension_loaded('curl') || !extension_loaded('mbstring')) {
    error_log('Portfolio reporting unavailable on PHP ' . PHP_VERSION . ': PHP 8.1+, cURL and mbstring are required; endpoint continues without reporting.');
    return;
}
if (!is_file(__DIR__ . '/vendor/autoload.php') || !is_file(__DIR__ . '/build.php')) {
    error_log('Portfolio reporting bundle is missing; rebuild with Composer before deployment.');
    return;
}

$reportingPreviousStatus = http_response_code();
$reportingBufferLevel = ob_get_level();
ob_start();
try {
    require_once __DIR__ . '/vendor/autoload.php';
    $build = require __DIR__ . '/build.php';
    if (!is_array($build) || !isset($build['release'], $build['environment']) || !is_string($build['release']) || !is_string($build['environment'])) {
        throw new UnexpectedValueException('Reporting build metadata is invalid.');
    }
    \Sentry\init([
        'logger' => getenv('REPORTING_DEBUG') ? new \Sentry\Logger\DebugFileLogger('php://stderr') : null,
        'dsn' => getenv('REPORTING_DSN') !== false ? getenv('REPORTING_DSN') : 'https://8b561c6564244066bd2960053ed220cd@reports.garrod.house/8',
        'release' => $build['release'],
        'environment' => getenv('REPORTING_ENVIRONMENT') ?: $build['environment'],
        'sample_rate' => 1.0,
        'traces_sample_rate' => 1.0,
        'enable_logs' => true,
        'send_default_pii' => true,
        'max_breadcrumbs' => 100,
        'attach_stacktrace' => true,
        'http_connect_timeout' => 1,
        'http_timeout' => 2,
        'http_ssl_native_ca' => PHP_OS_FAMILY === 'Windows',
        'tags' => ['service' => 'portfolio-php'],
        'before_send_log' => static function (\Sentry\Logs\Log $log): \Sentry\Logs\Log {
            $log->setAttribute('service.name', 'portfolio-php');
            return $log;
        },
        // Preserve the geocoder's existing no-raw-query-logging contract.
        'before_send' => 'reporting_request_context',
        'before_send_transaction' => 'reporting_request_context',
    ]);
    $trace = (string) ($_SERVER['HTTP_SENTRY_TRACE'] ?? $_POST['reporting_trace'] ?? '');
    $context = \Sentry\continueTrace($trace, (string) ($_SERVER['HTTP_BAGGAGE'] ?? ''));
    $context->setName((string) ($_SERVER['SCRIPT_NAME'] ?? 'php'));
    $context->setOp('http.server');
    $transaction = \Sentry\startTransaction($context);
    \Sentry\SentrySdk::getCurrentHub()->setSpan($transaction);
    $requestId = bin2hex(random_bytes(16));
    \Sentry\configureScope(static function (\Sentry\State\Scope $scope) use ($requestId): void {
        $scope->setTag('request_id', $requestId);
    });
    if (PHP_SAPI !== 'cli') header('X-Request-ID: ' . $requestId);
    register_shutdown_function(static function () use ($transaction): void {
        try {
            $transaction->setHttpStatus(http_response_code() ?: 200);
            reporting_log('PHP request finished', ['status' => http_response_code() ?: 200, 'endpoint' => $_SERVER['SCRIPT_NAME'] ?? 'cli']);
            $transaction->finish();
            \Sentry\flush();
        } catch (Throwable $error) { error_log('Reporting flush failed: ' . $error->getMessage()); }
    });
    $GLOBALS['portfolioReportingReady'] = true;
} catch (Throwable $error) {
    // Composer may emit text and set HTTP 500 before throwing. Neither may
    // replace a contact redirect or the geocoder's JSON response.
    if (!headers_sent()) http_response_code($reportingPreviousStatus ?: 200);
    error_log('Reporting initialization failed: ' . $error->getMessage());
} finally {
    while (ob_get_level() > $reportingBufferLevel) ob_end_clean();
}
