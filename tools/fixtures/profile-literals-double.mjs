// TEST ONLY: explicit scalar-ABI double using the retained authored JS oracle.
// Never imported or packaged by production code; not real-Wasm acceptance.
import { oracleClientVersion, oraclePassword } from './profile-literals-oracle.mjs';

export class ProfileLiteralParserDouble {
  static instances = [];
  input = new Uint8Array(384);
  output = new Uint8Array(20);
  ready = false;
  freed = false;
  constructor() { ProfileLiteralParserDouble.instances.push(this); }
  write(index, value) {
    if (!Number.isInteger(index) || index < 0 || index >= 384 || !Number.isInteger(value) || value < 0 || value > 255) return false;
    this.input[index] = value; return true;
  }
  parse_version(length) {
    try { return length > 0 && length <= 128 ? oracleClientVersion(this.input.subarray(0, length)) : -1; }
    catch { return -1; }
    finally { this.input.fill(0, 0, 128); }
  }
  parse_password(length) {
    this.output.fill(0); this.ready = false;
    try {
      if (length < 1 || length > 256) return false;
      oraclePassword(this.input.subarray(128, 128 + length), this.output);
      return this.ready = true;
    } catch { this.output.fill(0); return false; }
    finally { this.input.fill(0, 128); }
  }
  password_byte(index) { return this.ready && index < 20 ? this.output[index] : -1; }
  protocol_version() { return 19; }
  clear() { this.input.fill(0); this.output.fill(0); this.ready = false; }
  free() { this.freed = true; }
}
