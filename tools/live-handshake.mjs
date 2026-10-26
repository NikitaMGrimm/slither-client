import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { HandshakeSession } from '../web/handshake-session.mjs';
import { createReferenceOracle, loadWasm, referenceHash, sha256 } from './reference-context.mjs';
import { probeNickname, reserveOfficialAttempt, validatedEndpoint } from './connection-budget.mjs';
import { runHandshakeTransport } from './handshake-transport.mjs';

/** Explicit manual entry point only. Importing it does not create any socket. */
export async function runLiveHandshake({ endpoint, referenceRoot, outputDirectory }) {
  endpoint = validatedEndpoint(endpoint);
  const wasm = await loadWasm();
  const oracle = await createReferenceOracle(referenceRoot);
  const login = wasm.encode_login(oracle.profile.clientVersion, oracle.profile.password, probeNickname, 0, new Uint8Array());
  assert.deepEqual(login, oracle.login(probeNickname), 'Login comparison must pass before reserving a live attempt');
  const session = new HandshakeSession(wasm, oracle.profile, probeNickname, { solve: encoded => oracle.compareChallenge(encoded, wasm) });
  const started = performance.now();
  const reservation = reserveOfficialAttempt(outputDirectory, endpoint);
  const { records, challengeCompared, ...result } = await runHandshakeTransport({
    endpoint, session, started, createSocket: (url, options) => new WebSocket(url, options),
  });
  const summary = {
    ...result, nickname: probeNickname, loginBytesIdentical: true,
    sameChallengeReplyIdentical: challengeCompared, referenceSha256: referenceHash,
    elapsedMs: Math.round(performance.now() - started), records: records.length,
    loginSha256: sha256(login), sessionState: session.state,
  };
  reservation.persist(summary, records);
  return summary;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/live-handshake.mjs')) {
  const { values } = parseArgs({ options: { endpoint: { type: 'string' }, 'reference-root': { type: 'string' }, 'output-directory': { type: 'string' }, 'one-official-connection': { type: 'boolean' } } });
  if (!values['one-official-connection'] || !values.endpoint || !values['reference-root'] || !values['output-directory']) throw new Error('Requires explicit --one-official-connection, --endpoint, --reference-root and external --output-directory; never retry or replace an existing ledger');
  const result = await runLiveHandshake({ endpoint: values.endpoint, referenceRoot: values['reference-root'], outputDirectory: values['output-directory'] });
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
}
