// Explicit generated-ABI DOUBLE for inert glue tests; no renderer/pixel proof.
export function createAppearancePreviewDouble(calls = []) {
  return class {
    ticket = 0n; drawn = 0n; selected;
    constructor(local) { calls.push(['new', local]); }
    select(skin, bytes) {
      const selected = { skin, bytes: [...bytes] };
      if (JSON.stringify(selected) !== JSON.stringify(this.selected)) { this.ticket++; this.selected = selected; }
      calls.push(['select', skin, [...bytes]]); return this.ticket;
    }
    revision() { return this.ticket; }
    needs_draw(ticket) { return ticket === this.ticket && ticket !== this.drawn; }
    render(ticket, canvas, world, resolve, prepare) {
      calls.push(['render', ticket, canvas, world]);
      const result = resolve(Object.freeze({ skin: this.selected.skin, customBytes: new Uint8Array(this.selected.bytes), own: false, cosmetic: 0, x: 112, y: 0 }));
      if (result.status === 'ready') {
        const frame = prepare(canvas, 320, 128); frame.finish(); this.drawn = ticket;
      }
      return Object.freeze({ schema: 1, revision: ticket, changed: true, width: 320, height: 128,
        visible: result.status === 'ready', statusText: result.status === 'ready' ? '' : 'Synthetic unavailable' });
    }
    free() { calls.push(['free']); }
  };
}
