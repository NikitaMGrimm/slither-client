# HUD views and DOM rendering

The default bootstrap selects current/final score readouts, Play controls and
visible leaderboard rows in one runtime. The readout projection and fixed-node
renderer below remain separate from the leaderboard state/view and dynamic row
owner. Integration is implemented in the selected default code; local browser
verification remains in progress, and installed-host acceptance is separate.

`projectHudView(snapshot, binding)` projects a genuine committed
[HUD reducer](hud-state.md) snapshot and a closed binding-readiness observation
into a copied, frozen view. `requireHudView(value)` admits only views issued by
that same module graph. The projection copies formatted values from its private
Rust history; neither function reads a native scene, source, clock or transport.
Views contain no DOM capability, profile, endpoint or packet data.

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
Rust formats primitive safe integer scores in plain decimal without grouping,
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

## Explicit bootstrap owner

The default bootstrap selects readout, Play and leaderboard owners before its
single claim, enables score tracking and binds its constructed readout nodes.
Importing it in an armed realm immediately starts that runtime; the standalone
loopback page uses the same entry with its local host adapter.

Custom compositions use the side-effect-free runtime factory with explicit
initialization/Wasm dependencies. Its `hudReadout` option must be a boolean.
True requires the gate's complete optional frozen
`native.hudDom` capability, enables score tracking before gameplay starts and
selects the existing gameplay readout mode. The semantic option alone does not
construct nodes; default construction is selected alongside it.

The completed readout runtime exposes the binding method below. The default
entry's owned readout already occupies its single slot; this example applies
to a custom composition with no binding:

```js
const ticket = runtime.bindHudReadout({ schema: 1, scope, nodes });
ticket.unbind();
```

The request has exactly three own data fields on the current realm's Object or
null prototype. The existing fixed-node grammar above applies; its Document must
be the gate's captured Document. One binding occupies the private slot. A stale
binding stays occupied until explicit unbind. Old tickets cannot release a newer
binding. The owner supplies labels, mount, layout and final visibility.

Binding projects genuine committed history at an idle boundary. Later publication
follows a successful frame or selected gameplay resize, after source/native work
returns. The deferred callback publishes changed nonnull HUD/board history;
local-host composition also uses this safe boundary to update Play availability
after a normal disconnect. There is no extra queue or timer.
Packet, source, control and status callbacks do not render the HUD. Freshness
uses the captured document predicate without checking asset readiness or profile
acquisition.

Nickname and HUD ownership share guards against reentry, including violations
caught by a caller. Publication failures stop the runtime after active native
work returns. Cleanup detaches nickname first, releases the HUD binding next,
then attempts the remaining owners while preserving the first thrown value.
Partial native text/style writes cannot be rolled back. Unbind/disposal removes
no nodes and restores no DOM values.

## Original owned HUD composition

The [default package entry](extension.md#package-selected-owned-hud) starts
the runtime with `hudReadout:true, ownedHudUi:true`, Play and leaderboard
construction enabled. Visible mode requires semantic readout mode; invalid
combinations reject before gate access. There is one default bootstrap and one
claim; former owned entry variants are removed.

The import-free UI builder validates and copies closed inputs, then returns an
inert frozen `{mount,dispose}` lease. Its once-only mount creates exactly 13
Elements and 8 Text nodes with the existing renderer's topology. The runtime
retains the lease before mounting under its HUD operation guard, exits that
guard, and binds `readout-and-final` through the existing binding method. A
second binding rejects while that slot is occupied.

The authored lower-left layout uses monospace/tabular numbers and fixed widths:
17ch current length, 5ch rank and population, and 18ch final length. Labels are
`Length: `, `Place: `, ` / ` and `Last length: `. Numeric text stays empty until
the corresponding history exists. The final line is always present and is
independent of readout opacity. Publications change only the existing
renderer-owned text/local styles; layout does not resize with the values.

The gate captures four additional own native methods in optional sibling
`native.ownedHudDom`, reusing the existing captured Document. Unsupported capture
omits that sibling as a whole without altering `native.hudDom`. Construction
performs no source, profile, clock, measured-layout or original-page lookup.

Failed mounting preserves its exact thrown value and leaves cleanup to the
runtime after guard exit. Disposal first releases nickname/HUD references, then
attempts to remove only its own mount at the original parent while the document
is current. Removal may fail or leave nodes behind; there is no retry or DOM
restoration. The passive renderer's own unbind/dispose still removes no nodes.

## Visible leaderboard composition

The default gameplay subscription uses schema-2 HUD reports, retaining raw rows
in the same command-time transaction. `LeaderboardScoreProjector` supplies Rust
score arithmetic after ingress and held-source release. Separate JavaScript
board state and copied views retain ordered board/setup history and text,
color and opacity policy. These are existing
[Rust migration debt](architecture.md#ownership-decision), not a model for new
JavaScript game logic.

`createOwnedLeaderboardUi` constructs and renders the heading and row columns
through captured DOM operations. Names are written through Text nodes; markup
is not evaluated. Publication follows committed gameplay at the shared safe
boundary, with the readout's requested header/row opacity. Cleanup owns only
its constructed nodes. This integrates visible rows in the selected default;
it does not add minimap or announcement display.

## Activation and evidence limits

The passive readout APIs alone add no Play route, input listener, timer,
source acquisition, game socket, message/global command, CSP change or permission.
The default entry chooses original labels/layout and constructs/binds its
readout, Play and leaderboard owners. Opening or activating it starts neither
remote profile acquisition nor a game socket. Local Play uses the same
composition with authored sources; see [local Play](local-play.md).

Authored Node capability doubles and real-Wasm/Canvas-recorder composition cover
the documented checks in [verification](verification.md). They do not establish
the current default's actual DOM/CSS, installed-browser, pixels, wording, login
or server acceptance. Earlier isolated native renderer evidence does not prove
this new owner composition.
