import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodePhaseDiagnostics,phaseCounterWindow,PHASE_COUNTERS} from './helpers/legacy-phase-diagnostics.js';
import {HidTransport,LunaClient,packet,normalize,matches} from '../advanced/protocol.js';
import {decodeFeatures,VARIANTS} from '../advanced/features.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
function response(values={},reason=0,version=1){
  const reply=new Uint8Array(60);reply.set([161,0,2,54,1,126,76,70,1,12,version,reason]);
  const view=new DataView(reply.buffer);PHASE_COUNTERS.forEach((key,index)=>view.setUint32(12+index*4,values[key]||0,true));return reply;
}
test('revision 3 diagnostic capabilities are accepted only for phase-capable variants',()=>{
  for(const [index,variant] of VARIANTS.entries()){
    const r=new Uint8Array(23);r[17]=index+1;r[18]=variant.mask;r[21]=3;r[22]=15;
    if(variant.debounce!=='none'){r[19]=2;r[20]=5;}
    if(variant.phase==='none'){assert.throws(()=>decodeFeatures(r));continue;}
    const feature=decodeFeatures(r);assert.equal(feature.phaseDiagnostics,true);assert.equal(feature.implementationRevision,3);
    for(const flags of [7,14,31]){r[22]=flags;assert.throws(()=>decodeFeatures(r));}
  }
});
test('diagnostic parser separates health recoveries, rejects malformed data and preserves a busy snapshot marker',()=>{
  const raw=response({adjusted:10,sensor_busy:2,capture_failed:1,frame_clock_recovered:3,health_clock_recovered:7},3);
  assert.ok(matches(raw,126,[76,70,1,12,0]));assert.equal(matches(raw.slice(0,59),126,[76,70,1,12,0]),false);
  const value=decodePhaseDiagnostics(raw);
  assert.deepEqual([value.adjusted,value.skipped,value.failed,value.frames,value.healthRescues,value.lastReason],[10,5,1,16,7,3]);
  assert.throws(()=>decodePhaseDiagnostics(raw.slice(0,59)));
  assert.throws(()=>decodePhaseDiagnostics(response({},11)));
  assert.throws(()=>decodePhaseDiagnostics(response({},0,2)));
  assert.deepEqual(decodePhaseDiagnostics(response({adjusted:1},0,0)),{busy:true});
  const empty=decodePhaseDiagnostics(response({health_clock_recovered:2},0,0));
  assert.equal(empty.lastReason,null);assert.equal(empty.frames,0);assert.equal(empty.healthRescues,2);
});
test('observation deltas handle uint32 wrap and reject power resets or stale intervals',()=>{
  const before=decodePhaseDiagnostics(response({adjusted:0xffffffff,sensor_busy:10}));
  const after=decodePhaseDiagnostics(response({adjusted:2,sensor_busy:12}));
  const window=phaseCounterWindow(before,after,1000);assert.equal(window.adjusted,3);assert.equal(window.skipped,2);
  assert.equal(phaseCounterWindow(before,decodePhaseDiagnostics(response()),1000),null);
  assert.equal(phaseCounterWindow(before,after,0),null);assert.equal(phaseCounterWindow(before,after,16000),null);
});
