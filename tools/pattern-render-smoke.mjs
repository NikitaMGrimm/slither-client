import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';
import { Path2D } from './pattern-path-fixture.mjs';

// Authored synthetic geometry/source/failure checks through the real Wasm ABI.
// Native raster equivalence and performance require separate browser evidence.
export function patternRenderSmoke(wasm, { fixture, eq, ok, rejects }) {
  const f = fixture();
  try {
    const unused = () => { throw new Error('No synthetic appearance or food creation'); };
    f.scene.reset();
    f.scene.apply_frame_with_factories(syntheticSetup(), false, unused, unused);
    const context = f.target.context;
    const nativeFill = context.fill;
    let preserved = 0;
    context.fill = function(path, ...args) {
      if (!(path instanceof Path2D)) return nativeFill.call(this, path, ...args);
      const ambient = [{ marker: 'authored pre-existing current path' }];
      this.path = ambient; this.pathCommands = [{ op: 'sentinel' }];
      const result = nativeFill.call(this, path, ...args);
      eq(this.path, ambient, 'explicit pattern path leaves the current path untouched');
      eq(this.pathCommands, [{ op: 'sentinel' }]);
      preserved++;
      return result;
    };
    const patterns = [];
    const nativePattern = context.createPattern;
    context.createPattern = function(source, repetition) {
      const pattern = { ...nativePattern.call(this, source, repetition),
        epoch: source.epoch ?? 0, dimensions: [source.naturalWidth, source.naturalHeight] };
      patterns.push(pattern); return pattern;
    };
    for (const [width, height, zoom] of [[801, 603, .731], [319, 241, 1.17], [4096, 1, .05]]) {
      f.scene.set_zoom(zoom);
      f.target.context.trace = [];
      f.scene.render_standard_at_size(f.target, ...f.foods, f.background, width, height, f.resolve, f.quality);
      const fills = context.trace.filter(row => row.op === 'patternFill');
      eq(fills.length, 1, 'one isolated path paints the complete repeating layer');
      const row = fills[0], actualZoom = row.transforms.find(row => row[0] === 'scale')[1];
      eq(row.args, [-width * 3 / actualZoom, -height * 3 / actualZoom,
        width * 5 / actualZoom, height * 5 / actualZoom], 'negative/fractional rectangle arithmetic is unchanged');
      eq(row.transforms[0], ['translate', width / 2, height / 2]);
      eq(row.transforms[1], ['scale', actualZoom, actualZoom]);
      eq(row.transforms[2][0], 'translate', 'phase follows center and zoom');
      eq(row.alpha, 1); eq(row.blend, 'source-over');
      eq(row.color.source, f.background); eq(row.color.repetition, 'repeat');
      eq(row.path.rectangles, [row.args], 'fresh path has no accumulated rectangles');
      ok(row.args[0] < 0 && row.args[1] < 0);
    }
    eq(preserved, 3);
    const prior = patterns.at(-1);
    f.background.epoch = 1; f.render();
    ok(patterns.at(-1) !== prior, 'same source identity does not reuse an old pattern');
    eq(patterns.at(-1).epoch, 1, 'mutable source contents are sampled again');
    f.background.naturalWidth = 97; f.background.naturalHeight = 53; f.render();
    eq(patterns.at(-1).dimensions, [97, 53], 'reloaded image dimensions reach a fresh pattern');
    const before = [f.state(), context.trace.slice(), patterns.length, f.target.width];
    f.background.complete = false;
    rejects(() => f.render(), /loaded image/);
    eq([f.state(), context.trace, patterns.length, f.target.width], before,
      'pending/reloaded source rejects before pattern allocation, reset or painting');
    f.background.complete = true; f.render();
    for (const faultKind of ['failure', 'rectFailure']) {
      const fault = { authored: faultKind }, state = f.state(), trace = context.trace.slice();
      Path2D[faultKind] = fault;
      let caught;
      try { f.render(); } catch (error) { caught = error; }
      finally { Path2D[faultKind] = null; }
      eq(caught, fault, 'constructor/rect failure preserves primary identity');
      eq(f.state(), state); eq(context.trace, trace, 'path construction fails before every target clear');
      f.render();
    }
    for (const capability of ['constructor', 'rect']) {
      const state = f.state(), trace = context.trace.slice(), nativePath = globalThis.Path2D;
      const descriptor = Object.getOwnPropertyDescriptor(Path2D.prototype, 'rect');
      let caught;
      if (capability === 'constructor') globalThis.Path2D = undefined;
      else delete Path2D.prototype.rect;
      try { f.render(); } catch (error) { caught = error; }
      finally {
        globalThis.Path2D = nativePath;
        Object.defineProperty(Path2D.prototype, 'rect', descriptor);
      }
      ok(caught instanceof Error, 'missing path capability rejects');
      eq(f.state(), state); eq(context.trace, trace, 'missing capability cannot clear target');
      f.render();
    }
    f.scene.reset();
    const state = f.state(), trace = context.trace.slice(), nativePath = globalThis.Path2D;
    let constructed = 0, caught;
    const fault = { authored: 'second Setup path' };
    globalThis.Path2D = class extends nativePath {
      constructor() { super(); if (++constructed === 2) throw fault; }
    };
    try {
      const unused = () => { throw new Error('Empty Setup invokes no entity factory'); };
      f.scene.apply_frame_and_render_standard(bundle(syntheticSetup(), syntheticSetup()), false, unused, unused,
        f.target, ...f.foods, f.background, 801, 603, f.resolve, f.quality);
    } catch (error) { caught = error; }
    finally { globalThis.Path2D = nativePath; }
    eq(constructed, 2); eq(caught, fault);
    eq(f.state(), state); eq(context.trace, trace, 'all Setup paths preflight before the first clear');
    let populated = 0;
    globalThis.Path2D = class extends nativePath {
      rect(...args) { super.rect(...args); if (++populated === 2) throw fault; }
    };
    caught = undefined;
    try {
      f.scene.apply_frame_and_render_standard(bundle(syntheticSetup(), syntheticSetup()), false, unused, unused,
        f.target, ...f.foods, f.background, 801, 603, f.resolve, f.quality);
    } catch (error) { caught = error; }
    finally { globalThis.Path2D = nativePath; }
    eq(populated, 2); eq(caught, fault);
    eq(f.state(), state); eq(context.trace, trace, 'later rectangle failure also precedes the first clear');
    f.render();
  } finally {
    Path2D.failure = Path2D.rectFailure = null;
    f.close();
  }
}
