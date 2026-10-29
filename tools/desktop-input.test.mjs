import {TestSessionPolicy} from './fixtures/session-policy-double.mjs';
// Normal Node checks use an explicit TEST ONLY ABI double, never a build.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{desktopInputSmoke}from'./desktop-input-smoke.mjs';import{TestDesktopInput}from'./fixtures/client-input-fixture.mjs';
import{createClientInput}from'../web/client-input.mjs';
import{desktopInputLifetimeSmoke}from'./desktop-input-lifetime-smoke.mjs';
test('staged input adapter matches retained policy through explicit authored ABI double',()=>{assert.ok(desktopInputSmoke({DesktopInput:TestDesktopInput}).comparisons>900);});
test('explicit test ABI releases once after callbacks and preserves construction/cleanup primaries',()=>{assert.ok(desktopInputLifetimeSmoke({DesktopInput:TestDesktopInput,SessionPolicy:TestSessionPolicy}).cases>15);});
test('production requires Rust capability and has no numeric policy fallback',()=>{
 assert.throws(()=>createClientInput(),/Rust desktop input capability/);
 const source=fs.readFileSync(new URL('../web/client-input.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/Math\.|lastTurnMs|lastBoostMs|lastHeadingMs|leftSteps|rightSteps|wantHeading|sentBoost/);
});
