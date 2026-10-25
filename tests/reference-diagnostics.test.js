import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeReferenceDiagnostics,phaseCounterWindow} from './helpers/legacy-phase-diagnostics.js';
import {decodeFeatures,VARIANTS} from '../advanced/features.js';
import {HidTransport,LunaClient,matches} from '../advanced/protocol.js';
import {translate} from '../i18n.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/reference-diagnostics.json',import.meta.url)));
const bytes=name=>Uint8Array.from(Buffer.from(fixture[name],'hex'));

test('revision 4 capabilities accept exactly the installed reference ABI for phase variants',()=>{
  assert.equal(fixture.provenance.actual_thumb_diagnostic_query_executed,true);
  const actual=decodeFeatures(bytes('info'));
  assert.equal(actual.name,'ABLODLOCKDB');assert.equal(actual.stats,false);
  assert.equal(actual.phaseReference,true);assert.equal(actual.phaseDiagnostics,true);
  for(const [i,variant] of VARIANTS.entries()){
    const raw=bytes('info');raw[17]=i+1;raw[18]=variant.mask;
    if(variant.debounce==='none'){raw[19]=0;raw[20]=0;}
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(raw));continue;}
    assert.equal(decodeFeatures(raw).phaseReference,true);
    for(const flags of [7,15,30,255]){raw[22]=flags;assert.throws(()=>decodeFeatures(raw));}
  }
});

test('decode real ARM query output, including unsigned counts, signed correction and reference loss',()=>{
  const waiting=decodeReferenceDiagnostics(bytes('waiting'));
  assert.equal(waiting.state,1);assert.equal(waiting.valid,false);assert.equal(waiting.accepted,0);
  const locked=decodeReferenceDiagnostics(bytes('locked'));
  assert.deepEqual([locked.state,locked.period,locked.lead,locked.lastError,locked.pending,locked.accepted],
    [3,250,80,-7,-3,0xfffffffe]);
  assert.deepEqual([locked.captureValid,locked.valid,locked.confidence],[true,true,4]);
  const holdover=decodeReferenceDiagnostics(bytes('holdover'));
  assert.equal(holdover.state,4);assert.equal(holdover.valid,false);assert.equal(holdover.pending,0);
  assert.ok(matches(bytes('locked'),126,[76,70,1,13]));
  assert.equal(matches(bytes('locked').slice(0,51),126,[76,70,1,13]),false);
  assert.equal(phaseCounterWindow(locked,holdover,1000).accepted,3);
  assert.equal(phaseCounterWindow(holdover,waiting,1000),null);
});

test('reference parser rejects incompatible envelopes and impossible locked state',()=>{
  const bad=[bytes('locked').slice(0,51)];
  for(const [at,value] of [[3,45],[9,12],[10,2],[11,2],[14,1],[25,0],[26,3],[27,5],[16,125]]){
    const raw=bytes('locked');raw[at]=value;bad.push(raw);
  }
  for(const raw of bad)assert.throws(()=>decodeReferenceDiagnostics(raw));
});

