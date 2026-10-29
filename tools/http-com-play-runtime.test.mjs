// Actual gate/runtime/gameplay/session modules; native DOM and generated policy doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('HTTP-com genuine owned click stages privately and keeps reset/socket behind broker completion', async()=>{
  await runGameModuleTest(async({assert,createGraph})=>{
    const graph=createGraph({href:'http://slither.com/io',profileBroker:true,hudNative:true,ownedHudNative:true,ownedPlayNative:true});
    graph.hudWasm();
    const factory=await graph.load('runtime.mjs');
    const runtime=await factory.startGamePage({initialize(){},wasmApi:graph.wasm.api,hudReadout:true,
      ownedHudUi:true,ownedPlayUi:true,diagnosticUi:false});
    const receiver=await graph.load('profile-receiver.mjs');
    const mount=graph.f.document.getElementById('slither-client-root').children.at(-1);
    const endpoint=mount.children[0].children[1],nickname=mount.children[1].children[1],button=mount.children[2];
    graph.f.edit.inputValue(endpoint).value='ws://192.0.2.1:1234/slither';
    graph.f.edit.inputValue(nickname).value='Synthetic';
    assert.equal(runtime.diagnostics().gameplay.profilePhase,'idle');
    assert.equal(receiver.claimPendingProfileBroker(Array(16).fill(1)).accepted,false);
    graph.f.edit.dispatch('click',{target:button,button:0,trusted:false});graph.f.flush();
    assert.equal(receiver.claimPendingProfileBroker(Array(16).fill(1)).accepted,false);
    graph.f.edit.dispatch('click',{target:button,button:0,trusted:true});graph.f.flush();
    assert.equal(runtime.diagnostics().gameplay.profilePhase,'acquiring');assert.equal(graph.f.sockets,0);
    assert.equal(receiver.claimPendingProfileBroker(Array(16).fill(1)).accepted,true);
    assert.equal(receiver.claimPendingProfileBroker(Array(16).fill(1)).accepted,false);
    assert.equal(receiver.deliverPendingProfileBroker('deliver',Array(16).fill(2),17,19,Array(20).fill(0)),false);
    assert.equal(receiver.deliverPendingProfileBroker('deliver',Array(16).fill(1),17,19,Array(20).fill(0)),true);
    graph.f.frame();assert.equal(graph.f.sockets,0,'staged profile still holds acquisition draw fence');
    assert.equal(receiver.deliverPendingProfileBroker('finish',Array(16).fill(1)),true);
    await Promise.resolve();await Promise.resolve();graph.f.flush();
    assert.equal(graph.f.sockets,0,'completion alone cannot construct socket');
    graph.f.frame();assert.equal(graph.f.sockets,1,'only existing next complete controller operation commits socket');
    runtime.dispose();
  });
});

test('HTTP-com without Chrome broker arm retains unavailable default Play', async()=>{
  await runGameModuleTest(async({assert,createGraph})=>{
    const graph=createGraph({href:'http://slither.com/io',hudNative:true,ownedHudNative:true,ownedPlayNative:true});graph.hudWasm();
    const runtime=await(await graph.load('runtime.mjs')).startGamePage({initialize(){},wasmApi:graph.wasm.api,
      hudReadout:true,ownedHudUi:true,ownedPlayUi:true,diagnosticUi:false});
    const mount=graph.f.document.getElementById('slither-client-root').children.at(-1);
    assert.equal(graph.f.edit.ownedPlay.buttonState(mount.children[2]).disabled,true);
    assert.equal(graph.f.sockets,0);runtime.dispose();
  });
});
