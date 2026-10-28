// Authored synthetic actual-Wasm announcement witnesses; no network or reference.
export function announcementSmoke({ fixture, setup, spawn, food, prey, plan, eq, ok, rejects }) {
  const f = fixture();
  f.scene.enable_announcement_tracking();
  const packet = (name, message, count = 1) => [109, count >>> 16 & 255, count >>> 8 & 255, count & 255,
    255, 255, 255, name.length, ...Array.from(name, c => c.charCodeAt(0)), ...Array.from(message, c => c.charCodeAt(0))];
  const first = [setup(1), packet('First', '<tag> &  text'), setup(29)];
  f.hud(first, plan(first));
  let view = f.scene.announcement_view();
  eq(view.lines.map(line => line.text), ['"<tag> &  text"', 'By First', 'Longest today: 10']);
  eq(view.opacity, 0); ok(Object.isFrozen(view) && Object.isFrozen(view.lines) && Object.isFrozen(view.lines[0]));
  f.scene.reset(); eq(f.scene.announcement_view(), view, 'reset retains text/opacity');
  f.hud([setup(1), packet('123456-7', 'x'.repeat(600))]);
  view = f.scene.announcement_view(); eq(view.lines[0].text.length, 602); eq(view.lines[1].text, 'Anonymous player');
  const before = view;
  f.atomic(() => f.hud([setup(17), packet('new', 'new'), [109]]));
  eq(f.scene.announcement_view(), before);
  f.atomic(() => f.hud([packet('new', 'new'), packet('outside', '', 0xffffff)]));
  eq(f.scene.announcement_view(), before);
  for (const commands of [
    [setup(1), packet('outside', '', 0xffffff)],
    [setup(29), spawn(3), food, prey(31), setup(1), packet('outside', '', 2050)],
    [setup(1), packet('outside', '', 2050), setup(29)],
    [setup(29), packet('outside', '', 2078), setup(1)],
  ]) {
    const callbacks = { ...f.calls };
    f.atomic(() => f.hud(commands));
    eq(f.calls, callbacks, 'all source resolvers remain uncalled on late invalid announcement');
    eq(f.scene.announcement_view(), before);
  }
  const fresh = fixture(); fresh.scene.enable_announcement_tracking();
  fresh.atomic(() => fresh.hud([packet('missing-table', ''), setup(1)]));
  eq(fresh.scene.announcement_view().present, false);
  f.hud([packet('zero', 'ignored', 0)]); eq(f.scene.announcement_view(), before, 'nonpositive score retains content');
  const life = { schema: 1, deathPending: true, returnActive: true, returnCompleted: false, returnFraction: .6 };
  const step = f.scene.advance_with_control(20, false, () => ({ announcementLifecycle: life })); step.free();
  eq(f.scene.announcement_view().opacity, .6);
  const state = f.state(); let getters = 0;
  rejects(() => f.scene.advance_with_control(40, false, () => ({ announcementLifecycle: {
    ...life, get returnFraction() { getters++; return .5; },
  } })));
  eq(getters, 0); eq(f.state(), state); eq(f.scene.announcement_view().opacity, .6);
  rejects(() => f.scene.advance_with_control(40, false, () => ({ announcementLifecycle: { ...life, returnFraction: NaN } })));
  eq(f.state(), state);
  const completed = f.scene.advance_with_control(40, false, () => ({ announcementLifecycle: {
    schema: 1, deathPending: false, returnActive: true, returnCompleted: true, returnFraction: 0,
  } })); completed.free();
  eq(f.scene.announcement_view().opacity, -1);
  const observer = f.scene.announcement_view();
  eq(f.scene.announcement_view(), observer, 'observations consume no time');
}
