# Semantic HUD views and passive DOM rendering

`projectHudView(snapshot, binding)` projects a genuine committed
[HUD reducer](hud-state.md) snapshot and a closed binding-readiness observation
into a copied, frozen view. `requireHudView(value)` admits only views issued by
that same module graph. Neither function reads a native scene, source, clock or
transport. Views contain no DOM capability, profile, endpoint or packet data.

## History, formatting and readiness

Binding observations contain schema 1, private binding/document/scene Symbols,
scope (`readout` or `readout-and-final`), state and reason. Ready requires a null
reason; pending reasons are `nodes-pending` and `text-unselected`. Unavailable
reasons distinguish stale documents, unselected bindings, unavailable native DOM,
failed bindings and disposal. This is a trusted temporal observation, not a
permanent readiness certificate. Input records must have exactly the selected
own data fields and current-realm Object/null prototypes.

Current values come from stored displayed history, never the newest packet
header. Final values and exclamation come from already captured final history.
Reset/live-token changes do not erase these histories or replace their tokens.
Scores are primitive safe integers printed in plain decimal without grouping,
units or locale. Numeric negative zero remains negative zero as data and prints
`0`; negative and above-u32 scores remain valid. Fade and all four raw opacity
requests are copied without recomputation or clamping.

Nonready bindings retain available history as data. Null histories remain
missing; a null gameplay snapshot is unavailable, and an excluded final role is
explicitly `scope-excluded`. Aggregate readiness remains pending when any
selected role lacks history, while an individually ready current role can be
rendered on its own. No missing value becomes numeric zero.

## Fixed-node renderer

The separate module exports:

```js
bindStockHudDom({
  sceneIdentity, documentIdentity, scope, dom, nodes, isCurrentDocument,
}); // frozen { readiness, render, dispose }
```

Construction copies closed records without native observations or effects.
The owner supplies its exact Document, connected HTML mount, authored text-policy
selection and fixed readout/final subtrees. Readout uses two DIV lines with
SPAN/B elements, each holding one exact Text node. Final uses a separate DIV
with a SPAN label and B value. Selected missing nodes remain pending. The module
creates, searches for and attaches no nodes and selects no labels or mount.

The closed `dom` record supplies `nodeType`, `ownerDocument`, `parentNode`,
`firstChild`, `nextSibling`, `isConnected`, `localName`, `namespaceURI`, `style`,
`setText` and `setStyle`. Trusted composition must capture the native getters,
CharacterData setter and CSS setter with their exact receivers. Getterless
record validation does not prohibit these intentionally captured native getter
operations. Late mutable node properties, selectors, HTML parsing and original
page functions are not alternative capabilities.

`readiness()` checks freshness, native brands, namespace/tags, exact Document,
connection, distinct identities and bounded direct topology. A false freshness
check prevents subsequent native observations. `render(view)` requires a genuine
view with matching identities/scope and rechecks topology/styles before effects.
An old ready view cannot bypass stale nodes; an old pending view is not promoted
by improved readiness. Project again at the next safe owner boundary.

Only ready roles write numeric Text and the specified local styles. Labels stay
unchanged. Readout receives its raw requested opacity, 12px/14px text sizing and
local .4/.8/.3/.35 opacities. Final uses its captured score text/suffix, .45 label
opacity and bold value; it has no inherited readout opacity or automatic
reveal/hide behavior. Header/rows/announcement requests remain data. The owner
supplies authored labels, stable numeric placement, layout and final visibility.

Native setters can fail after earlier writes. The renderer stops, invalidates
the binding and preserves the exact first thrown value, including `undefined`.
No success receipt, rollback, replay or replacement host follows. Disposal drops
references and performs no DOM removal or restoration. Reference release is not
a claim of measured garbage collection. Actual owner cleanup remains separate.

## Activation and evidence limits

The bootstrap remains unchanged and does not enable score tracking or HUD
readout. These passive APIs add no input/Play route, listener, timer, source
acquisition, game socket, message/global command, CSP change or permission.
Any future attachment must publish after gameplay/source operations and committed
semantic publication complete; packet/control/status callbacks are not that seam.

Authored Node capability doubles and real-Wasm/Canvas-recorder composition cover
the documented checks in [verification](verification.md). They do not establish
actual DOM/CSS, installed-browser, pixels, wording, login or server acceptance.
