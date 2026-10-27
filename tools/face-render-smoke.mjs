import { bundle, syntheticSetup, syntheticScene } from '../web/synthetic-scene.mjs';

// Original synthetic metadata and complete real-Wasm render checks. The caller
// supplies a logical Canvas recorder, never reference assets or observed layouts.
export function faceRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects, checkAtomic, bodyImages }) {
  const geometry = () => ({ forward: 11.375, lateral: 3.125, lateralBias: 0.375,
    rotationOffset: 0.287, imageScale: 0.3125, pivotX: 9.25, pivotY: -7.5, width: 47, height: 31 });
  const style = (g = geometry()) => ({ eyes: { ...vanillaEyes(), distance: 8.125, outlineWidth: 1.25,
    pupilTravel: 0.02, eyeOpacity: 0.6, pupilOpacity: 0.8 }, decoration: { kind: 'paired-side-images', geometry: g } });
  const projection = f => request => {
    const result = f.resolve(request);
    return { revision: result.revision, eyes: result.recipe.eyes, decoration: result.recipe.faceDecoration ?? null };
  };
  const basic = (f, callback = projection(f)) => f.scene.render_with_face_decorations(
    f.target, ...f.foods, f.background, 1, false, callback);
  const images = f => f.target.context.trace.filter(v => v.op === 'image' && v.source === f.faceSource);
  const trace = f => f.target.context.trace.map(v => v.source ? { ...v, source: v.source.name } : v);
  const stage = f => {
    f.scene.set_follows(false); f.scene.set_camera_position(32541.375, 32547.125); f.scene.set_zoom(0.7125);
    f.scene.apply_frame(Uint8Array.of(101, 51), false);
    f.scene.advance(44, false).free();
  };
  const reset = (f, packets, resolve = () => style()) => {
    f.scene.reset(); f.scene.apply_frame_with_face_geometry(packets, false, resolve);
    f.target.context.trace = []; f.requests.length = 0;
  };

  // Both real APIs must compute from identical disposable state, without a
  // diagnostic prepare immediately before render consuming a second draw.
  const a = fixture({ faceStyle: style() }), b = fixture({ faceStyle: style() });
  try {
    for (const f of [a, b]) stage(f);
    a.render(); basic(b);
    eq(a.state(), b.state(), 'basic/standard prepare the same numeric face exactly once');
    const face = f => f.target.context.trace.filter(v => (v.op === 'fill' && v.commands[0]?.op === 'arc') || (v.op === 'image' && v.source === f.faceSource))
      .map(v => v.source ? { ...v, source: 'face', alphaWrites: undefined } : v);
    eq(face(a), face(b), 'both actual render APIs compose identical complete face lanes');
    eq(images(a).length, 6);
    const rows = JSON.parse(a.scene.drawn_snakes()); const snapshot = JSON.parse(a.scene.snapshot());
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i].snake, h = m.eyes.heading, z = snapshot.camera.zoom, g = geometry();
      ok(m.scale !== 1, 'non-unit entity scale');
      if (i > 0) ok(h !== 0, 'oblique captured heading');
      for (let j = 0; j < 2; j++) {
        const draw = images(a)[i * 2 + j];
        const side = j === 0 ? h - Math.PI / 2 : h + Math.PI / 2;
        const x = (Math.cos(h) * g.forward) * m.scale + Math.cos(side) * (g.lateral * m.scale + g.lateralBias);
        const y = (Math.sin(h) * g.forward) * m.scale + Math.sin(side) * (g.lateral * m.scale + g.lateralBias);
        const multiplier = (m.scale * z) * g.imageScale;
        eq(draw.transforms, [['setTransform', 1, 0, 0, 1, 0, 0],
          ['translate', 480 + ((x + m.correctedX) - snapshot.camera.absoluteX) * z,
            270 + ((y + m.correctedY) - snapshot.camera.absoluteY) * z],
          ['rotate', j === 0 ? h - g.rotationOffset : h + g.rotationOffset]], 'unfactored ordered image geometry');
        eq(draw.args, [-g.pivotX * multiplier, -g.pivotY * multiplier, g.width * multiplier, g.height * multiplier]);
        eq([draw.alpha, draw.blend, draw.source], [1, 'source-over', a.faceSource]);
      }
    }
    const full = a.target.context.trace;
    let cursor = 0;
    for (let i = 0; i < 3; i++) {
      const firstSide = full.findIndex((v, n) => n >= cursor && v.op === 'image' && v.source === a.faceSource);
      const secondSide = full.findIndex((v, n) => n > firstSide && v.op === 'image');
      eq(full.slice(cursor, firstSide).filter(v => v.op === 'fill').length, 4, 'both paired eyes and pupils precede this pair');
      eq(full.slice(cursor, firstSide).filter(v => v.op === 'stroke' && v.color === '#000000').length, 2);
      eq(full[secondSide].source, a.faceSource, 'the pair is consecutive, negative then positive');
      ok(full.slice(cursor, firstSide).some(v => v.op === 'image' && a.sources.includes(v.source)), 'body precedes face');
      cursor = secondSide + 1;
    }
    eq(a.target.context.stack.length, 0);
    // Old basic never silently drops a required retained decoration.
    const state = a.state(), before = a.target.context.trace.slice();
    rejects(() => a.scene.render(a.target, ...a.foods, a.background, 1, false));
    eq(a.state(), state); eq(a.target.context.trace, before);
  } finally { a.close(); b.close(); }

  for (const path of ['standard', 'basic']) {
    const f = fixture({ faceStyle: style() });
    const render = callback => path === 'basic' ? basic(f, callback) : f.render(callback);
    const atomic = callback => {
      const state = f.state(), before = f.target.context.trace.slice(); rejects(() => render(callback));
      eq(f.state(), state); eq(f.target.context.trace, before); eq(f.target.context.stack.length, 0);
    };
    const map = modify => request => {
      const s = f.resolve(request);
      return path === 'basic' ? modify({ revision: s.revision, eyes: s.recipe.eyes, decoration: s.recipe.faceDecoration })
        : { ...s, recipe: modify(s.recipe) };
    };
    const key = path === 'basic' ? 'decoration' : 'faceDecoration';
    try {
      stage(f); render();
      for (const sourceRect of [undefined, [0, 0, 43, 29], [1, 2, 13, 17]]) {
        f.metadata.faceDecoration.image = { asset: 8, ...(sourceRect ? { sourceRect } : {}) };
        f.target.context.trace = []; render();
        for (const call of images(f)) {
          eq(call.source, f.faceSource); eq(call.args.length, sourceRect ? 8 : 4);
          if (sourceRect) eq(call.args.slice(0, 4), sourceRect);
        }
      }
      atomic(map(r => ({ ...r, [key]: null })));
      atomic(map(r => ({ ...r, [key]: undefined })));
      atomic(map(r => ({ ...r, eyes: { kind: 'none' } })));
      atomic(map(r => ({ ...r, [key]: { ...r[key], kind: 'single-eye' } })));
      for (const field of Object.keys(geometry())) {
        atomic(map(r => ({ ...r, [key]: { ...r[key], geometry: { ...r[key].geometry, [field]: r[key].geometry[field] + 0.01 } } })));
      }
      if (path === 'standard') {
        atomic(map(r => ({ ...r, supportedFeatures: r.supportedFeatures.filter(v => v !== 'paired-side-images') })));
        atomic(map(r => ({ ...r, supportedFeatures: [...r.supportedFeatures, 'required-antenna'] })));
        atomic(map(r => ({ ...r, unsupportedFeatures: ['required-mouth'] })));
        atomic(map(r => ({ ...r, attachment: {} })));
      }
      for (const state of ['pending', 'unsupported']) {
        f.catalog[8].state = state; atomic();
      }
      f.catalog[8].state = 'ready'; f.catalog[8].source = null; atomic(); f.catalog[8].source = f.faceSource;
      f.catalog[8].source = f.target; atomic(); f.catalog[8].source = f.faceSource;
      const unloaded = new f.background.constructor('unloaded-face'); unloaded.complete = false;
      f.catalog[8].source = unloaded; atomic(); f.catalog[8].source = f.faceSource;
      // Cross-callback mutations must be revalidated after every resolver finishes.
      let count = 0;
      atomic(request => {
        const s = path === 'basic' ? projection(f)(request) : f.resolve(request);
        if (++count === 2) f.faceSource.height++;
        return s;
      });
      f.faceSource.height = 29;
      count = 0;
      atomic(request => {
        const s = path === 'basic' ? projection(f)(request) : f.resolve(request);
        if (++count === 2) f.target.height++;
        return s;
      });
      f.target.height = 540;
      count = 0;
      atomic(request => {
        const s = path === 'basic' ? projection(f)(request) : f.resolve(request);
        return { ...s, revision: ++count === 2 ? 'conflicting-source-revision' : s.revision };
      });
      for (const thrown of [new Error('late face callback'), Symbol('face'), null, undefined]) {
        count = 0; let caught = false;
        atomic(request => {
          if (++count === 2) { caught = true; throw thrown; }
          return path === 'basic' ? projection(f)(request) : f.resolve(request);
        });
        ok(caught); eq(count, 2);
      }
      // Asset aliases share the same pool between body and face in standard mode.
      f.metadata.faceDecoration.image = { asset: 0 };
      f.target.context.trace = []; render();
      const calls = f.target.context.trace.filter(v => v.op === 'image' && v.source === f.sources[0]);
      ok(calls.some(v => v.args[2] === geometry().width * ((JSON.parse(f.scene.snapshot()).own.scale * JSON.parse(f.scene.snapshot()).camera.zoom) * geometry().imageScale)));
      f.metadata.faceDecoration.image = { asset: 8 };

      // Scoped Canvas failures preserve the model; successful retry equals a
      // control that has not consumed the failed draw's camera/spacing/targets.
      const control = fixture({ faceStyle: style() });
      try {
        // Use fresh twins so earlier synthetic renders do not affect the comparison.
        const failed = fixture({ faceStyle: style() });
        try {
          for (const mode of ['image1', 'image2', 'translate', 'rotate', 'setTransform']) {
            const ctx = failed.target.context; ctx.trace = []; const before = failed.state();
            if (mode.startsWith('image')) { ctx.failSource = failed.faceSource; ctx.failSourceAt = Number(mode.at(-1)); ctx.failSourceCount = 0; }
            else ctx.failMethodAfterEyes = mode;
            rejects(() => path === 'basic' ? basic(failed) : failed.render());
            eq(failed.state(), before); eq(ctx.stack.length, 0);
            ctx.failSource = null; ctx.failMethodAfterEyes = null;
          }
          failed.target.context.trace = []; control.target.context.trace = [];
          if (path === 'basic') { basic(failed); basic(control); } else { failed.render(); control.render(); }
          eq(failed.state(), control.state()); eq(trace(failed), trace(control));
        } finally { failed.close(); }
      } finally { control.close(); }
    } finally { f.close(); }
  }

  // Body pending does not block a ready face-only projection or numeric install.
  const partial = fixture({ faceStyle: style() });
  try {
    partial.catalog[0].state = 'pending';
    const result = partial.provider.resolve({ skin: 0 }, partial.snapshot); eq(result.status, 'pending');
    reset(partial, bundle(syntheticSetup(), appearance()), () => ({ eyes: result.recipe.eyes,
      decoration: { kind: result.recipe.faceDecoration.kind, geometry: result.recipe.faceDecoration.geometry } }));
    partial.scene.advance(44, false).free(); basic(partial); eq(images(partial).length, 2);
    checkAtomic(partial);
  } finally { partial.close(); }

  // Quality, spawn/death and the complete body/death/eyes/reset/pair/next-body
  // boundary use the real APIs. No invalid outer-boost request is manufactured.
  for (const path of ['standard', 'basic']) for (const mode of ['HQ', 'LQ', 'blend']) {
    const f = fixture({ faceStyle: style() });
    const render = () => path === 'basic' ? basic(f) : f.render();
    const check = expected => {
      f.requests.length = 0; f.target.context.trace = []; const q = f.quality.snapshot();
      render(); eq(f.quality.snapshot(), q, 'render borrows quality without advancing it');
      eq(images(f).length, expected * 2); eq(f.requests.length, expected);
      ok(images(f).every(v => v.alpha === 1 && v.blend === 'source-over'));
    };
    try {
      reset(f, syntheticScene()); check(3);
      eq(JSON.parse(f.scene.snapshot()).own.spawnProgress, 0);
      if (mode === 'LQ') { f.quality.set_requested_mode(0); f.quality.begin_connection(); }
      if (mode === 'blend') {
        for (let i = 0; i < 2; i++) f.quality.update_statistics(1001 * (i + 1), 0, true);
        const step = f.scene.advance(48, false);
        try { f.quality.advance(step, true); } finally { step.free(); }
        const q = JSON.parse(f.quality.snapshot()); ok(!q.highQuality && q.qualityBlend > 0 && q.qualityBlend < 1);
      }
      f.scene.apply_frame(bundle([51, 255], [51, 0, 7, 255], [51, 0, 8, 255]), false);
      for (let i = 2; i <= 20; i++) f.scene.advance(48 + i * 40, false).free();
      check(3);
      f.scene.apply_frame(Uint8Array.of(115, 0, 0, 1), false);
      f.scene.advance(852, false).free(); check(3);
      const calls = f.target.context.trace;
      const first = calls.findIndex(v => v.op === 'fill');
      const side = calls.findIndex(v => v.op === 'image' && v.source === f.faceSource);
      eq(calls.slice(first, side).filter(v => v.op === 'fill').length, 4);
      ok(calls.slice(first, side).some(v => v.op === 'alpha' && v.requested === 1 && v.effective === 1));
      const next = calls.findIndex((v, n) => n > side && v.op === 'image' && v.source !== f.faceSource);
      ok(next > side, 'the following snake body starts after both side images');
      const pupil = calls.slice(first, side).filter(v => v.op === 'fill').at(-1);
      ok(pupil.alpha > 0 && pupil.alpha < style().eyes.pupilOpacity);
      if (path === 'standard') {
        const own = calls.slice(0, first).filter(v => v.op === 'image' && f.sources.includes(v.source));
        eq(own.at(-1).source, f.sources[6], 'death highlight is complete before eyes');
        ok(calls[next].alphaWrites.every(v => Number.isFinite(v.effective)));
      }
      for (let i = 1; i <= 9; i++) f.scene.advance(852 + i * 40, false).free();
      f.scene.advance(1247, false).free();
      check(3); ok(JSON.parse(f.scene.snapshot()).own.deathProgress > 0.99);
      f.scene.advance(1252, false).free();
      check(2); ok(JSON.parse(f.scene.snapshot()).own.expired);
      f.requests.length = 0; render(); eq(f.requests.map(r => r.own), [false, false], 'expired own diagnostics never resolve assets');
    } finally { f.close(); }
  }

  // A short face remains eligible without a body curve. Culling is based on
  // retained anchors, including the boundary; the head/image has no extra cull.
  for (const path of ['standard', 'basic']) {
    const f = fixture({ faceStyle: style() });
    const render = () => path === 'basic' ? basic(f) : f.render();
    try {
      const short = appearance().slice(0, -22); // one independently authored retained anchor
      reset(f, bundle(syntheticSetup(), short));
      f.scene.set_follows(false); f.scene.set_zoom(1);
      // The sole anchor is at 32428,32550. This draw's automatic zoom is 1.0002.
      const edge = 32428 - (480 / 1.0002 + 84);
      f.scene.set_camera_position(edge, 32550);
      render(); eq(images(f).length, 2); eq(f.requests.length, 1);
      eq(f.scene.own_curve(1, false).length, 0, 'short-face policy does not require a body curve');
      ok(images(f)[0].transforms[1][1] > 960, 'body-only visibility still completes an offscreen head face');
      f.scene.set_zoom(1); f.scene.set_camera_position(edge - 0.0001, 32550);
      f.target.context.trace = []; f.requests.length = 0; render(); eq(images(f).length, 0); eq(f.requests.length, 0);
      // Legacy API is allowed while every decorated object is culled.
      f.scene.render(f.target, ...f.foods, f.background, 1, false);
      f.scene.apply_frame(Uint8Array.of(101, 64), false);
      f.scene.advance(44, false).free(); f.scene.set_camera_position(32550, 32550);
      f.target.context.trace = []; f.requests.length = 0; render(); eq(images(f).length, 2);
      const m = JSON.parse(f.scene.snapshot()).own;
      eq(m.eyes.heading, m.heading, 'visibility entry resets face to raw heading');
      f.scene.apply_frame(Uint8Array.of(115, 0, 0, 0), false);
      f.target.context.trace = []; f.requests.length = 0; render(); eq(images(f).length, 0); eq(f.requests.length, 0);
    } finally { f.close(); }
  }

  // Duplicate IDs own numeric style per retained object. Draw-time callbacks
  // identify the appearance by its copied metadata, never a latest-ID style map.
  for (const path of ['standard', 'basic']) {
    const f = fixture({ faceStyle: style() });
    const styles = [style({ ...geometry(), pivotX: -0 }),
      { eyes: style().eyes, decoration: { kind: 'none' } }, style({ ...geometry(), forward: 19.25 })];
    const render = () => path === 'basic' ? basic(f) : f.render();
    let n = 0;
    try {
      reset(f, bundle(syntheticSetup(), appearance([1], 17), appearance([2], 29),
        [115, 0, 0, 1], appearance([3], 31)), () => styles[n++]);
      f.transform((s, request) => {
        const face = styles[request.customBytes[0] - 1];
        const { faceDecoration: ignored, ...recipe } = s.recipe;
        return { ...s, recipe: { ...recipe, eyes: face.eyes,
          supportedFeatures: [...recipe.supportedFeatures.filter(v => v !== 'paired-side-images'),
            ...(face.decoration.kind === 'none' ? [] : ['paired-side-images'])],
          ...(face.decoration.kind === 'none' ? {} : { faceDecoration: {
            kind: face.decoration.kind, geometry: face.decoration.geometry, image: s.recipe.faceDecoration.image } }) } };
      });
      f.scene.advance(44, false).free(); render();
      eq(f.requests.map(r => [r.id, r.own, r.drawOrdinal, r.cosmetic, [...r.customBytes]]),
        [[0, true, 0, 17, [1]], [0, false, 1, 29, [2]], [0, false, 2, 31, [3]]]);
      eq(images(f).length, 4); ok(images(f).slice(0, 2).every(v => Object.is(v.args[0], 0)));
      for (const expected of [2, 1]) {
        f.scene.apply_frame(Uint8Array.of(115, 0, 0, 0), false); f.requests.length = 0; f.target.context.trace = [];
        render(); eq(f.requests.length, expected);
      }
      eq(f.requests[0].own, true, 'already dead original own survives repeated wire-ID removals');
      eq(images(f).length, 2);
      for (let i = 1; i <= 12; i++) f.scene.advance(44 + i * 40, false).free();
      f.requests.length = 0; f.target.context.trace = []; render(); eq(f.requests.length, 0); eq(images(f).length, 0);
    } finally { f.close(); }
  }

  // Deliberate derived zero signs and finite underflow travel through both ABIs.
  for (const path of ['standard', 'basic']) {
    const f = fixture({ faceStyle: style({ ...geometry(), imageScale: Number.MIN_VALUE,
      width: Number.MIN_VALUE, height: Number.MIN_VALUE, pivotX: 0, pivotY: -0 }) });
    try {
      if (path === 'basic') basic(f); else f.render();
      eq(images(f).length, 6);
      for (const draw of images(f)) {
        ok(Object.is(draw.args[0], -0)); ok(Object.is(draw.args[1], 0));
        ok(Object.is(draw.args[2], 0)); ok(Object.is(draw.args[3], 0));
      }
    } finally { f.close(); }
  }

  // Retained metadata and callback validation happen at application, not render.
  const transaction = fixture({ faceStyle: style() });
  try {
    const f = transaction, before = f.state(); let calls = 0;
    rejects(() => f.scene.apply_frame_with_face_geometry(bundle(appearance(), [114, 0]), false,
      () => { calls++; return style(); })); eq(calls, 0); eq(f.state(), before);
    for (const thrown of [new Error('face appearance'), Symbol('appearance'), null, undefined]) {
      calls = 0; let caught = false;
      try {
        f.scene.apply_frame_with_face_geometry(bundle(appearance(), appearance()), false, () => {
          if (++calls === 2) throw thrown; return style();
        });
      } catch (e) { caught = true; eq(e, thrown); }
      ok(caught); eq(calls, 2); eq(f.state(), before);
    }
    for (const key of Object.keys(geometry())) {
      for (const invalid of [NaN, Infinity, -Infinity, '1', null, undefined, 65536]) {
        calls = 0;
        rejects(() => f.scene.apply_frame_with_face_geometry(bundle(appearance(), appearance()), false, () => {
          if (++calls === 1) return style(); return style({ ...geometry(), [key]: invalid });
        })); eq(calls, 2); eq(f.state(), before);
      }
      for (const accessor of [false, true]) {
        const g = geometry(), value = g[key]; delete g[key];
        if (accessor) Object.defineProperty(g, key, { get() { throw new Error('must not invoke'); } });
        else Object.setPrototypeOf(g, { [key]: value });
        rejects(() => f.scene.apply_frame_with_face_geometry(bundle(appearance()), false, () => style(g)));
        eq(f.state(), before);
      }
    }
    for (const invalid of [Promise.resolve(style()), { ...style(), decoration: null },
      { ...style(), decoration: { kind: 'single-eye' } }, { ...style(), eyes: { kind: 'none' } }]) {
      rejects(() => f.scene.apply_frame_with_face_geometry(bundle(appearance()), false, () => invalid)); eq(f.state(), before);
    }
    const mutable = style(); reset(f, bundle(syntheticSetup(), appearance()), () => mutable);
    mutable.decoration.geometry.forward = 400; mutable.eyes.pupilTravel = 200;
    f.scene.advance(44, false).free(); f.render(); eq(images(f).length, 2);
    eq(JSON.parse(f.scene.snapshot()).own.eyes.pupilX, 0.02);
  } finally { transaction.close(); }

  for (const key of Object.keys(geometry())) {
    const positive = ['imageScale', 'width', 'height'].includes(key);
    const f = fixture({ faceStyle: style(positive ? geometry() : { ...geometry(), [key]: -0 }) });
    try {
      if (positive) {
        for (const zero of [0, -0]) rejects(() => f.scene.apply_frame_with_face_geometry(bundle(appearance()), false, () => style({ ...geometry(), [key]: zero })));
      } else {
        f.render();
        for (const path of ['standard', 'basic']) {
          const before = f.state(), prior = f.target.context.trace.slice();
          f.metadata.faceDecoration.geometry[key] = 0;
          rejects(() => path === 'basic' ? basic(f) : f.render());
          eq(f.state(), before); eq(f.target.context.trace, prior);
          f.metadata.faceDecoration.geometry[key] = -0;
        }
        if (key === 'pivotX' || key === 'pivotY') {
          const index = key === 'pivotX' ? 0 : 1;
          ok(images(f).every(v => Object.is(v.args[index], 0)), 'negated negative-zero pivot stays positive zero');
        }
      }
    } finally { f.close(); }
  }

  // All three legacy application forms preserve commands and numeric state under
  // the corrected unconditional source boundary, with no decoration by default.
  const old = fixture(), explicit = fixture({ faceStyle: { eyes: vanillaEyes(), decoration: { kind: 'none' } } });
  try {
    for (const path of ['standard', 'basic']) {
      old.target.context.trace = []; explicit.target.context.trace = [];
      if (path === 'standard') { old.render(); explicit.render(); }
      else { old.scene.render(old.target, ...old.foods, old.background, 1, false); basic(explicit); }
      eq(old.state(), explicit.state()); eq(trace(old), trace(explicit));
    }
  } finally { old.close(); explicit.close(); }

  const decorated = fixture({ faceStyle: style() }), paired = fixture({ eyeStyle: style().eyes });
  try {
    for (const f of [decorated, paired]) stage(f);
    decorated.render(); paired.render();
    eq(decorated.state(), paired.state(), 'decoration enablement changes no protocol, clock, body, pupil or camera diagnostics');
    const bodies = f => bodyImages(f).map(v => ({ ...v, source: v.source.name }));
    eq(bodies(decorated), bodies(paired));
    eq(decorated.target.context.trace.filter(v => v.op === 'fill'), paired.target.context.trace.filter(v => v.op === 'fill'));
    // Different pupil gaze never enters side-image geometry.
    const twin = fixture({ faceStyle: style() });
    try {
      const gaze = fixture({ faceStyle: style() });
      try {
        gaze.scene.set_gaze_heading(Math.PI / 2);
        for (const f of [gaze, twin]) { f.scene.advance(44, false).free(); f.render(); }
        ok(JSON.parse(gaze.scene.snapshot()).own.eyes.pupilY !== JSON.parse(twin.scene.snapshot()).own.eyes.pupilY);
        const sides = f => images(f).map(v => ({ ...v, source: 'face', alphaWrites: undefined }));
        eq(sides(gaze), sides(twin));
      } finally { gaze.close(); }
    } finally { twin.close(); }
  } finally { decorated.close(); paired.close(); }

  const noEyes = fixture({ eyes: false });
  try {
    noEyes.render(); const calls = noEyes.target.context.trace;
    eq(calls.filter(v => v.op === 'fill' && v.commands[0]?.op === 'arc').length, 0);
    const edgeStart = calls.findIndex(v => v.op === 'alpha' && v.requested === 0.8);
    eq(calls.slice(0, edgeStart).filter(v => v.op === 'alpha').at(-1), { op: 'alpha', requested: 1, effective: 1 },
      'eye-less nondecorated face finishes at root alpha one before the scoped edge');
  } finally { noEyes.close(); }
}
