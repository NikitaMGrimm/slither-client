// Authored inert requirements. No browser, Wasm, socket, HTTP or source acquisition.
import assert from 'node:assert/strict';
import test from 'node:test';
import {connectingStatusSmoke, connectingStatusScalarSmoke} from './connecting-status-smoke.mjs';
import {TestGameplayPolicy} from './fixtures/gameplay-policy-double.mjs';
import {TestStockControllerPolicy} from './fixtures/stock-controller-double.mjs';
import {TestSessionPolicy} from './fixtures/session-policy-double.mjs';
import {TestDesktopInput} from './fixtures/client-input-fixture.mjs';
import {ProfileLiteralParserDouble} from './fixtures/profile-literals-double.mjs';
import {HudHistoryDouble} from './hud-history-double.mjs';
import {LeaderboardHistoryDouble} from './leaderboard-history-double.mjs';
import {runGameModuleTest} from './game-module-test-fixture.mjs';
const wasm = {GameplayPolicy:TestGameplayPolicy, StockControllerPolicy:TestStockControllerPolicy,
  SessionPolicy:TestSessionPolicy, DesktopInput:TestDesktopInput, ProfileLiteralParser:ProfileLiteralParserDouble,
  HudHistory:HudHistoryDouble, LeaderboardHistory:LeaderboardHistoryDouble};

test('deferred opening retains busy through real adapters until Setup or a terminal change', () => {
  assert.equal(connectingStatusSmoke(wasm).cases, 7);
});
test('copied status signature carries phase strings and preserves old numeric precedence', () => {
  assert.equal(connectingStatusScalarSmoke(wasm).cases, 20);
});
test('runtime retains connection busy through deferred opening/challenge/setup, loading handoff and terminal states', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    for (const ownedLoadingUi of [false,true]) for (const terminal of ['close','error']) {
      const graph = createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true}); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({...native,liveProfile:profile.capabilities}));
      const {startGamePage} = await graph.load('runtime.mjs');
      const runtime = await startGamePage({realm,initialize(){},wasmApi:graph.wasm.api,hudReadout:true,
        ownedHudUi:true,ownedPlayUi:true,ownedLoadingUi,diagnosticUi:false});
      try {
        const root = graph.f.document.getElementById('slither-client-root'), panel = root.children.at(-1);
        const endpoint=panel.children[0].children[1], button=panel.children[2];
        const label=ownedLoadingUi ? panel.children[3].children[0] : panel.children[3];
        const progress=ownedLoadingUi ? label.children[1] : null;
        const text=()=>graph.f.edit.hud.character(label.children[0]).data;
        const busy=phase=>{
          assert.equal(runtime.diagnostics().gameplay.session.phase,phase);
          assert.equal(text(),'Connecting.');
          assert.equal(graph.f.edit.hud.character(button.children[0]).data,'Connecting…');
          assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true);
          if(progress)assert.equal(graph.f.edit.hud.style(progress.style).get('display'),'inline-block');
          assert.equal(graph.f.edit.hud.style(panel.style).get('cursor'),'progress');
          assert.equal(graph.f.messages.at(-1).code,'connecting');
          if(ownedLoadingUi)assert.equal(graph.f.edit.hud.style(root.children[0].style).get('display'),'none');
        };
        assert.equal(text(),'Ready.');
        graph.f.edit.inputValue(endpoint).value='ws://192.0.2.1:1234/slither';
        graph.f.edit.dispatch('click',{target:button,button:0,trusted:true}); graph.f.flush();
        assert.equal(text(),'Preparing connection.'); assert.equal(graph.f.sockets,0);
        profile.respond(); await profile.settle(); graph.f.flush();
        busy('opening'); assert.equal(graph.f.sockets,0,'status change alone cannot construct');
        graph.f.frame(8); graph.f.flush(); busy('opening'); assert.equal(graph.f.sockets,1);
        graph.f.socket.open(); graph.f.flush(); busy('challenge');
        graph.message([54,1]); graph.f.flush(); busy('setup');
        graph.message([97,...new Array(24).fill(0)]); graph.f.flush();
        assert.equal(text(),'Connected.'); assert.equal(runtime.diagnostics().gameplay.session.connected,true);
        if(progress)assert.equal(graph.f.edit.hud.style(progress.style).get('display'),'none');
        assert.equal(graph.f.edit.hud.style(panel.style).get('display'),'none');
        if(terminal==='close')graph.f.socket.onclose(); else graph.f.socket.onerror(new Error('Authored inert socket failure'));
        graph.f.flush();
        if(terminal==='close'){
          assert.equal(text(),'Not connected.');
          assert.equal(runtime.diagnostics().gameplay.session.phase,'disconnected');
          assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled,true,'terminal close grants no new profile attempt');
        } else assert.equal(runtime.diagnostics().disposed,true);
        assert.equal(graph.f.sockets,1,'no automatic reconnect');
      } finally { runtime.dispose(); profile.assertWiped(); }
    }
  });
});
// Inert getter-order witnesses replace only the imported session capability with
// a labelled scratch module. All gameplay adapter code executes unchanged.
import fs from 'node:fs';
import {createGameplayComposition} from './fixtures/gameplay-composition-fixture.mjs';
import {createStockGameplay as gameplayAdapter} from '../web/stock-gameplay.mjs';
import {createStockGameplay as legacyGameplay} from './fixtures/stock-gameplay-oracle.mjs';

