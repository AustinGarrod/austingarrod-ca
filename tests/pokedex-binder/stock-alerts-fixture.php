<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit(1);

$root = dirname(__DIR__, 2).'/public';
require_once $root.'/api/v1/_binder-stock-worker.php';

$config = accounts_config($root);
$database = (string)getenv('ACCOUNTS_TEST_DATABASE');
if (!$config || !preg_match('/^accounts_test_[a-z0-9_]+$/D', $database)
    || !preg_match('/^mysql:host=(?:127\.0\.0\.1|localhost|::1);(?:[^;]+;)*dbname='.preg_quote($database, '/').'$/D', $config['dsn'])
    || $config['smtp']['host'] !== '127.0.0.1') {
    throw new RuntimeException('Run only with the loopback accounts fixture.');
}
$db = accounts_database($config);
$user = accounts_id($argv[1] ?? null);
$phase = $argv[2] ?? '';
if (accounts_query($db, 'SELECT email FROM accounts_users WHERE id=?', [$user])->fetchColumn() !== 'alerts@example.test') {
    throw new RuntimeException('Stock alerts fixture user is missing.');
}

accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET next_check_at=0 WHERE user_id=?', [$user]);
$db->exec('UPDATE accounts_binder_stock_observations SET next_check_at=0');
if ($phase === 'elapsed') {
    accounts_query($db, 'UPDATE accounts_binder_stock_alerts SET last_sent_at=? WHERE user_id=?',
        [time() - BINDER_STOCK_EMAIL_INTERVAL - 1, $user]);
}
if ($phase === 'one-card') {
    $overdue = array_fill_keys(range('a', 'j'), ['next_check_at' => 0]);
    $cold = array_fill_keys(range('k', 't'), true);
    $selected = binder_stock_batch($overdue + $cold, $overdue);
    if (count(array_intersect_key($selected, $cold)) !== 5 || count($selected) !== 10) {
        throw new RuntimeException('Refreshes and new printings must both get a share of a busy batch.');
    }
    $groups = ['sv03.5/001' => ['*' => ['key' => true]]];
    $targets = ['key' => ['variant' => ['id' => 'normal']]];
    $observations = ['key' => ['checked_at' => time(), 'offer_json' => '{}']];
    [$matches, $possible] = binder_stock_matches($groups, $targets, $observations, time());
    if ($matches['sv03.5/001:*']['printing'] !== 'sv03.5/001:normal' || !isset($possible['sv03.5/001:normal'])) {
        throw new RuntimeException('A wildcard match must retain the same physical printing key as an exact slot.');
    }
}

$lookup = static function (array $requests) use ($db, $user, $phase): array {
    if (count($requests) !== 6) throw new RuntimeException('Expected all six printings of the two missing cards.');
    if ($phase === 'binder-change') {
        accounts_query($db, "UPDATE accounts_documents SET revision=revision+1
            WHERE user_id=? AND app='pokedex-binder' AND document='master-sets'", [$user]);
    }
    $results = [];
    foreach ($requests as $request) {
        $number = $request['target']['card']['number'];
        if ($request['stores'] !== [BINDER_OFFER_STORES[0]] || !in_array($number, ['001', '002'], true)) {
            throw new RuntimeException('Only missing printings at the enabled store should be checked.');
        }
        $finish = $request['target']['variant']['id'];
        if (in_array($finish, ['normal', 'reverse'], true)) {
            $product = ['title' => $request['target']['card']['name'].' '.$number.' [Scarlet & Violet—151]'];
            $variant = ['title' => $finish === 'reverse' ? 'Reverse Holofoil' : 'Normal'];
            if (!binder_offer_matches($request['target'], $product, $variant)) {
                throw new RuntimeException('The worker target must work with the real offer matcher.');
            }
            $variant['title'] = $finish === 'reverse' ? 'Normal' : 'Reverse Holofoil';
            if (binder_offer_matches($request['target'], $product, $variant)) {
                throw new RuntimeException('The exact matcher must reject a different finish.');
            }
        }
        $checked = $phase !== 'unavailable';
        $inStock = $checked && ($number === '001' || !in_array($phase, ['one-card', 'sold-out'], true));
        $results[] = [
            'checkedStores' => (object)($checked ? ['401 Games' => gmdate(DATE_ATOM)] : []),
            'offers' => $inStock ? [['priceCents' => 100, 'condition' => 'Near Mint', 'url' => 'https://store.401games.ca/products/fixture']] : [],
        ];
    }
    return $results;
};
echo binder_stock_run($db, $config, $root, $lookup);
