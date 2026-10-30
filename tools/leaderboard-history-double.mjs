// Authored generated-ABI double for Node/VM shell tests; native semantics are separate evidence.
export function createLeaderboardHistoryDouble() {
  const freeze = Object.freeze;
  const invalid = () => { throw new TypeError('Invalid leaderboard state change'); };
  const colors = ['#c080ff', '#9099ff', '#80d0d0', '#80ff80', '#eeee70',
    '#ffa060', '#ff9090', '#ff4040', '#e030e0'];
  const text = value => value.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/ /g, '\u00a0');
  const remote = bytes => {
    let digits = 0;
    for (const unit of bytes) {
      if ((unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122)) digits = 0;
      else if (unit >= 48 && unit <= 57 && ++digits >= 7) return '';
    }
    return String.fromCharCode(...bytes);
  };
  return class LeaderboardHistoryDouble {
    constructor(data = { tableMax: null, setupSeen: false, revision: 0n, board: null }, parent = null) {
      this.data = data; this.parent = parent; this.open = parent === null;
    }
    is_open() { return this.open; }
    prepare(report) {
      if (!this.open) invalid();
      let tableMax = this.data.tableMax, setupSeen = this.data.setupSeen, index = 0;
      const requests = [], boards = [];
      for (const event of report.events) {
        if (event.kind === 'setup') { tableMax = event.tableMax; setupSeen = true; }
        else if (event.kind === 'leaderboard') {
          if (tableMax === null) invalid();
          const rows = report.leaderboardRows[index++].rows;
          requests.push(freeze({ commandIndex: event.commandIndex, tableMax,
            counts: freeze(rows.map(row => row.count)), fractionalMasses: freeze(rows.map(row => row.fractionalMass)) }));
          boards.push({ localRow: event.localRow, rows });
        }
      }
      return { owner: this, requests: freeze(requests), boards, tableMax, setupSeen, begun: false, completed: false };
    }
    requests(plan) { if (plan.owner !== this || !this.open) invalid(); return plan.requests; }
    begin_plan(plan) {
      if (plan.owner !== this || !this.open || plan.begun) invalid();
      plan.begun = true;
    }
    admit_name(value) {
      if (typeof value !== 'string' || value.length > 24) invalid();
      for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 32 || value.charCodeAt(i) > 127) invalid();
    }
    admit_score(plan, index, ordinal, score) {
      const request = plan.requests[index];
      const outside = request.counts[ordinal] > request.tableMax + 2048;
      if (outside ? !Number.isNaN(score) : !Number.isSafeInteger(score)) invalid();
    }
    complete(plan, scores, nickname) {
      if (!this.open || plan.owner !== this || !plan.begun || plan.completed) invalid();
      plan.completed = true;
      this.admit_name(nickname);
      for (let index = 0; index < scores.length; index++) {
        for (let ordinal = 0; ordinal < scores[index].length; ordinal++) {
          this.admit_score(plan, index, ordinal, scores[index][ordinal]);
        }
      }
      let board = this.data.board, revision = this.data.revision;
      for (let index = 0; index < plan.boards.length; index++) {
        const raw = plan.boards[index];
        const rows = raw.rows.map((row, ordinal) => {
          const own = row.ordinal === raw.localRow, score = scores[index][ordinal];
          return freeze({ ordinal: row.ordinal, numberText: `#${row.ordinal}`,
            score, scoreText: String(score), nameText: text(own ? nickname : remote(row.name)),
            cssColor: colors[row.rawColor % 9], own,
            opacityRequest: own ? 1 : .7 * (.3 + .7 * (1 - row.ordinal / 10)) });
        });
        board = freeze({ rows: freeze(rows) }); revision++;
      }
      return new LeaderboardHistoryDouble({ tableMax: plan.tableMax, setupSeen: plan.setupSeen, revision, board }, this);
    }
    discard_plan(plan) { plan.completed = true; plan.boards = null; }
    reset() { if (!this.open) invalid(); return new LeaderboardHistoryDouble(this.data, this); }
    commit() {
      if (this.open || !this.parent?.open) invalid();
      this.parent.open = false; this.open = true;
    }
    snapshot() { return freeze({ ...this.data }); }
    projection(heading, rows) {
      return freeze({ revision: this.data.revision, setupSeen: this.data.setupSeen,
        boardPresent: this.data.board !== null, requestedOpacity: freeze({ heading, rows }),
        readiness: this.data.board === null ? 'pending' : 'ready', reason: this.data.board === null ? 'no-board' : null,
        rows: freeze(this.data.board === null ? [] : this.data.board.rows.slice(0, 10).map(row => freeze({ ...row }))) });
    }
    free() {}
  };
}

export const LeaderboardHistoryDouble = process.env.SLITHER_LEADERBOARD_HISTORY_WASM === '1'
  ? (await (await import('./wasm-test-context.mjs')).loadWasm()).LeaderboardHistory
  : createLeaderboardHistoryDouble();
