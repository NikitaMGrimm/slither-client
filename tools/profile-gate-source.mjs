// The Chrome worker privately injects the same authored gate function with args.
// No secret is embedded in source/package files and no runtime eval is shipped.
export function privateProfileGateSource(source) {
  const marker = '(function installGameGate(profileAuthority) {';
  const start = source.indexOf(marker), end = source.lastIndexOf('})(undefined);');
  if (start < 0 || end < start || source.slice(end).trim() !== '})(undefined);') {
    throw new Error('Expected the exact authored private gate wrapper');
  }
  return source.slice(start + 1, end + 1);
}

export function privateProfileGateModule(source) {
  return `// Same authored gate, private Chrome worker dependency.\nexport default ${privateProfileGateSource(source)};\n`;
}
