// Authored protocol-19 lifecycle data, not a simulator or captured game stream.
import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

const u16 = value => [value >>> 8 & 255, value & 255];
const u24 = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];
const absolute = value => u24((32550 + value) * 5);

export function createBrowserLocalPlayFixture() {
  const name = [...new TextEncoder().encode('Synthetic life')];
  const own = [115, ...u16(0), ...u24(0), 48, ...u24(0), ...u16(128), ...u24(0), 0,
    ...absolute(0), ...absolute(0), name.length, ...name, 0, 0,
    ...absolute(-122), ...absolute(0), ...Array.from({ length: 10 }, () => [143, 127]).flat(), ...u16(0)];
  return {
    kind: 'authored-synthetic',
    defaultRuntime: { entry: 'extension/game-bootstrap.mjs', diagnosticUi: false },
    // No food/prey appearances or their entropy are needed by this witness.
    packets: [{ at: 0, bytes: bundle(syntheticSetup(), own, [108, 0, 0, 1, 0, 1]) }],
    // Capture final score before the ordinary snake-death command in the same frame.
    named: { death: bundle([118, 0], [115, 0, 0, 1]) },
  };
}
