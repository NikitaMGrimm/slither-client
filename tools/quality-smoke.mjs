import assert from 'node:assert/strict';

// Original synthetic real-Wasm ABI cases; no reference, renderer, host or network.
export function qualitySmoke(wasm) {
  const view = quality => JSON.parse(quality.snapshot());
  const invalidModes = [-1, -Number.MIN_VALUE, 0.5, 1 + Number.EPSILON, 2, 256, 2 ** 32, NaN, Infinity, -Infinity];
  for (const requested of invalidModes) assert.throws(() => new wasm.DesktopQuality(requested, 0));
  for (const start of [NaN, Infinity, -Infinity]) assert.throws(() => new wasm.DesktopQuality(1, start));

  const quality = new wasm.DesktopQuality(0, 0);
  const clock = new wasm.AnimationClock(0);
  let now = 0;
  function advance(milliseconds, playing = true, lagging = false) {
    now += milliseconds;
    const step = clock.advance(now, lagging, false);
    try { quality.advance(step, playing); }
    finally { step.free(); }
  }
  try {
    assert.deepEqual(view(quality), { requested: 0, highQuality: true, qualityBlend: 1,
      qualityScale: 1, lowFpsCounter: 0, lastStatisticsMs: 0 });
    quality.begin_connection();
    assert.deepEqual(view(quality), { requested: 0, highQuality: false, qualityBlend: 0,
      qualityScale: 1.7, lowFpsCounter: 0, lastStatisticsMs: 0 });
    quality.set_requested_mode(1);
    assert.equal(view(quality).highQuality, false, 'preference does not immediately apply');
    assert.equal(quality.update_statistics(1001, 60, true), true);
    assert.equal(view(quality).highQuality, false, 'no history means no recovery trigger');
    quality.begin_connection();
    assert.equal(view(quality).highQuality, true);
    assert.equal(view(quality).qualityBlend, 1);
    assert.equal(view(quality).qualityScale, 1);
    assert.equal(view(quality).lastStatisticsMs, 1001, 'connection preserves statistics cadence');

    for (const requested of invalidModes) {
      const stable = quality.snapshot();
      assert.throws(() => quality.set_requested_mode(requested));
      assert.equal(quality.snapshot(), stable, 'invalid preference cannot mutate or narrow');
    }
    const invalidCounts = [-1, -Number.MIN_VALUE, 0.5, 24.5, 4294967295.5,
      4294967296, 2 ** 32 + 24, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, NaN, Infinity, -Infinity];
    for (const playing of [false, true]) {
      for (const count of invalidCounts) {
        const stable = quality.snapshot();
        assert.throws(() => quality.update_statistics(2002, count, playing));
        assert.equal(quality.snapshot(), stable, 'invalid count preserves flags, history and timestamp');
        assert.throws(() => quality.update_statistics(1001, count, playing));
        assert.equal(quality.snapshot(), stable, 'count is validated even before the interval is due');
      }
    }
    for (const time of [NaN, Infinity, -Infinity]) {
      const stable = quality.snapshot();
      assert.throws(() => quality.update_statistics(time, 24, true));
      assert.equal(quality.snapshot(), stable, 'invalid time is atomic');
    }
    assert.equal(quality.update_statistics(2001, 0, true), false, 'strictly greater than 1000 ms');
    assert.equal(quality.update_statistics(500, 0, true), false, 'backward time leaves interval untouched');
    advance(40);
    assert.equal(quality.update_statistics(2002, 24, true), true);
    assert.deepEqual(view(quality), { requested: 1, highQuality: false, qualityBlend: 1,
      qualityScale: 1, lowFpsCounter: 1, lastStatisticsMs: 2002 });
    assert.equal(quality.update_statistics(2002, 0, true), false, 'one consumption per interval');
    advance(4, true, true);
    assert.equal(view(quality).qualityBlend, 1 - 0.425 * 0.0075);
    assert.equal(view(quality).qualityScale, 1 + 0.425 * 4E-5);
    const paused = quality.snapshot();
    advance(40, false);
    assert.equal(quality.snapshot(), paused, 'not playing freezes interpolation');
    advance(0);
    assert.equal(quality.snapshot(), paused, 'zero delta freezes interpolation');

    let statisticsTime = 2002;
    for (const count of [25, 31]) {
      statisticsTime += 1001;
      assert.equal(quality.update_statistics(statisticsTime, count, true), true);
      assert.equal(view(quality).lowFpsCounter, 1, 'LQ deadband retains history');
      assert.equal(view(quality).highQuality, false);
    }
    let history = 1;
    for (let interval = 0; interval < 10; interval++) {
      history *= 0.987;
      history -= 0.1;
      statisticsTime += 1001;
      quality.update_statistics(statisticsTime, 32, true);
      assert.equal(view(quality).lowFpsCounter, history);
      assert.equal(view(quality).highQuality, history <= 0);
    }
    assert.ok(history < 0, 'recovery keeps its negative residual');
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 0, true);
    assert.equal(view(quality).highQuality, true, 'first poor interval after recovery can remain HQ');
    assert.equal(view(quality).lowFpsCounter, history + 1);
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 25, true);
    assert.equal(view(quality).lowFpsCounter, (history + 1) * 0.987 - 0.1, 'HQ decays history at 25 draws');
    quality.set_requested_mode(0);
    const lowPreference = view(quality);
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 0, true);
    assert.equal(view(quality).lowFpsCounter, lowPreference.lowFpsCounter, 'low preference freezes adaptation');
    assert.equal(view(quality).highQuality, true, 'low preference alone does not force runtime low');
    quality.begin_connection();
    quality.begin_skin_preview();
    assert.deepEqual(view(quality), { requested: 0, highQuality: true, qualityBlend: 1,
      qualityScale: 1, lowFpsCounter: 0, lastStatisticsMs: statisticsTime });
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 0, true);
    assert.equal(view(quality).highQuality, true, 'LQ-requested preview retains HQ');
    quality.set_requested_mode(1);
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 24, true);
    assert.equal(view(quality).highQuality, false, 'preview initialization does not block later fallback');

    const serialized = quality.snapshot();
    const copy = JSON.parse(serialized);
    copy.requested = 99; copy.highQuality = true; copy.qualityBlend = 9;
    copy.qualityScale = 9; copy.lowFpsCounter = 9; copy.lastStatisticsMs = 9;
    assert.equal(quality.snapshot(), serialized, 'snapshot cannot expose mutable backing state');
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 0, false);
    assert.equal(view(quality).lastStatisticsMs, statisticsTime, 'inactive interval is consumed');
    assert.equal(view(quality).lowFpsCounter, 1, 'inactive interval does not adapt');
    assert.equal(JSON.parse(serialized).lastStatisticsMs, statisticsTime - 1001, 'old snapshots remain unchanged');
    statisticsTime += 1001;
    quality.update_statistics(statisticsTime, 4294967295, true);
    assert.equal(view(quality).lowFpsCounter, 0.887, 'inclusive u32 maximum is accepted without wrapping');
  } finally { quality.free(); clock.free(); }

  const overflow = new wasm.DesktopQuality(1, -Number.MAX_VALUE);
  try {
    const stable = overflow.snapshot();
    assert.throws(() => overflow.update_statistics(Number.MAX_VALUE, 0, true));
    assert.equal(overflow.snapshot(), stable, 'elapsed overflow preserves the complete state');
  } finally { overflow.free(); }

  const first = new wasm.DesktopQuality(-0, -1);
  const second = new wasm.DesktopQuality(1, 0);
  const sharedClock = new wasm.AnimationClock(0);
  const sharedStep = sharedClock.advance(8, false, false);
  try {
    assert.equal(view(first).requested, 0, 'negative zero is numeric zero');
    first.begin_connection();
    first.begin_skin_preview();
    second.update_statistics(1001, 24, true);
    second.advance(sharedStep, true);
    assert.equal(sharedStep.delta, 1, 'advance borrows rather than consuming the owned step');
    assert.equal('inner' in sharedStep, false, 'crate-private step storage is not a Wasm field');
    first.advance(sharedStep, true);
    assert.equal(view(first).qualityBlend, 1);
    assert.equal(view(second).qualityBlend, 1 - 0.0075);
    assert.equal(view(second).qualityScale, 1 + 4E-5);
    assert.equal(first.update_statistics(1000, -0, true), true, 'zero count accepts negative zero');
  } finally { sharedStep.free(); sharedClock.free(); first.free(); second.free(); }
}
