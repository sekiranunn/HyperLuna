import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodePhaseDiagnostics,phaseCounterWindow,PHASE_COUNTERS} from '../advanced/phase-diagnostics.js';
import {HidTransport,LunaClient,packet,normalize,matches} from '../advanced/protocol.js';
import {decodeFeatures,VARIANTS} from '../advanced/features.js';
import {DemoDevice} from '../advanced/demo.js';
import {createOptions} from '../native/research.js';
import {Vue} from './helpers/bundled-vue.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
function response(values={},reason=0,version=1){
  const reply=new Uint8Array(60);reply.set([161,0,2,54,1,126,76,70,1,12,version,reason]);
  const view=new DataView(reply.buffer);PHASE_COUNTERS.forEach((key,index)=>view.setUint32(12+index*4,values[key]||0,true));return reply;
}
function clock(){
  let time=1000,sequence=0;const scheduled=new Map();
  return {now:()=>time,setTimeout(fn,delay){const id=++sequence;scheduled.set(id,{fn,delay});return id;},clearTimeout(id){scheduled.delete(id);},
    get pending(){return scheduled.size;},async next(elapsed=1000){const [id,row]=scheduled.entries().next().value;scheduled.delete(id);time+=elapsed;return row.fn();}};
}
async function editor(revision=3){
  globalThis.window={XviUpdater:class{}};
  const timer=clock(),options=createOptions(definitions,{acquireDeviceLock:async()=>()=>{},addHeaderEntry(){},phaseClock:timer});
  const vm=new Vue({...options,mounted:undefined,beforeDestroy:undefined});vm.$message={error(){},warning(){}};
  const device=new DemoDevice({independentDebounce:true,implementationRevision:revision});
  device.collections=[{usagePage:65535,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
  vm.acceptRisk();await vm.attach(device);const requests=[],send=device.sendFeatureReport.bind(device);
  device.sendFeatureReport=async(id,p)=>{requests.push([p[5],p[9]]);return send(id,p);};
  return {vm,device,timer,requests};
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
test('revision 2 does not issue a diagnostic request or start observation',async()=>{
  const {vm,timer,requests}=await editor(2);
  try{vm.startPhaseObservation();await vm.readPhaseSnapshot();assert.equal(timer.pending,0);assert.equal(vm.phaseObserving,false);assert.deepEqual(requests,[]);}
  finally{await vm.disconnect();vm.$destroy();}
});
test('opt-in observation samples one read per tick, pauses for editing and hidden pages, and keeps health counts separate',async()=>{
  const {vm,device,timer,requests}=await editor();
  try{
    assert.equal(timer.pending,0);vm.startPhaseObservation();await timer.next(0);assert.equal(vm.phaseWindow,null);
    device.phaseCounters[0]+=5;device.phaseCounters[3]+=3;device.phaseCounters[11]+=2;device.phaseReason=3;
    await timer.next();
    assert.equal(vm.phaseWindow.adjusted,5);assert.equal(vm.phaseWindow.skipped,3);assert.equal(vm.phaseWindow.frames,8);
    assert.equal(vm.phaseWindow.healthRescues,2);assert.equal(vm.phaseState,'上次调节跳过');assert.equal(vm.phaseLastReason,'SPI 忙');
    assert.deepEqual(requests,[[126,12],[126,12]]);
    vm.busy=true;await timer.next();assert.equal(requests.length,2);assert.equal(vm.phaseWindow,null);vm.busy=false;
    vm.draft.lead=97;await timer.next();assert.equal(requests.length,2);vm.draft.lead=80;
    let visible=false;vm.phasePageVisible=()=>visible;vm.phaseVisibilityChanged();assert.equal(timer.pending,0);assert.equal(vm.phaseObservationState,'观察已暂停');
    visible=true;vm.phaseVisibilityChanged();await timer.next();assert.equal(requests.length,3);assert.equal(vm.phaseWindow,null);
    await timer.next();assert.equal(vm.phaseObservationState,'等待新运动帧');
    assert.ok(requests.every(([command,op])=>command===126&&op===12));
    vm.stopPhaseObservation();assert.equal(timer.pending,0);
  }finally{await vm.disconnect();vm.$destroy();}
});
test('an in-progress producer cannot replace the last complete snapshot or its read time',async()=>{
  const {vm,device}=await editor();
  try{
    const snapshot=vm.phaseDiagnostics,at=vm.phaseDiagnosticReadAt;
    device.phaseDiagnosticVersion=0;device.phaseCounters[0]+=20;
    await vm.readPhaseSnapshot();assert.equal(vm.phaseDiagnostics,snapshot);assert.equal(vm.phaseDiagnosticReadAt,at);assert.equal(vm.phaseDiagnosticBusy,true);
    device.phaseDiagnosticVersion=1;await vm.readPhaseSnapshot();assert.equal(vm.phaseDiagnostics.adjusted,21);assert.equal(vm.phaseDiagnosticBusy,false);
  }finally{await vm.disconnect();vm.$destroy();}
});
test('disconnect invalidates an outstanding diagnostic read and cancels future polling',async()=>{
  const {vm,device,timer}=await editor();
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),send=device.sendFeatureReport.bind(device);
  device.sendFeatureReport=async(id,p)=>{if(p[5]===126&&p[9]===12){entered();await new Promise(resolve=>{release=resolve;});}return send(id,p);};
  try{
    vm.startPhaseObservation();const pending=timer.next(0);await waiting;
    const closing=vm.disconnect();release();await Promise.all([pending,closing]);
    assert.equal(vm.phaseDiagnostics,null);assert.equal(vm.phaseDiagnosticReadAt,0);assert.equal(vm.phaseObserving,false);assert.equal(timer.pending,0);
  }finally{await vm.disconnect();vm.$destroy();}
});
test('a diagnostic transport failure stops observation without changing configuration',async()=>{
  const {vm,device,timer}=await editor();
  try{
    const base=JSON.stringify(vm.base),draft=JSON.stringify(vm.draft);
    device.receiveFeatureReport=async()=>{throw Object.assign(Error('link lost'),{name:'NetworkError'});};
    vm.startPhaseObservation();await timer.next(0);
    assert.equal(vm.phaseObserving,false);assert.equal(timer.pending,0);assert.equal(vm.phaseDiagnosticError,'link lost');
    assert.equal(JSON.stringify(vm.base),base);assert.equal(JSON.stringify(vm.draft),draft);
  }finally{await vm.disconnect();vm.$destroy();}
});
