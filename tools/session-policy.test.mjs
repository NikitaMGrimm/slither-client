// Normal Node execution: explicit test-only ABI, no Wasm build/browser requirement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TestSessionPolicy} from './fixtures/session-policy-double.mjs';
import {TestDesktopInput} from './fixtures/client-input-fixture.mjs';
import {sessionPolicyLifetimeSmoke} from './session-policy-lifetime-smoke.mjs';
import {createStockSession} from '../web/stock-session.mjs';
test('session owner releases once, defers active resource release and preserves exact errors',()=>{assert.ok(sessionPolicyLifetimeSmoke({SessionPolicy:TestSessionPolicy,DesktopInput:TestDesktopInput}).cases>=12);});
test('production session requires explicit Rust owner and contains no lifecycle numeric fallback',()=>{assert.throws(()=>createStockSession({wasm:{encode_login(){},solve_challenge(){},decode_frame(){},setup_protocol_version(){}},createSocket(){},now(){}}),/SessionPolicy/);const source=fs.readFileSync(new URL('../web/stock-session.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/let phase|let connected|let playing|lastPingMs\s*=|returnFraction\s*[-+]=|3333|1600|0\.004|0\.05|750|250/);});

import {sessionPolicySmoke,sessionProtocolDouble} from './session-policy-smoke.mjs';
test('staged session matches full retained authored session effects and callback observations',()=>{const result=sessionPolicySmoke({...sessionProtocolDouble(),SessionPolicy:TestSessionPolicy});assert.ok(result.comparisons>1000);});
test('negative control rejects lifecycle commit before packet success',()=>{class Early extends TestSessionPolicy{prepare_controls(...args){const result=super.prepare_controls(...args);super.commit_controls();return result;}}assert.throws(()=>sessionPolicySmoke({...sessionProtocolDouble(),SessionPolicy:Early}));});
test('negative control rejects a ping intent without its pre-callback commit',()=>{class Dropped extends TestSessionPolicy{commit_ping(){}}assert.throws(()=>sessionPolicySmoke({...sessionProtocolDouble(),SessionPolicy:Dropped}));});
