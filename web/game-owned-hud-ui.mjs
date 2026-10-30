// Original fixed HUD layout. The runtime registers this inert lease before native work.
const freeze = Object.freeze;
const apply = Reflect.apply;
const functionSource = Function.prototype.call.bind(Function.prototype.toString);
const asynchronous = [async function () {}, function* () {}, async function* () {}]
  .map(Object.getPrototypeOf);
const domFields = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const constructFields = ['createElement', 'createTextNode', 'appendChild', 'removeChild'];
const invalid = () => { throw new TypeError('Invalid owned HUD UI input'); };

function record(value, fields) {
  if (value === null || typeof value !== 'object') invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) invalid();
  const copy = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function synchronous(callback) {
  if (typeof callback !== 'function') invalid();
  const seen = new Set();
  let prototype = callback;
  for (let visits = 0; visits < 64; visits++) {
    prototype = Object.getPrototypeOf(prototype);
    if (prototype === null) break;
    if (seen.has(prototype) || asynchronous.includes(prototype)) invalid();
    seen.add(prototype);
  }
  if (prototype !== null || /^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/
    .test(functionSource(callback))) invalid();
}

/** No native observations occur until mount; failed mounts require external disposal. */
export function createOwnedHudUi(input) {
  let options = record(input, ['document', 'parent', 'dom', 'construct', 'isCurrentDocument']);
  input = undefined;
  let document = options.document;
  let parent = options.parent;
  if (document === null || typeof document !== 'object'
    || parent === null || typeof parent !== 'object' || document === parent) invalid();
  let dom = record(options.dom, domFields);
  let construct = record(options.construct, constructFields);
  for (const name of domFields) synchronous(dom[name]);
  for (const name of constructFields) synchronous(construct[name]);
  let checker = options.isCurrentDocument;
  synchronous(checker);
  options = undefined;
  let attempted = false;
  let disposed = false;
  let mounting = false;
  let ownedMount;

  const call = (name, target, ...args) => apply(dom[name], undefined, [target, ...args]);
  const current = () => {
    const result = apply(checker, undefined, []);
    if (typeof result !== 'boolean') invalid();
    return result;
  };
  const requireCurrent = () => {
    if (!current()) throw new Error('Stale owned HUD document');
  };
  const requireParent = () => {
    if (call('nodeType', document) !== 9 || call('isConnected', document) !== true
      || call('nodeType', parent) !== 1 || call('ownerDocument', parent) !== document
      || call('isConnected', parent) !== true
      || call('namespaceURI', parent) !== 'http://www.w3.org/1999/xhtml'
      || typeof call('localName', parent) !== 'string') invalid();
    const style = call('style', parent);
    if (style === null || typeof style !== 'object') invalid();
  };

  function mount() {
    if (attempted || disposed) throw new Error('Owned HUD mount already consumed');
    attempted = true;
    mounting = true;
    try {
      requireCurrent();
      requireParent();
      const identities = new Set([document, parent]);
      const fresh = (type, name, text) => {
        const value = type === 1
          ? apply(construct.createElement, undefined, [document, name])
          : apply(construct.createTextNode, undefined, [document, text]);
        if (value === null || typeof value !== 'object' || identities.has(value)) invalid();
        identities.add(value);
        if (call('nodeType', value) !== type || call('ownerDocument', value) !== document
          || call('parentNode', value) !== null || call('isConnected', value) !== false
          || call('firstChild', value) !== null || call('nextSibling', value) !== null) invalid();
        if (type === 1 && (call('localName', value) !== name
          || call('namespaceURI', value) !== 'http://www.w3.org/1999/xhtml')) invalid();
        return value;
      };
      const element = name => fresh(1, name);
      const append = (target, child) => apply(construct.appendChild, undefined, [target, child]);
      const atom = (name, text) => {
        const value = freeze({ element: element(name), text: fresh(3, null, text) });
        append(value.element, value.text);
        return value;
      };
      ownedMount = element('div');
      const readout = freeze({ root: element('div'), lengthLine: element('div'), rankLine: element('div'),
        lengthLabel: atom('span', 'Your length: '), lengthValue: atom('b', ''),
        rankLabel: atom('span', 'Your rank: '), rankValue: atom('span', ''),
        separator: atom('span', ' of '), populationValue: atom('span', '') });
      const final = freeze({ root: element('div'), label: atom('span', 'Last length: '), value: atom('b', '') });
      for (const [target, children] of [
        [readout.lengthLine, [readout.lengthLabel.element, readout.lengthValue.element]],
        [readout.rankLine, [readout.rankLabel.element, readout.rankValue.element,
          readout.separator.element, readout.populationValue.element]],
        [readout.root, [readout.lengthLine, readout.rankLine]],
        [final.root, [final.label.element, final.value.element]],
        [ownedMount, [readout.root, final.root]],
      ]) for (const child of children) append(target, child);

      const styles = new Set();
      const layout = (target, properties) => {
        const style = call('style', target);
        if (style === null || typeof style !== 'object' || identities.has(style) || styles.has(style)) invalid();
        styles.add(style);
        for (const [property, value] of properties) call('setStyle', style, property, value);
      };
      layout(ownedMount, [['position', 'absolute'], ['left', '8px'], ['bottom', '8px'],
        ['width', '34ch'], ['display', 'block'], ['color', '#eee'], ['font-family', 'monospace'],
        ['font-size', '12px'], ['white-space', 'pre'], ['pointer-events', 'none'],
        ['border', '0'], ['border-radius', '0'], ['background', 'none']]);
      layout(readout.root, [['font-family', 'Arial, sans-serif']]);
      for (const line of [readout.lengthLine, readout.rankLine, final.root]) layout(line, [['display', 'block']]);
      for (const [value, bold] of [[readout.lengthValue, true], [readout.rankValue, false],
        [readout.populationValue, false]]) {
        layout(value.element, [['display', 'inline'], ['font-family', 'inherit'],
          ['font-variant-numeric', 'tabular-nums'], ...(bold ? [['font-weight', 'bold']] : [])]);
      }
      layout(final.value.element, [['display', 'inline-block'], ['box-sizing', 'content-box'],
        ['text-align', 'right'], ['font-family', 'monospace'], ['font-variant-numeric', 'tabular-nums'],
        ['width', '18ch'], ['font-weight', 'bold']]);
      const nodes = freeze({ schema: 1, document, mount: ownedMount, textPolicy: 'authored', readout, final });
      requireCurrent();
      requireParent();
      // Keep ownership even if the append attaches and then throws under the runtime guard.
      append(parent, ownedMount);
      requireCurrent();
      return nodes;
    } finally {
      mounting = false;
    }
  }

  function dispose() {
    if (mounting) throw new Error('Owned HUD construction active');
    if (disposed) return;
    disposed = true;
    try {
      if (ownedMount !== undefined && current() && call('parentNode', ownedMount) === parent) {
        apply(construct.removeChild, undefined, [parent, ownedMount]);
      }
    } finally {
      ownedMount = document = parent = dom = construct = checker = undefined;
    }
  }

  return freeze({ mount, dispose });
}
