// Authored Playwright/DOM action doubles only; these are not browser acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { runScenarioSteps, validateScenario } from './browser-scenario-steps.mjs';
import { createClientInput } from './fixtures/client-input-fixture.mjs';
import { createSyntheticSession, createPeerReceipt } from './browser-session-fixture.mjs';

function harness(steps) {
  const trace = [], receipt = { connections: 1, logins: 1, closed: 0, inputs: [] };
  const page = {
    keyboard: { async press(key) { trace.push(['press', key]); }, async down(key) { trace.push(['down', key]); }, async up(key) { trace.push(['up', key]); } },
    mouse: { async move(x, y) { trace.push(['move', x, y]); } },
    clock: { async runFor(ms) { trace.push(['clock', ms]); } },
    locator: selector => ({ async textContent() { trace.push(['text', selector]); return '165'; },
      async isVisible() { return true; }, async isEnabled() { return true; }, async click() {}, async fill() {} }),
    async evaluate(_fn, argument) { trace.push(['editor', argument]); },
    async screenshot(options) { trace.push(['screenshot', options.path]); return Buffer.from('AUTHORED IMAGE DOUBLE'); },
  };
  const peer = { receipt, advance(ms) { trace.push(['packet-clock', ms]); },
    deliver(name) { trace.push(['deliver', name]); }, disconnect() { trace.push(['disconnect']); } };
  const scenario = { kind: 'authored-synthetic', viewport: { width: 640, height: 480 }, steps };
  const result = { actions: [], checkpoints: [] };
  return { page, peer, trace, scenario, result,
    run: () => runScenarioSteps({ page, peer, scenario, result, output: '/authored-unused', waitForIngress: async () => {} }) };
}

test('callable step runner sends ingress before clock updates and supports legacy actions', async () => {
  const h = harness([{ op: 'press', key: 'Enter' }, { op: 'advance', ms: 50 }, { op: 'disconnect' }]);
  await h.run();
  assert.deepEqual(h.trace, [['press', 'Enter'], ['packet-clock', 25], ['clock', 25], ['packet-clock', 25], ['clock', 25], ['disconnect']]);
  assert.deepEqual(h.result.actionCleanupErrors, []);
});

test('native action methods, exact input counters and remembered final text remain explicit assertions', async () => {
  const h = harness([{ op: 'move', x: 400, y: 200 }, { op: 'key-down', key: 'Space' }, { op: 'key-up', key: 'Space' },
    { op: 'packet', name: 'death' }, { op: 'remember-text', selector: 'current', name: 'score' },
    { op: 'assert-text', selector: 'final', remember: 'score' },
    { op: 'assert-peer', counts: { logins: 1, boostOff: 1, turn: { min: 1 } } },
    { op: 'mark-peer', name: 'editing' }, { op: 'assert-peer', since: 'editing', counts: { heading: 0, boostOn: 0 } }]);
  h.peer.receipt.inputs.push({ kind: 'boostOff' }, { kind: 'turn' }); await h.run();
  assert.deepEqual(h.trace.slice(0, 4), [['move', 400, 200], ['down', 'Space'], ['up', 'Space'], ['deliver', 'death']]);
  assert.equal(h.result.assertions.length, 4); assert.equal(h.result.assertions[1].text, '165');
});

test('checkpoint hook is injectable without browser ownership and screenshot names cannot escape output', async () => {
  const h = harness([{ op: 'screenshot', name: 'return' }]); let calls = 0;
  await runScenarioSteps({ ...h, output: '/authored-unused', onCheckpoint: ({ peer }) => { calls++; return { logins: peer.receipt.logins }; } });
  assert.equal(calls, 1); assert.deepEqual(h.result.checkpoints[0].observation, { logins: 1 });
  await assert.rejects(harness([{ op: 'screenshot', name: '../escape' }]).run(), /safe screenshot/);
});

test('failure releases held input and removes authored editor, retaining the primary failure', async () => {
  const h = harness([{ op: 'editor', visible: true }, { op: 'key-down', key: 'Space' }, { op: 'unsupported' }]);
  await assert.rejects(h.run(), /Unsupported scenario/);
  assert.deepEqual(h.trace.slice(-2), [['up', 'Space'], ['editor', 'slither-scenario-editor']]);
  const broken = harness([{ op: 'key-down', key: 'Space' }]); broken.page.keyboard.up = async () => { throw 0; };
  await assert.rejects(broken.run(), /cleanup failed/); assert.deepEqual(broken.result.actionCleanupErrors, ['held-key release failed']);
});

