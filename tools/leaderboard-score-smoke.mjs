import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

// Authored same-host oracle. Preserve each arithmetic operation and Math.pow.
function scoreTable(n) {
  const factors = [], cumulative = [];
  for (let i = 0; i <= n; i++) {
    factors.push(i === n ? factors[i - 1] : Math.pow(1 - i / n, 2.25));
    cumulative.push(i === 0 ? 0 : cumulative[i - 1] + 1 / factors[i - 1]);
  }
  return (count, mass) => {
    if (count > n + 2048) return NaN;
    const index = Math.min(count, n);
    const divided = mass / factors[index];
    const added = cumulative[index] + divided;
    const subtracted = added - 1;
    const multiplied = subtracted * 15;
    return Math.floor(multiplied - 5) / 1;
  };
}

/** Real Rust/Wasm numeric projection; no browser, transport or source artwork. */
export function leaderboardScoreSmoke(wasm) {
  const projector = new wasm.LeaderboardScoreProjector();
  let assertions = 0;
  const same = (actual, expected) => { assertions++; assert(Object.is(actual, expected)); };
  const rejects = callback => { assertions++; assert.throws(callback); };
  try {
    for (const n of [1, 10, 300, 65535, 1]) {
      const oracle = scoreTable(n);
      const counts = [0, 1, n, Math.min(65535, n + 2048), Math.min(65535, n + 2049), 65535];
      const masses = [0, .5, 1, 1 / 16777215, 8388608 / 16777215, -0];
      const result = projector.project(n, Float64Array.from(counts), Float64Array.from(masses));
      same(result.length, counts.length);
      for (let i = 0; i < counts.length; i++) same(result[i], oracle(counts[i], masses[i]));
      // Output is independent owned storage, and subsequent projections preserve it.
      const saved = result.slice();
      projector.project(n, new Float64Array(), new Float64Array());
      for (let i = 0; i < counts.length; i++) same(result[i], saved[i]);
    }
    for (const n of [0, -1, 65536, NaN, Infinity, 1.5, '1', null, undefined]) {
      rejects(() => projector.project(n, new Float64Array(), new Float64Array()));
    }
    for (const count of [-1, 65536, .5, NaN, Infinity]) {
      rejects(() => projector.project(1, Float64Array.of(count), Float64Array.of(0)));
    }
    for (const mass of [-1, 1.000001, NaN, Infinity]) {
      rejects(() => projector.project(1, Float64Array.of(65535), Float64Array.of(mass)));
    }
    for (const counts of [[], new Uint16Array(), new Proxy(new Float64Array(), {})]) {
      rejects(() => projector.project(1, counts, new Float64Array()));
    }
    rejects(() => projector.project(1, Float64Array.of(0), new Float64Array()));
    rejects(() => projector.project(1, new Float64Array(149796), new Float64Array(149796)));
    const foreign = runInNewContext('Float64Array.of(0, 1)');
    const result = projector.project(1, foreign, Float64Array.of(0, 0));
    same(result[0], -20); same(result[1], -5);
    same(projector.project(1, Float64Array.of(1), Float64Array.of(1))[0], 10);
  } finally { projector.free(); }
  console.log(`Leaderboard score real-Wasm checks passed (${assertions} assertions; exact host Math.pow oracle).`);
}
