// Authored native-operation doubles and an explicitly issued-view ESM DOUBLE.
// These isolated VM checks do not prove real state/view integration, DOM/CSS or pixels.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGateTestDom } from './game-gate-test-fixture.mjs';

if (typeof vm.SourceTextModule !== 'function') {
  test('owned leaderboard isolated ESM native-boundary suite', t => {
    // Node's worker context otherwise makes this separate runner use an invisible IPC reporter.
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath,
      ['--experimental-vm-modules', '--test', fileURLToPath(import.meta.url)],
      { env: environment, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    t.diagnostic(result.stdout);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all nine supplied colors/,
      'child must report the actual focused suite, not merely exit successfully');
  });
} else {
  const context = vm.createContext({});
  const source = await readFile(new URL('../extension/game-owned-leaderboard-ui.mjs', import.meta.url), 'utf8');
  const viewDouble = new vm.SourceTextModule(`
    // LABELLED DOUBLE: membership and copied frozen grammar, no real state/HUD admission.
    const issued = new WeakSet();
    export function requireLeaderboardView(view) {
      if (!issued.has(view)) throw new TypeError('Invalid issued-view DOUBLE');
      return view;
    }
    export function issue(binding, fields = {}) {
      const rows = Array.from(fields.rows || [], row => Object.freeze({ ...row }));
      const view = Object.freeze({schema:1, bindingIdentity:binding.bindingIdentity,
        documentIdentity:binding.documentIdentity, sceneIdentity:binding.sceneIdentity,
        revision:0n, binding:Object.freeze({state:'ready',reason:null}),
        readiness:'pending', reason:'no-board', setupSeen:false, boardPresent:false,
        requestedOpacity:Object.freeze({heading:0,rows:0}), ...fields, rows:Object.freeze(rows)});
      issued.add(view); return view;
    }
  `, { context, identifier: 'issued-view-double' });
  const product = new vm.SourceTextModule(source, { context, identifier: 'owned-leaderboard-product' });
  await product.link(specifier => {
    assert.equal(specifier, './stock-leaderboard-view.mjs');
    return viewDouble;
  });
  await product.evaluate();
  const create = product.namespace.createOwnedLeaderboardUi;
  const issue = viewDouble.namespace.issue;
  const domNames = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
    'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
  const primaries = [undefined, null, false, 0, '', Symbol('primary'), new Error('synthetic primary')];
  const ownRecord = value => Object.assign(Object.create(null), value);
  function throwsExact(callback, primary) {
    let threw = false;
    try { callback(); } catch (error) { threw = true; assert.equal(error, primary); }
    assert.equal(threw, true, 'throw presence, including undefined');
  }
  function fixture() {
    const native = createGateTestDom({ hud: true });
    const document = new native.Document(), parent = new native.hud.HTMLElement('main');
    const nativeAppend = native.Node.prototype.appendChild, nativeRemove = native.Node.prototype.removeChild;
    Reflect.apply(nativeAppend, document, [parent]);
    const styleGetter = Object.getOwnPropertyDescriptor(native.hud.HTMLElement.prototype, 'style').get;
    const textSetter = Object.getOwnPropertyDescriptor(native.hud.CharacterData.prototype, 'data').set;
    const styleSetter = native.hud.CSSStyleDeclaration.prototype.setProperty;
    const calls = [], created = [], translates = new WeakMap();
    let hook = () => {}, current = true;
    const operation = (name, body) => function (...args) {
      const entry = { name, args };
      calls.push(entry); hook('before', entry);
      const result = body(...args); entry.result = result;
      hook('after', entry); return result;
    };
    const dom = ownRecord({});
    for (const name of domNames) {
      if (name === 'setText') dom[name] = operation(name,
        (target, value) => Reflect.apply(textSetter, target, [value]));
      else if (name === 'setStyle') dom[name] = operation(name,
        (target, key, value) => Reflect.apply(styleSetter, target, [key, value]));
      else {
        const owner = name === 'style' ? native.hud.HTMLElement
          : ['localName', 'namespaceURI'].includes(name) ? native.Element : native.Node;
        const getter = Object.getOwnPropertyDescriptor(owner.prototype, name).get;
        dom[name] = operation(name, target => Reflect.apply(getter, target, []));
      }
    }
    const tripwires = node => {
      for (const key of [...domNames, 'data', 'translate', 'then', 'innerHTML', 'outerHTML',
        'querySelector', 'appendChild', 'removeChild', 'getBoundingClientRect'])
        Object.defineProperty(node, key, { get() { throw new Error(`Late node read: ${key}`); },
          set() { throw new Error(`Late node write: ${key}`); } });
      return node;
    };
    const construct = ownRecord({
      createElement: operation('createElement', (receiver, tag) => {
        assert.equal(receiver, document); assert.ok(['div', 'span', 'br'].includes(tag));
        const node = new native.hud.HTMLElement(tag);
        native.state(node).owner = document; created.push(node); return tripwires(node);
      }),
      createTextNode: operation('createTextNode', (receiver, text) => {
        assert.equal(receiver, document); assert.equal(typeof text, 'string');
        const node = new native.hud.CharacterData(text);
        native.state(node).owner = document; created.push(node); return tripwires(node);
      }),
      appendChild: operation('appendChild', (target, child) => Reflect.apply(nativeAppend, target, [child])),
      removeChild: operation('removeChild', (target, child) => Reflect.apply(nativeRemove, target, [child])),
    });
    const properties = ownRecord({ setTranslate: operation('setTranslate', function (target, value) {
      assert.equal(arguments.length, 2); assert.equal(value, true);
      Reflect.apply(styleGetter, target, []); // Native HTMLElement brand double.
      translates.set(target, value);
    }) });
    const input = ownRecord({ sceneIdentity: Symbol('scene'), documentIdentity: Symbol('document'),
      document, parent, dom, construct, properties, isCurrentDocument: operation('current', () => current) });
    tripwires(document); tripwires(parent);
    const children = node => Array.from(node.children);
    return { native, document, parent, dom, construct, properties, input, calls, created,
      lease: () => create(input), hook(value) { hook = value; }, current(value) { current = value; },
      children, style: node => native.hud.style(Reflect.apply(styleGetter, node, [])),
      text: node => native.hud.character(node).data,
      detach(node) { Reflect.apply(nativeRemove, native.state(node).parent, [node]); },
      append(target, node) { Reflect.apply(nativeAppend, target, [node]); },
      nodes() { const mount = children(parent)[0]; return { mount,
        heading: children(mount)[0], columns: children(mount).slice(1) }; },
      translates };
  }
  const row = (ordinal, own = false) => ({ ordinal, numberText: `#${ordinal}`, score: -0,
    scoreText: '0', nameText: 'A\u00a0&<>"\'\n\u007f', cssColor: '#80ff80', own,
    opacityRequest: own ? 1 : .7 * (.3 + .7 * (1 - ordinal / 10)) });
  const boardView = (binding, rows = [row(1)], revision = 1n, extra = {}) => issue(binding,
    { rows, revision, setupSeen: true, boardPresent: true, readiness: 'ready', reason: null, ...extra });
  const mutations = new Set(['createElement', 'createTextNode', 'appendChild', 'removeChild', 'setStyle', 'setTranslate']);

  test('inert frozen lease mounts exact owned geometry, hidden boxes and native translate', () => {
    const f = fixture(), lease = f.lease();
    assert.equal(f.calls.length, 0); assert.equal(Object.isFrozen(lease), true);
    assert.deepEqual(Object.keys(lease), ['mount', 'readiness', 'render', 'dispose']);
    assert.equal(lease.readiness().state, 'pending'); assert.equal(f.calls.length, 0);
    const binding = lease.mount(), { mount, heading, columns } = f.nodes();
    assert.equal(Object.isFrozen(binding), true); assert.equal(binding.state, 'ready');
    assert.equal(f.created.length, 6); assert.equal(f.text(f.children(heading)[0]), 'Leaderboard');
    assert.equal(f.style(mount).get('pointer-events'), 'none');
    assert.deepEqual(columns.map(node => f.children(node)), [[], [], []]);
    for (const node of [heading, ...columns]) {
      assert.equal(f.style(node).get('display'), 'none');
      assert.equal(f.style(node).get('position'), 'fixed');
      assert.equal(f.style(node).get('cursor'), 'default');
      assert.equal(f.style(node).get('font-family'), 'Arial, "Helvetica Neue", Helvetica, sans-serif');
    }
    assert.equal(f.style(heading).get('top'), '4px'); assert.equal(f.style(heading).get('right'), '4px');
    assert.equal(f.style(heading).get('width'), '285px'); assert.equal(f.style(heading).get('height'), '28px');
    assert.equal(f.style(heading).get('font-size'), '21px'); assert.equal(f.style(heading).get('font-weight'), 'bold');
    for (const [i, node] of columns.entries()) {
      const s = f.style(node);
      for (const [key, value] of Object.entries({ top: '32px', height: '800px', overflow: 'hidden',
        'font-size': '12px', 'line-height': '150%', right: ['4px', '64px', '260px'][i],
        width: ['50px', '180px', '30px'][i], 'text-align': ['center', 'left', 'right'][i], 'z-index': String(7 + i) }))
        assert.equal(s.get(key), value);
      assert.equal(s.has('white-space'), i === 1);
      assert.equal(s.has('font-variant-numeric'), i !== 1);
    }
    assert.equal(f.translates.get(columns[1]), true);
    assert.equal(f.style(f.parent).size, 0);
    assert.equal(lease.readiness().bindingIdentity, binding.bindingIdentity);
    lease.dispose(); lease.dispose(); assert.deepEqual(f.children(f.parent), []);
  });

  test('Setup before board writes visibility/opacity; disabled and nonready views never write', () => {
    const f = fixture(), lease = f.lease(), binding = lease.mount(), { heading, columns } = f.nodes();
    lease.render(issue(binding));
    assert.equal(f.style(heading).get('display'), 'none');
    const receipt = lease.render(issue(binding, { setupSeen: true,
      requestedOpacity: Object.freeze({ heading: -.85, rows: -1 }) }));
    assert.equal(receipt.readiness, 'pending'); assert.equal(receipt.rowsWritten, false);
    for (const node of [heading, ...columns]) assert.equal(f.style(node).get('display'), 'inline');
    assert.equal(f.style(heading).get('opacity'), '-0.85');
    for (const node of columns) assert.equal(f.style(node).get('opacity'), '-1');
    for (const fields of [
      { binding: Object.freeze({ state: 'pending', reason: 'nodes-pending' }), readiness: 'pending', reason: 'nodes-pending' },
      { binding: Object.freeze({ state: 'unavailable', reason: 'disposed' }), readiness: 'unavailable', reason: 'disposed' },
      { revision: null, requestedOpacity: null, readiness: 'unavailable', reason: 'leaderboard-disabled-or-disposed' },
    ]) {
      const before = f.calls.length;
      lease.render(issue(binding, fields));
      assert.equal(f.calls.slice(before).some(c => mutations.has(c.name)), false);
    }
    lease.dispose();
  });

  test('ten visible rows preserve Text/color/opacity and own-name bold', () => {
    const f = fixture(), lease = f.lease(), binding = lease.mount();
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, i === 4));
    const receipt = lease.render(boardView(binding, rows));
    assert.equal(receipt.rowsWritten, true);
    assert.equal(f.created.length, 6 + 9 * 10);
    const { columns } = f.nodes();
    for (const [column, node] of columns.entries()) {
      const children = f.children(node); assert.equal(children.length, 20);
      for (const [index, value] of rows.entries()) {
        const span = children[index * 2], br = children[index * 2 + 1];
        assert.equal(f.native.state(span).tag, 'span'); assert.equal(f.native.state(br).tag, 'br');
        assert.equal(f.text(f.children(span)[0]), [value.scoreText, value.nameText, value.numberText][column]);
        assert.equal(f.style(span).get('color'), value.cssColor);
        assert.equal(f.style(span).get('opacity'), String(value.opacityRequest));
        assert.equal(f.style(span).get('font-weight'), column === 1 && value.own ? 'bold' : 'normal');
      }
    }
    lease.dispose();
  });

  test('oversized issued-view double is rejected before DOM work', () => {
    const f = fixture(), lease = f.lease(), binding = lease.mount();
    const before = f.calls.length;
    assert.throws(() => lease.render(boardView(binding,
      Array.from({ length: 11 }, (_, index) => row(index + 1)))), { name: 'TypeError' });
    assert.equal(f.calls.length, before);
    assert.equal(f.created.length, 6);
    lease.dispose();
  });

  test('same revision updates only styles; equal new revision rebuilds and empty board clears', () => {
    const f = fixture(), lease = f.lease(), binding = lease.mount();
    lease.render(boardView(binding));
    const old = f.children(f.nodes().columns[0]), created = f.created.length, before = f.calls.length;
    assert.equal(lease.render(boardView(binding, [row(1)], 1n,
      { requestedOpacity: Object.freeze({ heading: .425, rows: .5 }) })).rowsWritten, false);
    assert.equal(f.created.length, created);
    assert.equal(f.calls.slice(before).some(c => ['createElement', 'createTextNode', 'appendChild', 'removeChild'].includes(c.name)), false);
    assert.equal(f.children(f.nodes().columns[0])[0], old[0]);
    assert.equal(lease.render(boardView(binding, [row(1)], 2n)).rowsWritten, true);
    assert.notEqual(f.children(f.nodes().columns[0])[0], old[0]);
    assert.equal(f.native.state(old[0]).parent, null);
    assert.equal(lease.render(boardView(binding, [], 3n)).rowsWritten, true);
    for (const column of f.nodes().columns) assert.deepEqual(f.children(column), []);
    lease.dispose();
  });

  test('all three columns finish disconnected preparation before first old-child replacement', () => {
    const f = fixture(), lease = f.lease(), binding = lease.mount();
    lease.render(boardView(binding));
    const before = f.calls.length, old = f.nodes().columns.map(node => f.children(node));
    let firstRemoval = true;
    f.hook((phase, entry) => {
      if (phase === 'before' && entry.name === 'removeChild' && firstRemoval) {
        firstRemoval = false;
        assert.equal(f.created.length, 6 + 9 + 18);
        for (const [i, column] of f.nodes().columns.entries()) assert.deepEqual(f.children(column), old[i]);
      }
    });
    lease.render(boardView(binding, [row(1), row(2)], 2n));
    const tape = f.calls.slice(before), first = tape.findIndex(c => c.name === 'removeChild');
    assert.ok(first > 0); assert.equal(tape.slice(first).some(c => c.name.startsWith('create')), false);
    f.hook(() => {}); lease.dispose();
  });

  test('row allocation cap is checked before native observation; issued-view membership and identities are mandatory', () => {
    for (const mode of ['unissued', 'scene', 'document', 'binding', 'oversize']) {
      const f = fixture(), lease = f.lease(), binding = lease.mount();
      const view = mode === 'unissued' ? { ...boardView(binding) }
        : boardView(binding, mode === 'oversize' ? new Array(149796).fill(row(1)) : [row(1)], 1n,
          mode === 'scene' ? { sceneIdentity: Symbol() } : mode === 'document'
            ? { documentIdentity: Symbol() } : mode === 'binding' ? { bindingIdentity: Symbol() } : {});
      const before = f.calls.length;
      assert.throws(() => lease.render(view)); assert.equal(f.calls.length, before);
      assert.equal(lease.readiness().state, 'unavailable'); lease.dispose();
    }
  });

  test('closed records reject getters/extra fields/prototypes; foreign bound async/generators rejected without calls', () => {
    for (const group of ['input', 'dom', 'construct', 'properties']) {
      const f = fixture(), original = group === 'input' ? f.input : f.input[group], key = Object.keys(original)[0];
      for (const bad of [Object.assign(Object.create({}), original), ownRecord({ ...original, extra: true }),
        Object.defineProperty(ownRecord(original), key, { get() { throw new Error('Getter invoked'); } }),
        ownRecord({ ...original, [Symbol()]: true })]) {
        assert.throws(() => create(group === 'input' ? bad : ownRecord({ ...f.input, [group]: bad })), /Invalid/);
        assert.equal(f.calls.length, 0);
      }
    }
    for (const callback of [async () => {}, function* () {}, async function* () {},
      (async () => {}).bind(null), (function* () {}).bind(null), (async function* () {}).bind(null)]) {
      const f = fixture();
      assert.throws(() => create(ownRecord({ ...f.input, isCurrentDocument: callback })), /Invalid/);
      assert.equal(f.calls.length, 0);
    }
  });

  test('captured capabilities ignore later records; malformed native brands/topology cannot mount', () => {
    const f = fixture(), lease = f.lease();
    for (const group of [f.dom, f.construct, f.properties]) for (const key of Object.keys(group))
      group[key] = () => { throw new Error('Late replacement'); };
    lease.mount(); lease.dispose();
    for (const mode of ['proxy', 'foreign', 'svg', 'detached', 'fresh-alias', 'wrong-tag', 'style-alias']) {
      const f = fixture();
      if (mode === 'proxy') f.input.parent = new Proxy(f.parent, {});
      if (mode === 'foreign') f.native.state(f.parent).owner = new f.native.Document();
      if (mode === 'svg') f.native.state(f.parent).namespace = 'http://www.w3.org/2000/svg';
      if (mode === 'detached') f.detach(f.parent);
      if (mode === 'fresh-alias') f.construct.createElement = () => f.parent;
      if (mode === 'wrong-tag') {
        const original = f.construct.createElement;
        f.construct.createElement = (...args) => { const node = original(...args); f.native.state(node).tag = 'aside'; return node; };
      }
      if (mode === 'style-alias') {
        const original = f.dom.style; let shared;
        f.dom.style = target => { const value = original(target); return shared ??= value; };
      }
      const lease = f.lease(); assert.throws(lease.mount); lease.dispose();
      assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
    }
  });

  test('before/after every mount mutation and each getter category preserve exact first thrown values', t => {
    const control = fixture(); control.lease().mount();
    const tape = control.calls;
    const selected = tape.map((call, index) => ({ name: call.name, index }))
      .filter(({ name, index }) => mutations.has(name) || tape.findIndex(c => c.name === name) === index);
    let cases = 0;
    for (const { index, name } of selected) for (const phase of ['before', 'after']) for (const primary of primaries) {
      const f = fixture(), lease = f.lease(); let position = -1;
      f.hook((at) => { if (at === 'before') position++; if (position === index && at === phase) throw primary; });
      throwsExact(lease.mount, primary);
      assert.equal(f.calls.some(c => c.name === 'removeChild'), false, `${name}: no internal cleanup`);
      const stopped = f.calls.length; assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, stopped);
      f.hook(() => {}); lease.dispose(); lease.dispose(); assert.deepEqual(f.children(f.parent), []); cases++;
    }
    t.diagnostic(`${cases} exact-primary before/after mount cases; all mutations and first getter/checker categories`);
  });

  test('every mount boundary position stops on before/after undefined throws', t => {
    const control = fixture(); control.lease().mount();
    const count = control.calls.length;
    for (let index = 0; index < count; index++) for (const phase of ['before', 'after']) {
      const f = fixture(), lease = f.lease(); let position = -1;
      f.hook(at => { if (at === 'before') position++; if (position === index && at === phase) throw undefined; });
      throwsExact(lease.mount, undefined);
      assert.equal(f.calls.length, index + 1);
      assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
      f.hook(() => {}); lease.dispose(); assert.deepEqual(f.children(f.parent), []);
    }
    t.diagnostic(`${count * 2} before/after cases across every native/checker mount boundary`);
  });

  test('last append after-effect failure retains own lease until external post-guard disposal', () => {
    for (const primary of primaries) {
      const f = fixture(), lease = f.lease(); let guard = true;
      f.hook((phase, entry) => {
        if (entry.name === 'appendChild' && entry.args[0] === f.parent && phase === 'after') throw primary;
        if (entry.name === 'removeChild' && guard) throw new Error('Cleanup inside guard');
      });
      throwsExact(lease.mount, primary); assert.equal(f.children(f.parent).length, 1);
      guard = false; f.hook(() => {}); lease.dispose(); assert.deepEqual(f.children(f.parent), []);
    }
  });

  test('caught mount/render/readiness/disposal reentry poisons active operation and invalidates binding', () => {
    for (const outer of ['mount', 'render']) for (const nested of ['mount', 'render', 'readiness', 'dispose']) {
      const f = fixture(), lease = f.lease(); let binding, caught;
      if (outer === 'render') binding = lease.mount();
      let fired = false;
      f.hook((phase, entry) => {
        if (!fired && phase === 'before' && entry.name === 'setStyle') {
          fired = true;
          try { lease[nested](binding && boardView(binding)); } catch (error) { caught = error; }
        }
      });
      let thrown;
      try { outer === 'mount' ? lease.mount() : lease.render(boardView(binding)); } catch (error) { thrown = error; }
      assert.equal(fired, true); assert.match(String(caught), /reentry/); assert.equal(thrown, caught);
      const count = f.calls.length;
      assert.equal(lease.readiness().state, 'unavailable'); assert.equal(f.calls.length, count);
      f.hook(() => {}); lease.dispose(); assert.deepEqual(f.children(f.parent), []);
    }
  });

  test('caught reentry at every native category stops even if callback subsequently throws another value', () => {
    const control = fixture(); control.lease().mount();
    const names = [...new Set(control.calls.map(call => call.name))];
    for (const name of names) for (const phase of ['before', 'after']) {
      const f = fixture(), lease = f.lease(); let first, fired = false;
      f.hook((at, entry) => {
        if (!fired && entry.name === name && at === phase) {
          fired = true;
          try { lease.readiness(); } catch (error) { first = error; }
          throw undefined;
        }
      });
      let thrown;
      try { lease.mount(); } catch (error) { thrown = error; }
      assert.equal(fired, true); assert.match(String(first), /reentry/); assert.equal(thrown, first);
      f.hook(() => {}); lease.dispose(); assert.deepEqual(f.children(f.parent), []);
    }
  });

  test('constructor reflection failures preserve primary and invalid freshness never observes native DOM', () => {
    for (const primary of primaries) for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const f = fixture();
      throwsExact(() => create(new Proxy(f.input, { [trap]() { throw primary; } })), primary);
      assert.equal(f.calls.length, 0);
    }
    for (const value of [undefined, null, 0, 1, 'true', Promise.resolve(true),
      Object.defineProperty({}, 'then', { get() { throw new Error('then inspected'); } })]) {
      const f = fixture(), lease = f.lease(); f.current(value);
      assert.throws(lease.mount, /Invalid/); assert.deepEqual(f.calls.map(c => c.name), ['current']);
      f.current(true); lease.dispose();
    }
  });

  test('unrelated children survive cleanup, and cleanup reentry consumes its lease without a second removal', () => {
    const f = fixture(), lease = f.lease(); lease.mount();
    const unrelated = new f.native.hud.HTMLElement('aside'); f.native.state(unrelated).owner = f.document;
    f.append(f.parent, unrelated); lease.dispose(); assert.deepEqual(f.children(f.parent), [unrelated]);
    for (const phase of ['before', 'after']) {
      const f = fixture(), lease = f.lease(); lease.mount(); let first;
      f.hook((at, entry) => {
        if (entry.name === 'removeChild' && at === phase) {
          try { lease.dispose(); } catch (error) { first = error; }
        }
      });
      let thrown;
      try { lease.dispose(); } catch (error) { thrown = error; }
      assert.equal(thrown, first); assert.match(String(first), /reentry/);
      const count = f.calls.length; lease.dispose(); assert.equal(f.calls.length, count);
    }
  });

  test('staleness stops observations immediately; old ready views cannot bypass live ownership checks', () => {
    for (const mode of ['stale', 'adopted', 'reparented', 'extra-child', 'parent-moved', 'namespace']) {
      const f = fixture(), lease = f.lease(), binding = lease.mount(), view = boardView(binding), { mount } = f.nodes();
      const other = new f.native.hud.HTMLElement('section'); f.native.state(other).owner = f.document;
      f.append(f.document, other);
      if (mode === 'stale') f.current(false);
      if (mode === 'adopted') f.native.state(mount).owner = new f.native.Document();
      if (mode === 'reparented') { f.detach(mount); f.append(other, mount); }
      if (mode === 'extra-child') f.append(mount, new f.native.hud.HTMLElement('aside'));
      if (mode === 'parent-moved') { f.detach(f.parent); f.append(other, f.parent); }
      if (mode === 'namespace') f.native.state(mount).namespace = 'http://www.w3.org/2000/svg';
      const before = f.calls.length;
      if (mode === 'stale') assert.equal(lease.render(view).readiness, 'unavailable');
      else assert.throws(() => lease.render(view));
      assert.equal(f.calls.slice(before).some(c => mutations.has(c.name)), false);
      if (mode === 'stale') assert.deepEqual(f.calls.slice(before).map(c => c.name), ['current']);
      const cleanup = f.calls.length; lease.dispose(); lease.dispose();
      if (['stale', 'adopted', 'reparented', 'parent-moved', 'namespace'].includes(mode))
        assert.equal(f.calls.slice(cleanup).some(c => c.name === 'removeChild'), false);
    }
    const f = fixture(), lease = f.lease(); lease.mount();
    f.hook((phase, entry) => { if (phase === 'after' && entry.name === 'nodeType') f.current(false); });
    assert.equal(lease.readiness().state, 'unavailable'); assert.equal(f.calls.at(-1).name, 'current');
    f.hook(() => {}); lease.dispose();
  });

  test('partial prepare/replacement/style failure preserves primary, stops, invalidates, then cleanup consumes once', () => {
    for (const name of ['createElement', 'createTextNode', 'appendChild', 'removeChild', 'setStyle'])
      for (const phase of ['before', 'after']) for (const primary of primaries) {
        const f = fixture(), lease = f.lease(), binding = lease.mount(); lease.render(boardView(binding));
        const old = f.nodes().columns.map(column => f.children(column)); let fired = false;
        f.hook((at, entry) => { if (!fired && entry.name === name && at === phase) { fired = true; throw primary; } });
        throwsExact(() => lease.render(boardView(binding, [row(1), row(2)], 2n)), primary);
        assert.equal(fired, true); assert.equal(lease.readiness().state, 'unavailable');
        if (['createElement', 'createTextNode', 'setStyle'].includes(name))
          for (const [i, column] of f.nodes().columns.entries()) assert.deepEqual(f.children(column), old[i]);
        f.hook(() => {}); lease.dispose(); const count = f.calls.length; lease.dispose();
        assert.equal(f.calls.length, count); assert.deepEqual(f.children(f.parent), []);
      }
  });

  test('every replacement append/remove and publication setter fails without replay or success receipt', t => {
    const control = fixture(), lease = control.lease(), binding = lease.mount();
    lease.render(boardView(binding));
    const nodes = control.nodes(), before = control.calls.length;
    const publishStyles = new Set(control.calls.filter(c => c.name === 'style'
      && [nodes.heading, ...nodes.columns].includes(c.args[0])).map(c => c.result));
    lease.render(boardView(binding, [row(1), row(2)], 2n));
    const positions = control.calls.slice(before).map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.name === 'removeChild'
        || entry.name === 'appendChild' && nodes.columns.includes(entry.args[0])
        || entry.name === 'setStyle' && publishStyles.has(entry.args[0]));
    let cases = 0;
    for (const { index } of positions) for (const phase of ['before', 'after']) for (const primary of primaries) {
      const f = fixture(), lease = f.lease(), binding = lease.mount(); lease.render(boardView(binding));
      let position = -1;
      f.hook(at => { if (at === 'before') position++; if (position === index && at === phase) throw primary; });
      const count = f.calls.length;
      throwsExact(() => lease.render(boardView(binding, [row(1), row(2)], 2n)), primary);
      assert.equal(f.calls.length - count, index + 1);
      const stopped = f.calls.length;
      assert.equal(lease.render(boardView(binding, [row(1)], 3n)).readiness, 'unavailable');
      assert.equal(f.calls.length, stopped);
      f.hook(() => {}); lease.dispose(); assert.deepEqual(f.children(f.parent), []); cases++;
    }
    t.diagnostic(`${cases} exact-primary before/after replacement/publication mutation cases`);
  });

  test('all nine supplied colors and numeric text requests pass unchanged to each row column', () => {
    const f = fixture(), lease = f.lease(), binding = lease.mount();
    const colors = ['#c080ff', '#9099ff', '#80d0d0', '#80ff80', '#eeee70', '#ffa060', '#ff9090', '#ff4040', '#e030e0'];
    const rows = colors.map((cssColor, i) => ({ ...row(i + 1), cssColor,
      score: i === 0 ? NaN : i === 1 ? -9007199254740991 : 9007199254740991,
      scoreText: i === 0 ? 'NaN' : i === 1 ? '-9007199254740991' : '9007199254740991' }));
    lease.render(boardView(binding, rows));
    for (const column of f.nodes().columns) for (const [i, color] of colors.entries())
      assert.equal(f.style(f.children(column)[2 * i]).get('color'), color);
    assert.deepEqual(f.children(f.nodes().columns[0]).filter((_, i) => i % 2 === 0)
      .map(span => f.text(f.children(span)[0])), rows.map(row => row.scoreText));
    lease.dispose();
  });

  test('disposal boundary failures retain exact falsy primary and consume cleanup without retry', () => {
    for (const name of ['current', 'nodeType', 'ownerDocument', 'parentNode', 'isConnected', 'namespaceURI', 'style', 'removeChild'])
      for (const phase of ['before', 'after']) for (const primary of primaries) {
        const f = fixture(), lease = f.lease(); lease.mount(); let fired = false;
        f.hook((at, entry) => { if (!fired && entry.name === name && at === phase) { fired = true; throw primary; } });
        throwsExact(lease.dispose, primary); assert.equal(fired, true);
        const count = f.calls.length; lease.dispose(); assert.equal(f.calls.length, count);
        assert.equal(lease.readiness().reason, 'disposed'); assert.equal(f.calls.length, count);
      }
  });
}
