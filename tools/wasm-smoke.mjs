import assert from 'node:assert/strict';
import { loadWasm } from './reference-context.mjs';
import { syntheticChallenge } from './reference-parity.mjs';
import { HandshakeSession } from '../web/handshake-session.mjs';

// Entirely synthetic ABI integration; no reference files or network are used.
const wasm = await loadWasm();
const profile = { clientVersion: 1, password: Uint8Array.from({ length: 20 }, (_, index) => index), protocolVersion: 19 };
const session = new HandshakeSession(wasm, profile, 'Synthetic');
const challenge = Uint8Array.from([54, ...syntheticChallenge('A'.repeat(27))]);
const reply = session.receive(challenge);
assert.equal(reply.outbound.length, 2);
assert.equal(reply.outbound[0].length, 27);
assert.equal(reply.outbound[1][0], 115);
const setup = new Uint8Array(30); setup[0] = 97; setup[23] = 19;
const accepted = session.receive(setup);
assert.equal(accepted.complete, true); assert.equal(accepted.protocolVersion, 19);
assert.throws(() => wasm.solve_challenge(Uint8Array.of(0, 1)));
assert.throws(() => wasm.encode_login(1, new Uint8Array(19), 'Synthetic', 0, new Uint8Array()));
console.log('Synthetic Wasm ABI handshake passed; no reference files or sockets used.');
