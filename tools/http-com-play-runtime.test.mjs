// Actual gate/runtime/gameplay/session modules; native DOM and generated policy doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('HTTP-com genuine owned click stages privately and keeps reset/socket behind broker completion', async()=>{
  await runGameModuleTest(async({assert,createGraph})=>{
    const graph=createGraph({href:'http://slither.com/io',profileBroker:true,hudNative:true,ownedHudNative:true,ownedPlayNative:true});
    graph.hudWasm();
    const factory=await graph.load('runtime.mjs');
    const runtime=await factory.startGamePage({initialize(){},wasmApi:graph.wasm.api,hudReadout:true,
      ownedHudUi:true,ownedPlayUi:true,diagnosticUi:false,profileAuthority:Array(16).fill(1),profileGate:graph.f.gate});
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

test('private bootstrap and actual broker defeat public first-claim, then complete existing owned Play',async()=>{
  await runGameModuleTest(async({assert,createGraph,createProfileBroker,createExtensionLiveProfileAcquirer,ProfileLiteralParserDouble})=>{
    const g=createGraph({href:'http://slither.com/io',profileBroker:true,deferPrivateGate:true,hudNative:true,ownedHudNative:true,
      ownedPlayNative:true,leaderboardNative:true,minimapNative:true,
      prepareWasm(api,run){api.LeaderboardScoreProjector=run('(class {project(){throw Error("No startup leaderboard projection expected");} free(){}})');}
    });g.hudWasm();
    const page=await g.load('profile-receiver.mjs');
    const id='a'.repeat(32),privateKey=Array.from({length:16},(_,i)=>i+31),trace=[];
    const profile=g.profileNative(),base=profile.capabilities;
    const caps={...base,environment:()=>({origin:`chrome-extension://${id}`,topLevel:false,secureContext:true})};
    const sender={id,frameId:0,tab:{id:7},documentId:'synthetic-current-document',url:'http://slither.com/io',origin:'http://slither.com'};
    const api={runtime:{id,getURL:name=>`chrome-extension://${id}/${name}`},scripting:{async executeScript(injection){
      assert.deepEqual(injection.target,{tabId:7,documentIds:[sender.documentId]});assert.equal(injection.world,'MAIN');
      const stage=injection.args.length===1?'gate':injection.args.length===2?'bootstrap':injection.args[1];
      trace.push(stage);
      const result=await g.injectProfile(injection.func,injection.args);
      if(stage==='gate'&&result===true) {
        assert.throws(()=>g.f.gate.claim(id,Array(16).fill(7)),/Private gate authority required/);
        const publicRuntime=await g.load('runtime.mjs');
        await assert.rejects(publicRuntime.startGamePage({initialize(){},wasmApi:g.wasm.api,profileAuthority:Array(16).fill(7)}),/Private profile bootstrap required/);
        await assert.rejects(publicRuntime.startGamePage({initialize(){},wasmApi:g.wasm.api,profileAuthority:Array(16).fill(7),profileGate:g.f.gate}),/Private gate authority required/);
        g.f.host();g.f.complete();
      }
      if(injection.args[1]==='deliver') {g.f.frame();assert.equal(g.f.sockets,0,'acquiring fence remains until finish');}
      return[{frameId:0,documentId:sender.documentId,result}];
    }}};
    const create=()=>createProfileBroker({api,native:{now:()=>0,setTimeout:()=>1,clearTimeout(){},capabilities:caps},
      initialize:async()=>{},Parser:ProfileLiteralParserDouble,createAcquirer:createExtensionLiveProfileAcquirer,
      installGate:g.privateGateFunction,bootstrap:g.profileBootstrapFunction});
    let broker=create();
    const privateMessage=type=>({type,schema:1,activationId:id,authority:[...privateKey]});
    assert.equal(await broker(privateMessage('slither-client-profile-bootstrap'),sender),true);
    assert.equal(profile.counts.fetch,0,'bootstrap creates no profile attempt');
    const root=g.f.document.getElementById('slither-client-root');
    let mount;
    for(const child of root.children)if(child.children?.length>=4&&child.children[0].children?.[1]?.localName==='input')mount=child;
    assert(mount);const button=mount.children[2];
    g.f.edit.inputValue(mount.children[0].children[1]).value='ws://192.0.2.1:1234/slither';
    g.f.edit.inputValue(mount.children[1].children[1]).value='Synthetic';
    g.f.edit.dispatch('click',{target:button,button:0,trusted:true});g.f.flush();
    assert(g.f.messages.some(message=>message.type==='slither-client-profile-wake'));
    const attacker=Array(16).fill(7);
    assert.equal(page.claimPendingProfileBroker(attacker).accepted,false);
    assert.equal(page.deliverPendingProfileBroker('deliver',attacker,17,19,Array(20).fill(99)),false);
    assert.equal(page.deliverPendingProfileBroker('finish',attacker),false);
    assert.equal(profile.counts.fetch,0);assert.equal(g.f.sockets,0);
    broker=create(); // Worker restart before Play acquisition retains isolated document authority.
    const work=broker(privateMessage('slither-client-profile-wake'),sender);profile.respond();
    assert.equal(await work,true);assert.equal(profile.counts.fetch,1);
    await Promise.resolve();await Promise.resolve();g.f.flush();assert.equal(g.f.sockets,0);
    g.f.frame();assert.equal(g.f.sockets,1);
    await broker(privateMessage('slither-client-profile-wake'),sender);assert.equal(profile.counts.fetch,1);
    assert.deepEqual(trace.slice(0,5),['gate','bootstrap','claim','deliver','finish']);profile.assertWiped();
    g.f.event('pagehide');
  });
});

test('private bootstrap rejects a pre-existing page gate without claiming or starting it',async()=>{
  await runGameModuleTest(async({assert,createGraph,createProfileBroker})=>{
    const g=createGraph({href:'http://slither.com/io',profileBroker:true,deferPrivateGate:true});
    g.run(`Object.defineProperty(globalThis,Symbol.for('slither.client.gate.v1'),{value:{
      claim(){throw Error('Must not invoke a pre-existing page gate');}
    }});`);
    const id='a'.repeat(32),stages=[];
    const broker=createProfileBroker({api:{runtime:{id,getURL:n=>`chrome-extension://${id}/${n}`},
      scripting:{async executeScript(injection){stages.push(injection.args.length);return[{frameId:0,documentId:'synthetic',result:await g.injectProfile(injection.func,injection.args)}];}}},
      native:{now:()=>0,setTimeout:()=>1,clearTimeout(){}},initialize(){throw Error('No parser initialization');},installGate:g.privateGateFunction,bootstrap:g.profileBootstrapFunction});
    assert.equal(await broker({type:'slither-client-profile-bootstrap',schema:1,activationId:id,authority:Array(16).fill(37)},
      {id,frameId:0,tab:{id:7},documentId:'synthetic',origin:'http://slither.com',url:'http://slither.com/io'}),false);
    assert.deepEqual(stages,[1]);assert.equal(g.f.sockets,0);assert.equal(g.counts.initialize,0);
  });
});
