// Authored test-only Play ABI double. Production has no JS admission fallback.
export function createPlayAdmissionDouble() {
  return class PlayAdmission {
    constructor(local, profileAvailable) {
      this.local = local; this.hasCapability = local || profileAvailable;
      this.consumed = false; this.returnPending = false; this.freed = false;
    }
    live() { if (this.freed) throw Error('Freed synthetic Play policy'); }
    available() { this.live(); return this.hasCapability; }
    accepted() { this.live(); return this.consumed; }
    nickname_valid(nickname) { this.live(); return nickname.length <= 24 && !/[^\x20-\x7f]/.test(nickname); }
    accept() {
      this.live();
      if (!this.hasCapability || this.consumed) return false;
      this.consumed = true; return true;
    }
    lock_unavailable() {
      this.live();
      if (this.hasCapability) return false;
      this.consumed = true; return true;
    }
    return_ready(phase, playing) {
      this.live();
      this.returnPending = this.local && this.consumed && (phase === 'disconnected' || phase === 'victory' && !playing);
      return this.returnPending;
    }
    complete_return() {
      this.live();
      if (!this.returnPending) throw Error('No accepted local Play to return');
      this.consumed = this.returnPending = false;
    }
    free() { this.live(); this.freed = true; }
  };
}
