// What the COSMIC applet is told to draw. Run: node --test tests/*.test.cjs
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

function load(path) {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL(path, `file://${__filename}`), 'utf8'), context);
  return context;
}
const Model = load('../engine/Model.js');
const Pace = load('../engine/Pace.js');
const View = load('../ViewModel.js');
const catalog = JSON.parse(readFileSync(new URL('../engine/providers.json', `file://${__filename}`), 'utf8')).providers;
// Values made inside a vm context have that context's prototypes; compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

const hour = 3600000, now = 1900000000000;
const reading = (state = 'fresh', observedAt = now) => ({
  id: 'claude', name: 'Claude Code', plan: 'Max 20x', state, message: state === 'fresh' ? '' : 'Last reading · refresh failed',
  observedAt,
  windows: [
    {id: 'session', title: 'Session', used: 0.03, resetAt: now + 4 * hour, durationMs: 5 * hour},
    {id: 'weekly', title: 'Weekly', used: 0.21, resetAt: now + 22 * hour, durationMs: 168 * hour},
  ],
});
// Claude only, with the 5-hour window beside the weekly one: what most of these tests draw.
const claudeBoth = extra => View.settings(JSON.stringify({providers: ['claude'], barWindows: ['session', 'weekly'], ...extra}), catalog);
const draw = (prefs, usage) => plain(View.view(Model, Pace, catalog, prefs, id => usage[id], 'Next update in 4 min', now));

test('no settings file means the GNOME defaults: both providers, weekly in the panel, shown as what is left', () => {
  for (const raw of ['', 'not json', '[]', 'null']) {
    assert.deepEqual(plain(View.settings(raw, catalog)), {
      providers: ['claude', 'codex'], barWindows: ['weekly'],
      display: {claude: 'remaining', codex: 'remaining'}, demo: false,
    });
  }
});

test('settings keep only known providers, once each, and only the two display modes', () => {
  const prefs = plain(View.settings(JSON.stringify({
    providers: ['codex', 'nope', 'claude', 'codex'], display: {claude: 'used', codex: 'sideways'}, demo: true,
  }), catalog));
  assert.deepEqual(prefs.providers, ['codex', 'claude']);
  assert.deepEqual(prefs.display, {claude: 'used', codex: 'remaining'});
  assert.equal(prefs.demo, true);
});

test('an empty provider list is respected, not replaced by the default', () => {
  assert.deepEqual(plain(View.settings('{"providers": []}', catalog)).providers, []);
});

test('a fresh reading: panel text, one row per window, what is left', () => {
  const doc = draw(claudeBoth(), {claude: reading()});
  assert.deepEqual(doc.bar, [{id: 'claude', icon: 'claude.svg', text: '5h 97% · 7d 79%'}]);
  assert.equal(doc.providers.length, 1);
  assert.equal(doc.providers[0].plan, 'Max 20x');
  assert.equal(doc.providers[0].status, '');
  assert.deepEqual(doc.providers[0].windows.map(w => [w.title, w.value, w.fill, w.reset, w.dim]), [
    ['Session', '97% left', 0.97, 'Resets 4h 0m', false],
    ['Weekly', '79% left', 0.79, 'Resets 22h 0m', false],
  ]);
  assert.equal(doc.footer, 'Next update in 4 min');
});

test('with no settings file: the weekly window alone in the panel, and a provider with no reading shows a dash', () => {
  const doc = draw(View.settings('', catalog), {claude: reading()});
  assert.deepEqual(doc.bar, [
    {id: 'claude', icon: 'claude.svg', text: '79%'},
    {id: 'codex', icon: 'openai.svg', text: '—'},
  ]);
  assert.deepEqual(doc.providers.map(p => [p.id, p.windows.length]), [['claude', 2], ['codex', 0]]);
});

test('used mode turns the numbers and the meter round', () => {
  const doc = draw(claudeBoth({display: {claude: 'used'}}), {claude: reading()});
  assert.equal(doc.bar[0].text, '5h 3% · 7d 21%');
  assert.deepEqual(doc.providers[0].windows.map(w => [w.value, w.fill]), [['3% used', 0.03], ['21% used', 0.21]]);
});

test('an old reading is marked in the panel, dimmed in the popup, and explained', () => {
  const doc = draw(claudeBoth(), {claude: reading('stale', now - 15 * 60000)});
  assert.equal(doc.bar[0].text, '5h 97% ! · 7d 79% !');
  assert.ok(doc.providers[0].windows.every(w => w.dim));
  assert.equal(doc.providers[0].status, 'Last reading · refresh failed');
});

test('before the first reading the panel shows a dash and the popup says it is checking', () => {
  const doc = draw(View.settings('', catalog), {});
  assert.equal(doc.bar[0].text, '—');
  assert.equal(doc.providers[0].status, 'Checking usage…');
  assert.deepEqual(doc.providers[0].windows, []);
});

test('burning fast: flame in the panel, red meter and a limit time in the popup', () => {
  const fast = reading();
  fast.windows[0] = {id: 'session', title: 'Session', used: 0.4, resetAt: now + 4 * hour, durationMs: 5 * hour};
  const doc = draw(claudeBoth(), {claude: fast});
  assert.equal(doc.bar[0].text, '5h 60% 🔥 · 7d 79%');
  const session = doc.providers[0].windows[0];
  assert.equal(session.severity, 'critical');
  assert.equal(session.warning, '🔥 Limit in 1h 30m');
  assert.equal(session.marker, 0.8);
});

test('the footer speaks in minutes', () => {
  const state = {demo: false, updating: false, selected: true, nextRefreshAt: now + 4.5 * 60000};
  assert.equal(View.footer(state, now), 'Next update in 4 min');
  assert.equal(View.footer({...state, nextRefreshAt: now + 30000}, now), 'Next update in <1 min');
  assert.equal(View.footer({...state, nextRefreshAt: Infinity}, now), 'Next update soon');
  assert.equal(View.footer({...state, updating: true}, now), 'Updating…');
  assert.equal(View.footer({...state, selected: false}, now), 'Updates paused');
  assert.equal(View.footer({...state, demo: true}, now), 'Sample data');
});
