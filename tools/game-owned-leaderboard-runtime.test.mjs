// Authored offline runtime integration. Actual gate, builders and issued views;
// gameplay is an explicit seam double, and the projector is a generated-Wasm ABI double.
// No claim about actual gameplay/Wasm, native DOM, pixels or server acceptance.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('owned leaderboard startup, deferred publication and resource ownership', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const gameplaySource = `
      import { createHudState, reduceHudState } from './stock-hud-state.mjs';
      import { createLeaderboardState, prepareLeaderboardPacket,
        completeLeaderboardPacket } from './stock-leaderboard-state.mjs';
      export let seam;
      // Explicit gameplay seam DOUBLE: no session, wire parsing, source owner or native scene calls.
      export function createStockGameplay(options) {
        const identity = Symbol('Synthetic runtime seam scene');
        let hud = createHudState(identity), rows = createLeaderboardState(identity), disposed = false;
        seam = { options, frames: 0, resizes: 0, frees: 0, snapshotHook: undefined,
          stage(names = [[65]], keepHud = false) {
            names = Array.from(names,name => Array.from(name));
            const events = rows.setupSeen ? [] : [
              {kind:'setup',commandIndex:0,tableMax:17},
              {kind:'setup-draw',commandIndex:0,view:{schema:1,enabled:true,tableMax:17,
                own:null,status:'no-own',score:null,error:null}}];
            const commandIndex = events.length ? 1 : 0;
            events.push({kind:'leaderboard',commandIndex,localRow:0,rank:0,population:0,deathPending:false});
            const report = {schema:2,commandCount:commandIndex+1,setupDraws:commandIndex,events,
              leaderboardRows:[{commandIndex,rows:names.map((name,index)=>({ordinal:index+1,count:2,
                fractionalMass:.5,rawColor:255,paletteIndex:3,name}))}]};
            const plan = prepareLeaderboardPacket(rows,report);
            const scores = plan.requests.map(request => Array.from(options.leaderboardProjector.project(
              request.tableMax,new Float64Array(request.counts),new Float64Array(request.fractionalMasses))));
            const nextRows = completeLeaderboardPacket(rows,plan,scores,'Local');
            const nextHud = keepHud ? hud : reduceHudState(hud,identity,{kind:'packet',report});
            options.defer(() => { if (!disposed) { rows=nextRows; hud=nextHud; } });
          },
        };
        return { hudSnapshot() { seam.snapshotHook?.(); return disposed ? null : hud; },
          leaderboardSnapshot: () => disposed ? null : rows,
          frame() { seam.frames++; hud=reduceHudState(hud,identity,{kind:'step',delta:1,
            lifecycle:{schema:1,deathPending:false,returnActive:false,returnCompleted:false,returnFraction:1}}); },
          resize() { seam.resizes++; }, event() {}, play() {}, playWithLiveProfile() { return Promise.resolve(); },
          diagnostics: () => ({session:{connected:false,playing:false}}), dispose() { disposed=true; seam.frees++; } };
      }`;
    const selected = { hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedLeaderboardUi: true };
    async function setup({ nativeTransform = value => value, initialize = () => {}, wasmTransform = () => {} } = {}) {
      const calls = { constructed: 0, projects: 0, freed: 0, initialized: 0, hook: undefined, freeHook: undefined };
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
        leaderboardNative: true, prepareWasm(api, run) {
          api.LeaderboardScoreProjector = run(`(calls => class LeaderboardScoreProjector {
            constructor() { calls.constructed++; }
            project(tableMax, counts, masses) {
              calls.projects++; calls.hook?.();
              if(tableMax!==17 || !(counts instanceof Float64Array) || !(masses instanceof Float64Array))
                throw Error('Wrong projector ABI');
              return new Float64Array(counts.length).fill(-0);
            }
            free() { calls.freed++; calls.freeHook?.(); }
          })`)(calls);
          wasmTransform(api, run);
        } });
      graph.hudWasm();
      graph.sources.set('https://authored-package.invalid/game/stock-gameplay.mjs', gameplaySource);
      const realm = graph.nativeBoundary(nativeTransform);
      const factory = await graph.load('runtime.mjs');
      const start = () => factory.startGamePage({ realm, wasmApi: graph.wasm.api, ...selected,
        initialize() { calls.initialized++; return initialize(); } });
      return { graph, calls, start, seam: async () => (await graph.load('stock-gameplay.mjs')).seam };
    }
    const text = (graph, node) => node.children.length ? node.children.map(child => text(graph, child)).join('')
      : node.nodeType === 3 ? graph.f.edit.hud.character(node).data : '';

    // Actual startup retains one native scene/projector, one RAF and the existing public API.
    {
      const { graph, calls, start, seam: getSeam } = await setup();
      const runtime = await start(), seam = await getSeam();
      // Mutating the ABI class later must not replace captured project/free authority.
      graph.wasm.api.LeaderboardScoreProjector.prototype.project = () => assert.fail('Late project lookup');
      graph.wasm.api.LeaderboardScoreProjector.prototype.free = () => assert.fail('Late free lookup');
      assert.equal(calls.initialized, 1); assert.equal(calls.constructed, 1);
      assert.equal(seam.options.hudReadout, true); assert.equal(seam.options.leaderboardRows, true);
      assert.deepEqual(Object.keys(seam.options.leaderboardProjector), ['project']);
      assert.equal(graph.f.raf.size, 1); assert.equal(graph.f.sockets, 0);
      assert.equal(graph.wasm.calls.filter(value => value === 'scene').length, 1);
      assert.deepEqual(Object.keys(runtime).sort(), ['diagnostics','play','playWithLiveProfile',
        'bindNicknameField','bindHudReadout','dispose'].sort());
      const root = graph.f.document.getElementById('slither-client-root'), mount = root.children.at(-1);
      assert.equal(mount.children.length, 4);
      assert.equal(graph.f.edit.hud.style(mount.children[0].style).get('display'), 'none');
      assert.equal(text(graph,mount), 'Leaderboard');
      seam.stage([[65,32,38,60],[66]]);
      assert.equal(calls.projects, 1); assert.equal(text(graph,mount), 'Leaderboard', 'packet seam has no DOM publication');
      graph.f.flush();
      assert.equal(text(graph,mount), 'Leaderboard00A\u00a0&<B#1#2');
      assert.equal(graph.f.edit.hud.style(mount.children[0].style).get('display'), 'inline');
      const first = mount.children[1].children[0];
      graph.f.frame(8);
      assert.equal(seam.frames, 1); assert.equal(calls.projects, 1);
      assert.equal(mount.children[1].children[0], first, 'frame-only fade reuses rows');
      assert.equal(graph.f.edit.hud.style(mount.children[1].style).get('opacity'), '0.01');
      seam.stage([[66]], true); graph.f.flush();
      assert.equal(text(graph,mount), 'Leaderboard0B#1', 'row revision publishes with unchanged HUD identity');
      assert.notEqual(mount.children[1].children[0], first);
      const rebuilt = mount.children[1].children[0];
      graph.f.event('resize');
      assert.equal(seam.resizes, 1); assert.equal(mount.children[1].children[0], rebuilt);
      seam.stage([]); graph.f.flush();
      assert.equal(text(graph,mount), 'Leaderboard', 'empty board clears all columns');
      assert.equal(calls.projects, 3, 'empty board still projects');
      const projects = seam.options.leaderboardProjector;
      const lateFrame = graph.f.raf.values().next().value;
      seam.stage([[67]]);
      runtime.dispose(); runtime.dispose();
      assert.equal(calls.freed, 1); assert.equal(seam.frees, 1);
      assert.equal(root.children.length, 3); assert.equal(graph.f.raf.size, 0);
      const traces = graph.f.edit.hud.trace.length;
      assert.equal(projects.project(17, new Float64Array(), new Float64Array()), undefined);
      graph.f.flush(); lateFrame(16);
      assert.equal(calls.freed, 1); assert.equal(graph.f.edit.hud.trace.length, traces);
    }

    // Adoption revokes publication/removal authority without losing native cleanup.
    {
      const { graph, calls, start, seam: getSeam } = await setup();
      const runtime = await start(), seam = await getSeam();
      const root = graph.f.document.getElementById('slither-client-root'), mount = root.children.at(-1);
      const foreign = new graph.f.document.constructor();
      foreign.appendChild(mount);
      const before = text(graph,mount);
      seam.stage(); graph.f.flush();
      assert.equal(text(graph,mount), before);
      runtime.dispose();
      assert.equal(mount.parentNode, foreign); assert.equal(calls.freed, 1);
    }

    // Failure after native setter work retains the exact falsy startup primary;
    // projector and other owners release after the setter stack unwinds.
    for (const primary of [undefined, null, false, 0, '']) {
      const { graph, calls, start } = await setup();
      let active = false;
      graph.f.edit.hud.controls.set('setTranslate', { hook() { active = true; },
        afterHook() { active = false; }, afterFailure: primary });
      calls.freeHook = () => assert.equal(active, false);
      let failed = false;
      try { await start(); } catch (error) { failed = true; assert.equal(error, primary); }
      assert(failed); assert.equal(calls.freed, 1); assert.equal(graph.f.raf.size, 0);
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
    }

    // Caught runtime reentry still poisons the shared publication guard.
    {
      const { graph, calls, start, seam: getSeam } = await setup();
      const runtime = await start(), seam = await getSeam();
      let setterActive = false, reentry = 0;
      calls.freeHook = () => assert.equal(setterActive, false);
      graph.f.edit.hud.controls.set('setStyle', { hook() {
        setterActive = true;
        try { runtime.dispose(); } catch { reentry++; }
      }, afterHook() { setterActive = false; } });
      seam.stage(); graph.f.flush();
      assert(reentry > 0); assert.equal(calls.freed, 1); assert.equal(seam.frees, 1);
      assert.equal(graph.f.raf.size, 0); assert.equal(runtime.diagnostics().disposed, true);
    }

    // Projector calls have the existing native guard; cleanup never runs inside project.
    {
      const { graph, calls, start, seam: getSeam } = await setup();
      const runtime = await start(), seam = await getSeam();
      let projectActive = false, reentry = 0;
      calls.hook = () => {
        projectActive = true;
        try { runtime.dispose(); } catch { reentry++; }
        projectActive = false;
      };
      assert.throws(() => seam.stage(), /owner operation active/);
      assert.equal(reentry, 1); assert.equal(calls.freed, 0);
      calls.freeHook = () => assert.equal(projectActive, false);
      runtime.dispose(); assert.equal(calls.freed, 1); assert.equal(graph.f.raf.size, 0);
    }

    // Cleanup continues after a falsy projector-free failure and never retries it.
    {
      const { graph, calls, start, seam: getSeam } = await setup();
      const runtime = await start(), seam = await getSeam();
      calls.freeHook = () => { throw false; };
      let failed = false;
      try { runtime.dispose(); } catch (error) { failed = true; assert.equal(error, false); }
      assert(failed); assert.equal(calls.freed, 1); assert.equal(seam.frees, 1);
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
      runtime.dispose(); assert.equal(calls.freed, 1);
    }

    // A selected missing capability fails before initialization, DOM or input setup.
    {
      const { graph, calls, start } = await setup({ nativeTransform(native) {
        const { leaderboardDom, ...rest } = native; return Object.freeze(rest);
      } });
      const before = graph.f.edit.hud.trace.length;
      await assert.rejects(start());
      assert.equal(calls.initialized, 0); assert.equal(calls.constructed, 0);
      assert.equal(graph.f.document.getElementById('slither-client-root'), undefined);
      assert.equal(graph.f.edit.hud.trace.length, before);
    }

    // Descriptor-only admission rejects a foreign bound async setter without invoking it.
    {
      let invoked = 0;
      const foreignAsync = (async function () { invoked++; }).bind(null);
      const { graph, calls, start } = await setup({ nativeTransform(native) {
        const group = native.leaderboardDom;
        return Object.freeze({ ...native, leaderboardDom: Object.freeze(Object.assign(Object.create(null), group, {
          properties: Object.freeze(Object.assign(Object.create(null), { setTranslate: foreignAsync })),
        })) });
      } });
      await assert.rejects(start(), /leaderboard DOM/);
      assert.equal(invoked, 0); assert.equal(calls.initialized, 0); assert.equal(calls.constructed, 0);
      assert.equal(graph.f.document.getElementById('slither-client-root'), undefined);
    }
  });
});

test('local host selects explicit accessory dispatch, ready sources and profile; idle publication enables Play again', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
      leaderboardNative: true, prepareWasm(api, run) {
        api.LeaderboardScoreProjector = run('(class { project(){return new Float64Array();} free(){} })');
        api.resolve_local_skin = run('(function () { throw Error("No policy resolution expected in this runtime seam double"); })');
      } });
    graph.hudWasm();
    const origin = 'https://authored-package.invalid/game/';
    // Explicit gameplay seam DOUBLE. Exercise the actual controller/source and UI paths,
    // without starting a session, opening a socket or advancing a real Wasm scene.
    graph.sources.set(origin + 'stock-gameplay.mjs', `
      import { createHudState } from './stock-hud-state.mjs';
      import { createLeaderboardState } from './stock-leaderboard-state.mjs';
      export let seam;
      export function createStockGameplay(options) {
        const identity=Symbol('Local seam scene'), hud=createHudState(identity), rows=createLeaderboardState(identity);
        let phase='ready', playing=false, connected=false;
        seam={ options, requests:[],
          disconnect() { phase='disconnected'; playing=connected=false; options.onStatus('disconnected'); options.defer(()=>{}); },
          victory(returned=false) { phase='victory'; connected=true; playing=!returned;
            options.onStatus('connected'); options.defer(()=>{}); },
          fail() { phase='failed'; playing=connected=false; options.onStatus('disconnected'); options.defer(()=>{}); },
          status(code) { options.onStatus(code); },
        };
        return { hudSnapshot:()=>hud, leaderboardSnapshot:()=>rows,
          frame(){options.controller.resize(960,540);}, resize(w,h){options.controller.resize(w,h);}, event(){},
          play(request){seam.requests.push(request);phase='opening';playing=connected=false;},
          playWithLiveProfile(){throw Error('Local Play must not acquire a profile');},
          diagnostics:()=>({session:{phase,playing,connected}}), dispose(){} };
      }`);
    for (const [name, factory] of [['stock-host-snapshot.mjs','createStockHostSnapshot'],
      ['stock-skin-provider.mjs','createStockSkinAdapter'], ['stock-food-provider.mjs','createStockEntityAssets']]) {
      graph.sources.set(origin + name, `export function ${factory}(){throw Error('Remote source factory used locally');}`);
    }
    const realm = { ...graph.f.realm, location: { href: 'http://127.0.0.1:18884/game/' } };
    Object.defineProperty(realm,'top',{value:realm});
    Object.defineProperty(realm,Symbol.for('slither.client.gate.v1'),{
      get(){assert.fail('Remote gate observed locally');},
    });
    const endpoint = 'ws://127.0.0.1:19400/slither', events = [];
    let selectedBackdrop;
    graph.wasm.api.AnimatedScene.prototype.set_background_backdrop = image => { selectedBackdrop = image; };
    const prototype = graph.wasm.api.AnimatedScene.prototype;
    let accessoryDraws = 0;
    for (const family of ['apply_frame_and_render_standard_with_', 'render_standard_with_']) {
      const suffix = family.startsWith('apply') ? '_presentation_and_prey' : '_presentation_at_size';
      const original = prototype[family + 'face' + suffix];
      prototype[family + 'accessory' + suffix] = function (...args) {
        if (family.startsWith('render')) accessoryDraws++;
        return Reflect.apply(original, this, args);
      };
      prototype[family + 'face' + suffix] = () => assert.fail('Local accessory mode used the face API');
    }
    let runtime, active = false, disposed = false, begins = 0, ends = 0, claims = 0, presets = 0, sourceHook;
    let initialized = false, skinBindings = 0;
    const sources = { appearanceMode: 'accessory', palettes: [graph.f.canvas(),graph.f.canvas(),graph.f.canvas()],
      background: new graph.f.realm.HTMLImageElement(),
      backgroundImage: new graph.f.realm.HTMLImageElement(),
      adapter: {
        beginOperation() {
          assert.equal(active,false); assert.equal(runtime.diagnostics().captureHeld,true);
          active=true; begins++; return Object.freeze({revision:'synthetic-local'});
        },
        resolveAppearance(){assert(active);return {};},
        resolveRecipe(){assert(active);sourceHook?.();return {synthetic:true};},
        resolveAntennaRandom(){assert(active);return new Float64Array(14);},
        endOperation(){assert(active);assert.equal(runtime.diagnostics().captureHeld,true);active=false;ends++;},
      }, hostAssets: { resolveFood(){assert(active);return {};}, resolvePrey(){assert(active);return {};} },
    };
    const metadata = Object.freeze({schema:1,id:Symbol('Local host double'),code:'held'});
    const original = graph.f.gate, armed = original.metadata();
    const localHost = { endpoint, sources,
      bindSkinPolicy(resolveSkin) {
        assert.equal(initialized, true); assert.equal(begins, 0);
        assert.equal(resolveSkin, graph.wasm.api.resolve_local_skin); skinBindings++;
      },
      profile: graph.run('({clientVersion:0,password:new Uint8Array(20),protocolVersion:19})'),
      gate: { metadata:()=>metadata, claim(id) {
        assert.equal(id,metadata.id); assert.equal(++claims,1);
        const native=original.claim(armed.id);
        return Object.freeze(Object.defineProperty({ ...native,
          setInput(route){assert.equal(disposed,false);events.push('input');native.setInput(route);},
          status(code){assert.equal(disposed,false);events.push('status');native.status(code);},
          createSocket(){assert.fail('No socket action delegated to runtime tests');},
        },'liveProfile',{get(){assert.fail('Local runtime inspected profile HTTP capability');}}));
      } },
      isCurrentDocument:()=>!disposed && realm.document===graph.f.document,
      presetEndpoint(field){presets++;graph.f.edit.inputValue(field).value=endpoint;},
      dispose(){assert.equal(active,false);assert.equal(graph.wasm.counts().sceneFrees,1);
        assert.equal(graph.wasm.counts().qualityFrees,1);disposed=true;events.push('host.dispose');},
    };
    const { startGamePage } = await graph.load('runtime.mjs');
    runtime = await startGamePage({realm,localHost,initialize(){initialized=true;},wasmApi:graph.wasm.api,
      hudReadout:true,ownedHudUi:true,ownedPlayUi:true,ownedLeaderboardUi:true});
    assert.equal(selectedBackdrop, sources.backgroundImage);
    assert.equal(skinBindings, 1, 'Rust policy is bound once after initialization and before source use');
    const seam = (await graph.load('stock-gameplay.mjs')).seam;
    assert.equal(claims,1);assert.equal(presets,1);assert.equal(seam.options.localSession,true);
    assert.equal('liveProfile' in seam.options,false);assert.equal(graph.f.sockets,0);
    const root=graph.f.document.getElementById('slither-client-root'), mount=root.children[4];
    const field=mount.children[0].children[1], nickname=mount.children[1].children[1], button=mount.children[2];
    assert.equal(graph.f.edit.inputValue(field).value,endpoint);
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,false);
    const status=()=>graph.f.edit.hud.character(mount.children[3].children[0]).data;
    const click=()=>{graph.f.edit.dispatch('click',{target:button,button:0,trusted:true});graph.f.flush();};
    graph.f.edit.inputValue(field).value='ws://127.0.0.1:19401/slither';click();
    assert.equal(status(),'Enter a valid server address.');assert.equal(seam.requests.length,0);
    graph.f.edit.inputValue(field).value=endpoint;graph.f.edit.inputValue(nickname).value='a'.repeat(25);click();
    assert.equal(status(),'Check the nickname.');assert.equal(seam.requests.length,0);
    graph.f.edit.inputValue(nickname).value=' Local ';
    click(); assert.equal(seam.requests.length,1);assert.equal(status(),'Connecting.');
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true);
    const request=seam.requests[0];
    assert.equal(request.endpoint,endpoint);assert.equal(request.profile,localHost.profile);
    assert.equal(request.nickname,' Local ');assert.equal(request.skin,0);assert.equal(request.customSkin.length,0);
    graph.f.frame(8);assert.equal(begins,1);assert.equal(ends,1);assert.equal(runtime.diagnostics().captureHeld,false);
    assert.equal(accessoryDraws, 1, 'The explicit source-bundle mode reaches the actual controller');
    seam.disconnect();
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true,'status stack never unlocks');
    graph.f.flush();assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,false);
    const enables=()=>graph.f.edit.ownedPlay.trace.filter(([name,,value])=>name==='buttonDisabled' && value===false).length;
    const before=enables();graph.f.frame(16);graph.f.flush();assert.equal(enables(),before,'idle publication unlocks once');
    click();assert.equal(seam.requests.length,2);assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true);
    seam.victory();graph.f.flush();
    assert.equal(graph.f.edit.hud.style(mount.style).get('display'),'none');
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true,'victory stays locked before return completes');
    graph.f.frame(24);assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true);
    seam.victory(true);
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true,'returned-victory status stack never unlocks');
    graph.f.flush();assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,false);
    assert.equal(graph.f.edit.hud.style(mount.style).get('display'),'block');
    assert.equal(runtime.diagnostics().gameplay.session.connected,true,'record victory can retain its connected socket');
    const returnedEnables=enables();graph.f.frame(32);graph.f.flush();assert.equal(enables(),returnedEnables);
    assert.equal(seam.requests.length,2,'return never starts another Play automatically');
    click();assert.equal(seam.requests.length,3);assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true);
    seam.fail();graph.f.flush();assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true,'failed session stays locked');
    // Caught reentry under a local adapter still poisons the existing source/native guard;
    // all owners release only after endOperation has cleared the held source.
    let caught=0;
    sourceHook=()=>{try{runtime.dispose();}catch{caught++;}};
    graph.f.frame(40);assert.equal(caught,1);assert.equal(begins,ends);
    assert.equal(runtime.diagnostics().disposed,true);assert.equal(runtime.diagnostics().captureHeld,false);
    assert.equal(events.at(-1),'host.dispose');assert.equal(events.filter(x=>x==='input').length,2);
    assert.equal(root.children.length,3);assert.equal(graph.f.raf.size,0);
    runtime.dispose();assert.equal(events.filter(x=>x==='host.dispose').length,1);
  });
});

test('local host rejects nonliteral or non-top-level documents before claim and initialization', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph=createGraph({armed:false});
    const { startGamePage }=await graph.load('runtime.mjs');
    for(const href of ['https://127.0.0.1:18884/','http://localhost:18884/',
      'http://127.0.0.1/','http://127.0.0.1:65536/','http://127.0.0.1:18884.evil.invalid/']) {
      const realm={location:{href}};realm.top=realm;
      const localHost={get gate(){assert.fail('Invalid local document reached claim');}};
      await assert.rejects(startGamePage({realm,localHost,initialize(){assert.fail('Unexpected initialize');},wasmApi:{}}),
        /literal top-level/);
    }
    const realm={location:{href:'http://127.0.0.1:18884/'},top:{}};
    await assert.rejects(startGamePage({realm,localHost:{},initialize(){},wasmApi:{}}),/literal top-level/);
  });
});
