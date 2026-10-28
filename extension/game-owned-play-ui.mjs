// Original fixed Play panel. Retain the inert lease before guarded native work.
const freeze = Object.freeze;
const apply = Reflect.apply;
const functionSource = Function.prototype.call.bind(Function.prototype.toString);
const functionKind = Symbol.toStringTag;
const asynchronous = [async function () {}, function* () {}, async function* () {}]
  .map(Object.getPrototypeOf);
const domFields = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const constructFields = ['createElement', 'createTextNode', 'appendChild', 'removeChild'];
const controlFields = ['inputValue', 'inputMaxLength', 'inputAutocompleteOff', 'buttonType', 'buttonDisabled'];
const statuses = freeze({ ready: 'Ready.', 'empty-endpoint': 'Enter a server address.',
  'invalid-endpoint': 'Enter a valid server address.', 'invalid-nickname': 'Check the nickname.',
  preparing: 'Preparing connection.', connecting: 'Connecting.', connected: 'Connected.',
  'not-connected': 'Not connected.', unavailable: 'Play unavailable on this page.',
  failed: 'Play failed. Reload to start again.' });
const invalid = () => { throw new TypeError('Invalid owned Play UI input'); };

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
    const kind = Object.getOwnPropertyDescriptor(prototype, functionKind);
    if (seen.has(prototype) || asynchronous.includes(prototype)
      || kind && Object.hasOwn(kind, 'value')
        && ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(kind.value)) invalid();
    seen.add(prototype);
  }
  if (prototype !== null || /^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/
    .test(functionSource(callback))) invalid();
}

