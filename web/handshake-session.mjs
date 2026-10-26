/** Unpack the Rust ABI result only after validating the complete packed buffer. */
export function unpackCommands(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected packed command bytes');
  const commands = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 4) throw new Error('Truncated packed command length');
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    offset += 4;
    if (!length || length > bytes.length - offset) throw new Error('Invalid packed command length');
    commands.push(bytes.slice(offset, offset + length)); offset += length;
  }
  if (!commands.length) throw new Error('No commands in frame');
  return commands;
}

/** No sockets, retries, dynamic evaluation, or game-control packets live here. */
export class HandshakeSession {
  #state = 'challenge';
  #frames = 0;
  #wasm;
  #login;
  #profile;
  #solve;
  constructor(wasm, profile, nickname, { solve = encoded => wasm.solve_challenge(encoded) } = {}) {
    this.#wasm = wasm; this.#profile = profile; this.#solve = solve;
    this.#login = wasm.encode_login(profile.clientVersion, profile.password, nickname, 0, new Uint8Array());
  }
  get state() { return this.#state; }
  start() { return [Uint8Array.of(1), Uint8Array.of(99, 0)]; }
  receive(frame) {
    if (this.#state === 'done' || this.#state === 'failed') throw new Error('Handshake is terminal');
    try {
      if (++this.#frames > 16) throw new Error('Handshake frame limit exceeded');
      const commands = unpackCommands(this.#wasm.decode_frame(frame, false));
      if (this.#state === 'challenge' && (commands.length !== 1 || commands[0][0] !== 54)) throw new Error('Expected one challenge command');
      if (this.#state === 'setup' && commands[0][0] !== 97) throw new Error('Expected setup after login');
      let state = this.#state;
      let protocolVersion;
      const outbound = [];
      for (const command of commands) {
        if (command[0] === 54) {
          if (state !== 'challenge') throw new Error('Repeated or out-of-order challenge');
          const reply = this.#solve(command.subarray(1));
          if (!(reply instanceof Uint8Array) || reply.length !== 27) throw new Error('Invalid challenge reply');
          outbound.push(reply, this.#login.slice()); state = 'setup';
        } else if (command[0] === 97) {
          if (state !== 'setup') throw new Error('Setup arrived before challenge');
          protocolVersion = this.#wasm.setup_protocol_version(command);
          if (protocolVersion !== this.#profile.protocolVersion) throw new Error('Unexpected advertised protocol version');
          state = 'done';
          break; // Remaining structurally validated commands belong to gameplay, outside this probe.
        } else throw new Error('Unexpected command before setup');
      }
      this.#state = state;
      return { outbound, complete: state === 'done', protocolVersion };
    } catch (error) { this.#state = 'failed'; throw error; }
  }
}
