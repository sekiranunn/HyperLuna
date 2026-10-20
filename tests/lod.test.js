import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lodHeight, lodLabel, lodHeightOptions} from '../advanced/lod.js';
import {DemoDevice} from '../advanced/demo.js';
import {createOptions} from '../native/research.js';

const definitions=JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json',import.meta.url)));
function view() {
  globalThis.window={XviUpdater:class {}};
  const options=createOptions(definitions,{});
  const context={...options.data(),$message:{error(){},warning(){}}};
  for(const [key,method] of Object.entries(options.methods))context[key]=method.bind(context);
  for(const [key,get] of Object.entries(options.computed))Object.defineProperty(context,key,{get:get.bind(context)});
  return context;
}
function device() {
  const result=new DemoDevice();
  result.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
  result.packets=[];const send=result.sendFeatureReport.bind(result);
  result.sendFeatureReport=async(id,packet)=>{result.packets.push([...packet]);await send(id,packet);};
  return result;
}

test('height labels include saved raw codes and avoid the reserved 1.2 mm code',()=>{
  for(const [code,height] of [[0,0.7],[0x87,0.7],[1,1],[0x85,1],[2,2],[0x8f,2]]){
    assert.equal(lodHeight(code),height);assert.equal(lodLabel(code),`${height.toFixed(1)} mm（0x${code.toString(16).toUpperCase().padStart(2,'0')}）`);
  }
  assert.equal(lodHeight(0x8a),1.5);assert.equal(lodLabel(0x8a),'约 1.5 mm（0x8A）');
  const choices=lodHeightOptions(0x8a);
  assert.equal(choices.length,23);
  for(const option of choices)assert.equal(lodHeight(option.value),parseFloat(option.label.replace('约 ','')));
  assert.ok(!choices.some(option=>option.label.includes('1.2')));
  assert.ok(choices.some(option=>option.value===0x87&&option.label==='0.7 mm（0x87）'));
  assert.equal(choices.find(option=>option.label==='约 3.0 mm（0x99）').value,0x99);
});

test('reading every saved LOD code preserves its exact byte, including aliases and unknown heights',()=>{
  const context=view(),raw=[...new DemoDevice().slots[0]],legacy=new DemoDevice().legacy[0];
  context.connected=true;
  for(let code=0;code<256;code++){
    context.setBase({raw,legacy:{...legacy,lod:code},slot:1,active:1});
    assert.equal(context.legacy.lod,code);
    assert.ok(context.lodOptions.some(option=>option.value===code));
    assert.equal(context.collectDraft().legacy.lod,code);
    assert.equal(context.dirty,false);
    context.draft.lead=84;
    assert.ok(!context.changeRows(context.collectDraft()).some(row=>row.name==='LOD 高度'));
  }
  assert.equal(lodHeight(0x59),null);assert.equal(lodLabel(0x59),'当前高度未知（0x59）');
});

test('height selection previews millimetres, writes one LOD setting, and verifies the saved code',async()=>{
  const context=view(),mouse=device();context.acceptRisk();await context.attach(mouse);
  const expected=structuredClone(context.base), before=mouse.packets.length;
  context.legacy.lod=context.lodOptions.find(option=>option.label==='约 1.3 mm（0x88）').value;
  const draft=context.collectDraft(),rows=context.changeRows(draft);
  assert.deepEqual(rows,[{name:'LOD 高度',before:'约 1.5 mm（0x8A）',after:'约 1.3 mm（0x88）'}]);
  await context.applySettings(draft,expected);
  const writes=mouse.packets.slice(before).filter(packet=>packet[4]===1&&packet[5]===8);
  assert.equal(writes.length,1);assert.deepEqual(writes[0].slice(6,8),[1,0x88]);
  assert.equal(mouse.legacy[0].lod,0x88);assert.equal(context.legacy.lod,0x88);assert.equal(context.dirty,false);
  await context.disconnect();
});
