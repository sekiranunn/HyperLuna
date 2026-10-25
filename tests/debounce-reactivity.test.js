import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vue} from './helpers/bundled-vue.js';
import {createOptions} from '../native/research.js';
import {DemoDevice} from '../advanced/demo.js';
import {BUTTONS,buttonMask} from '../advanced/protocol.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
globalThis.window={XviUpdater:class {}};
async function editor(){
  const options=createOptions(definitions,{acquireDeviceLock:async()=>()=>{},addHeaderEntry(){}});
  const vm=new Vue({...options,mounted:undefined,beforeDestroy:undefined});
  vm.$message={error(){},warning(){}};
  const device=new DemoDevice({independentDebounce:true});
  device.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
  vm.acceptRisk();await vm.attach(device);
  return {vm,device};
}

async function toggleEveryButton(vm){
  const other={hyper:vm.legacy.hyper,tracking:vm.legacy.tracking};
  for(const {id} of BUTTONS){
    vm.selectedButton=id;await Vue.nextTick();
    let updates=0;const stop=vm.$watch(()=>vm.debounceDraft.enabled,()=>updates++);
    const before=vm.draft.buttons.map(button=>button.enabled);
    for(let click=0;click<4;click++){
      vm.debounceDraft.enabled=!vm.debounceDraft.enabled;
      await Vue.nextTick();
      assert.equal(updates,click+1,`button ${id}: every toggle must notify the rendered switch`);
      for(let key=0;key<5;key++)assert.equal(vm.draft.buttons[key].enabled,key===id?((click%2)?before[key]:!before[key]):before[key]);
      assert.deepEqual({hyper:vm.legacy.hyper,tracking:vm.legacy.tracking},other);
      assert.equal(vm.dirty,click%2===0,'the Apply button must update without toggling another control');
    }
    stop();
  }
}

test('live Vue connection and re-read keep all five debounce switches reactive and isolated',async()=>{
  const {vm}=await editor();
  try{
    assert.equal(vm.dirty,false);
    await toggleEveryButton(vm);
    await vm.readConfig();await toggleEveryButton(vm);
    await vm.disconnect();
    const device=new DemoDevice({independentDebounce:true});
    device.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
    await vm.attach(device);await toggleEveryButton(vm);
  }finally{await vm.disconnect();vm.$destroy();}
});

test('preset and save/readback preserve reactive per-button flags and timing fields',async()=>{
  const {vm,device}=await editor();
  try{
    vm.loadPreset();
    assert.equal('lead' in vm.draft,false);assert.equal('lock' in vm.draft,false);
    const baseline=vm.collectDraft();await vm.applySettings(baseline,structuredClone(vm.base));
    await toggleEveryButton(vm);
    vm.selectedButton=1;await Vue.nextTick();
    let timingUpdates=0;const stop=vm.$watch(()=>vm.debounceDraft.post,()=>timingUpdates++);
    vm.debounceDraft.post='2.3';await Vue.nextTick();
    assert.equal(timingUpdates,1);assert.equal(vm.draft.buttons[0].post,1.5);
    vm.debounceDraft.enabled=false;await Vue.nextTick();
    const draft=vm.collectDraft();
    assert.equal(buttonMask(draft.raw),29);
    await vm.applySettings(draft,structuredClone(vm.base));
    assert.equal(buttonMask(device.slots[0]),29);assert.equal(vm.dirty,false);
    assert.equal(vm.draft.buttons[1].post,2.3);assert.equal(vm.draft.buttons[1].enabled,false);
    vm.debounceDraft.enabled=true;await Vue.nextTick();assert.equal(vm.dirty,true);
    await vm.readConfig();assert.equal(vm.draft.buttons[1].enabled,false);assert.equal(vm.dirty,false);
    stop();
  }finally{await vm.disconnect();vm.$destroy();}
});
