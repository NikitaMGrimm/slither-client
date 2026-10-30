import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loopbackEndpoint } from '../web/loopback-session.mjs';

test('endpoint cannot select external, aliased or ambiguous destinations', () => {
  assert.equal(loopbackEndpoint('ws://127.0.0.1:8766/slither'), 'ws://127.0.0.1:8766/slither');
  assert.equal(loopbackEndpoint('ws://127.0.0.1:80/slither'), 'ws://127.0.0.1:80/slither');
  for (const url of ['wss://127.0.0.1:8766/slither', 'ws://localhost:8766/slither', 'ws://127.1:8766/slither',
    'ws://example.invalid:8766/slither', 'ws://127.0.0.1:65536/slither', 'ws://127.0.0.1:0/slither',
    'ws://127.0.0.1:08766/slither', 'ws://127.0.0.1:8766/slither?x=1', 'ws://user@127.0.0.1:8766/slither']) {
    assert.throws(() => loopbackEndpoint(url));
  }
});
