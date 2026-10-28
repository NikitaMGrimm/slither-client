// Authored runner mocks: no browser, build, network or external reference inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('private capture requires complete trace evidence and retains failed-run cleanup and receipts', async () => {
  const fixture = fileURLToPath(new URL('./browser-reference-test-fixture.mjs', import.meta.url));
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--experimental-vm-modules', fixture, '--repo', repo], { timeout: 15000 });
  const cases = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(cases.map(({ variant, status }) => [variant, status]), [
    ['missing-events', 'failed'], ['dropped-events', 'failed'], ['valid-trace', 'passed'],
  ]);
});
