import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {patchOfficialScanRate} from '../patches/official-scan-rate.mjs';
import {patchAssetPaths} from '../patches/asset-paths.mjs';
import {removeFirmwareUi, removeFirmwareSdkMethods} from '../patches/remove-firmware.mjs';
import {DemoDevice} from '../advanced/demo.js';

const root = new URL('../', import.meta.url);
const original = readFileSync(new URL('official/js/app.1c5e5052.js', root), 'utf8');
const generated = readFileSync(new URL('native/official-app.js', root), 'utf8');
const sdk = removeFirmwareSdkMethods(readFileSync(new URL('official/js/output.xvi3.min.js', root), 'utf8'));
function component(source, storage) {
  const start = source.indexOf('He=[],Oe=') + 'He=[],Oe='.length;
  const end = source.indexOf(',We=Oe,Je=', start);
  assert.ok(start > 0 && end > start);
  return new Function('u', 'localStorage', 'console', `return (${source.slice(start, end)});`)(
    () => '', storage, {log(){}, error(error){throw error;}});
}
function instance(card, device, updater) {
  const context = {...card.data(), xviUpdater:updater, events:[], $emit(name,value){this.events.push({name,value});}};
  for (const [key,method] of Object.entries(card.methods)) context[key] = method.bind(context);
  card.watch.device.handler.call(context, device);
  return context;
}
const forbiddenStorage = {
  getItem(){throw Error('scan-rate cache must not be read');},
  setItem(){throw Error('scan-rate cache must not be written');}
};
function realUpdater(device, wired) {
  const window = {};
  vm.runInNewContext(sdk, {window, navigator:{hid:{}}, console:{log(){},error(error){throw error;}}, setTimeout});
  const updater = new window.XviUpdater();
  updater.setReportDevice = device;
  updater.isWired = wired;
  updater.mySleep = async () => {};
  return updater;
}
function recordingDevice() {
  const device = new DemoDevice();
  const send = device.sendFeatureReport.bind(device);
  device.packets = [];
  device.sendFeatureReport = async (id,packet) => {
    device.packets.push(Array.from(packet));
    return send(id,packet);
  };
  return device;
}
function scanWrites(device) {return device.packets.filter(p=>p[4]===0&&p[5]===0x1f);}

test('original wired mount reproduces the persistent 1 kHz write and browser-only restore', async () => {
  const saved=new Map(), storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v))};
  const old=component(original,storage), device={modelCN:'LUNA33',isWiredConnection:true,profileID:1,scanRateSelectValue:64};
  let scan=64;
  const wired=instance(old,device,{async setScanRate(slot,value){scan=value;}});
  await old.mounted.call(wired);
  assert.equal(scan,1);
  assert.equal(saved.get('scanRateSelectValueFalse'),'64');
  // Closing the page and unplugging has no JavaScript left to restore scan.
  assert.equal(scan,1);
  const wireless=instance(old,{...device,isWiredConnection:false,scanRateSelectValue:scan},{async setScanRate(slot,value){scan=value;}});
  await old.mounted.call(wireless);
  assert.equal(scan,64);
});

test('generated official app contains the fix and rejects changed vendor source', () => {
  assert.ok(generated===removeFirmwareUi(patchAssetPaths(patchOfficialScanRate(original))),'Generated settings app matches the scan-rate and firmware-removal patches');
  assert.throws(()=>patchOfficialScanRate(original.replace('He=[],Oe={props:','He=[],other={props:')));
  assert.throws(()=>patchOfficialScanRate(original.replace('!0===this.localDevice.isWiredConnection','false===this.localDevice.isWiredConnection')));
  assert.ok(readFileSync(new URL('official-entry.js',root),'utf8').includes("load('/native/official-app.js')"));
});

test('wired 1 kHz report rate preserves every configured scan rate and profile without a page on unplug', async () => {
  const card=component(generated,forbiddenStorage), device=recordingDevice();
  device.productId=0x32;
  const updater=realUpdater(device,true);
  for (const scan of [1,16,32,64,128]) {
    for (let slot=1;slot<=4;slot++) {
      device.legacy[slot-1].scan_rate=scan;
      device.legacy[slot-1].polling=1;
      const context=instance(card,{modelCN:'LUNA33',isWiredConnection:true,profileID:slot,scanRateSelectValue:await updater.getScanRate(slot)},updater);
      await card.mounted.call(context);
      assert.equal(context.localDevice.scanRateSelectValue,scan===16?1:scan);
      assert.deepEqual(context.rateOptions.map(v=>v.value),[128,64,32,1]);
      // No component remains mounted to handle a later disconnect/reconnect.
      assert.equal(device.legacy[slot-1].scan_rate,scan);
      assert.equal(device.legacy[slot-1].polling,1);
    }
  }
  assert.equal(scanWrites(device).length,0);
  assert.ok(device.packets.every(p=>p[2]===0&&p[5]===0x9f));
});

test('wireless mount respects intentional 1 kHz and ignores stale browser preferences', async () => {
  const card=component(generated,forbiddenStorage);
  for (const scan of [1,32,64,128]) {
    const writes=[];
    const context=instance(card,{modelCN:'LUNA33',isWiredConnection:false,profileID:3,scanRateSelectValue:scan},{async setScanRate(...args){writes.push(args);}});
    await card.mounted.call(context);
    assert.equal(context.localDevice.scanRateSelectValue,scan);
    assert.equal(writes.length,0);
  }
});

test('manual changes send exactly one scan write to the chosen slot and do not alter USB polling', async () => {
  const card=component(generated,forbiddenStorage), device=recordingDevice();
  device.productId=0x32;device.legacy[1].polling=1;
  const updater=realUpdater(device,true);
  const context=instance(card,{modelCN:'LUNA33',isWiredConnection:true,profileID:2,scanRateSelectValue:await updater.getScanRate(2)},updater);
  await card.mounted.call(context);
  context.localDevice.scanRateSelectValue=128;
  await context.rateSelectChange();
  assert.equal(device.legacy[1].scan_rate,128);
  assert.equal(device.legacy[1].polling,1);
  assert.equal(scanWrites(device).length,1);
  assert.deepEqual(scanWrites(device)[0].slice(2,8),[0,2,0,31,2,128]);
  assert.equal(context.events[0].value.scanRateSelectValue,128);
  // A user-selected 1 kHz in wireless mode must survive the next mount too.
  updater.isWired=false;device.productId=0x33;
  context.localDevice.isWiredConnection=false;context.localDevice.scanRateSelectValue=1;
  await context.rateSelectChange();
  assert.equal(scanWrites(device).length,2);
  const remounted=instance(card,{modelCN:'LUNA33',isWiredConnection:false,profileID:2,scanRateSelectValue:await updater.getScanRate(2)},updater);
  await card.mounted.call(remounted);
  assert.equal(device.legacy[1].scan_rate,1);
  assert.equal(scanWrites(device).length,2);
});

test('other models retain the vendor normalization behavior', async () => {
  for(const scan of [0,1,2,4,8,32,64,128]) {
    const observed=[];
    for(const source of [original,generated]) {
      const card=component(source,forbiddenStorage), writes=[];
      const context=instance(card,{modelCN:'TYPE33',isWiredConnection:true,profileID:1,scanRateSelectValue:scan},{async setScanRate(slot,value){writes.push([slot,value]);}});
      await card.mounted.call(context);
      observed.push({rate:context.localDevice.scanRateSelectValue,writes});
    }
    assert.deepEqual(observed[1],observed[0]);
  }
});
