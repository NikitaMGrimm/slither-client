import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { externalDirectory } from './reference-context.mjs';

export const probeNickname = '(Bot) Bottington';
export const maximumProbeMs = 10000;

export function validatedEndpoint(input) {
  const url = new URL(input);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.pathname !== '/slither') {
    throw new Error('Expected a ws:// or wss:// literal-IP endpoint ending in /slither, without credentials/query/fragment');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!net.isIP(host)) throw new Error('A selected literal IP is required; DNS/family fallback is not permitted');
  return url.href;
}

/** Exclusive durable reservation precedes every socket-constructor attempt. */
export function reserveOfficialAttempt(outputDirectory, endpoint) {
  const directory = externalDirectory(outputDirectory);
  const file = path.join(directory, 'official-attempt.json');
  const record = { reservedAt: new Date().toISOString(), endpoint: validatedEndpoint(endpoint), nickname: probeNickname, attempts: 1, maximumMs: maximumProbeMs, retryAllowed: false };
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(record, null, 2) + '\n'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  const evidence = [];
  try {
    for (const name of ['official-wire.jsonl', 'official-result.json']) {
      evidence.push(fs.openSync(path.join(directory, name), 'wx', 0o600));
    }
  } catch (error) {
    const errors = [error];
    for (const handle of evidence) {
      try { fs.closeSync(handle); } catch (closeError) { errors.push(closeError); }
    }
    if (errors.length > 1) throw new AggregateError(errors, 'Evidence reservation failed');
    throw error; // The ledger remains consumed, even though no dial occurred.
  }
  let persisted = false;
  return {
    directory, ledger: file, record,
    persist(summary, records) {
      if (persisted) throw new Error('Evidence was already finalized');
      persisted = true;
      const errors = [];
      const serialize = [
        () => records.map(item => JSON.stringify(item)).join('\n') + '\n',
        () => JSON.stringify(summary, null, 2) + '\n',
      ];
      // Persist each independently: a failed summary must not discard wire records.
      evidence.forEach((handle, index) => {
        try { fs.writeFileSync(handle, serialize[index]()); fs.fsyncSync(handle); }
        catch (error) { errors.push(error); }
        finally {
          try { fs.closeSync(handle); } catch (error) { errors.push(error); }
        }
      });
      if (errors.length) throw new AggregateError(errors, 'Could not persist all probe evidence');
    },
  };
}
