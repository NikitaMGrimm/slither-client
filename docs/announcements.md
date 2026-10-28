# Public announcements

The default extension and local Play entry select Rust-owned public announcement
retention through `enable_announcement_tracking()` before ingress. The existing
HUD packet transaction validates each complete bare `m` command before any source
or Setup callback. Unselected HUD and received-only packet APIs keep `m` opaque.
This selection does not change the schema-1/schema-2 report shapes.

Each accepted command uses its own u24 count and fractional mass with the score
table active at that command position. A complete ordered table-availability and
count-bound pass precedes every resolver and Setup callback; it allocates no score
tables and leaves the existing command-time f64 scoring in place. It receives no
own-score adjustment and has no playing guard. A positive score replaces the retained content; a zero or
negative score preserves it. A missing table or index beyond `N + 2048` rejects
the transaction. Later Setup commands do not recompute an earlier announcement.
This data is independent of the local final score and retained snake identity.

Name and message are decoded independently from Latin-1 and admitted by the
normal seven-digit policy: ASCII letters reset the accumulated digit count;
punctuation and spaces do not. The seventh ASCII digit rejects that text field
only. There is no trimming, printable-byte conversion, normalization, 24-byte
nickname cap or 140-byte outgoing-message cap. The complete bounded remainder
after the declared name is the message. Native tests preserve arbitrary bytes;
browser submission uses Text nodes with ordinary collapsing whitespace. Legacy
HTML control/NUL/entity parsing equivalence is not claimed.

Rust projects message, attribution and length in that order. Nonempty messages
have ordinary double quotes and 17-pixel bold italic styling, followed by a
5-pixel spacer. Attribution and length use 13-pixel text. Empty names select an
anonymous attribution when a message exists; both fields empty select a single
length line. Labels are authored English (`By`, `Anonymous player`, `Longest
today`); exact stock wording and typography remain unverified. The passive DOM
owner places the 300-by-228 CSS-pixel holder at left 8/top 4 and interprets no
packet text as markup.

There is no announcement expiry timer in the available authored authority.
Content survives Setup, death, return and ordinary world reset. Setup requests
opacity zero and a fade sentinel of -1. An accepted playing leaderboard outside
pending death starts the fade at zero. The existing pre-motion frame step and
session lifecycle drive Rust fade: alive increments use `min(1, fade + .01 *
delta)`, pending death holds, active return uses the supplied return fraction,
and completed return requests -1. No extra clock, draw, timer, socket or quality
update is added. Reads through `announcement_view()` consume no time. Numeric
transactions roll back on failure; external Canvas or DOM effects cannot be
rolled back.

Authority is the existing borrowed packet contract, authored score/HUD and normal
nickname-admission research, and HUD-06's coverage inventory. No original source,
artwork or capture is imported. The inventory remains unpromoted pending its
owner's reassessment.

Verification uses authored fixed-step native tests, synthetic DOM/runtime/package
tests, and the fresh real-Wasm ABI harness with a logical Canvas recorder. These
checks cover receipt order, replacement, text branches, lifecycle and rollback.
They do not establish native browser CSS/pixels, exact stock labels/layout,
installed-host behavior, official-server acceptance or full HUD fidelity.
Scripted screenshot comparison and independent review remain integration work
for the parent lane.
