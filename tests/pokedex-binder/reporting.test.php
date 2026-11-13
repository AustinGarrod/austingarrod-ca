<?php
declare(strict_types=1);
// Local SDK-boundary check. No ingestion occurs; uses only a synthetic credential and collection.
putenv('REPORTING_DSN=');
$_SERVER['SCRIPT_NAME'] = '/utilities/pokedex-binder/api/binder.php';
require_once dirname(__DIR__, 2) . '/public/reporting/bootstrap.php';
$event = \Sentry\Event::createEvent();
$event->setRequest([
    'url' => 'https://example.invalid/utilities/pokedex-binder/api/binder.php?private=query',
    'query_string' => 'private=query',
    'headers' => ['X-Pokedex-Key' => 'pdx_' . str_repeat('A', 43)],
    'cookies' => ['private' => 'cookie'],
    'data' => ['state' => ['ownedDexIds' => [1, 25]]],
    'method' => 'PATCH',
]);
$event->setExtra(['state' => ['ownedDexIds' => [99]]]);
$safe = reporting_request_context($event);
if ($safe->getRequest() !== ['url' => 'https://example.invalid/utilities/pokedex-binder/api/binder.php', 'method' => 'PATCH'] || $safe->getExtra() !== []) {
    throw new RuntimeException('Private binder reporting context was not removed.');
}
$_SERVER['SCRIPT_NAME'] = '/utilities/radius-map/api/geocode.php';
$event = \Sentry\Event::createEvent();
$event->setRequest(['url' => 'https://example.invalid/utilities/radius-map/api/geocode.php?q=private', 'data' => 'private', 'query_string' => 'q=private', 'method' => 'GET']);
if (reporting_request_context($event)->getRequest() !== ['url' => 'https://example.invalid/utilities/radius-map/api/geocode.php', 'method' => 'GET']) {
    throw new RuntimeException('Geocoder reporting privacy regressed.');
}
echo "PHP reporting privacy checks passed.\n";
