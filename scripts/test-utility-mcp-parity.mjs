import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const companion = join(root, 'apps/idle-slayer-companion');
const input = await build({
  stdin: { resolveDir: join(companion, 'src/domain'), contents: [
    "export * from './rules.ts';",
    "export { recommendUpgrades } from './recommendations.ts';",
    "export { emptyCompanionProgress } from './companion-progress.ts';",
    "export { visibleCompanionEntities } from './companion-catalog.ts';",
    "export { planCompanionUltraAscension } from './companion-reset.ts';",
    "export { planCompanionObservation } from './companion-observation.ts';",
  ].join('\n') },
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const native = await import('data:text/javascript;base64,' + Buffer.from(input.outputFiles[0].contents).toString('base64'));
const read = path => JSON.parse(readFileSync(join(companion, path), 'utf8'));
const map = read('public/catalog.json');
const catalog = read('public/companion-catalog.json');
const priorities = read('src/data/wiki-priorities.json');
const rules = read('src/data/companion-reset-rules.json');
const empty = native.emptyCompanionProgress(map.revision);
const owned = structuredClone(empty);
owned.ascension.epoch = 1;
owned.ascension.showSpoilers = true;
owned.ascension.purchases = Object.fromEntries(map.upgrades.map(item => [item.id, { epoch: 1, active: item.activation === 'immediate' }]));
owned.ascension.milestones = Object.fromEntries(map.milestones.map(item => [item.id, true]));
owned.ascension.purchases['preserved-unknown'] = { epoch: 0, active: true };
const scenarios = [];
const expected = [];
function add(action, progress, expectedResult, extras = {}) {
  scenarios.push({ action, progress, ...extras });
  expected.push(expectedResult);
}

for (const progress of [empty, { ...empty, ascension: { ...empty.ascension, showSpoilers: true } }, owned]) {
  const projected = native.visibility(map, progress.ascension);
  const entries = {};
  if (projected.upgrades.length) entries.ascension = projected.upgrades.map(item => item.id);
  if (projected.milestones.length) entries.milestone = projected.milestones.map(item => item.id);
  for (const item of native.visibleCompanionEntities(catalog, progress, map)) {
    (entries[item.system] ??= []).push(item.id);
  }
  add('visible', progress, entries);
  const { caveat, ...recommended } = native.recommendUpgrades(map, progress.ascension, priorities, { limit: 12 });
  add('recommend', progress, {
    ...recommended,
    suggestions: recommended.suggestions.map(item => ({
      id: item.upgrade.id, title: item.upgrade.title, cost: item.cost, activation: item.upgrade.activation,
      basis: item.basis === 'fallback' ? 'catalog-cost-fallback' : 'wiki',
      priority: item.priority ?? null, tier: item.tier ?? null, sourceUrl: item.source?.url ?? null,
    })),
  });
}

const keyHash = value => createHash('sha256').update(value).digest('hex');
let choicesTested = 0;
for (const { id } of map.upgrades) {
  const result = native.planPurchase(map, empty.ascension, id);
  const toExpected = value => value.kind === 'ready' ? { kind: 'ready', profile: value.profile }
    : value.kind === 'choice' ? { kind: 'choice', key: keyHash(value.key), options: value.options.length } : { kind: 'blocked' };
  add('buy', empty, toExpected(result), { id, choices: {} });
  if (result.kind === 'choice' && choicesTested++ < 5) {
    result.options.forEach((_, choice) => add('buy', empty,
      toExpected(native.planPurchase(map, empty.ascension, id, { [result.key]: choice })),
      { id, choices: { [keyHash(result.key)]: choice } }));
  }
}
assert.ok(choicesTested > 0, 'Cover actual OR forks');
for (const { id } of [...map.upgrades.slice(0, 15), ...map.upgrades.filter(item => item.activation === 'after-ultra-ascension').slice(0, 12)]) {
  add('remove', owned, { kind: 'ready', profile: native.planRemoval(map, owned.ascension, id).profile }, { id });
  const activation = native.planAstralActivation(map, owned.ascension, id);
  add('activate', owned, activation.kind === 'ready' ? activation : { kind: 'blocked' }, { id });
}
for (const { id } of map.milestones.slice(0, 8)) {
  add('remove', owned, { kind: 'ready', profile: native.planRemoval(map, owned.ascension, id, true).profile }, { id, milestone: true });
}

let resets = 0;
for (const quantity of [null, '0', '999999998', '123456789012345678901234567890']) {
  const fixture = structuredClone(owned);
  for (const system of ['achievement', 'material', 'quest', 'village', 'divinity']) fixture.modules[system].tracked = true;
  fixture.modules.material.records[rules.materialReward.id] = quantity === null ? {} : { count: quantity, discovered: true };
  fixture.modules.divinity.records[catalog.entities.find(item => item.system === 'divinity').id] = { active: true, selected: true };
  if (quantity === '0') {
    for (const id of rules.achievementIds) fixture.modules.achievement.records[id] = { completed: false };
    for (const id of rules.materialIds) fixture.modules.material.records[id] ??= { discovered: false };
    for (const { id } of rules.quests) fixture.modules.quest.records[id] = { count: '13', completed: false, claimed: false };
  }
  const outcome = native.planCompanionUltraAscension(map, catalog, fixture);
  assert.ok(outcome.ok, 'The reviewed full ownership fixture must exercise a real reset');
  ++resets;
  add('reset', fixture, outcome);
}
const blocked = native.planCompanionUltraAscension(map, catalog, empty);
assert.ok(!blocked.ok);
add('reset', empty, { ok: false });
for (const { system, id } of catalog.entities.filter(item => item.system === 'craft' && item.permanent !== false).slice(0, 4)) {
  const input = { system, id, patch: { completed: false } };
  const observedAt = '2026-11-18T00:00:00Z';
  const outcome = native.planCompanionObservation(map, owned, system, id, input.patch, observedAt);
  assert.ok(outcome.ok);
  add('observe', owned, { ok: true, progress: outcome.progress }, { input, observedAt });
}

const php = process.env.PHP_BINARY || 'php';
const phpDir = execFileSync(php, ['-r', 'echo dirname(PHP_BINARY);'], { encoding: 'utf8' }).trim();
const extensions = execFileSync(php, ['-r', 'echo implode(",", get_loaded_extensions());'], { encoding: 'utf8' }).split(',');
const flags = process.platform === 'win32' ? ['-d', 'extension_dir=' + join(phpDir, 'ext')] : [];
if (!extensions.includes('mbstring')) flags.push('-d', 'extension=mbstring');
const actual = JSON.parse(execFileSync(php, [...flags, join(root, 'tests/mcp/parity.php')], {
  input: JSON.stringify({ map, catalog, rules, priorities, scenarios }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}));
assert.equal(actual.length, expected.length);
for (let i = 0; i < expected.length; ++i) {
  assert.deepEqual(actual[i], expected[i], 'PHP/TypeScript mismatch in ' + scenarios[i].action + ' fixture ' + (scenarios[i].id ?? i));
}
console.log('Utility MCP parity: ' + scenarios.length + ' catalog and progress scenarios matched TypeScript, including ' + resets + ' reviewed resets.');
