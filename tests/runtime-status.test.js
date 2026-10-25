import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HidTransport,LunaClient,packet,normalize,matches,decodeProfile,encodeProfile} from '../advanced/protocol.js';
import {decodeFeatures,VARIANTS} from '../advanced/features.js';
import {DemoDevice} from '../advanced/demo.js';
import {createOptions} from '../native/research.js';
import {Vue} from './helpers/bundled-vue.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
const client=(device)=>new LunaClient(new HidTransport(device,{interval:1,timeout:12}),definitions);

test('revision 2 recognizes both release capabilities and rejects unknown flags',async()=>{
  const device=new DemoDevice({implementationRevision:2});
  await device.sendFeatureReport(0,packet(126,[76,70,1,0]));
  const reply=normalize(await device.receiveFeatureReport(0));
  assert.equal(reply.length,23);
  for(const [i,variant] of VARIANTS.entries()){
    const r=reply.slice();r[17]=variant.id;r[18]=variant.mask;
    if(variant.id===2){r[19]=2;r[20]=5;}else{r[19]=0;r[20]=0;}
    const features=decodeFeatures(r);
    assert.equal(features.name,variant.name);assert.equal(features.runtimeStatus,true);
    assert.equal(features.landingPolicy,variant.id===2);assert.equal(Boolean(features.perButtonDebounce),variant.id===2);
    assert.equal(Boolean(features.independentDebounce),variant.id===2);
    for(const offset of [21,22]){const bad=r.slice();bad[offset]^=128;assert.throws(()=>decodeFeatures(bad));}
  }
});

test('landing protection changes only negotiated profile bytes and preserves legacy reserved bytes',()=>{
  const old=Uint8Array.from([7,0,0,0,1,0,0,0,15,0,0,0,100,0,0xcd,0xef]);
  const draft={...decodeProfile(old),landingProtection:true};
  assert.deepEqual(encodeProfile(old,draft).slice(14),old.slice(14));
  const encoded=encodeProfile(old,draft,34,{landingPolicy:true});
  assert.deepEqual(encoded.slice(0,14),old.slice(0,14));assert.deepEqual([...encoded.slice(14)],[0,0]);
  draft.landingProtection=false;
  assert.deepEqual([...encodeProfile(old,draft,34,{landingPolicy:true}).slice(14)],[1,0]);
  assert.throws(()=>encodeProfile(old,{...draft,landingProtection:1},34,{landingPolicy:true}));
});

test('save confirmation waits through pending and bounded retries, then exposes permanent failures',async()=>{
  const device=new DemoDevice({implementationRevision:2}),c=client(device);await c.info();
  device.statusQueue=[1,0x13,0x23,2];device.invalidAges=0xFEDCBA98;device.clockPaused=1;
  const seen=[];
  const final=await c.waitForSave({interval:0,onStatus:s=>seen.push(s.save)});
  assert.deepEqual(seen,[1,3,3,2]);assert.equal(final.invalidAges,0xFEDCBA98);assert.equal(final.clockPaused,true);
  device.saveState=0x33;device.saveError=9;
  await assert.rejects(c.waitForSave(),/保存失败/);
  assert.equal((await c.runtimeStatus()).attempts,3);
  assert.equal((await c.retrySave({interval:0})).save,2);
  device.saveState=1;await assert.rejects(c.waitForSave({timeout:0}),/尚未确认/);
  await c.transport.close();
});

test('lost retry-save acknowledgement never causes a second mutation',async()=>{
  const device=new DemoDevice({implementationRevision:2}),c=client(device);await c.info();
  const send=device.sendFeatureReport.bind(device);let writes=0;
  device.sendFeatureReport=async(id,p)=>{await send(id,p);if(p[5]===126&&p[9]===11){writes++;device.reply.fill(0);}};
  const result=await c.retrySave({interval:0});
  assert.equal(writes,1);assert.equal(result.save,2);await c.transport.close();
});

test('runtime responses reject truncated packets and unsupported status values',async()=>{
  const device=new DemoDevice({implementationRevision:2}),c=client(device);await c.info();
  await device.sendFeatureReport(0,packet(126,[76,70,1,10,0]));
  const reply=normalize(await device.receiveFeatureReport(0));
  assert.ok(matches(reply,126,[76,70,1,10,0]));
  assert.ok(!matches(reply.slice(0,17),126,[76,70,1,10,0]));
  for(const [offset,value] of [[10,4],[10,0x43],[11,4],[12,2]]){
    const bad=reply.slice();bad[offset]=value;assert.throws(()=>c.decodeStatus(bad));
  }
  await c.transport.close();
});

async function editor(independent){
  globalThis.window={XviUpdater:class{}};
  const options=createOptions(definitions,{acquireDeviceLock:async()=>()=>{},addHeaderEntry(){}});
  const vm=new Vue({...options,mounted:undefined,beforeDestroy:undefined});
  vm.$message={error(){},warning(){}};
  const device=new DemoDevice({perButtonDebounce:true,independentDebounce:independent,implementationRevision:2});
  device.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
  vm.acceptRisk();await vm.attach(device);return{vm,device};
}

test('shared and independent editors preserve other switches and confirm flash before claiming saved',async()=>{
  for(const independent of [false,true]){
    const{vm,device}=await editor(independent);
    try{
      const other={tracking:vm.legacy.tracking,hyper:vm.legacy.hyper};
      vm.selectedButton=1;vm.debounceDraft.post=2.3;
      if(independent)vm.debounceDraft.enabled=false;else vm.draft.debounce=false;
      vm.draft.landingProtection=false;await Vue.nextTick();assert.equal(vm.dirty,true);
      assert.deepEqual({tracking:vm.legacy.tracking,hyper:vm.legacy.hyper},other);
      const draft=vm.collectDraft();device.saveState=0x33;
      await assert.rejects(vm.applySettings(draft,structuredClone(vm.base)),/保存失败/);
      assert.equal(vm.runtime.save,3);assert.ok(!vm.message.includes('设置已保存'));
      await vm.retrySave();assert.equal(vm.runtime.save,2);assert.equal(vm.message,'设置已保存，回读核对通过。');
      assert.equal(vm.draft.landingProtection,false);assert.equal(vm.draft.buttons[1].post,2.3);
      if(independent)assert.equal(vm.draft.buttons[1].enabled,false);else assert.equal(vm.draft.debounce,false);
      if(!independent){const bottom={...vm.base.buttons[5]};vm.loadPreset();assert.deepEqual(vm.draft.buttons[5],bottom);}
    }finally{await vm.disconnect();vm.$destroy();}
  }
});

