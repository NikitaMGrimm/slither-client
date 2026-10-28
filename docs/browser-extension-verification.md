# Installed extension verification

The installed-preview harness tests the unchanged packaged Manifest V3 extension,
not HTTP copies of its files. It records the native extension identity, policy,
package hashes, actual extension-origin modules/Wasm and the existing authored
animated preview. It opens the package's launcher and clicks **Open offline
preview**. One preview PNG remains in a create-only external output directory.
No browser execution belongs to ordinary `npm test`.

## Explicit boundary

`extension/game-activation.mjs`, `game-gate.js`, `game-link.js` and the manifest's
web-accessible resources admit only the four canonical HTTP/HTTPS Slither
origins, at `/` or `/index.html` without query/fragment/credentials. Loopback is
rejected. The exported explicit-profile runtime API does not bypass those
activation/source boundaries. Extension-page CSP also permits only self
connections, so the packaged offline preview cannot connect a local game peer.

Consequently the legal offline installed slice is preview/CSP/module/Wasm
loading plus a negative packaged-policy probe on an authored loopback URL.
That probe is explicitly a module-policy check in an installed context, not
action-popup activation or default-game acceptance. Canonical-host MAIN versus
ISOLATED delivery, host CSP, borrowed-source readiness, native default Play,
profile acquisition and server acceptance remain blocked/unrun. Do not change
matches, permissions, CSP, DNS or official-host routing to manufacture success.

The smallest prospective seam is a separately reviewed test composition using
the existing explicit local-host/sourceFactory injection and supplied synthetic
profile/peer, confined to an authored origin. It would need its own bounded
authorization and would prove that composition, not the unchanged canonical
installed activation gate. This change does not implement or enable that seam.

## Build and browser-free audit

Use the matching wasm-bindgen 0.2.129 CLI. Preserve existing generated outputs;
select a fresh package output when bytes differ:

```sh
npm run build:web
node tools/wasm-smoke.mjs
node tools/build-extension.mjs --output-dir dist/extension/installed-preview-001
node tools/browser-extension-run.mjs --browser chrome --package dist/extension/installed-preview-001/chrome --output /external/fresh-audit
```

Without `--run-installed-preview` this command performs no browser launch or
fixture/server startup. It compares the existing package against the current
packager's complete file graph and records hashes/policy. Package files are
never patched, copied into a different manifest or served as a fake extension.
The audit requires this checkout's own ignored `dist/extension` output.

## Exact bounded browser plan

Browser execution requires the task owner's exact lease/authorization. Prepare
one Chrome job, optionally followed by one independently authorized Firefox
job. There is no automatic fallback, retry, browser loop or original input.
Unsupported install APIs fail the job and retain its receipt.

1. Installed headed Chrome, a fresh owned temporary profile, 1280×800 viewport,
   Playwright pipe transport and `--enable-unsafe-extension-debugging`.
   `Extensions.loadUnpacked` and `Extensions.getExtensions` must attest the exact
   package directory. This avoids the removed branded-Chrome `--load-extension`
   switch and does not add a service worker to the product manifest.
2. Installed Firefox through an explicit external geckodriver executable. Its
   temporary-addon API installs the unchanged Firefox directory. The owned
   throwaway profile stays under the harness's temporary root. geckodriver
   `--allow-system-access` permits one native WebExtensionPolicy URL lookup;
   content automation then tests the real extension page. No global setting,
   signing preference, persistent profile or product permission is changed.

```sh
node tools/browser-extension-run.mjs --browser chrome --package dist/extension/installed-preview-001/chrome --output /external/fresh-chrome --run-installed-preview
node tools/browser-extension-run.mjs --browser firefox --package dist/extension/installed-preview-001/firefox --output /external/fresh-firefox --run-installed-preview --geckodriver /absolute/geckodriver --firefox-binary /absolute/installed/firefox
```

geckodriver is a separately installed Mozilla tool, not an npm dependency or
implicit download. The harness does not require Selenium. Both browser paths
use only the packaged preview and one authored literal-loopback static page.
An owned deny-only proxy never forwards an upstream connection. Page resources
must remain extension-local; no profile acquisition, game socket or peer is
created. Browser ambient proxy denials are recorded separately from page errors.

Installed checks have a 90-second deadline; browser close and fixture cleanup
have separate deadlines. Browser/context, local fixture and temporary profile
cleanup are attempted independently in finally. Any cleanup error fails the
receipt. A profile-removed flag alone is not an independent OS-process audit;
the owner must verify quiet before handing the browser lease on. No screenshots
or trace are taken outside the single planned authored preview screenshot.

The new harness is preparation until an actual authorized installed run passes.
Synthetic mocks, package/route audits and fresh ABI success are not installed
acceptance. Firefox and Chrome-specific installation paths may fail on an
unsupported browser/driver version; that is reported, not silently replaced.

## Primary API references

- [Playwright extension support and removed branded-Chrome flags](https://playwright.dev/docs/chrome-extensions)
- [Official CDP Extensions protocol](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Extensions.pdl)
- [Chromium introduction of the scoped extension-debugging API](https://chromium.googlesource.com/chromium/src.git/+/225b2eaa7f23c33b7c4e30c1bfc58f1bd99cbe1c%5E%21/)
- [Mozilla temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
- [Mozilla geckodriver flags and system access](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html)
- [Mozilla add-on install protocol client](https://github.com/mozilla/gecko-dev/blob/master/testing/marionette/client/marionette_driver/addons.py)
