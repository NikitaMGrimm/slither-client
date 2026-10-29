// Authored generated-ABI double for DOM/capability composition, not Rust evidence.
// Real Rust policy requirements execute in menu-preferences-smoke.mjs and native tests.
export function createMenuPreferencesDouble() {
  return class MenuPreferences {
    constructor(local, saved) {
      this.local = local; this.nickname = ''; this.skin = 0; this.custom = []; this.stripe = 0;
      try {
        const parts = saved.split(':');
        if (parts.length !== 4 || parts[0] !== '1' || saved.length > 600) return;
        const decode = text => {
          if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw Error('synthetic record');
          return text.match(/../g)?.map(byte => Number.parseInt(byte, 16)) ?? [];
        };
        const name = String.fromCharCode(...decode(parts[1])), skin = decode(parts[2]);
        const custom = decode(parts[3]);
        if (skin.length !== 1 || skin[0] >= (local ? 3 : 66) || custom.length > 254
          || custom.length && (custom.length < 10 || custom.length % 2 || custom.slice(0, 8).some(Boolean))) return;
        this.set_nickname(name); this.skin = skin[0]; this.custom = custom;
      } catch { this.nickname = ''; this.skin = 0; this.custom = []; }
    }
    set_nickname(value) {
      if (typeof value !== 'string' || value.length > 24 || /[^\x20-\x7f]/.test(value)) throw Error('synthetic nickname');
      this.nickname = value;
    }
    action(action) {
      if (!this.view().controls.find(control => control.action === action)?.enabled) return;
      const count = this.local ? 3 : 66, offset = 8 + this.stripe * 2;
      if (action === 'next-skin' || action === 'previous-skin') { this.skin = (this.skin + (action === 'next-skin' ? 1 : count - 1)) % count; this.custom = []; this.stripe = 0; }
      if (action === 'build') { this.custom = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0]; this.stripe = 0; }
      if (action === 'next-stripe') this.stripe = (this.stripe + 1) % ((this.custom.length - 8) / 2);
      if (action === 'longer') this.custom[offset]++;
      if (action === 'shorter') this.custom[offset]--;
      if (action === 'next-color' || action === 'previous-color') {
        const palettes = this.local ? [0, 1, 2] : [...Array(36).keys(), 37, 39, 41];
        const index = palettes.indexOf(this.custom[offset + 1]);
        this.custom[offset + 1] = palettes[(index + (action === 'next-color' ? 1 : palettes.length - 1)) % palettes.length];
      }
      if (action === 'add-stripe') { this.custom.push(1, this.custom[offset + 1]); this.stripe = (this.custom.length - 8) / 2 - 1; }
      if (action === 'remove-stripe') { this.custom.splice(offset, 2); this.stripe = 0; }
      if (action === 'reset') { this.skin = 0; this.custom = []; this.stripe = 0; }
    }
    serialize() {
      const hex = bytes => bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
      return `1:${hex(Array.from(this.nickname, char => char.charCodeAt(0)))}:${hex([this.skin])}:${hex(this.custom)}`;
    }
    view() {
      const custom = this.custom.length > 0, runs = Math.max(0, (this.custom.length - 8) / 2), length = this.custom[8 + 2 * this.stripe] ?? 0;
      const controls = [['previous-skin', 'Previous skin', true], ['next-skin', 'Next skin', true],
        ['build', 'Build a skin', !custom], ['next-stripe', 'Next stripe', runs > 1],
        ['previous-color', 'Previous color', custom], ['next-color', 'Next color', custom],
        ['shorter', 'Shorter stripe', length > 1], ['longer', 'Longer stripe', custom && length < 255],
        ['add-stripe', 'Add stripe', custom && runs < 123], ['remove-stripe', 'Remove stripe', runs > 1], ['reset', 'Reset appearance', true]]
        .map(([action, label, enabled]) => Object.freeze({ action, label, enabled }));
      return Object.freeze({ nickname: this.nickname, skin: this.skin, customSkin: Uint8Array.from(this.custom),
        title: custom ? 'Custom skin' : `Skin ${this.skin + 1} of ${this.local ? 3 : 66}`,
        detail: custom ? `Stripe ${this.stripe + 1} of ${runs} · Color ${this.custom[9 + 2 * this.stripe] + 1} · Length ${length}` : '',
        controls: Object.freeze(controls) });
    }
    free() { this.freed = true; }
  };
}
