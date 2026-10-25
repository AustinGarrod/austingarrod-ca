<?php
declare(strict_types=1);

// A deploy bundles Composer dependencies; HostPapa needs no Composer or Node runtime.
if (!is_file(__DIR__ . '/vendor/autoload.php') || !is_file(__DIR__ . '/build.php')) {
    error_log('Portfolio reporting bundle is missing; rebuild with Composer before deployment.');
    return;
}
require_once __DIR__ . '/vendor/autoload.php';
$build = require __DIR__ . '/build.php';
function reporting_request_context(\Sentry\Event $event): \Sentry\Event
{
    if (str_ends_with((string) ($_SERVER['SCRIPT_NAME'] ?? ''), '/geocode.php')) {
        $request = $event->getRequest();
        unset($request['query_string'], $request['data']);
        if (isset($request['url'])) $request['url'] = explode('?', $request['url'])[0];
        $event->setRequest($request);
    }
    return $event;
}
try {
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
    \Sentry\logger()->info('PHP request finished', ['status' => http_response_code() ?: 200, 'endpoint' => $_SERVER['SCRIPT_NAME'] ?? 'cli']);
    $transaction->finish();
    \Sentry\flush();
    } catch (Throwable $error) { error_log('Reporting flush failed: ' . $error->getMessage()); }
});
} catch (Throwable $error) { error_log('Reporting initialization failed: ' . $error->getMessage()); }

function report_failure(string $operation, array $context = [], ?Throwable $cause = null): void
{
    if (!function_exists('Sentry\\captureException')) return;
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
    if (!class_exists('Sentry\\SentrySdk')) return null;
    $parent = \Sentry\SentrySdk::getCurrentHub()->getSpan();
    return $parent ? $parent->startChild(\Sentry\Tracing\SpanContext::make()->setOp($operation)->setDescription($operation)) : null;
}
