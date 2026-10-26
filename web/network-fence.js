// Original authored loopback harness fence. This file must execute before reference scripts.
(() => {
  'use strict';
  const stats = {
    blockedSockets: [],
    blockedSocketCount: 0,
    suppressedAnimationFrames: 0,
    suppressedIntervals: 0,
    rewrittenImages: 0,
    rewrittenDirectories: 0,
  };
  Object.defineProperty(window, 'slitherPrototypeFence', { value: stats });
  function BlockedWebSocket(url) {
    stats.blockedSocketCount += 1;
    stats.blockedSockets.push(typeof url === 'string' ? url : '[non-string URL]');
    throw new DOMException('WebSocket disabled by the loopback prototype harness', 'SecurityError');
  }
  Object.assign(BlockedWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Object.defineProperty(window, 'WebSocket', { value: BlockedWebSocket, writable: false, configurable: false });
  Object.defineProperty(window, 'requestAnimationFrame', {
    value() { stats.suppressedAnimationFrames += 1; return 0; },
    writable: false, configurable: false,
  });
  Object.defineProperty(window, 'setInterval', {
    value() { stats.suppressedIntervals += 1; return 0; },
    writable: false, configurable: false,
  });

  const officialHost = host => host === 'slither.io' || host === 'www.slither.io';
  const imageSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...imageSource,
    set(value) {
      let replacement = value;
      if (typeof value === 'string') {
        let url;
        try { url = new URL(value, window.location.href); } catch { /* Native setter handles invalid URLs. */ }
        if (url && officialHost(url.hostname) && /^\/s2?\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|gif|webp)$/.test(url.pathname)) {
          replacement = `/reference/assets${url.pathname}${url.search}`;
          stats.rewrittenImages += 1;
        }
      }
      Reflect.apply(imageSource.set, this, [replacement]);
    },
  });

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, resource, ...options) {
    let replacement = resource;
    if (typeof resource === 'string') {
      let url;
      try { url = new URL(resource, window.location.href); } catch { /* Native open handles invalid URLs. */ }
      if (url && (officialHost(url.hostname) || url.origin === window.location.origin) && /^\/i\d+\.txt$/.test(url.pathname)) {
        replacement = '/reference/empty-directory';
        stats.rewrittenDirectories += 1;
      }
    }
    return Reflect.apply(open, this, [method, replacement, ...options]);
  };
})();
