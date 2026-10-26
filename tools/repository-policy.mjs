import { createHash } from 'node:crypto';
import path from 'node:path';

const forbiddenDirectories = new Set([
  '.reference', 'reference', 'raw', 'readable', 'site', 'runtime', 'captures',
  'recordings', 'outputs', 'private', 'local', 'node_modules', 'target', 'dist',
]);
const forbiddenExtensions = new Set([
  '.map', '.wasm', '.crate', '.zip', '.tar', '.gz', '.7z', '.png', '.jpg',
  '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.jsonl', '.key', '.pem', '.log',
]);
const knownReferenceHashes = new Set([
  '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095',
]);
const maximumBytes = 512 * 1024;

/** Known artifact detection complements human provenance review; it cannot prove ownership. */
export function checkEntry(name, bytes, mode = '100644', referenceHashes = knownReferenceHashes) {
  const problems = [];
  const normalized = name.replaceAll('\\', '/');
  const parts = normalized.toLowerCase().split('/');
  const basename = parts.at(-1);
  if (parts.some(part => forbiddenDirectories.has(part))) problems.push('external reference or generated directory');
  if (forbiddenExtensions.has(path.posix.extname(basename))) problems.push('reference, binary, capture, or generated file format');
  if (/^game\d+\.js$|^client\.(?:original|readable|formatted)\.js$|^(?:legacy-name-map|naming-evidence|assets-manifest)\.json$/.test(basename)) problems.push('known official-client artifact name');
  if (/^\.env(?:\.|$)/.test(basename) && basename !== '.env.example') problems.push('local environment file');
  if (mode !== '100644' && mode !== '100755') problems.push('symlinks and submodules require explicit policy review');
  if (bytes.length > maximumBytes) problems.push('file exceeds the 512 KiB source limit');
  if (bytes.includes(0)) problems.push('binary source payload');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    problems.push('non-UTF-8 source payload');
  }
  if (referenceHashes.has(createHash('sha256').update(bytes).digest('hex'))) problems.push('known pinned official-client bundle');
  const text = bytes.toString('utf8');
  if (/"sourcesContent"\s*:/.test(text)) problems.push('embedded source-map contents');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) problems.push('private key material');
  if (path.posix.extname(basename) === '.svg') {
    if (normalized !== 'assets/logo.svg') problems.push('unreviewed vector asset');
    if (/<script\b|<foreignObject\b|<image\b|\b(?:href|src)\s*=|\bon[a-z]+\s*=|url\s*\(/i.test(text)) problems.push('SVG contains scripts, external references, or embedded images');
  }
  return problems.map(problem => `${name}: ${problem}`);
}
