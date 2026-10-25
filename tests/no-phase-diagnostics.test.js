import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOptions} from '../native/research.js';
import {DemoDevice} from '../advanced/demo.js';
import {decodeFeatures} from '../advanced/features.js';
import {LunaClient} from '../advanced/protocol.js';
import {Vue} from './helpers/bundled-vue.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
for(const revision of [23,24]) test(`revision ${revision} retains phase and five-key configuration without diagnostic capabilities`,()=>{
  const reply=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,1,43,2,5,revision,7]);
  const value=decodeFeatures(reply);
  assert.equal(value.phase,'saved');assert.equal(value.runtimeStatus,true);
  assert.equal(value.buttonCount,5);assert.equal(value.independentDebounce,true);
  for(const key of ['phaseDiagnostics','phaseAudit','phaseReference'])assert.equal(value[key],undefined);
  for(const flags of [15,31,255]){reply[22]=flags;assert.throws(()=>decodeFeatures(reply));}
  assert.equal(LunaClient.prototype.phaseDiagnostics,undefined);
});
test('connecting and reloading configuration never request phase diagnostic pages',async()=>{
  globalThis.window={XviUpdater:class{}};
  const options=createOptions(definitions,{acquireDeviceLock:async()=>()=>{},addHeaderEntry(){}});
  const vm=new Vue({...options,mounted:undefined,beforeDestroy:undefined});
  vm.$message={error(){},warning(){}};
  const device=new DemoDevice({implementationRevision:24,variantId:1,independentDebounce:true});
  device.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
  const requests=[];const send=device.sendFeatureReport.bind(device);
  device.sendFeatureReport=async(id,packet)=>{requests.push([...packet]);return send(id,packet);};
  try{
    vm.acceptRisk();await vm.attach(device);await vm.readConfig();
    assert.equal(vm.connected,true);assert.equal(vm.features.implementationRevision,24);
    assert.equal(vm.draft.buttons.length,5);assert.equal(vm.draft.lead,80);
    assert.equal(vm.startPhaseObservation,undefined);assert.equal(vm.refreshPhaseStatus,undefined);
    assert.ok(!requests.some(raw=>raw[5]===126&&raw[9]>=12&&raw[9]<=16));
    assert.ok(requests.some(raw=>raw[5]===126&&raw[9]===10)); // save-state verification remains
  }finally{await vm.disconnect();vm.$destroy();}
});
test('phase configuration remains visible while observer and status controls are absent',()=>{
  const template=readFileSync(new URL('../native/research.html',import.meta.url),'utf8');
  assert.match(template,/v-model="draft.lock"/);assert.match(template,/v-model="draft.lead"/);
  for(const value of ['refreshPhaseStatus','phaseObserving','phaseMetricRows','phaseCountRows'])assert.ok(!template.includes(value));
});
