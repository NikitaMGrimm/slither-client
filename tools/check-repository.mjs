import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEntry } from './repository-policy.mjs';

function git(directory, args) {
  return execFileSync('git', args, { cwd: directory, maxBuffer: 32 * 1024 * 1024 });
}

/** Read Git blobs rather than the working tree, so unstaged edits cannot mask staged artifacts. */
export function checkRepository(directory, history = false, outgoingTips = []) {
  const errors = [];
  const checked = new Set();
  let count = 0;
  function inspect(mode, object, name) {
    const identity = `${mode}\0${object}\0${name}`;
    if (checked.has(identity)) return;
    checked.add(identity);
    if (mode === '160000') {
      errors.push(`${name}: submodules require explicit policy review`);
      return;
    }
    const bytes = git(directory, ['cat-file', 'blob', object]);
    errors.push(...checkEntry(name, bytes, mode));
    count++;
  }
  const staged = git(directory, ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const entry of staged) {
    const tab = entry.indexOf('\t');
    const [mode, object, stage] = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    if (stage !== '0') errors.push(`${name}: unresolved index stage ${stage}`);
    else inspect(mode, object, name);
  }
  if (!staged.length) errors.push('No tracked files to inspect; stage the intended source before checking.');
  if (history || outgoingTips.length) {
    // A push can name an old, now-unreferenced commit directly. Include Git's
    // actual outgoing tips, not just the local branches currently retaining it.
    for (const tip of outgoingTips) {
      if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(tip)) throw new Error('Invalid outgoing object ID');
      git(directory, ['rev-parse', '--verify', `${tip}^{commit}`]);
    }
    const commits = git(directory, ['rev-list', '--all', ...outgoingTips]).toString('utf8').trim().split('\n').filter(Boolean);
    for (const commit of commits) {
      const entries = git(directory, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean);
      for (const entry of entries) {
        const tab = entry.indexOf('\t');
        const [mode, , object] = entry.slice(0, tab).split(' ');
        inspect(mode, object, entry.slice(tab + 1));
      }
    }
  }
  return { count, errors: [...new Set(errors)] };
}

export function outgoingPushTips(input) {
  const tips = new Set();
  for (const line of input.split(/\r?\n/).filter(line => line.trim())) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !fields[1].match(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/) || !fields[3].match(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/)) {
      throw new Error('Malformed Git pre-push input');
    }
    if (!/^0+$/.test(fields[1])) tips.add(fields[1]);
  }
  return [...tips];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--history', '--pre-push'].includes(arg))) throw new Error('Usage: node tools/check-repository.mjs [--history | --pre-push]');
  const history = args.includes('--history') || args.includes('--pre-push');
  const tips = args.includes('--pre-push') ? outgoingPushTips(fs.readFileSync(0, 'utf8')) : [];
  const result = checkRepository(process.cwd(), history, tips);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Repository boundary passed: ${result.count} indexed${history ? ' and historical' : ''} file versions checked.`);
}
