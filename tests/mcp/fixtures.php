<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}
$root = dirname(__DIR__, 2);
require $root.'/public/api/v1/_mcp-tools.php';
$config = accounts_config($root.'/dist');
$dbName = getenv('ACCOUNTS_TEST_DATABASE');
if (!preg_match('/^accounts_test_[a-z0-9_]+$/D', $dbName) || $config === null || !str_starts_with($config['dsn'], 'mysql:host=127.0.0.1;')
    || !str_ends_with($config['dsn'], ';dbname='.$dbName) || !str_starts_with($config['allowedOrigin'], 'http://127.0.0.1:')) {
    exit(1);
}
$db = accounts_database($config);
switch ($argv[1] ?? '') {
    case 'expire':
        accounts_query($db, "UPDATE accounts_mcp_tokens SET expires_at=0 WHERE kind='access'");
        exit;
    case 'stale':
        accounts_query($db, "UPDATE accounts_documents SET revision=revision+1 WHERE app='pokedex-binder'");
        exit;
    case 'seed':
        break;
    default:
        exit(1);
}
$map = mcp_slayer_catalogs($root.'/dist')[0];
$users = [];
foreach (['one', 'two'] as $name) {
    $user = accounts_uuid();
    $email = $name.'@example.test';
    accounts_query($db, 'INSERT INTO accounts_users(id,email) VALUES(?,?)', [$user, $email]);
    $session = accounts_prepare_session($db, $user);
    $binder = (object)['schemaVersion' => 1, 'settings' => (object)['columns' => 3, 'rows' => 3, 'useBackSides' => true, 'leadingBlankPockets' => 0],
        'ownedDexIds' => [$name === 'one' ? 1 : 4]];
    accounts_save_document($db, $user, 'pokedex-binder', 'binder', 1, accounts_encode($binder), null);
    if ($name === 'one') {
        $set = (object)['id'=>accounts_uuid(),'name'=>'151 Master','setId'=>'sv03.5','goal'=>'variants','order'=>'together','settings'=>$binder->settings,'specialties'=>[],'extras'=>[],'owned'=>[]];
        $copy = clone $set; $copy->id=accounts_uuid(); $copy->name='151 Trade';
        accounts_save_document($db,$user,'pokedex-binder','master-sets',1,accounts_encode((object)['schemaVersion'=>1,'binders'=>[$set,$copy]]),null);
        $progress = mcp_slayer_progress(null, $map->revision);
        $progress->ascension->showSpoilers = true;
        $defaults = [
            'progress' => $progress,
            'intentions' => (object)['format' => 'idle-slayer-companion-workspace', 'version' => 1, 'goals' => [], 'recipePlans' => new stdClass()],
            'checkpoints' => (object)['kind' => 'progress-checkpoints', 'version' => 1, 'entries' => []],
            'comparison' => (object)['kind' => 'upgrade-comparison', 'version' => 1, 'ids' => []],
        ];
        foreach ($defaults as $document => $state) {
            accounts_save_document($db, $user, 'idle-slayer-companion', $document, 1, accounts_encode($state), null);
        }
    }
    $users[$name] = ['id' => $user, 'token' => $session['token'], 'csrf' => $session['session']['csrf_token']];
}
echo accounts_encode($users);
