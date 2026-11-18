import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const php = process.env.PHP_BINARY || 'php';
const extensions = execFileSync(php, ['-r', 'echo implode(",", get_loaded_extensions());'], { encoding: 'utf8' }).split(',');
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const flags = process.platform === 'win32' ? ['-d', 'extension_dir=' + join(phpDir, 'ext')] : [];
for (const ext of ['mbstring', 'pdo_mysql']) if (!extensions.includes(ext)) flags.push('-d', 'extension=' + ext);
const dsn = process.env.ACCOUNTS_TEST_DSN;
assert.ok(dsn?.startsWith('mysql:host=127.0.0.1;'), 'Set a loopback ACCOUNTS_TEST_DSN.');
assert.ok(existsSync(join(root, 'dist/api/v1/_mcp-vendor/autoload.php')), 'Install the SDK and build dist first.');
const name = 'accounts_test_mcp_' + randomBytes(8).toString('hex');
mkdirSync(join(root, 'tmp'), { recursive: true });
const scratch = mkdtempSync(join(root, 'tmp/mcp-test-'));
const env = { ...process.env, ACCOUNTS_TEST_DATABASE: name, ACCOUNTS_CONFIG: join(scratch, 'accounts.php'), REPORTING_DSN: '' };
const phpRun = (path, ...args) => execFileSync(php, [...flags, join(root, path), ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fixture = action => phpRun('tests/mcp/fixtures.php', action);
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const base = '/api/v1/mcp/';
const binder = 'pokedex-binder';
const slayer = 'idle-slayer-companion';
const authClient = 'https://chatgpt.com/oauth/codex/client.json';
const callback = origin + '/callback';
const chatgptClient = 'https://chatgpt.com/oauth/client.json';
const chatgptCallback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const config = {
  enabled: true, migrationEnabled: true, allowedOrigin: origin,
  dsn: dsn.replace(/;?dbname=[^;]*/i, '').replace(/;$/, '') + ';dbname=' + name,
  username: process.env.ACCOUNTS_TEST_USER || 'root', password: process.env.ACCOUNTS_TEST_PASSWORD || '',
  secret: randomBytes(32).toString('hex'),
  mcp: { [binder]: { enabled: true }, [slayer]: { enabled: true } },
};
function writeConfig() {
  writeFileSync(env.ACCOUNTS_CONFIG, "<?php return json_decode(base64_decode('" + Buffer.from(JSON.stringify(config)).toString('base64') + "'), true);");
}
writeConfig();
let server, browser, created = false, stage = 'setup', internal = '';
let users;
const request = (path, options) => fetch(origin + path, { redirect: 'manual', ...options });
const cookie = user => '__Host-ag-session=' + user.token;
function browserHeaders(user, proof, csrf = user.csrf) {
  return { Cookie: cookie(user) + (proof ? '; ' + proof : ''), 'X-Account-ID': user.id, 'X-CSRF-Token': csrf, Origin: origin, 'Content-Type': 'application/json' };
}
async function consent(user, flow, proof, decision, accountId = user.id, csrf) {
  const data = decision ? { flow, decision, accountId } : { flow };
  return request(base + 'oauth/consent', { method: 'POST', body: JSON.stringify(data), headers: browserHeaders(user, proof, csrf) });
}
async function begin(app, overrides = {}) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');
  const qs = new URLSearchParams({
    client_id: authClient, redirect_uri: callback, response_type: 'code', state, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource: origin + base + app,
    scope: app + ':read ' + app + ':write offline_access', ...overrides,
  });
  const response = await request(base + 'oauth/authorize?' + qs);
  if (!response.ok && response.status !== 303) return { response };
  const proof = response.headers.get('set-cookie');
  assert.match(proof, /secure; HttpOnly; SameSite=Lax/i);
  const location = response.headers.get('location');
  assert.match(location, /^\/account\/assistant-consent\/#[\w-]{43}$/);
  return { response, verifier, state, proof: proof.split(';')[0], flow: location.split('#')[1], location };
}
async function token(fields) {
  return request(base + 'oauth/token', { method: 'POST', body: new URLSearchParams({ client_id: authClient, ...fields }) });
}
async function connect(user, app, decision) {
  const flow = await begin(app);
  assert.equal(flow.response.status, 303);
  const result = await consent(user, flow.flow, flow.proof, decision);
  assert.equal(result.status, 200);
  const redirect = new URL((await result.json()).redirect);
  assert.equal(redirect.searchParams.get('state'), flow.state);
  assert.equal(redirect.searchParams.get('iss'), origin);
  const fields = {
    grant_type: 'authorization_code', code: redirect.searchParams.get('code'),
    redirect_uri: callback, code_verifier: flow.verifier, resource: origin + base + app,
  };
  assert.equal((await token({ ...fields, code_verifier: 'x'.repeat(43) })).status, 400);
  const response = await token(fields);
  assert.equal(response.status, 200);
  assert.equal((await token(fields)).status, 400);
  return response.json();
}
async function rpc(app, auth, method, params, headers = {}) {
  return request(base + app, {
    method: 'POST', headers: {
      Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25',
      ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
  });
}
async function rpcBody(response) {
  const text = await response.text();
  return JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6) ?? '{}' : text);
}
async function tool(app, credentials, type, args = {}, error) {
  const response = await rpc(app, credentials.access_token, 'tools/call', { name: type, arguments: args });
  assert.equal(response.status, 200, type);
  const { result, error: fault } = await rpcBody(response);
  assert.ok(result, type + ': ' + JSON.stringify(fault));
  const content = result.structuredContent ?? JSON.parse(result.content[0].text);
  if (error) assert.equal(content.code, error, type);
  else assert.ok(!result.isError, type + ': ' + JSON.stringify(content));
  return content;
}
const preview = (app, grant, operation, input, error) => tool(app, grant, 'preview_change', { operation, input }, error);
async function edit(app, grant, operation, input) {
  const { previewId } = await preview(app, grant, operation, input);
  return tool(app, grant, 'apply_change', { previewId });
}
try {
  phpRun('tests/accounts/database.php', 'create'); created = true;
  phpRun('server/mcp/migrate.php', env.ACCOUNTS_CONFIG);
  phpRun('server/mcp/migrate.php', env.ACCOUNTS_CONFIG);
  users = JSON.parse(fixture('seed'));
  server = spawn(php, [...flags, '-d', 'display_errors=0', '-S', '127.0.0.1:' + port, '-t', join(root, 'dist'), join(root, 'tests/mcp/router.php')],
    { env, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', data => { if (/PHP (Fatal|Warning|Parse)/.test(String(data))) internal += String(data).replace(/\[[^\]]+\] /g, ''); });
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await request('/robots.txt')).ok) break; } catch { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  stage = 'discovery and consent security';
  const challenge = await rpc(binder, null, 'tools/list');
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('cache-control'), /no-store/);
  const metadata = challenge.headers.get('www-authenticate').match(/resource_metadata="([^"]+)"/)[1];
  assert.equal((await (await fetch(metadata)).json()).resource, origin + base + binder);
  assert.equal((await (await request('/.well-known/oauth-authorization-server')).json()).issuer, origin);
  assert.equal((await begin(binder, { redirect_uri: 'http://localhost.attacker.test/callback' })).response.status, 400);
  assert.equal((await begin(binder, { scope: slayer + ':read' })).response.status, 400);
  const cancelled = await begin(binder);
  assert.equal((await consent(users.one, cancelled.flow, '', 'deny')).status, 400);
  assert.equal((await consent(users.one, cancelled.flow, cancelled.proof, 'deny', users.two.id)).status, 409);
  assert.equal((await consent(users.one, cancelled.flow, cancelled.proof, 'deny', users.one.id, 'invalid')).status, 403);
  const deny = await consent(users.one, cancelled.flow, cancelled.proof, 'deny');
  assert.equal(new URL((await deny.json()).redirect).searchParams.get('error'), 'access_denied');
  assert.equal((await consent(users.one, cancelled.flow, cancelled.proof, 'read')).status, 400);

  stage = 'client tools and isolation';
  const writer = await connect(users.one, binder, 'write');
  const reader = await connect(users.two, binder, 'read');
  const slayerWriter = await connect(users.one, slayer, 'write');
  const noSave = await connect(users.two, slayer, 'read');
  const otherWriter = await connect(users.two, binder, 'write');
  const init = await rpc(binder, writer.access_token, 'initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'fixture', version: '1' }, capabilities: {} });
  assert.equal((await rpcBody(init)).result.serverInfo.name, binder);
  const tools = (await rpcBody(await rpc(binder, writer.access_token, 'tools/list'))).result.tools;
  assert.ok(tools.some(item => item.name === 'apply_change' && item.annotations.readOnlyHint === false));
  const modern = await rpc(binder, writer.access_token, 'server/discover', {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' });
  const discovery = await rpcBody(modern);
  assert.equal(modern.status, 200, JSON.stringify(discovery));
  assert.ok(discovery.result);
  assert.equal((await rpc(slayer, writer.access_token, 'tools/list')).status, 401);
  assert.equal((await rpc(binder, writer.access_token, 'tools/list', undefined, { Origin: 'https://other.example.test' })).status, 403);
  assert.equal((await rpc(binder, reader.access_token, 'tools/call', { name: 'preview_change', arguments: {} })).status, 403);
  assert.equal((await tool(binder, writer, 'get_collection', { status: 'owned' })).items[0].id, 1);
  assert.equal((await tool(binder, reader, 'get_collection', { status: 'owned' })).items[0].id, 4);
  assert.equal((await tool(binder, writer, 'list_printings', { dexId: 1, setId: 'me01' })).items[0].number, '001');
  await tool(slayer, noSave, 'get_progress', {}, 'save_not_synced');
  assert.ok((await tool(slayer, noSave, 'search_catalog', { limit: 2 })).items.length);

  stage = 'preview, concurrent revision, replay and recovery';
  const stale = await preview(binder, writer, 'set_ownership', { dexIds: [7], owned: true });
  fixture('stale');
  await tool(binder, writer, 'apply_change', { previewId: stale.previewId }, 'stale_preview');
  const next = await preview(binder, writer, 'set_ownership', { dexIds: [7], owned: true });
  const alternatives = await preview(binder, writer, 'set_ownership', { dexIds: [10], owned: true });
  const result = await tool(binder, writer, 'apply_change', { previewId: next.previewId });
  assert.equal(result.revision, 3);
  assert.deepEqual(await tool(binder, writer, 'apply_change', { previewId: next.previewId }), result);
  await tool(binder, writer, 'apply_change', { previewId: alternatives.previewId }, 'stale_preview');
  await tool(binder, otherWriter, 'apply_change', { previewId: next.previewId }, 'preview_expired');
  const sync = await request('/api/v1/sync.php?' + new URLSearchParams({ app: binder, document: 'binder', clientId: randomUUID() }), {
    headers: { Cookie: cookie(users.one), 'X-Account-ID': users.one.id },
  });
  assert.deepEqual((await sync.json()).document.state.ownedDexIds, [1, 7]);
  const ownCopies = await tool(binder, writer, 'list_recovery');
  assert.equal(ownCopies.items[0].id, result.recoveryCopyId);
  assert.deepEqual((await tool(binder, reader, 'list_recovery')).items, []);
  await preview(slayer, slayerWriter, 'restore_recovery', { id: result.recoveryCopyId }, 'snapshot_not_found');
  await edit(binder, writer, 'restore_recovery', { id: result.recoveryCopyId });
  assert.deepEqual((await tool(binder, writer, 'get_collection', { status: 'owned' })).items.map(item => item.id), [1]);

  const sets = await tool(binder, writer, 'list_set_binders', {query:'151'});
  assert.equal(sets.total,2);
  const binderId=sets.items[0].binderId;
  const readSet=(id,status)=>tool(binder,writer,'get_set_binder',{binderId:id,status,query:'Bulbasaur'});
  const slot=(await readSet(binderId,'missing')).items.find(s=>s.key==='001:reverse');
  assert.equal(slot.pocket,2);
  await edit(binder,writer,'set_slot_ownership',{binderId,key:slot.key,owned:true});
  assert.equal((await readSet(binderId,'owned')).items[0].key,slot.key);
  assert.equal((await readSet(sets.items[1].binderId,'owned')).total,0);
  await tool(binder,reader,'get_set_binder',{binderId},'binder_not_found');

  stage = 'synced Slayer operations';
  const recommendation = (await tool(slayer, slayerWriter, 'recommend_upgrades', { limit: 1 })).suggestions[0];
  assert.ok(recommendation?.id);
  await edit(slayer, slayerWriter, 'record_purchase', { id: recommendation.id });
  await edit(slayer, slayerWriter, 'set_goal', { system: 'ascension', id: recommendation.id, enabled: true });
  assert.equal((await tool(slayer, slayerWriter, 'get_workspace')).goals[0].ref.id, recommendation.id);
  await preview(slayer, slayerWriter, 'capture_checkpoint', { name: '😀'.repeat(33) }, 'invalid_checkpoint_name');
  await edit(slayer, slayerWriter, 'capture_checkpoint', { name: '  Cafe\u0301\u2002  checkpoint  ' });
  const checkpoint = (await tool(slayer, slayerWriter, 'list_checkpoints')).checkpoints[0];
  assert.equal(checkpoint.name, 'Café checkpoint');
  assert.equal((await tool(slayer, slayerWriter, 'get_checkpoint', { id: checkpoint.id })).checkpoint.id, checkpoint.id);
  await edit(slayer, slayerWriter, 'rename_checkpoint', { id: checkpoint.id, name: 'Renamed checkpoint' });
  assert.equal((await tool(slayer, slayerWriter, 'list_checkpoints')).checkpoints[0].name, 'Renamed checkpoint');
  await edit(slayer, slayerWriter, 'delete_checkpoint', { id: checkpoint.id });
  await edit(slayer, slayerWriter, 'set_comparison', { ids: [recommendation.id] });
  assert.equal((await tool(slayer, slayerWriter, 'get_saved_comparison')).upgrades[0].id, recommendation.id);
  const material = (await tool(slayer, slayerWriter, 'search_catalog', { system: 'material', limit: 1 })).items[0];
  await edit(slayer, slayerWriter, 'record_observation', { system: 'material', id: material.id, patch: { count: '12345678901234567890', discovered: true } });
  assert.equal((await tool(slayer, slayerWriter, 'get_progress', { system: 'material', query: material.id })).items[0].record.count, '12345678901234567890');

  stage = 'browser consent and management';
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  async function openConsent(flow) {
    assert.equal(flow.response.status, 303);
    await context.addCookies([{ name: '__Host-ag-mcp', value: flow.proof.split('=')[1], url: origin.replace('http:', 'https:') + '/', secure: true, httpOnly: true }]);
    await page.goto(origin + flow.location);
  }
  const browserFlow = await begin(binder);
  await openConsent(browserFlow);
  await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
  assert.match(await page.getByRole('link', { name: 'Sign in', exact: true }).getAttribute('href'), /assistant-consent%2F/);
  await context.addCookies([{ name: '__Host-ag-session', value: users.one.token, url: origin.replace('http:', 'https:') + '/', secure: true, httpOnly: true }]);
  await page.reload();
  await page.getByRole('button', { name: 'Allow read and write' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForURL(callback + '?**');
  assert.equal(new URL(page.url()).searchParams.get('error'), 'access_denied');
  await page.goto(origin + '/account/');
  await page.getByRole('heading', { name: 'Connected assistants' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Revoke Codex access to Idle Slayer Companion' }).isVisible());
  await page.getByRole('button', { name: 'Revoke Codex access to Idle Slayer Companion' }).click();
  await page.getByText('Assistant access revoked.', { exact: true }).waitFor();
  assert.equal((await rpc(slayer, slayerWriter.access_token, 'tools/list')).status, 401);

  stage = 'ChatGPT read-only OAuth';
  const chatgpt = { client_id: chatgptClient, redirect_uri: chatgptCallback };
  await context.route(chatgptCallback + '?*', route => route.fulfill({ body: 'Callback received' }));
  assert.equal((await begin(slayer, { ...chatgpt, redirect_uri: chatgptCallback + '?other=1' })).response.status, 400);
  assert.equal((await begin(slayer, { ...chatgpt, redirect_uri: callback })).response.status, 400);
  const chatgptDeny = await begin(slayer, chatgpt);
  await openConsent(chatgptDeny);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForURL(chatgptCallback + '?**');
  const deniedCallback = new URL(page.url());
  assert.equal(deniedCallback.searchParams.get('error'), 'access_denied');
  assert.equal(deniedCallback.searchParams.get('state'), chatgptDeny.state);
  assert.equal(deniedCallback.searchParams.get('iss'), origin);

  for (const app of [binder, slayer]) {
    const flow = await begin(app, { ...chatgpt, scope: app === binder ? '' : app + ':read ' + app + ':write offline_access' });
    await openConsent(flow);
    await page.locator('#assistant-client-name').filter({ hasText: /^ChatGPT$/ }).waitFor();
    assert.ok(!(await page.getByRole('button', { name: 'Allow read and write' }).isVisible()));
    assert.ok(await page.getByText('You can revoke access from your account.', { exact: false }).isVisible());
    assert.equal((await consent(users.one, flow.flow, flow.proof, 'write')).status, 400);
    await page.getByRole('button', { name: 'Allow read access', exact: true }).click();
    await page.waitForURL(chatgptCallback + '?**');
    const response = new URL(page.url());
    assert.equal(response.searchParams.get('state'), flow.state);
    assert.equal(response.searchParams.get('iss'), origin);
    const fields = {
      grant_type: 'authorization_code', code: response.searchParams.get('code'),
      redirect_uri: chatgptCallback, code_verifier: flow.verifier, resource: origin + base + app,
    };
    assert.equal((await token(fields)).status, 400);
    const exchanged = await token({ ...fields, client_id: chatgptClient });
    assert.equal(exchanged.status, 200);
    const credentials = await exchanged.json();
    const scope = app + ':read' + (app === slayer ? ' offline_access' : '');
    assert.equal(credentials.scope, scope);
    const { result } = await rpcBody(await rpc(app, credentials.access_token, 'tools/list'));
    assert.ok(result.tools.length > 0 && result.tools.every(item => item.annotations.readOnlyHint && item.annotations.destructiveHint === false));
    assert.ok(!result.tools.some(item => ['preview_change', 'apply_change'].includes(item.name)));
    for (const name of ['preview_change', 'apply_change']) {
      assert.equal((await rpc(app, credentials.access_token, 'tools/call', { name, arguments: {} })).status, 403);
    }
    if (app === binder) {
      assert.ok((await tool(binder, credentials, 'get_collection', { status: 'owned' })).items.some(item => item.id === 1));
    } else {
      assert.ok((await tool(slayer, credentials, 'get_progress', { limit: 1 })).items.length);
    }
    const refresh = await token({ client_id: chatgptClient, grant_type: 'refresh_token', refresh_token: credentials.refresh_token, resource: fields.resource });
    assert.equal(refresh.status, 200);
    assert.equal((await refresh.json()).scope, scope);
  }

  stage = 'assistant setup layout';
  await page.goto(origin + '/account/assistants/');
  assert.ok(await page.getByRole('heading', { name: 'ChatGPT web', exact: true }).isVisible());
  assert.equal(await page.getByRole('link', { name: 'Download skill ZIP' }).count(), 2);
  assert.equal(await page.getByRole('link', { name: 'Download Claude plugin ZIP' }).count(), 2);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => {
      const hero = document.querySelector('.page-hero').getBoundingClientRect();
      const panel = document.querySelector('.assistant-guide').getBoundingClientRect();
      const downloadActions = [...document.querySelectorAll('.assistant-download-actions')];
      return document.documentElement.scrollWidth <= innerWidth && panel.top - hero.bottom >= 24
        && downloadActions.every(row => {
          const [primary, secondary] = [...row.children].map(link => link.getBoundingClientRect());
          return secondary.left - primary.right >= 8 || secondary.top - primary.bottom >= 8;
        });
    }), 'Assistant setup needs separation without overflow at ' + width + 'px');
  }

  stage = 'expiry, refresh replay and rollback';
  fixture('expire');
  assert.equal((await rpc(binder, writer.access_token, 'tools/list')).status, 401);
  const refresh = { grant_type: 'refresh_token', refresh_token: writer.refresh_token, resource: origin + base + binder };
  assert.equal((await token({ ...refresh, resource: origin + base + slayer })).status, 400);
  const refreshed = await token(refresh);
  assert.equal(refreshed.status, 200);
  const renewed = await refreshed.json();
  assert.equal((await rpc(binder, renewed.access_token, 'tools/list')).status, 200);
  assert.equal((await token(refresh)).status, 400);
  assert.equal((await rpc(binder, renewed.access_token, 'tools/list')).status, 401);
  const fresh = await connect(users.one, binder, 'write');
  const logout = await request('/api/v1/auth.php?action=logout-all', { method: 'POST', body: '{}', headers: browserHeaders(users.one) });
  assert.equal(logout.status, 200);
  assert.equal((await rpc(binder, fresh.access_token, 'tools/list')).status, 401);
  const sidecar = join(scratch, 'utility-mcp.json');
  writeFileSync(sidecar, JSON.stringify({ [binder]: { enabled: false }, [slayer]: { previewAccounts: [users.one.id] } }));
  assert.equal((await rpc(binder, null, 'tools/list')).status, 503);
  assert.equal((await rpc(slayer, null, 'tools/list')).status, 401);
  const limited = await begin(slayer);
  assert.equal((await consent(users.two, limited.flow, limited.proof, 'read')).status, 400);
  writeFileSync(sidecar, '{invalid JSON');
  assert.equal((await rpc(slayer, null, 'tools/list')).status, 503);
  console.log('Utility MCP: discovery, OAuth, grant isolation, real tool calls, save previews, replay, recovery, browser consent and revocation passed.');
} catch (error) {
  console.error('Utility MCP failed at ' + stage + '.');
  if (internal) console.error(internal);
  throw error;
} finally {
  await browser?.close();
  server?.kill();
  if (created) phpRun('tests/accounts/database.php', 'drop');
}
