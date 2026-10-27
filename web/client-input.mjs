// Caller-clocked desktop input intents. This module owns no socket or scheduler.
const TAU = Math.PI * 2;

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${label}`);
  return value;
}

function nonnegative(value, label) {
  finite(value, label);
  if (value < 0) throw new RangeError(`Invalid ${label}`);
  return value;
}

function version(value) {
  if (!Number.isInteger(value) || value < 2 || value > 255) throw new RangeError('Invalid protocol version');
  return value;
}

function stepCount(value) {
  if (!Number.isInteger(value) || value < 0 || value > 5) throw new RangeError('Invalid whole steps');
  return value;
}

/** CSS/window pointer units deliberately remain separate from backing-canvas pixels. */
export function desktopPointer({ clientX, clientY, viewportWidth, viewportHeight,
  follow, camera, head, zoom }) {
  finite(clientX, 'pointer x');
  finite(clientY, 'pointer y');
  finite(viewportWidth, 'viewport width');
  finite(viewportHeight, 'viewport height');
  if (viewportWidth <= 0 || viewportHeight <= 0) throw new RangeError('Invalid viewport size');
  boolean(follow, 'follow preference');
  let x = clientX - viewportWidth / 2;
  let y = clientY - viewportHeight / 2;
  if (!follow && head != null) {
    finite(camera?.x, 'camera x');
    finite(camera?.y, 'camera y');
    finite(head.x, 'head x');
    finite(head.y, 'head y');
    finite(zoom, 'zoom');
    if (zoom <= 0) throw new RangeError('Invalid zoom');
    x += (camera.x - head.x) * zoom;
    y += (camera.y - head.y) * zoom;
  }
  finite(x, 'pointer displacement x');
  finite(y, 'pointer displacement y');
  finite(x * x + y * y, 'pointer squared distance');
  return { x, y, gazeHeading: Math.atan2(y, x) };
}

/** Explicit sends commit their attempt state before invoking the trusted capability. */
export function createClientInput({ protocolVersion = 19 } = {}) {
  let protocol = version(protocolVersion);
  let connected = false;
  let own = null;
  let pointer = { x: 0, y: 0 };
  let comparedPointer = { x: 0, y: 0 };
  let wantHeading = false;
  let lastHeadingMs = 0;
  let lastBoostMs = 0;
  let lastTurnMs = 0;
  let lastQuantizedHeading = 0;
  let leftHeld = false;
  let rightHeld = false;
  let boostKeyHeld = false;
  let leftSteps = 0;
  let rightSteps = 0;
  let ticking = false;

  function requireIdle() {
    if (ticking) throw new Error('Input tick is already active');
  }

  function pendingArrowSteps(count) {
    const eligible = connected && own !== null;
    const left = leftSteps + (eligible && leftHeld ? count : 0);
    const right = rightSteps + (eligible && rightHeld ? count : 0);
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
      throw new RangeError('Keyboard step accumulation overflow');
    }
    return [left, right];
  }

  function setBoost(value) {
    if (own) own.requestedBoost = value;
  }

  function updatePointer(input) {
    // No-own pointer movement still updates global coordinates, without a head offset.
    if (own && input.follow === false && input.head == null) throw new TypeError('Expected raw own head');
    const point = desktopPointer(own ? input : { ...input, head: null });
    pointer = { x: point.x, y: point.y };
    return point;
  }

  function snapshot() {
    return { protocolVersion: protocol, connected,
      pointer: { ...pointer }, comparedPointer: { ...comparedPointer }, wantHeading,
      lastHeadingMs, lastBoostMs, lastTurnMs, lastQuantizedHeading,
      leftHeld, rightHeld, boostKeyHeld, leftSteps, rightSteps,
      own: own ? { ...own } : null };
  }

  return {
    setProtocolVersion(value) { protocol = version(value); },
    setConnected(value) { connected = boolean(value, 'connection state'); },
    setOwn(value) {
      if (value === null) { own = null; return; }
      if (!value || value.token == null) throw new TypeError('Invalid own appearance');
      const next = {
        token: value.token,
        wantedHeading: finite(value.wantedHeading, 'wanted heading'),
        gazeHeading: finite(value.gazeHeading, 'gaze heading'),
        dead: boolean(value.dead, 'death state'),
        turnRate: nonnegative(value.turnRate, 'turn rate'),
        sizeTurnFactor: nonnegative(value.sizeTurnFactor, 'size turn factor'),
        speedTurnFactor: nonnegative(value.speedTurnFactor, 'speed turn factor'),
      };
      if (own && Object.is(own.token, next.token)) {
        next.gazeHeading = own.gazeHeading;
        next.requestedBoost = own.requestedBoost;
        next.sentBoost = own.sentBoost;
      } else {
        next.requestedBoost = false;
        next.sentBoost = false;
      }
      own = next;
    },
    pointer: updatePointer,
    keyDown(code) {
      if (code === 'ArrowLeft') leftHeld = true;
      else if (code === 'ArrowRight') rightHeld = true;
      else if (code === 'ArrowUp' || code === 'Space') { boostKeyHeld = true; setBoost(true); }
      else return false;
      return true;
    },
    keyUp(code) {
      if (code === 'ArrowLeft') leftHeld = false;
      else if (code === 'ArrowRight') rightHeld = false;
      else if (code === 'ArrowUp' || code === 'Space') { boostKeyHeld = false; setBoost(false); }
      else return false;
      return true;
    },
    mouseDown(input) {
      if (own) { updatePointer(input); setBoost(true); }
    },
    mouseUp() { setBoost(false); },
    // The desktop source installs no global focus-loss release handler.
    blur() {},
    // Extension teardown only gates future sends; it invents no final packet.
    pagehide() { connected = false; },
    reset() { connected = false; own = null; },
    snapshot,
    // This phase precedes session close/reset; a later send phase must use zero steps.
    accumulateStep({ wholeSteps }) {
      requireIdle();
      const [left, right] = pendingArrowSteps(stepCount(wholeSteps));
      leftSteps = left;
      rightSteps = right;
    },
    tick({ nowMs, wholeSteps }, send, betweenKeyboardAndBoost) {
      requireIdle();
      ticking = true;
      try {
        finite(nowMs, 'timestamp');
        stepCount(wholeSteps);
        if (typeof send !== 'function') throw new TypeError('Expected synchronous send capability');
        if (betweenKeyboardAndBoost !== undefined && typeof betweenKeyboardAndBoost !== 'function') {
          throw new TypeError('Expected synchronous input phase hook');
        }
        const intents = [];
        if (!connected) return { gazeHeading: own?.gazeHeading ?? null, intents };
        const emit = bytes => { intents.push(bytes.slice()); send(bytes); };
        if (own) {
          const [nextLeft, nextRight] = pendingArrowSteps(wholeSteps);
          if ((nextLeft > 0 || nextRight > 0) && nowMs - lastTurnMs > 50) {
            // Strict comparisons intentionally leave equal positive debts uncancelled.
            let left = nextLeft;
            let right = nextRight;
            if (right > 0 && left > right) { left -= right; right = 0; }
            if (left > 0 && right > left) { right -= left; left = 0; }
            const count = Math.min(127, left > 0 ? left : right);
            const increasing = left === 0;
            const displacement = own.turnRate * count * own.sizeTurnFactor * own.speedTurnFactor;
            const gaze = increasing ? own.gazeHeading + displacement : own.gazeHeading - displacement;
            finite(displacement, 'keyboard gaze displacement');
            finite(gaze, 'keyboard gaze');
            lastTurnMs = nowMs;
            leftSteps = left - (increasing ? 0 : count);
            rightSteps = right - (increasing ? count : 0);
            own.gazeHeading = gaze;
            emit(protocol >= 5
              ? Uint8Array.of(252, increasing ? count + 128 : count)
              : Uint8Array.of(increasing ? 114 : 108, count));
          } else {
            leftSteps = nextLeft;
            rightSteps = nextRight;
          }
        }
        // Session ping is connected-only, including Setup before the first own appearance.
        if (betweenKeyboardAndBoost !== undefined) {
          betweenKeyboardAndBoost(Object.freeze({ nowMs, protocolVersion: protocol }), emit);
        }
        if (!own) return { gazeHeading: null, intents };
        if (own.sentBoost !== own.requestedBoost && nowMs - lastBoostMs > 50) {
          own.sentBoost = own.requestedBoost;
          lastBoostMs = nowMs;
          emit(protocol >= 5
            ? Uint8Array.of(own.sentBoost ? 253 : 254)
            : Uint8Array.of(109, own.sentBoost ? 1 : 0));
        }
        if (pointer.x !== comparedPointer.x || pointer.y !== comparedPointer.y) wantHeading = true;
        own.gazeHeading = Math.atan2(pointer.y, pointer.x);
        if (wantHeading && nowMs - lastHeadingMs > 33) {
          wantHeading = false;
          lastHeadingMs = nowMs;
          comparedPointer = { ...pointer };
          const distanceSquared = pointer.x * pointer.x + pointer.y * pointer.y;
          let angle = distanceSquared > 256 ? Math.atan2(pointer.y, pointer.x) : own.wantedHeading;
          angle %= TAU;
          if (angle < 0) angle += TAU;
          const quantized = protocol >= 5 ? Math.floor((250 + 1) * angle / TAU)
            : Math.floor(16777215 * angle / TAU);
          if (quantized !== lastQuantizedHeading) {
            lastQuantizedHeading = quantized;
            emit(protocol >= 5 ? Uint8Array.of(quantized & 255)
              : Uint8Array.of(101, (quantized >> 16) & 255, (quantized >> 8) & 255, quantized & 255));
          }
        }
        return { gazeHeading: own.gazeHeading, intents };
      } finally {
        ticking = false;
      }
    },
  };
}
