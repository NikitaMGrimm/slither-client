import assert from 'node:assert/strict';
import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

// Authored synthetic packet/clock schedules through the real Wasm API. This
// checks copied native widget plans, not browser Canvas/DOM or reference pixels.
export function minimapRenderSmoke(wasm) {
  let assertions = 0;
  const eq = (actual, expected, message) => {
    assertions++;
    assert.deepEqual(actual, expected, message);
  };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  const throws = callback => { assertions++; assert.throws(callback); };
  const pixel = (plane, index) => Array.from(plane.slice(4 * index, 4 * index + 4));
  const view = (scene, revision) => scene.minimap_view(0, 0, revision);
  const u16 = value => [value >>> 8 & 255, value & 255];
  const u24 = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];
  const center = 32550;
  const appearance = (id, x) => {
    const name = Array.from('Synthetic minimap', c => c.charCodeAt(0));
    return [115, ...u16(id), ...u24(0), 48, ...u24(0), ...u16(4250), ...u24(0), 0,
      ...u24(x * 5), ...u24(center * 5), name.length, ...name, 0, 255,
      ...u24((x - 84) * 5), ...u24(center * 5), 211, 127, 0, 0];
  };

  const legacy = new wasm.AnimatedScene(0);
  const scene = new wasm.AnimatedScene(0);
  const own = new wasm.AnimatedScene(0);
  try {
    const initial = view(scene);
    eq(Object.keys(initial).sort(), ['schema', 'enabled', 'imageRevision', 'dimension',
      'baseRgba', 'alternateRgba', 'widget'].sort());
    eq([initial.schema, initial.enabled, initial.imageRevision, initial.dimension, initial.widget],
      [1, false, 0n, null, null]);
    ok(initial.baseRgba instanceof Uint8Array);
    legacy.apply_frame(Uint8Array.of(77), false);
    eq(JSON.parse(legacy.snapshot()).ignored, 1, 'disabled commands remain opaque before Setup');
    throws(() => legacy.enable_minimap_tracking());
    legacy.reset();
    legacy.enable_minimap_tracking();
    eq(view(legacy).enabled, true);

    scene.enable_minimap_tracking();
    scene.enable_minimap_tracking();
    scene.apply_frame(bundle(syntheticSetup(), [77, 0, 2, 64], [82]), false);
    let current = view(scene);
    eq([current.dimension, current.imageRevision], [2, 2n]);
    eq(JSON.parse(scene.snapshot()).ignored, 1, 'map tracking does not enable malformed score R');
    eq(scene.score_view().status, 'disabled');
    eq(pixel(current.baseRgba, 3), [255, 255, 255, 255]);
    eq(pixel(current.alternateRgba, 3), [255, 255, 255, 255]);
    current.alternateRgba[12] = 0;
    eq(pixel(view(scene).alternateRgba, 3), [255, 255, 255, 255], 'copied pixels do not alias native state');
    const revision = current.imageRevision;
    scene.advance(40, false).free();
    current = view(scene, revision);
    eq([current.baseRgba, current.alternateRgba], [null, null]);
    eq(current.imageRevision, revision, 'numeric updates retain drawing-buffer revision');
    eq(current.widget.side, 26);
    eq([current.widget.right, current.widget.bottom, current.widget.zIndex], [16, 16, 10]);
    eq(current.widget.opacity, 0.025);
    const resizeBurst = bundle(...Array.from({ length: 4096 }, (_, index) =>
      [85, ...(index % 2 ? [2, 0] : [1, 255])]));
    const beforeBurst = view(scene);
    throws(() => scene.apply_frame(resizeBurst, false));
    eq(view(scene), beforeBurst, 'a short resize burst cannot monopolize the receiving frame');
    scene.advance_with_control(80, false, () => ({ minimapUiFraction: 0.5 })).free();
    eq(view(scene, revision).widget.opacity, 0.05,
      'return fraction is applied before the connected map fade writer');
    scene.observe_minimap_ui_fraction(0.5);
    eq(view(scene, revision).widget.opacity, 0.025);
    throws(() => scene.observe_minimap_ui_fraction(NaN));
    throws(() => scene.minimap_view(-1, 0, revision));
    eq(view(scene, revision).widget.opacity, 0.025);
    eq(current.widget.background.center, { x: 13, y: 13 });
    eq(current.widget.background.fill, [32, 38, 48]);
    eq(current.widget.background.quadrantFill, [64, 70, 80]);
    eq(current.widget.images, [
      { dimension: 2, left: 12, top: 12, opacity: current.widget.images[0].opacity, zIndex: 12 },
      { dimension: 2, left: 12, top: 12, opacity: current.widget.images[1].opacity, zIndex: 13 },
    ]);
    eq([current.widget.marker.side, current.widget.marker.radius, current.widget.marker.zIndex], [14, 2.5, 13]);
    eq([current.widget.label.text, current.widget.label.fontSize, current.widget.label.textAlign,
      current.widget.label.overflowHidden], ['server 1', 14, 'center', true]);

    scene.apply_frame(Uint8Array.of(86, 64), false);
    current = view(scene, revision);
    ok(current.imageRevision !== revision);
    eq(pixel(current.baseRgba, 3), [255, 255, 255, 255]);
    eq(pixel(current.alternateRgba, 3), [0, 0, 0, 0]);
    scene.apply_frame(bundle([85, 0, 2, 32], [76, 2, 0, 1, 64, 64]), false);
    eq(pixel(view(scene).alternateRgba, 0), [255, 255, 255, 255]);
    scene.apply_frame(bundle([76, 3, 0, 1, 64, 64, 64]), false);
    eq(pixel(view(scene).alternateRgba, 0), [255, 255, 255, 255], 'lighter persists at unchanged size');
    scene.apply_frame(bundle([77, 0, 80, 64], [117, 64], [86, 64]), false);
    current = view(scene);
    eq(current.dimension, 80);
    eq(pixel(current.baseRgba, 6399), [255, 255, 255, 255]);
    eq(pixel(current.alternateRgba, 6399), [0, 0, 0, 0]);
    scene.apply_frame(bundle([77, 0, 3, 64], syntheticSetup(), [86, 64]), false);
    current = view(scene);
    eq(current.dimension, 24, 'mid-frame Setup forces 24 before the following V');
    eq(pixel(current.alternateRgba, 575), [255, 255, 255, 255]);
    const beforeFailure = view(scene);
    throws(() => scene.apply_frame(bundle([77, 0, 3, 32], [86, 64, 255]), false));
    eq(view(scene), beforeFailure, 'a late reachable missing operand preserves native map and revision');
    scene.reset();
    current = view(scene);
    eq(current.enabled, true);
    ok(current.imageRevision !== beforeFailure.imageRevision);
    ok(current.baseRgba.every(byte => byte === 0));
    ok(current.alternateRgba.every(byte => byte === 0));
    throws(() => scene.apply_frame(Uint8Array.of(86, 64), false));
    scene.apply_frame(bundle(syntheticSetup(), [77, 0, 0, 255]), false);
    current = view(scene);
    eq([current.dimension, current.widget.side, current.baseRgba.length], [0, 24, 0]);

    own.enable_minimap_tracking();
    own.enable_nicknames();
    own.apply_frame(bundle(syntheticSetup(), appearance(0, center + 1000), [77, 0, 24, 64],
      [122, ...u24(500)]), false);
    const raw = own.control_view().own.rawHead;
    own.advance(151, false).free();
    const radius = JSON.parse(own.snapshot()).boundary.displayed;
    const project = head => Math.round(10 * (12 + 12 + 12 * (head - center) / radius - 7)) / 10;
    current = view(own);
    eq([current.widget.marker.left, current.widget.marker.top], [project(raw.x), project(raw.y)]);
    ok(own.control_view().own.rawHead.x !== raw.x);
    const ownToken = own.control_view().own.token;
    own.apply_frame(bundle([115, 0, 0, 0], appearance(0, center + 4000)), false);
    own.set_connected(false);
    own.advance(400, false).free();
    eq(own.control_view().own.token, ownToken, 'ID reuse retains original own marker source');
    eq([view(own).widget.marker.left, view(own).widget.marker.top],
      [project(own.control_view().own.rawHead.x), project(own.control_view().own.rawHead.y)]);
    const retainedMarker = view(own).widget.marker;
    own.reset();
    own.apply_frame(syntheticSetup(), false);
    own.advance(408, false).free();
    eq(view(own).widget.marker, retainedMarker, 'reset without a new own object retains marker coordinates');
  } finally {
    own.free();
    scene.free();
    legacy.free();
  }
  return { assertions, scenes: 3 };
}
