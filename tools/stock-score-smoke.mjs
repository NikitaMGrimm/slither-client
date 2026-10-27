import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';
import { unpackCommands } from '../web/handshake-session.mjs';

const word = value => [value >>> 8 & 255, value & 255];
const triple = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];

// Authored Node-host Math.pow oracle; no browser or external numeric arrays.
function score(n, index, mass) {
  assert.ok(index <= n + 2048);
  const factors = [], cumulative = [];
  for (let i = 0; i <= n; i++) {
    factors.push(i === n ? factors[i - 1] : Math.pow(1 - i / n, 2.25));
    cumulative.push(i === 0 ? 0 : cumulative[i - 1] + 1 / factors[i - 1]);
  }
  const at = Math.min(index, n);
  const divided = mass / factors[at];
  const added = cumulative[at] + divided;
  const subtracted = added - 1;
  const multiplied = subtracted * 15;
  const shifted = multiplied - 5;
  return Math.floor(shifted) / 1;
}

/** Real Wasm score-state ABI with authored packets only; no Canvas or network. */
export function stockScoreSmoke(wasm) {
  let assertions = 0, primaryFailed = false;
  const cases = [], owners = [];
  const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  const rejects = callback => { assertions++; assert.throws(callback); };
  const commands = unpackCommands(wasm.decode_frame(syntheticScene(), false));
  const appearance = commands.find(command => command[0] === 115);
  const setup = n => { const value = syntheticSetup(); value.set(word(n), 4); return value; };
  const spawn = id => { const value = Uint8Array.from(appearance); value.set(word(id), 1); return value; };
  const scene = (enabled = true) => {
    const value = new wasm.AnimatedScene(0); owners.push(value);
    if (enabled) value.enable_score_tracking();
    return value;
  };
  function view(value) {
    const snapshot = value.snapshot();
    const result = value.score_view();
    eq(Reflect.ownKeys(result).sort(), ['schema', 'enabled', 'tableMax', 'own', 'status', 'score', 'error'].sort());
    eq(result.schema, 1);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(result))) ok(Object.hasOwn(descriptor, 'value'));
    if (result.own !== null) {
      eq(Reflect.ownKeys(result.own).sort(), ['token', 'id', 'logicalSegments', 'fractionalMass', 'scoreAdjustment', 'scoreIndex'].sort());
      eq(typeof result.own.token, 'bigint');
      eq(result.own.scoreIndex, result.own.logicalSegments + result.own.scoreAdjustment);
    }
    eq(value.snapshot(), snapshot, 'score read does not mutate the scene');
    return result;
  }
  function ready(value) {
    const result = view(value);
    eq(result.status, 'ready'); eq(result.error, null);
    eq(result.score, score(result.tableMax, result.own.scoreIndex, result.own.fractionalMass));
    return result;
  }
  function unchangedAfterFailure(value, callback) {
    const before = value.score_view(), snapshot = value.snapshot();
    rejects(callback); eq(value.score_view(), before); eq(value.snapshot(), snapshot);
  }
  try {
    const legacy = scene(false);
    eq(view(legacy), { schema: 1, enabled: false, tableMax: null, own: null,
      status: 'disabled', score: null, error: null });
    legacy.apply_frame(bundle([82], [82, 4], [82, 4, 5]), false);
    eq(JSON.parse(legacy.snapshot()).ignored, 3);
    unchangedAfterFailure(legacy, () => legacy.enable_score_tracking());
    legacy.reset(); legacy.enable_score_tracking();
    eq(view(legacy).status, 'no-tables');
    cases.push('legacy opaque R and explicit enablement');

    const own = scene();
    eq(view(own).status, 'no-tables');
    unchangedAfterFailure(own, () => own.apply_frame(Uint8Array.of(82, 3), false));
    unchangedAfterFailure(own, () => own.apply_frame(bundle(setup(430), [82, 3], spawn(0)), false));
    own.apply_frame(setup(430), false);
    eq(view(own).status, 'no-own');
    own.apply_frame(spawn(0), false);
    eq(ready(own).own.logicalSegments, 12);
    cases.push('canonical R requires event-position own');

    const token = own.score_view().own.token;
    const beforeR = JSON.parse(own.snapshot()).own;
    own.apply_frame(bundle([82, 8], [82, 8], [82, 3]), false);
    eq(ready(own).own.scoreAdjustment, 3);
    eq(JSON.parse(own.snapshot()).own, beforeR, 'R schedules no body or smoothing change');
    for (const invalid of [[82], [82, 1, 2]]) unchangedAfterFailure(own, () => own.apply_frame(Uint8Array.from(invalid), false));
    eq(JSON.parse(own.snapshot()).ignored, 0);
    cases.push('replacement R leaves geometry unchanged and malformed R rolls back');

    own.apply_frame(Uint8Array.from([104, 0, 0, ...triple(8_388_608)]), false);
    own.apply_frame(Uint8Array.of(114, 0, 0), false);
    const latest = ready(own);
    eq(latest.own.logicalSegments, 11);
    eq(latest.own.fractionalMass, 8_388_608 / 16_777_215);
    const copied = own.score_view(); copied.own.scoreAdjustment = 255; copied.score = 0;
    eq(own.score_view(), latest, 'copied observation cannot mutate native state');
    cases.push('latest unsmoothed mass/logical count and independent copied record');

    own.apply_frame(bundle(setup(2), setup(2), setup(17)), false);
    eq(ready(own).tableMax, 17); eq(own.score_view().own.scoreAdjustment, 3);
    own.reset();
    eq(view(own).tableMax, 17); eq(own.score_view().status, 'no-own'); eq(own.score_view().enabled, true);
    own.apply_frame(bundle(setup(17), spawn(7)), false);
    eq(ready(own).own.scoreAdjustment, 0); ok(own.score_view().own.token > token);
    cases.push('table cache/mode persist reset; own/R identity resets');

    const retained = scene();
    retained.apply_frame(bundle(setup(430), spawn(0), [82, 9], [115, 0, 0, 1], spawn(0)), false);
    const original = retained.score_view().own;
    for (let i = 1; i <= 12; i++) { const step = retained.advance(i * 40, false); step.free(); }
    retained.apply_frame(bundle([104, 0, 0, ...triple(16_777_215)], [82, 23]), false);
    const after = ready(retained).own;
    eq(after.token, original.token); eq(after.logicalSegments, original.logicalSegments);
    eq(after.fractionalMass, original.fractionalMass); eq(after.scoreAdjustment, 23);
    eq(retained.control_view().own.dead, true);
    eq(retained.control_view().own.token, original.token, 'control and score retain the same original own');
    cases.push('retained original own survives death/expiry/wire reuse');

    unchangedAfterFailure(own, () => own.apply_frame(bundle(setup(3), [82, 255], [104]), false));
    unchangedAfterFailure(own, () => own.apply_frame(setup(0), false));
    let resolverCalls = 0;
    const primary = { authoredResolverFailure: true };
    const before = own.score_view(), snapshot = own.snapshot();
    let failed = false, caught;
    try {
      own.apply_frame_with_eye_geometry(bundle(setup(3), [82, 255], spawn(8)), false, () => {
        resolverCalls++; throw primary;
      });
    } catch (error) { failed = true; caught = error; }
    eq(failed, true); eq(caught, primary); eq(resolverCalls, 1);
    eq(own.score_view(), before); eq(own.snapshot(), snapshot);
    cases.push('late packet/resolver failures preserve tables/R/model and primary identity');

    const resetStep = own.advance_with_control(8, false, request => {
      eq(request.wholeSteps, 1);
      return { resetWorld: true, connected: false };
    });
    resetStep.free();
    eq(view(own).tableMax, 17); eq(own.score_view().status, 'no-own');
    eq(own.score_view().enabled, true);
    own.apply_frame(bundle(setup(17), spawn(9)), false);
    eq(ready(own).own.scoreAdjustment, 0);
    cases.push('same-step control reset preserves mode/tables without retaining own R');

    const short = scene();
    const emptyBody = [115, 0, 9, ...triple(0), 48, ...triple(0), ...word(128),
      ...triple(0), 0, ...triple(500_000), ...triple(5000), 0, 0, 255];
    short.apply_frame(bundle(setup(1), emptyBody), false);
    eq(ready(short).score, -20); eq(short.score_view().own.logicalSegments, 0);
    short.apply_frame(Uint8Array.of(82, 1), false);
    eq(ready(short).score, -5);
    short.apply_frame(Uint8Array.from([104, 0, 9, ...triple(16_777_215)]), false);
    eq(ready(short).score, 10);
    cases.push('analytic negative and positive integer scores cross the ABI unchanged');

    const outside = scene();
    // A long authored body exceeds the small table while remaining within geometry limits.
    const long = Uint8Array.from([115, 0, 5, ...triple(0), 48, ...triple(0), ...word(128),
      ...triple(0), 0, ...triple(500_000), ...triple(5000), 0, 0, 255,
      ...triple(38_000), ...triple(5000), ...Array.from({ length: 2198 }, () => [211, 127]).flat(), 0, 0]);
    outside.apply_frame(bundle(setup(1), long), false);
    const unsupported = view(outside);
    ok(unsupported.own.scoreIndex > 2049); eq(unsupported.status, 'unsupported');
    eq(unsupported.error, 'index-out-of-range'); eq(unsupported.score, null);
    cases.push('unsupported index is an explicit observation without clamping');

    return { assertions, cases: cases.length, checks: cases, owners: owners.length,
      networkConnections: 0, evidence: 'authored Node host Math.pow/real-Wasm score-state; no browser/HUD acceptance' };
  } catch (error) { primaryFailed = true; throw error; }
  finally {
    const cleanupErrors = [];
    for (const owner of owners) { try { owner.free(); } catch (error) { cleanupErrors.push(error); } }
    if (cleanupErrors.length) {
      if (primaryFailed) console.error('Additional score smoke cleanup failures:', cleanupErrors);
      else throw new AggregateError(cleanupErrors, 'Score smoke cleanup failed');
    }
  }
}

const fingerprint = name => {
  const bytes = fs.readFileSync(name);
  return { path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Supply explicit generated JS and Wasm paths');
  const files = process.argv.slice(2).map(name => path.resolve(name));
  const before = files.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-score-smoke-before', artifacts: before }));
  let result, failed = false, primary;
  try {
    const wasm = await import(pathToFileURL(files[0]).href);
    wasm.initSync({ module: fs.readFileSync(files[1]) });
    result = stockScoreSmoke(wasm);
  } catch (error) { failed = true; primary = error; }
  const after = files.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-score-smoke-after', artifacts: after,
    unchanged: JSON.stringify(before) === JSON.stringify(after), result, failed,
    failure: failed ? String(primary?.stack ?? primary) : null }));
  let fingerprintFailure;
  try { assert.deepEqual(after, before, 'Supplied generated artifacts changed during smoke'); }
  catch (error) { fingerprintFailure = error; }
  if (failed) { if (fingerprintFailure) console.error(fingerprintFailure); throw primary; }
  if (fingerprintFailure) throw fingerprintFailure;
}
