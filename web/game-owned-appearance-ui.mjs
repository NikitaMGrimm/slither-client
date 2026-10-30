// Native menu glue. Selection, formatting and persistence grammar belong to Rust.
import { startPageLayout } from './start-page-layout.mjs';

const apply = Reflect.apply;
const freeze = Object.freeze;
function record(value, fields) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== fields.length) throw new TypeError('Closed menu record required');
  const copy = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Menu data fields required');
    copy[key] = descriptor.value;
  }
  return copy;
}

/** Retain this lease before mount. No timers, source reads or session authority. */
export function createOwnedAppearanceUi({ document, parent, nickname, dom, construct, controls,
  capabilities, Policy, policyMethods, local, isCurrentDocument, preview }) {
  let methods = record(policyMethods, ['view', 'action', 'set_nickname', 'serialize', 'free']);
  if (Object.values(methods).some(method => typeof method !== 'function')) throw new TypeError('Complete captured menu policy required');
  let owner, mount, previewMount, title, detail, nicknameParent, entries = [], lines = [], attempted = false, disposed = false, disabled = false;
  const invoke = (name, ...args) => apply(methods[name], owner, args);
  const current = () => {
    if (disposed || !isCurrentDocument() || dom.ownerDocument(parent) !== document || !dom.isConnected(parent)) {
      throw new Error('Current menu document required');
    }
    if (nicknameParent && (dom.ownerDocument(nickname) !== document || !dom.isConnected(nickname)
      || dom.parentNode(nickname) !== nicknameParent || dom.parentNode(nicknameParent) !== parent)) throw new Error('Current menu nickname required');
    if (mount) {
      if (dom.parentNode(mount) !== parent || dom.ownerDocument(mount) !== document || !dom.isConnected(mount)) throw new Error('Current menu mount required');
      for (const { button, text } of entries) {
        if (dom.ownerDocument(button) !== document || !dom.isConnected(button) || dom.parentNode(button) !== mount
          || dom.firstChild(button) !== text || dom.parentNode(text) !== button || dom.nextSibling(text) !== null) {
          throw new Error('Current menu buttons required');
        }
      }
      for (const { line, text } of lines) {
        if (dom.parentNode(line) !== mount || dom.ownerDocument(line) !== document || !dom.isConnected(line)
          || dom.firstChild(line) !== text || dom.parentNode(text) !== line || dom.nextSibling(text) !== null) throw new Error('Current menu labels required');
      }
      if (previewMount) preview.current();
      const children = [...lines.map(entry => entry.line), ...entries.map(entry => entry.button), ...(previewMount ? [previewMount] : [])];
      if (dom.firstChild(mount) !== children[0] || children.some((node, index) => dom.nextSibling(node) !== (children[index + 1] ?? null))) throw new Error('Exact menu topology required');
    }
  };
  const view = () => {
    const value = record(invoke('view'), ['nickname', 'skin', 'customSkin', 'title', 'detail', 'controls']);
    if (typeof value.nickname !== 'string' || typeof value.title !== 'string' || typeof value.detail !== 'string'
      || !Array.isArray(value.controls) || value.controls.length > 16 || !(value.customSkin instanceof Uint8Array)
      || !Number.isInteger(value.skin) || value.skin < 0 || value.skin > 255) throw new TypeError('Copied menu view required');
    value.controls = value.controls.map(item => {
      const control = record(item, ['action', 'label', 'enabled']);
      if (typeof control.action !== 'string' || typeof control.label !== 'string' || typeof control.enabled !== 'boolean') throw new TypeError('Copied menu controls required');
      return control;
    });
    return value;
  };
  function render() {
    current();
    const value = view();
    if (value.controls.length !== entries.length) throw new Error('Stable menu control inventory required');
    dom.setText(title, value.title); dom.setText(detail, value.detail);
    for (const [index, entry] of entries.entries()) {
      const control = value.controls[index];
      if (control.action !== entry.action) throw new Error('Stable menu action required');
      dom.setText(entry.text, control.label);
      controls.buttonDisabled(entry.button, disabled || !control.enabled);
    }
    current();
  }
  function save() {
    current();
    if (typeof capabilities.write(invoke('serialize')) !== 'boolean') throw new TypeError('Synchronous menu storage result required');
    current();
  }
  function change(action) {
    current();
    if (disabled) return;
    invoke('action', action); render(); save();
    notifyPreview();
  }
  function notifyPreview() {
    if (!preview) return;
    current();
    const selected = view();
    preview.select(selected.skin, new Uint8Array(selected.customSkin)); current();
  }
  function mountMenu() {
    if (attempted || disposed) throw new Error('Menu mount already consumed');
    attempted = true; current();
    nicknameParent = dom.parentNode(nickname); current();
    const saved = capabilities.read(); current();
    if (saved !== null && (typeof saved !== 'string' || saved.length > 600)) throw new TypeError('Bounded native menu storage required');
    owner = new Policy(local, typeof saved === 'string' ? saved : '');
    const value = view();
    if (capabilities.setNickname(nickname, value.nickname) !== undefined) throw new TypeError('Synchronous nickname restoration required');
    current();
    const used = new Set([document, parent, nickname]);
    const fresh = (tag, content) => {
      const node = tag ? construct.createElement(document, tag) : construct.createTextNode(document, content);
      if (!node || used.has(node) || dom.ownerDocument(node) !== document || dom.parentNode(node) !== null
        || dom.isConnected(node) || dom.firstChild(node) !== null || dom.nextSibling(node) !== null
        || dom.nodeType(node) !== (tag ? 1 : 3) || tag && (dom.localName(node) !== tag || dom.namespaceURI(node) !== 'http://www.w3.org/1999/xhtml')) {
        throw new TypeError('Fresh menu node required');
      }
      used.add(node); return node;
    };
    const root = fresh('div');
    const textLine = content => {
      const line = fresh('div'), text = fresh(null, content);
      construct.appendChild(line, text); construct.appendChild(root, line);
      lines.push({ line, text });
      return text;
    };
    textLine('Appearance'); title = textLine(value.title); detail = textLine(value.detail);
    const actions = [];
    const seen = new Set();
    for (const control of value.controls) {
      if (seen.has(control.action)) throw new TypeError('Distinct menu actions required');
      seen.add(control.action);
      const button = fresh('button'), text = fresh(null, control.label);
      controls.buttonType(button); controls.buttonDisabled(button, !control.enabled);
      construct.appendChild(button, text); construct.appendChild(root, button);
      for (const [property, value] of startPageLayout.menuButton) dom.setStyle(dom.style(button), property, value);
      entries.push({ button, text, action: control.action });
      actions.push(freeze({ button, parent: root, onPress: () => change(control.action) }));
    }
    for (const [property, value] of startPageLayout.menu) dom.setStyle(dom.style(root), property, value);
    current();
    mount = root; construct.appendChild(parent, mount); current();
    if (preview) { previewMount = preview.mount(mount); current(); notifyPreview(); }
    return freeze(actions);
  }
  function setDisabled(value) {
    if (typeof value !== 'boolean') throw new TypeError('Menu disabled boolean required');
    disabled = value; if (mount) render();
  }
  function rememberNickname(value) { current(); invoke('set_nickname', value); save(); }
  function selection(value) {
    rememberNickname(value);
    const selected = view();
    return { nickname: selected.nickname, skin: selected.skin, customSkin: selected.customSkin };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    let failed = false, primary;
    try { preview?.dispose(); } catch (error) { failed = true; primary = error; }
    try {
      if (mount && isCurrentDocument() && dom.ownerDocument(mount) === document && dom.parentNode(mount) === parent) construct.removeChild(parent, mount);
    } catch (error) { if (!failed) { failed = true; primary = error; } }
    try { if (owner) invoke('free'); }
    catch (error) { if (!failed) { failed = true; primary = error; } }
    finally {
      owner = mount = previewMount = title = detail = nicknameParent = undefined; entries = []; lines = [];
      document = parent = nickname = dom = construct = controls = capabilities = Policy = isCurrentDocument = methods = preview = undefined;
    }
    if (failed) throw primary;
  }
  return freeze({ mount: mountMenu, setDisabled, rememberNickname, selection, dispose });
}
