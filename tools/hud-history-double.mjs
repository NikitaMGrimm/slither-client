// Authored synthetic generated-ABI double for Node/VM shell tests, not Rust evidence.
// Native semantics and the real Wasm ABI are checked independently.
export function createHudHistoryDouble() {
  const freeze = Object.freeze;
  const safeInteger = Number.isSafeInteger;
  const decimal = Function.prototype.call.bind(Number.prototype.toString);
  const invalid = () => { throw new TypeError('Invalid HUD state change'); };
  const required = (s, playing) => s.dirty && playing && s.rank > 0 && s.population > 0;
  const initial = () => ({ ownToken: null, rank: 0, population: 0, bestRank: 999999999,
    maxPopulation: 0, dirty: false, fade: -1,
    requestedOpacity: { readout: 0, header: 0, rows: 0, announcement: 0 }, current: null, final: null });
  const bind = (s, token) => {
    if (s.ownToken !== null && s.ownToken !== token) invalid();
    s.ownToken = token;
  };
  const draw = (s, v) => {
    if (v === null || v.status !== 'ready') invalid();
    bind(s, v.own.token);
    s.current = { score: v.score, rank: s.rank, population: s.population, ownToken: v.own.token };
    s.dirty = false;
  };
  const opacity = s => { s.requestedOpacity = { readout: s.fade, header: .85 * s.fade,
    rows: s.fade, announcement: s.fade }; };
  const text = score => { if (!safeInteger(score)) invalid(); return decimal(score, 10); };
  return class HudHistoryDouble {
    constructor(state = initial()) { this.state = state; }
    required(playing) { return required(this.state, playing); }
    reduce(input) {
      const s = { ...this.state };
      switch (input.kind) {
        case 'packet':
          for (const e of input.report.events) {
            switch (e.kind) {
              case 'setup': s.fade = -1; s.requestedOpacity = initial().requestedOpacity; break;
              case 'setup-draw': if (required(s, true)) draw(s, e.view); break;
              case 'own-length-scheduled': bind(s, e.token); s.dirty = true; break;
              case 'leaderboard':
                s.rank = e.rank; s.population = e.population;
                s.bestRank = Math.min(s.bestRank, e.rank); s.maxPopulation = Math.max(s.maxPopulation, e.population);
                s.dirty = true; if (s.fade === -1 && !e.deathPending) s.fade = 0;
                break;
              case 'final-score': bind(s, e.view.own.token);
                s.final = { score: e.view.score, exclamation: e.view.score > 1000, ownToken: e.view.own.token }; break;
            }
          }
          break;
        case 'draw': if (required(s, input.playing)) draw(s, input.view); break;
        case 'world-reset':
          s.ownToken = null; s.rank = s.population = s.maxPopulation = 0; s.bestRank = 999999999; break;
        case 'step': {
          const l = input.lifecycle;
          if (!Number.isFinite(input.delta) || input.delta < 0 || input.delta > 5
            || !Number.isFinite(l.returnFraction) || l.returnFraction < 0 || l.returnFraction > 1
            || (l.returnCompleted ? !l.returnActive || l.deathPending || l.returnFraction !== 0
              : l.returnActive && (!l.deathPending || l.returnFraction <= 0))) invalid();
          if (l.returnCompleted) { s.fade = -1; opacity(s); }
          else if (l.returnActive) { s.fade = l.returnFraction; opacity(s); }
          else if (!l.deathPending && s.fade !== -1 && s.fade !== 1) {
            s.fade = Math.min(1, s.fade + .01 * input.delta); opacity(s);
          }
          break;
        }
        default: invalid();
      }
      return new HudHistoryDouble(s);
    }
    snapshot() {
      const s = this.state;
      return freeze({ ...s, requestedOpacity: freeze({ ...s.requestedOpacity }),
        current: s.current === null ? null : freeze({ ...s.current }),
        final: s.final === null ? null : freeze({ ...s.final }) });
    }
    values(includesFinal) {
      const s = this.state;
      const c = s.current, f = includesFinal ? s.final : null;
      return freeze({ current: c === null ? null : freeze({ score: c.score, scoreText: text(c.score),
        rank: c.rank, rankText: String(c.rank), population: c.population,
        populationText: String(c.population), ownToken: c.ownToken }),
      final: f === null ? null : freeze({ score: f.score, scoreText: text(f.score),
        exclamation: f.exclamation, suffix: f.exclamation ? '!' : '', ownToken: f.ownToken }) });
    }
    free() {}
  };
}

// The complete ABI smoke reuses these existing requirements with the real class.
export const HudHistoryDouble = process.env.SLITHER_HUD_HISTORY_WASM === '1'
  ? (await (await import('./wasm-test-context.mjs')).loadWasm()).HudHistory
  : createHudHistoryDouble();
