import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeFeatures,VARIANTS} from '../advanced/features.js';
import {HidTransport,LunaClient,decodeProfile,encodeProfile} from '../advanced/protocol.js';
import {DemoDevice} from '../advanced/demo.js';
import {createOptions} from '../native/research.js';
import {Vue} from './helpers/bundled-vue.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
test('revision 25 exposes only stable non-phase IDs and rejects retired firmware',()=>{
  assert.deepEqual(VARIANTS.map(v=>v.id),[2,6]);
  for(const [id,mask,schema,keys] of [[2,41,2,5],[6,1,0,0]]){
    const r=Uint8Array.from([161,0,0,17,1,126,76,70,1,0,76,70,51,51,1,34,32,id,mask,schema,keys,25,7]);
    const f=decodeFeatures(r);assert.equal(f.implementationRevision,25);assert.equal(f.runtimeStatus,true);
    for(const key of ['phase','phaseDiagnostics','phaseAudit','phaseReference'])assert.equal(f[key],undefined);
    for(const [old,cap] of [[1,43],[3,213],[4,133],[5,5]]){
      const retired=r.slice();retired[17]=old;retired[18]=cap;assert.throws(()=>decodeFeatures(retired));
    }
  }
});
test('profile edits never expose or transmit removed parameters',()=>{
  const raw=Uint8Array.from([7,1,80,0,1,159,0,0,15,0,0,0,100,0,1,0]);
  const value=decodeProfile(raw);assert.equal('lock' in value,false);assert.equal('lead' in value,false);
  const out=encodeProfile(raw,{...value,lock:true,lead:1000});
  assert.deepEqual([...out.slice(1,4)],[0,0,0]);
  assert.deepEqual([...raw.slice(1,4)],[1,80,0]);
  for(let i=0;i<16;i++)if(i<1||i>=4)assert.equal(out[i],raw[i]);
});
test('native editor has no removed controls; reads stay read-only and presets cannot enable them',async()=>{
  globalThis.window={XviUpdater:class{}};
  const options=createOptions(definitions,{acquireDeviceLock:async()=>()=>{},addHeaderEntry(){}});
  const vm=new Vue({...options,mounted:undefined,beforeDestroy:undefined});
  vm.$message={error(){},warning(){}};
  const device=new DemoDevice();
  device.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
  const requests=[];const send=device.sendFeatureReport.bind(device);
  device.sendFeatureReport=async(id,packet)=>{requests.push([...packet]);return send(id,packet);};
  try{
    vm.acceptRisk();await vm.attach(device);await vm.readConfig();
    assert.equal(vm.connected,true);assert.equal(vm.features.implementationRevision,25);
    assert.equal(vm.draft.buttons.length,5);assert.equal(vm.dirty,false);
    assert.ok(!requests.some(p=>p[5]===126&&[2,4,6,9,11,12,13,14,15,16].includes(p[9])));
    vm.loadPreset();assert.equal('lock' in vm.draft,false);assert.equal('lead' in vm.draft,false);
    const request=vm.collectDraft();assert.deepEqual([...request.raw.slice(1,4)],[0,0,0]);
    assert.equal(request.raw[0],7);assert.equal(request.legacy.polling,64);
    for(const file of ['native/research.html','native/research.js','advanced/features.js','i18n.js']){
      const text=readFileSync(new URL('../'+file,import.meta.url),'utf8');
      assert.ok(!/draft\.(?:lock|lead)|features\.phase|phaseLead|相位调节|提前量/.test(text),file);
    }
  }finally{await vm.disconnect();vm.$destroy();}
});
test('save-state verification remains available without retired diagnostic operations',async()=>{
  const device=new DemoDevice(),c=new LunaClient(new HidTransport(device,{interval:1}),definitions);
  try{
    await c.info();const status=await c.runtimeStatus();assert.equal(status.save,2);assert.equal('phase' in status,false);
    for(const op of [12,13,14,15,16])await assert.rejects(c.extension(op,0));
    device.statusQueue=[1,2];assert.equal((await c.waitForSave({interval:0})).save,2);
  }finally{await c.transport.close();}
});