/** Native failures unwind to the retaining runtime; this view never cleans up an active operation. */
export function createOwnedPlayUi(input) {
  let options = record(input, ['document', 'parent', 'dom', 'construct', 'controls', 'isCurrentDocument']);
  input = undefined;
  let document = options.document;
  let parent = options.parent;
  if (document === null || typeof document !== 'object'
    || parent === null || typeof parent !== 'object' || document === parent) invalid();
  let dom = record(options.dom, domFields);
  let construct = record(options.construct, constructFields);
  let controls = record(options.controls, controlFields);
  for (const name of domFields) synchronous(dom[name]);
  for (const name of constructFields) synchronous(construct[name]);
  for (const name of controlFields) synchronous(controls[name]);
  let checker = options.isCurrentDocument;
  synchronous(checker);
  options = undefined;
  let attempted = false, disposed = false, active = false, mounted = false, locked = false;
  let ownedMount, button, status, statusText;

  const call = (name, target, ...args) => apply(dom[name], undefined, [target, ...args]);
  const current = () => {
    const result = apply(checker, undefined, []);
    if (typeof result !== 'boolean') invalid();
    return result;
  };
  const requireCurrent = () => {
    if (!current()) throw new Error('Stale owned Play document');
  };
  const requireIdle = () => {
    if (active) throw new Error('Owned Play operation active');
  };
  const requireParent = () => {
    if (call('nodeType', document) !== 9 || call('isConnected', document) !== true
      || call('nodeType', parent) !== 1 || call('ownerDocument', parent) !== document
      || call('isConnected', parent) !== true
      || call('namespaceURI', parent) !== 'http://www.w3.org/1999/xhtml'
      || typeof call('localName', parent) !== 'string') invalid();
    const style = call('style', parent);
    if (style === null || typeof style !== 'object') invalid();
    return style;
  };
  const connectedHere = node => call('ownerDocument', node) === document && call('isConnected', node) === true;
  const currentMount = () => call('isConnected', document) === true && connectedHere(parent)
    && connectedHere(ownedMount) && call('parentNode', ownedMount) === parent;
  const requireMounted = () => {
    if (!mounted) throw new Error('Owned Play panel not mounted');
    requireCurrent();
    if (!currentMount() || !connectedHere(button) || !connectedHere(status) || !connectedHere(statusText)
      || call('parentNode', button) !== ownedMount || call('parentNode', status) !== ownedMount
      || call('parentNode', statusText) !== status || call('firstChild', status) !== statusText
      || call('nextSibling', statusText) !== null) invalid();
  };

  function mount() {
    requireIdle();
    if (attempted || disposed) throw new Error('Owned Play mount already consumed');
    attempted = true;
    active = true;
    try {
      requireCurrent();
      const parentStyle = requireParent();
      const identities = new Set([document, parent, parentStyle]);
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
      const text = value => fresh(3, null, value);
      const append = (target, child) => apply(construct.appendChild, undefined, [target, child]);
      ownedMount = element('div');
      const endpointParent = element('label'), endpointLabel = text('Server address'), endpoint = element('input');
      const nicknameParent = element('label'), nicknameLabel = text('Nickname'), nickname = element('input');
      button = element('button');
      const buttonText = text('Play');
      status = element('div');
      statusText = text(statuses.ready);
      for (const field of [endpoint, nickname]) {
        if (apply(controls.inputValue, undefined, [field]) !== '') invalid();
        apply(controls.inputAutocompleteOff, undefined, [field]);
        apply(controls.inputMaxLength, undefined, [field, field === endpoint ? 128 : 24]);
      }
      apply(controls.buttonType, undefined, [button]);
      apply(controls.buttonDisabled, undefined, [button, false]);
      const edges = [[endpointParent, [endpointLabel, endpoint]], [nicknameParent, [nicknameLabel, nickname]],
        [button, [buttonText]], [status, [statusText]], [ownedMount, [endpointParent, nicknameParent, button, status]]];
      for (const [target, children] of edges) for (const child of children) append(target, child);

      const styles = new Set();
      const layout = (target, properties) => {
        const style = call('style', target);
        if (style === null || typeof style !== 'object' || identities.has(style) || styles.has(style)) invalid();
        styles.add(style);
        for (const [property, value] of properties) call('setStyle', style, property, value);
      };
      layout(ownedMount, [['position', 'absolute'], ['left', '8px'], ['top', '56px'], ['width', '48ch'],
        ['display', 'block'], ['color', '#eee'], ['font-family', 'monospace'], ['font-size', '12px'],
        ['font-variant-numeric', 'tabular-nums'], ['border', '0'], ['border-radius', '0'], ['background', 'none']]);
      for (const label of [endpointParent, nicknameParent]) layout(label,
        [['display', 'block'], ['height', '4em'], ['white-space', 'nowrap']]);
      for (const field of [endpoint, nickname]) layout(field, [['display', 'block'], ['width', '46ch'],
        ['box-sizing', 'border-box'], ['font-family', 'monospace'], ['font-size', '12px'], ['border-radius', '0']]);
      layout(button, [['position', 'static'], ['display', 'block'], ['font-family', 'monospace'],
        ['font-size', '12px'], ['border-radius', '0']]);
      layout(status, [['display', 'block'], ['width', '48ch'], ['height', '2em'], ['white-space', 'pre-wrap']]);
      for (const [target, children] of edges) {
        if (call('firstChild', target) !== children[0]) invalid();
        for (let index = 0; index < children.length; index++) {
          if (call('parentNode', children[index]) !== target
            || call('nextSibling', children[index]) !== (children[index + 1] ?? null)) invalid();
        }
      }
      const nodes = freeze({ schema: 1, document, mount: ownedMount, endpoint, endpointParent,
        nickname, nicknameParent, button, buttonParent: ownedMount });
      requireCurrent();
      requireParent();
      // Ownership precedes attachment, including an append that attaches and then throws.
      append(parent, ownedMount);
      if (!currentMount()) invalid();
      requireCurrent();
      mounted = true;
      return nodes;
    } finally {
      active = false;
    }
  }

  function setStatus(state) {
    requireIdle();
    if (disposed) return;
    if (typeof state !== 'string' || !Object.hasOwn(statuses, state)) invalid();
    active = true;
    try {
      requireMounted();
      call('setText', statusText, statuses[state]);
      requireCurrent();
    } finally {
      active = false;
    }
  }

  function lock() {
    requireIdle();
    if (disposed || locked) return;
    active = true;
    try {
      requireMounted();
      // Status updates never unlock an admitted attempt.
      locked = true;
      apply(controls.buttonDisabled, undefined, [button, true]);
      requireCurrent();
    } finally {
      active = false;
    }
  }

  function unlock() {
    requireIdle();
    if (disposed || !locked) return;
    active = true;
    try {
      requireMounted();
      apply(controls.buttonDisabled, undefined, [button, false]);
      requireCurrent();
      locked = false;
    } finally {
      active = false;
    }
  }

  function dispose() {
    requireIdle();
    if (disposed) return;
    disposed = true;
    active = true;
    try {
      if (ownedMount !== undefined && current() && currentMount()) {
        apply(construct.removeChild, undefined, [parent, ownedMount]);
      }
    } finally {
      ownedMount = button = status = statusText = document = parent = dom = construct = controls = checker = undefined;
      active = false;
    }
  }

  return freeze({ mount, setStatus, lock, unlock, dispose });
}
