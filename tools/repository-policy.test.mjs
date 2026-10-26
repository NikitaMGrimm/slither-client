import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkEntry } from './repository-policy.mjs';
import { checkRepository, outgoingPushTips } from './check-repository.mjs';

test('original Rust, JavaScript bridge, and synthetic data stay permitted', () => {
  for (const name of ['src/lib.rs', 'web/bridge.js', 'tools/check.mjs', 'tests/fixtures/synthetic.json']) {
    assert.deepEqual(checkEntry(name, Buffer.from('// Original authored test data\n')), []);
  }
});

test('reference directories, disguised known bundles, maps, and binary payloads are rejected', () => {
  for (const name of ['raw/input.txt', 'nested/readable/program.js', 'assets/image.png', 'web/game1107249518.js', 'web/client.js.map']) {
    assert(checkEntry(name, Buffer.from('synthetic placeholder')).length > 0, name);
  }
  const synthetic = Buffer.from('SYNTHETIC forbidden reference payload; not official source');
  const hash = createHash('sha256').update(synthetic).digest('hex');
  assert(checkEntry('web/renamed.js', synthetic, '100644', new Set([hash])).some(error => error.includes('pinned')));
  const map = JSON.stringify({ ['sources' + 'Content']: ['SYNTHETIC source'] });
  assert(checkEntry('web/renamed.json', Buffer.from(map)).some(error => error.includes('source-map')));
  assert(checkEntry('web/renamed.mjs', Buffer.from([65, 0, 66])).some(error => error.includes('binary')));
  assert(checkEntry('web/invalid.mjs', Buffer.from([0xc3, 0x28])).some(error => error.includes('UTF-8')));
});

test('only the self-contained project logo is permitted as a vector asset', () => {
  const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H4"/></svg>');
  assert.deepEqual(checkEntry('assets/logo.svg', logo), []);
  assert(checkEntry('assets/other.svg', logo).length > 0);
  assert(checkEntry('assets/logo.svg', Buffer.from('<svg><image href="data:image/png;base64,SYNTHETIC"/></svg>')).length > 0);
});

function withRepository(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slither-client-guard-'));
  const git = args => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
  try {
    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'user.name', 'Synthetic Guard Test']);
    git(['config', 'user.email', 'guard@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    fs.mkdirSync(path.join(directory, 'web'));
    run(directory, git);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('slither-client-guard-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('an unstaged clean edit cannot conceal a forbidden staged blob', () => withRepository((directory, git) => {
  const file = path.join(directory, 'web/bridge.mjs');
  fs.writeFileSync(file, Buffer.from([65, 0, 66]));
  git(['add', 'web/bridge.mjs']);
  fs.writeFileSync(file, '// Original clean working tree\n');
  assert(checkRepository(directory).errors.some(error => error.includes('binary')));
}));

test('removing a forbidden file later does not erase it from the published history check', () => withRepository((directory, git) => {
  const file = path.join(directory, 'web/bridge.mjs');
  fs.writeFileSync(file, '// Original source\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'test: original source']);
  fs.writeFileSync(path.join(directory, 'web/program.js.map'), 'SYNTHETIC map placeholder');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'test: synthetic prohibited artifact']);
  git(['rm', '--quiet', 'web/program.js.map']);
  git(['commit', '--quiet', '-m', 'test: remove synthetic prohibited artifact']);
  assert.deepEqual(checkRepository(directory).errors, []);
  assert(checkRepository(directory, true).errors.some(error => error.includes('program.js.map')));
}));

test('pre-push inspects explicitly pushed history even after all local refs stop retaining it', () => withRepository((directory, git) => {
  fs.writeFileSync(path.join(directory, 'web/bridge.mjs'), '// Original source\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'test: clean root']);
  const root = git(['rev-parse', 'HEAD']).toString().trim();
  fs.writeFileSync(path.join(directory, 'web/program.js.map'), 'SYNTHETIC prohibited artifact');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'test: synthetic prohibited artifact']);
  git(['rm', '--quiet', 'web/program.js.map']);
  git(['commit', '--quiet', '-m', 'test: clean tree retaining forbidden ancestor']);
  const tip = git(['rev-parse', 'HEAD']).toString().trim();
  git(['reset', '--hard', root]);
  assert.deepEqual(checkRepository(directory, true).errors, []);
  const input = `refs/heads/candidate ${tip} refs/heads/candidate ${'0'.repeat(40)}\n`;
  assert(checkRepository(directory, true, outgoingPushTips(input)).errors.some(error => error.includes('program.js.map')));
  const invocation = spawnSync(process.execPath, [path.resolve('tools/check-repository.mjs'), '--pre-push'], { cwd: directory, input, encoding: 'utf8' });
  assert.equal(invocation.status, 1);
  assert(invocation.stderr.includes('program.js.map'));
}));

test('pre-push accepts deletion records and rejects malformed object IDs', () => {
  assert.deepEqual(outgoingPushTips(`(delete) ${'0'.repeat(40)} refs/heads/old ${'a'.repeat(40)}\n`), []);
  assert.throws(() => outgoingPushTips('refs/heads/main --all refs/heads/main nope\n'), /Malformed/);
});
