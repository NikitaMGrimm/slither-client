// TEST ONLY project-authored command fold retained from the pre-migration session.
import {copyHudIngressPlan} from '../../web/stock-hud-contract.mjs';
// All subscription modes use this fold. Only the final commit touches live cells.
export function stageControls(commands, receivedMs, initial, hudSchema) {
  const next = { ...initial, actions: { ...initial.actions } };
  const guards = [], finalCaptureIndices = [];
  for (let index = 0; index < commands.length; index++) {
    const command = commands[index];
    if (hudSchema) {
      guards.push({ playing: next.playing, closeRequested: next.closeRequested, deathPending: next.deathMs !== null });
      if (command[0] === 118 && command[1] !== 2 && next.playing && !next.closeRequested) finalCaptureIndices.push(index);
    }
    if (command[0] === 97) {
      next.connected = true; next.playing = true; next.phase = 'playing';
      next.previousUiMs = receivedMs; next.uiPhase = 'in';
    } else if (command[0] === 112) {
      next.pingPending = false; next.lagging = false;
    } else if (command[0] === 118) {
      if (command[1] === 2) next.closeRequested = true;
      else {
        next.deathMs = receivedMs; next.lifeEnded = true; next.lagging = false;
        next.actions = { ...next.actions, resetLag: true }; next.actionRevision++;
        if (next.playing && !next.closeRequested) {
          if (command[1] === 1) next.phase = 'victory';
          else { next.closeRequested = true; next.phase = 'dead'; }
        }
      }
    }
  }
  const plan = hudSchema ? copyHudIngressPlan({ schema: hudSchema, commandCount: commands.length, guards, finalCaptureIndices }) : null;
  return { next, plan };
}

export function matchHudReport(report, commands, plan) {
  let eventIndex = 0, captureIndex = 0, setups = 0;
  for (let index = 0; index < commands.length; index++) {
    const opcode = commands[index][0];
    let expected;
    if (opcode === 97) { expected = 'setup'; setups++; }
    else if (opcode === 108 && plan.guards[index].playing) expected = 'leaderboard';
    else if (plan.finalCaptureIndices[captureIndex] === index) { expected = 'final-score'; captureIndex++; }
    const current = report.events[eventIndex];
    if (expected) {
      if (!current || current.commandIndex !== index || current.kind !== expected) throw new TypeError('Missing HUD event');
      if (expected === 'leaderboard' && current.deathPending !== plan.guards[index].deathPending) throw new TypeError('Invalid HUD death guard');
      eventIndex += expected === 'setup' ? 2 : 1;
    } else if (current?.commandIndex === index) {
      if (current.kind !== 'own-length-scheduled' || ![115, 110, 78, 43, 104, 114].includes(opcode)) throw new TypeError('Unexpected HUD event');
      eventIndex++;
    }
  }
  if (eventIndex !== report.events.length || setups !== report.setupDraws) throw new TypeError('Unexpected HUD events');
}
