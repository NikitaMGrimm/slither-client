// Explicit tools-only policy/host doubles; no build, browser or sockets.
import assert from 'node:assert/strict';
import test from 'node:test';
import {TestGameplayPolicy} from './fixtures/gameplay-policy-double.mjs';
import {TestStockControllerPolicy} from './fixtures/stock-controller-double.mjs';
import {TestSessionPolicy} from './fixtures/session-policy-double.mjs';
import {TestDesktopInput} from './fixtures/client-input-fixture.mjs';
import {ProfileLiteralParserDouble} from './fixtures/profile-literals-double.mjs';
import {HudHistoryDouble} from './hud-history-double.mjs';
import {LeaderboardHistoryDouble} from './leaderboard-history-double.mjs';
import {gameplayPolicySmoke,gameplayPolicyNumericSmoke,gameplayPolicyLifetimeSmoke,gameplayPolicyAdmissionSmoke} from './gameplay-policy-smoke.mjs';
const wasm={GameplayPolicy:TestGameplayPolicy,StockControllerPolicy:TestStockControllerPolicy,SessionPolicy:TestSessionPolicy,DesktopInput:TestDesktopInput,
  ProfileLiteralParser:ProfileLiteralParserDouble,HudHistory:HudHistoryDouble,LeaderboardHistory:LeaderboardHistoryDouble};
test('gameplay exact retained oracle differential with inert host effects',async()=>{const r=await gameplayPolicySmoke(wasm);assert(r.sequences>50);console.log('DOUBLE gameplay differential:',JSON.stringify(r));});
test('gameplay UTF-16 and Math.ceil boundaries',()=>assert.equal(gameplayPolicyNumericSmoke(wasm).cases,12));
test('gameplay new-owner cleanup and reentry lifetimes',async()=>assert.equal((await gameplayPolicyLifetimeSmoke(wasm)).cases,11));
test('gameplay capability precedence, partial cleanup and explicit injection',()=>assert.equal(gameplayPolicyAdmissionSmoke(wasm).cases,8));
test('negative controls reject unpaired publication, lost reentry poison, reset input and profile eligibility',async()=>{
  for(const P of[
    class DroppedPublication extends TestGameplayPolicy{publish_pending(){super.publish_pending();return false;}},
    class LostPoison extends TestGameplayPolicy{poison_reentry(){return false;}post_callback_fatal(){return false;}},
    class LostReset extends TestGameplayPolicy{lifecycle_done(){super.lifecycle_done(false);}},
    class PrematureCommitted extends TestGameplayPolicy{profile_ready(){this.phase=4;}},
  ])await assert.rejects(()=>gameplayPolicySmoke({...wasm,GameplayPolicy:P}),assert.AssertionError,P.name);
});
test('negative controls reject lossy UTF-16 and a changed ceiling rule',()=>{
  class Lossy extends TestGameplayPolicy{
    set_nickname(units){const text=new TextDecoder().decode(new TextEncoder().encode(String.fromCharCode(...units)));
      super.set_nickname(Uint16Array.from({length:text.length},(_,index)=>text.charCodeAt(index)));}
  }
  class Rounded extends TestGameplayPolicy{static css_ceil(value){return Math.round(value);}}
  for(const P of[Lossy,Rounded])assert.throws(()=>gameplayPolicyNumericSmoke({GameplayPolicy:P}),assert.AssertionError);
});