test('legacy oracle remains immutable: only pending status payload intentionally differs', () => {
  function fixture(create) {
    const statuses=[];
    const f=createGameplayComposition(create,wasm,{configure(options){
      const previous=options.onStatus;options.onStatus=code=>{previous(code);statuses.push(code);};
    }});
    return {...f,statuses};
  }
  const old=fixture(legacyGameplay),next=fixture(gameplayAdapter);
  try {
    for (const f of[old,next]){f.h.gameplay.play(f.login());f.h.flush();}
    const sameState=()=>{
      assert.deepEqual(next.h.gameplay.diagnostics(),old.h.gameplay.diagnostics());
      assert.deepEqual(next.h.trace,old.h.trace);
      assert.deepEqual(next.h.sockets.map(s=>s.sent),old.h.sockets.map(s=>s.sent));
    };
    for(const advance of[
      ()=>{},
      f=>f.h.gameplay.frame(8),
      f=>f.h.sockets[0].open(),
      f=>f.h.sockets[0].message([54,1]),
    ]){
      for(const f of[old,next]){advance(f);f.h.flush();}
      assert.equal(old.statuses.at(-1),'disconnected');
      assert.equal(next.statuses.at(-1),'connecting');sameState();
    }
    for(const f of[old,next]){f.h.sockets[0].message([97,3]);f.h.flush();}
    assert.equal(old.statuses.at(-1),'connected');assert.equal(next.statuses.at(-1),'connected');sameState();
  } finally {for(const f of[old,next]){f.h.gameplay.dispose();f.h.controller.dispose();}}
});

test('status captures phase once and short-circuits connected after the ready observation', async () => {
  const sessionSource=`export const witness={};
    export const stockEndpoint=value=>value;
    export function createStockSession(){return {
      subscribe(observer){observer.state();return ()=>{witness.cleanup.push('unsubscribe');};},
      snapshot(){return witness.snapshot;},pendingActions(){return {actions:{}};},
      dispose(){witness.cleanup.push('session-free');}
    };}`;
  const sessionUrl='data:text/javascript;base64,'+Buffer.from(sessionSource).toString('base64');
  const original=fs.readFileSync(new URL('../web/stock-gameplay.mjs',import.meta.url),'utf8');
  const source=original.replace(/from '(\.\/[^']+)'/g,(_match,specifier)=>'from '+JSON.stringify(
    specifier==='./stock-session.mjs'?sessionUrl:new URL('../web/'+specifier.slice(2),import.meta.url).href));
  const {createStockGameplay}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const {witness}=await import(sessionUrl);
  for(const phase of['ready','opening','challenge','setup','disconnected']){
    const reads=[],pending=[],errors=[];let phaseReads=0;
    witness.cleanup=[];
    witness.snapshot={uiTimerNeeded:false,
      get connected(){reads.push('connected');if(phase==='ready'&&phaseReads)throw undefined;return false;},
      get phase(){reads.push('phase');assert.equal(++phaseReads,1,'phase observed exactly once');return phase;},
    };
    class Policy extends TestGameplayPolicy{
      static status(phase,connected){reads.push(['status',phase,connected]);return super.status(phase,connected);}
    }
    const owner=createStockGameplay({wasm:{...wasm,GameplayPolicy:Policy},scene:{control_view(){},set_connected(){},reset_lag(){}},
      quality:{begin_connection(){}},controller:{packet(){},frame(){}},
      createSocket(){assert.fail('Getter witness constructs no socket');},now:()=>0,defer:fn=>pending.push(fn),
      setInterval(){assert.fail('No UI timer');},clearInterval(){},onStatus:code=>reads.push(['callback',code]),onFatal:error=>errors.push(error)});
    try{
      while(pending.length)pending.shift()();
      const expected=phase==='ready'?'ready-not-connected':phase==='disconnected'?'disconnected':'connecting';
      assert.deepEqual(reads,['connected','phase',...(phase==='ready'?[]:['connected']),['status',phase,false],['callback',expected]]);
      assert.deepEqual(errors,[]);
    } finally {owner.dispose();}
    assert.deepEqual(witness.cleanup,['unsubscribe','session-free']);
  }
});

test('connection-status callback preserves an exact thrown undefined through deferred release', () => {
  const f=createGameplayComposition(gameplayAdapter,wasm,{configure(options){
    const previous=options.onStatus;options.onStatus=code=>{previous(code);if(code==='connecting')throw undefined;};
  }});
  try {
    f.h.gameplay.play(f.login());f.h.flush();
    assert.deepEqual(f.h.errors,[undefined]);
    assert.equal(f.h.gameplay.diagnostics().disposed,true);
    assert.equal(f.h.sockets.length,0);
  } finally {f.h.gameplay.dispose();f.h.controller.dispose();}
});

test('negative control rejects the old disconnected result for a pending connection', () => {
  class DroppedBusy extends TestGameplayPolicy{
    static status(phase,connected){return phase==='ready'?1:connected?2:3;}
  }
  assert.throws(()=>connectingStatusSmoke({...wasm,GameplayPolicy:DroppedBusy}),assert.AssertionError);
});
