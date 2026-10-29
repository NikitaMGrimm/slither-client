// Authored owner/policy doubles exercise the real fixture teardown hooks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (typeof vm.SourceTextModule !== 'function') {
  test('stock fixture cleanup isolated module suite', t => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath,
      ['--experimental-vm-modules', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)],
      { env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    t.diagnostic(result.stdout);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /# tests 4\b/);
  });
} else {
  for (const [name, factory, policy] of [
    ['stock-client', 'createStockClient', 'TestStockControllerPolicy'],
    ['stock-gameplay', 'createStockGameplay', 'TestGameplayPolicy'],
  ]) {
    async function fixture() {
      const hooks = [];
      const context = vm.createContext({ process: { env: {} } });
      const module = values => new vm.SyntheticModule(Object.keys(values), function() {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
      const subject = new vm.SourceTextModule(await readFile(
        new URL(`./fixtures/${name}-fixture.mjs`, import.meta.url), 'utf8'), { context });
      await subject.link(specifier => {
        if (specifier === 'node:test') return module({ after: hook => hooks.push(hook) });
        if (specifier === `../../web/${name}.mjs`) return module({ [factory]: options => options.owner });
        assert.match(specifier, /^\.\/(stock-controller|gameplay-policy)-double\.mjs$/);
        return module({ [policy]: class TestPolicy {} });
      });
      await subject.evaluate();
      assert.equal(hooks.length, 1);
      return { create: subject.namespace[factory], cleanup: hooks[0] };
    }

    test(`${name} cleanup attempts every owner and retains exact failures`, async () => {
      const { create, cleanup } = await fixture();
      const calls = [], failure = new Error('authored disposal failure');
      for (const [index, value] of [undefined, failure, false, 'success'].entries()) {
        create({ owner: { dispose() {
          calls.push(index);
          if (index < 3) throw value;
        } } });
      }
      let caught;
      try { cleanup(); } catch (error) { caught = error; }
      assert.deepEqual(calls, [0, 1, 2, 3]);
      assert.equal(caught?.name, 'AggregateError');
      assert.deepEqual(Array.from(caught.errors), [undefined, failure, false]);
      cleanup();
      assert.deepEqual(calls, [0, 1, 2, 3], 'drained owners are not disposed again');
    });

    test(`${name} cleanup succeeds for an empty or successful batch`, async () => {
      const { create, cleanup } = await fixture();
      cleanup();
      const calls = [];
      for (const id of [0, 1]) create({ owner: { dispose() { calls.push(id); } } });
      cleanup();
      assert.deepEqual(calls, [0, 1]);
    });
  }
}
