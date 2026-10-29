import init, { ProfileLiteralParser } from './pkg/slither_client.js';
import { createProfileBroker } from './profile-broker.mjs';
import { createExtensionLiveProfileAcquirer } from './stock-live-profile.mjs';

const bytes = Object.freeze({ allocate: size => new Uint8Array(size), length: value => value.byteLength,
  copy: (target, source, offset) => target.set(source, offset), clear: value => value.fill(0) });
const now = performance.now.bind(performance);
const capabilities = Object.freeze({
  fetch: (url, options) => {
    if (url !== 'https://slither.io/s/game1107249518.js') throw new TypeError('Unsupported profile route');
    return fetch(url, options);
  },
  digest: async (algorithm, value) => new Uint8Array(await crypto.subtle.digest(algorithm, value)),
  createAbort() { const controller = new AbortController(); return Object.freeze({ signal: controller.signal, abort: () => controller.abort() }); },
  now, setTimeout, clearTimeout,
  environment: () => Object.freeze({ origin: `chrome-extension://${chrome.runtime.id}`, topLevel: false,
    secureContext: isSecureContext && import.meta.url === chrome.runtime.getURL('game/profile-worker.mjs') }),
  responseInfo: response => Object.freeze({ status: response.status, type: response.type, url: response.url, redirected: response.redirected, body: response.body }),
  getReader: body => body.getReader(), read: reader => reader.read(),
  cancelReader: reader => reader.cancel(), releaseReader: reader => reader.releaseLock(), bytes,
});
let initialized;
const receive = createProfileBroker({ api: chrome, Parser: ProfileLiteralParser,
  createAcquirer: createExtensionLiveProfileAcquirer,
  initialize: () => initialized ??= init(),
  native: { capabilities, now, random: value => crypto.getRandomValues(value), setTimeout, clearTimeout } });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  receive(message, sender).then(() => respond(false), () => respond(false));
  return true;
});
