import scenario from './browser-prey-scenario.json' with { type: 'json' };
import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

// Original protocol-19 fixture authorship only. Rust parses and owns all lifecycle
// state. The future shared runner supplies transport/clock/default bootstrap;
// this module neither starts a browser nor opens a socket/server.
const u16 = n => [n >>> 8 & 255, n & 255];
const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
const position = n => u24((32550 + n) * 5);
function command(event) {
  const { op, id, x, y } = event;
  switch (op) {
    case 'setup': return syntheticSetup();
    case 'snake': return [115, ...u16(id), ...u24(0), 48, ...u24(0), ...u16(128), ...u24(0), event.skin,
      ...position(x), ...position(y), 0, 0, 0, ...position(x - 122), ...position(y),
      ...Array.from({ length: 10 }, () => [143, 127]).flat(), ...u16(0)];
    case 'prey': return [121, ...u16(id), event.color, ...position(x), ...position(y),
      22, 48, ...u24(0), ...u24(0), ...u16(64)];
    // Canonical short j position uses the protocol's divided-by-three offset.
    case 'motion': return [106, ...u16(id), ...u16((x - 1) / 3), ...u16((y - 1) / 3)];
    case 'capture': return [121, ...u16(id), ...u16(event.eater)];
    case 'remove': return [121, ...u16(id)];
    case 'snake-death': return [115, ...u16(id), 1];
    default: throw new Error('Unknown authored prey fixture event');
  }
}

/** Post-handshake packets for the actual default consumer, with authored sources.
 * Deliver each packet before its same-time frame. Keep the runtime's shared
 * update/render path; never advance a second clock or substitute a renderer.
 * The current browser-scenario CLI does not select packet fixtures; the shared
 * pipeline owner must compose this contract into its existing transport seam.
 * The coordinated peer seam is syntheticPeer({fixture}); advance(ms) delivers
 * due packets once per accepted login. At each checkpoint, the future runner
 * records its actual batch/frame index alongside elapsed at, never at/cadence
 * as an assumed frame. This module does not import or start that peer.
 */
export function createBrowserPreyFixture() {
  const copy = structuredClone(scenario);
  const grouped = new Map();
  for (const event of copy.events) {
    if (!grouped.has(event.at)) grouped.set(event.at, []);
    grouped.get(event.at).push(command(event));
  }
  return { ...copy, packets: [...grouped].map(([at, commands]) => ({ at, bytes: bundle(...commands) })) };
}