test('invalid semantic checkpoint references and missing counter kinds fail closed', async () => {
  await assert.rejects(harness([{ op: 'assert-text', selector: 'final', remember: 'unknown' }]).run(), /text checkpoint/);
  await assert.rejects(harness([{ op: 'assert-peer', since: 'unknown', counts: { logins: 1 } }]).run(), /Unknown input/);
  await assert.rejects(harness([{ op: 'assert-peer', counts: { invented: 1 } }]).run(), /Unknown peer/);
  await assert.rejects(harness([{ op: 'move', x: -1, y: 10 }]).run(), /pointer/);
});

test('committed default scenario covers input/editor release, final capture, return and second explicit Play', () => {
  const scenario = validateScenario(JSON.parse(fs.readFileSync(new URL('./browser-local-play.json', import.meta.url))));
  assert.equal(scenario.expectedLogins, 2); assert.equal(scenario.fixture, 'local-play-lifecycle');
  const steps = scenario.steps;
  assert.equal(steps.filter(x => x.op === 'click' && x.name === 'Play').length, 2);
  const down = steps.findIndex(x => x.op === 'key-down' && x.key === 'Space');
  const editor = steps.findIndex(x => x.op === 'focus' && x.label === 'Scenario editor');
  const release = steps.findIndex(x => x.op === 'key-up' && x.key === 'Space');
  assert.ok(down < editor && editor < release);
  assert.equal(steps[editor + 1].state, 'focused');
  assert.ok(steps.some(x => x.op === 'assert-peer' && x.since === 'editing' && x.counts.turn === 0 && x.counts.boostOn === 0));
  const death = steps.findIndex(x => x.op === 'packet' && x.name === 'death');
  const final = steps.findIndex(x => x.op === 'assert-text' && x.remember === 'current-score');
  assert.ok(death < final);
  const noReconnect = steps.findIndex(x => x.op === 'assert-peer' && x.counts.closed === 1 && x.counts.logins === 1);
  const secondPlay = steps.findLastIndex(x => x.op === 'click' && x.name === 'Play');
  assert.ok(final < noReconnect && noReconnect < secondPlay);
  assert.ok(steps.some(x => x.op === 'assert-peer' && x.counts.logins === 2));
  assert.equal(steps.filter(x => x.op === 'advance').reduce((sum, x) => sum + x.ms, 0) < 10000, true);
});

// In-memory host-route model plus the actual input owner and step runner. This
// witnesses assertion sensitivity; it does not establish native DOM delivery.
async function editorInputProbe(mutation) {
  const committed = JSON.parse(fs.readFileSync(new URL('./browser-local-play.json', import.meta.url)));
  const start = committed.steps.findIndex(x => x.op === 'key-down' && x.key === 'Space');
  const end = committed.steps.findIndex(x => x.op === 'editor' && !x.visible);
  const h = harness(committed.steps.slice(start, end + 1));
  const input = createClientInput();
  input.setConnected(true);
  input.setOwn({ token: 'authored-own', wantedHeading: 0, gazeHeading: 0, dead: false,
    turnRate: 0.1, sizeTurnFactor: 1, speedTurnFactor: 1 });
  const receipt = createPeerReceipt();
  const session = createSyntheticSession({ receipt, send() {}, close() {} });
  session.receive(Uint8Array.of(99, 0));
  session.receive(new Uint8Array(27).fill(65));
  session.receive(Uint8Array.from([115, 30, ...Array(22).fill(0)]));
  h.peer.receipt = receipt;
  let editing = false, now = 1000, mouseups = 0;
  h.page.keyboard.down = async key => {
    if (!editing || mutation === 'forward-editor-keydown') input.keyDown(key);
  };
  h.page.keyboard.up = async key => {
    if (!(editing && key === 'Space' && mutation === 'drop-editor-keyup')) input.keyUp(key);
  };
  h.page.getByLabel = () => ({
    async focus() { editing = true; }, async count() { return 1; },
    async evaluate() { return editing; },
    async click() { mouseups++; editing = true; input.mouseUp(); },
  });
  h.page.clock.runFor = async ms => {
    now += ms;
    input.tick({ nowMs: now, wholeSteps: 1 }, bytes => session.receive(bytes));
  };
  try { await h.run(); }
  finally { session.end(); }
  assert.equal(mouseups, 0, 'focus setup must not release boost through mouseup');
  assert.equal(input.snapshot().boostKeyHeld, false);
  return h.result;
}

test('editor release and held-key suppression assertions reject both actual-input negative controls', async () => {
  const good = await editorInputProbe();
  assert.deepEqual(good.assertions.at(-1).actual, {
    connections: 1, logins: 1, closed: 0, heading: 0, turn: 0, boostOn: 0, boostOff: 0, ping: 0,
  });
  await assert.rejects(editorInputProbe('drop-editor-keyup'), /Scenario assertion failed/);
  await assert.rejects(editorInputProbe('forward-editor-keydown'), /Scenario assertion failed/);
});
