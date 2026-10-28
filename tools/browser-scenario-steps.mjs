// Authored scenario actions shared by local-page and future installed harnesses.
// This module launches no browser, build, socket or server.
import path from 'node:path';
import { createHash } from 'node:crypto';

export function validateScenario(scenario) {
  if (scenario.kind !== 'authored-synthetic' || !Array.isArray(scenario.steps) || scenario.steps.length > 100
    || !Number.isInteger(scenario.viewport?.width) || !Number.isInteger(scenario.viewport?.height)
    || scenario.viewport.width < 320 || scenario.viewport.width > 3840
    || scenario.viewport.height < 240 || scenario.viewport.height > 2160) throw new Error('Invalid authored scenario');
  if (scenario.fixture !== undefined && scenario.fixture !== 'local-play-lifecycle') throw new Error('Unknown CLI packet fixture');
  return scenario;
}

export async function runScenarioSteps({ page, peer, scenario, output, result, onCheckpoint,
  waitForIngress = () => new Promise(resolve => setTimeout(resolve, 10)) }) {
  validateScenario(scenario);
  const memories = new Map(), marks = new Map(), held = new Set();
  result.assertions ??= [];
  const editorId = 'slither-scenario-editor';
  let editor = false, failed = false;
  const locator = step => step.role ? page.getByRole(step.role, { name: step.name, exact: true })
    : step.label ? page.getByLabel(step.label, { exact: true })
      : step.selector ? page.locator(step.selector) : (() => { throw new Error('A role/name, label or selector is required'); })();
  const advance = async ms => {
    if (!Number.isInteger(ms) || ms < 0 || ms > 10000) throw new Error('Invalid bounded advance');
    // Deliver each tape batch before the corresponding clock update/checkpoint.
    // `at` is fixture-relative scheduled time; a future browser report must retain
    // actual ingress/update timestamps rather than infer them from this schedule.
    let remaining = ms;
    do {
      const dt = Math.min(25, remaining);
      peer.advance?.(dt);
      await waitForIngress();
      await page.clock.runFor(dt);
      await waitForIngress();
      remaining -= dt;
    } while (remaining > 0);
  };
  const poll = async (check, index) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await check()) return;
      await advance(16);
    }
    throw new Error(`Scenario assertion failed at step ${index}`);
  };
  const peerCounts = step => {
    const receipt = peer.receipt;
    const start = step.since === undefined ? 0 : marks.get(step.since);
    if (start === undefined) throw new Error('Unknown input checkpoint');
    const inputs = (receipt.inputs ?? []).slice(start).filter(x => step.connection === undefined || x.connection === step.connection);
    const actual = { connections: receipt.connections, logins: receipt.logins, closed: receipt.closed ?? 0 };
    for (const kind of ['heading', 'turn', 'boostOn', 'boostOff', 'ping']) actual[kind] = inputs.filter(x => x.kind === kind).length;
    for (const [key, expected] of Object.entries(step.counts)) {
      if (!Object.hasOwn(actual, key)) throw new Error('Unknown peer counter');
      if (Number.isInteger(expected) && expected >= 0) { if (actual[key] !== expected) return null; }
      else if (expected && Number.isInteger(expected.min) && expected.min >= 0 && Object.keys(expected).length === 1) {
        if (actual[key] < expected.min) return null;
      } else throw new Error('Invalid peer counter expectation');
    }
    return actual;
  };
  try {
    for (const [index, step] of scenario.steps.entries()) {
      result.lastStep = index; result.actions.push(step.op);
      if (step.op === 'press') await page.keyboard.press(step.key);
      else if (step.op === 'key-down') { held.add(step.key); await page.keyboard.down(step.key); }
      else if (step.op === 'key-up') { await page.keyboard.up(step.key); held.delete(step.key); }
      else if (step.op === 'move') {
        if (![step.x, step.y].every(Number.isFinite) || step.x < 0 || step.x > scenario.viewport.width
          || step.y < 0 || step.y > scenario.viewport.height) throw new Error('Invalid scenario pointer');
        await page.mouse.move(step.x, step.y);
      } else if (step.op === 'fill') await locator(step).fill(step.value, { force: true });
      else if (step.op === 'click') await locator(step).click({ force: true });
      // DOM focus setup only: avoid a click's mouseup clearing held game boost.
      // All game key events continue through native Playwright keyboard input.
      else if (step.op === 'focus') await locator(step).focus();
      else if (step.op === 'advance') await advance(step.ms);
      else if (step.op === 'disconnect') peer.disconnect();
      else if (step.op === 'packet') { peer.deliver(step.name); await advance(0); }
      else if (step.op === 'mark-peer') {
        if (typeof step.name !== 'string' || marks.has(step.name)) throw new Error('Unique input checkpoint required');
        marks.set(step.name, (peer.receipt.inputs ?? []).length);
      } else if (step.op === 'assert-peer') {
        let actual;
        await poll(() => { actual = peerCounts(step); return actual !== null; }, index);
        result.assertions.push({ step: index, kind: 'peer', since: step.since ?? null, actual });
      } else if (step.op === 'remember-text' || step.op === 'assert-text') {
        const target = locator(step);
        let text;
        if (step.op === 'remember-text') {
          await poll(async () => { text = (await target.textContent())?.trim(); return !!text; }, index);
          if (typeof step.name !== 'string' || memories.has(step.name)) throw new Error('Unique text checkpoint required');
          memories.set(step.name, text);
        } else {
          const expected = step.remember === undefined ? step.equals : memories.get(step.remember);
          if (typeof expected !== 'string' || !expected) throw new Error('Expected nonempty text checkpoint');
          await poll(async () => { text = (await target.textContent())?.trim(); return text === expected; }, index);
        }
        result.assertions.push({ step: index, kind: step.op, text });
      } else if (step.op === 'editor') {
        if (typeof step.visible !== 'boolean') throw new Error('Explicit editor visibility required');
        if (step.visible && editor) throw new Error('Scenario editor already present');
        // An authored editing target only; game events still come from native
        // Playwright input. Never dispatch an event or manufacture isTrusted.
        await page.evaluate(({ id, visible }) => {
          if (visible) {
            if (document.getElementById(id)) throw new Error('Scenario editor identity collision');
            const field = document.createElement('input'); field.id = id;
            field.setAttribute('aria-label', 'Scenario editor');
            field.style.cssText = 'position:fixed;left:8px;top:64px;width:180px;z-index:2147483647';
            document.body.appendChild(field);
          } else document.getElementById(id)?.remove();
        }, { id: editorId, visible: step.visible });
        editor = step.visible;
      } else if (step.op === 'assert') {
        const target = locator(step);
        await poll(async () => {
          if (step.state === 'hidden') return !(await target.isVisible());
          // Do not block fake-clock progress inside Playwright's locator wait.
          if (await target.count() !== 1) return false;
          return step.state === 'enabled' ? target.isEnabled()
            : step.state === 'focused' ? target.evaluate(e => e === document.activeElement)
              : step.state === 'visible' ? target.isVisible() : false;
        }, index);
      } else if (step.op === 'screenshot') {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(step.name) || result.checkpoints.some(x => x.name === step.name)) throw new Error('Unique safe screenshot name required');
        const png = await page.screenshot({ path: path.join(output, step.name + '.png'), animations: 'allow' });
        const checkpoint = { name: step.name, sha256: createHash('sha256').update(png).digest('hex'), viewport: scenario.viewport };
        if (onCheckpoint) checkpoint.observation = await onCheckpoint({ page, peer, step, index });
        result.checkpoints.push(checkpoint);
      } else throw new Error('Unsupported scenario operation');
    }
    return result;
  } catch (error) {
    failed = true; throw error;
  } finally {
    // Preserve a primary scenario failure while still attempting every release.
    const errors = [];
    for (const key of held) { try { await page.keyboard.up(key); } catch { errors.push('held-key release failed'); } }
    if (editor) { try { await page.evaluate(id => document.getElementById(id)?.remove(), editorId); } catch { errors.push('scenario editor removal failed'); } }
    result.actionCleanupErrors = errors;
    if (!failed && errors.length) throw new Error('Scenario input cleanup failed');
  }
}
