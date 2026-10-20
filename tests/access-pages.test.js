import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {isLuna33, FIRMWARE_NOTICE} from '../device-access.js';
import {createOptions} from '../native/research.js';
import {DemoDevice} from '../advanced/demo.js';
import {assetUrl} from '../runtime.js';
import {patchAssetPaths} from '../patches/asset-paths.mjs';
import {patchOfficialScanRate} from '../patches/official-scan-rate.mjs';
import {removeFirmwareUi, removeFirmwareSdkMethods} from '../patches/remove-firmware.mjs';

const root = new URL('../',import.meta.url);
const definitions = JSON.parse(readFileSync(new URL('advanced/protocol-definitions.json',root)));
const collection = () => ({usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]});
function lunaDevice(pid=0x33) {
  const device = new DemoDevice(); device.productId=pid;device.collections=[collection()];
  device.sent=[];const send=device.sendFeatureReport.bind(device);
  device.sendFeatureReport=async(id,packet)=>{device.sent.push([...packet]);await send(id,packet);};
  return device;
}
function view(dependencies={}) {
  globalThis.window={XviUpdater:class {}};
  const options=createOptions(definitions,{acquireDeviceLock:async()=>()=>{},addHeaderEntry(){},...dependencies});
  const context={...options.data(),$message:{error(){},success(){},warning(){}}};
  for(const [key,method] of Object.entries(options.methods))context[key]=method.bind(context);
  for(const [key,get] of Object.entries(options.computed))Object.defineProperty(context,key,{get:get.bind(context)});
  return {context,options};
}

test('LUNA33 identity uses vendor IDs and a usable vendor report, not the product name',()=>{
  for(const pid of [0x32,0x33])assert.equal(isLuna33(lunaDevice(pid)),true);
  for(const pid of [0x54,0x84,0xb032,0xb033])assert.equal(isLuna33(lunaDevice(pid)),false);
  assert.equal(isLuna33({...lunaDevice(),vendorId:0x1234,productName:'LUNAFURY LUNA33'}),false);
  assert.equal(isLuna33({...lunaDevice(),collections:[]}),false);
  const device=lunaDevice();device.collections[0].featureReports[0].items[0].reportCount=32;
  assert.equal(isLuna33(device),false);
});

test('the vendor model table confirms that the accepted IDs belong only to LUNA33',()=>{
  const source=readFileSync(new URL('official/js/app.1c5e5052.js',root),'utf8');
  const match=source.match(/JSON\.parse\('(\[\{"ModelEN":"LUNA33".*?\])'\)/);
  assert.ok(match);const models=JSON.parse(match[1]);
  for(const model of models){
    for(const [vid,pid] of [['VIDWired','PIDWired'],['VIDWireless','PIDWireless'],['VIDWireless4K8K','PIDWireless4K8K']]){
      if(!model[pid])continue;
      const device={...lunaDevice(),vendorId:parseInt(model[vid],16),productId:parseInt(model[pid],16)};
      assert.equal(isLuna33(device),model.ModelEN==='LUNA33',model.ModelEN);
    }
  }
});

test('risk confirmation is required for every new page instance, and UI state cannot grant access',async()=>{
  assert.match(FIRMWARE_NOTICE,/未经充分验证/);assert.match(FIRMWARE_NOTICE,/设备损坏/);assert.match(FIRMWARE_NOTICE,/自行承担后果/);
  const {context}=view(),device=lunaDevice();
  assert.equal(context.riskVisible,true);assert.equal(context.hasAccess,false);
  await assert.rejects(context.attach(device),/风险提示/);assert.equal(device.sent.length,0);
  context.riskAcknowledged=true;context.deviceVerified=true;
  await assert.rejects(context.applySettings({},{}),/风险提示/);
  context.acceptRisk();context.deviceVerified=false;
  await assert.rejects(context.applySettings({},{}),/连接 LUNAFURY/);
  await assert.rejects(context.attach(lunaDevice(0x54)),/仅支持/);
  assert.equal(context.hasAccess,false);assert.equal(view().context.riskVisible,true);
});

test('verified LUNA33 unlocks patched controls using reads only and removal closes the page',async()=>{
  const {context}=view(),device=lunaDevice();context.acceptRisk();await context.attach(device);
  assert.equal(context.hasAccess,true);assert.equal(context.connected,true);assert.equal(context.currentFirmware,'0.0.26.0');
  assert.ok(device.sent.every(packet=>packet[5]>=0x80||(packet[5]===0x7e&&[0,1,3,7].includes(packet[9]))||(packet[5]===0x7e&&packet[9]===5&&packet[10]===2)));
  await context.disconnect();assert.equal(context.hasAccess,false);assert.equal(context.reviewVisible,false);
  await assert.rejects(context.applySettings({},{}),/连接 LUNAFURY/);
});

test('stock LUNA33 stays on settings and explains that extensions are unsupported',async()=>{
  const {context}=view(),device=lunaDevice(0x32),send=device.sendFeatureReport.bind(device);
  device.sendFeatureReport=async(id,packet)=>{
    await send(id,packet);
    if(packet[5]===0x7e)device.reply=Uint8Array.from([0xa3,0,0,0,1,0x7e,...new Array(58).fill(0)]);
  };
  context.acceptRisk();await context.attach(device);
  assert.equal(context.hasAccess,true);assert.equal(context.connected,false);assert.equal(context.tab,'settings');
  assert.match(context.message,/官方设置/);assert.equal(context.features.name,'官方固件');
  assert.ok(device.sent.every(packet=>packet[4]!==0xb0&&packet[6]!==0xb0));
  await context.disconnect();
});

test('old firmware URLs cannot restore a session or cause firmware, storage, or loopback requests',async()=>{
  const {context,options}=view(),originalFetch=globalThis.fetch;
  const originals=Object.fromEntries(['location','indexedDB'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  globalThis.window.addEventListener=()=>{};
  globalThis.fetch=async()=>{throw Error('Page startup must not request firmware or a local service');};
  Object.defineProperty(globalThis,'location',{value:{search:'?tab=firmware&image=stock'},configurable:true});
  Object.defineProperty(globalThis,'indexedDB',{get(){throw Error('Must not open old firmware sessions');},configurable:true});
  try{
    await options.mounted.call(context);
    assert.equal(context.tab,'settings');assert.equal(context.hasAccess,false);
    for(const method of ['browserFlasher','startFirmware','recoverFirmware','downloadFirmware','downloadBackup','openLocalFlasher'])assert.equal(context[method],undefined);
    const device=lunaDevice();context.acceptRisk();await context.attach(device);
    await context.readRegisters();await context.readStatistics();
    assert.ok(context.registerRows.every(row=>row.value!==null));assert.ok(context.counterRows.length>0);
    assert.ok(device.sent.every(packet=>packet[5]>=0x80||(packet[5]===0x7e&&[0,1,3,7].includes(packet[9]))||(packet[5]===0x7e&&packet[9]===5&&packet[10]===2)));
    await context.disconnect();
  }finally{
    globalThis.fetch=originalFetch;
    for(const [key,descriptor] of Object.entries(originals)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});

test('official settings keep their project asset paths and have no update icon or mounted updater dialog',()=>{
  const base='https://example.github.io/HyperLuna/';
  for(const path of ['js/vendor.js','/fonts/font.woff','advanced/'])assert.equal(assetUrl(path,base),base+path.replace(/^\//,''));
  const source=readFileSync(new URL('official/js/app.1c5e5052.js',root),'utf8');
  const patched=removeFirmwareUi(patchAssetPaths(patchOfficialScanRate(source)));
  assert.ok(patched.includes('new URL("../",document.currentScript.src).href'));
  assert.ok(!patched.includes('e.updateDialogVisible=!0'));
  assert.ok(!patched.includes('t("UpdateDialog",'));
  assert.ok(patched.includes('t("SettingDialog",'));
  assert.throws(()=>removeFirmwareUi(patched));
});

test('published vendor SDK can read application versions and contains no firmware update transport',async()=>{
  const original=readFileSync(new URL('official/js/output.xvi3.min.js',root),'utf8');
  const safe=removeFirmwareSdkMethods(original);
  const device=lunaDevice(0x32),window={};
  vm.runInNewContext(safe,{window,navigator:{hid:{}},Uint8Array,DataView,TextDecoder,console,setTimeout});
  const updater=new window.XviUpdater();updater.setReportDevice=device;updater.isWired=true;updater.mySleep=async()=>{};
  for(const method of ['FwUpdate','enterBL','getBLFWVer','erase','program','programByDataParams','verify','exitBL','getFetchFWFile'])assert.equal(updater[method],undefined,method);
  assert.equal(await updater.getFirmwareVersionDeviceID(0),'0.0.26.0');
  assert.ok(device.sent.length>0);assert.ok(device.sent.every(packet=>packet[4]===0&&packet[5]===0x81));
  assert.throws(()=>removeFirmwareSdkMethods(safe));
});

test('Pages artifact keeps verified firmware files while excluding updater code and private local data',{skip:!existsSync(new URL('.pages-dist/',root))},()=>{
  const dist=new URL('.pages-dist/',root),files=readdirSync(dist,{recursive:true}).map(String);
  const deployment=JSON.parse(readFileSync(new URL('deployment.json',dist)));
  assert.equal(deployment.mode,'pages');assert.equal(deployment.firmwareUpdates,'archived');
  const catalogue=JSON.parse(readFileSync(new URL('firmware/catalogue.json',dist)));
  const ids=['ABLODLOCKDB','ABLODDB','ABLODSTATSDB','ABLODSTATS','ABLODLOCK','ABLOD','stock'];
  assert.deepEqual(catalogue.images.map(image=>image.id),ids);
  assert.deepEqual(files.filter(path=>path.endsWith('.bin')).map(path=>path.replaceAll('\\','/')).sort(),ids.map(id=>'firmware/'+id+'.bin').sort());
  assert.deepEqual(readdirSync(new URL('firmware/',root)).sort(),ids.map(id=>id+'.bin').sort());
  const perButtonHashes={
    ABLODLOCKDB:'145537286c3442127ff1b64c173a097db39af9f06ab0aaa01e07d21f6e527ecc',
    ABLODDB:'00853ca0baf0b0ee6e57ce966cd59110e6d328dd49655905d1b33a0d55bb7db9',
    ABLODSTATSDB:'b5a0b245d330f1658196f94b3e986f573b7ee5a647500cfb543b987d883423ed'
  };
  for(const [id,sha] of Object.entries(perButtonHashes)){
    const image=catalogue.images.find(image=>image.id===id);
    assert.equal(image.name,id);assert.equal(image.file,id+'.bin');assert.equal(image.sha256,sha);
    assert.equal(image.debounce_schema,1);assert.equal(image.button_count,6);assert.equal(image.features.per_button_debounce,true);
  }
  for(const image of catalogue.images){
    const bytes=readFileSync(new URL('firmware/'+image.file,dist));
    assert.equal(bytes.length,99008);assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256);
    assert.deepEqual(bytes,readFileSync(new URL('firmware/'+image.file,root)));
  }

  assert.ok(!files.some(path=>/(?:readme|backup|evidence|\.py$|\.exe$|session|node_modules|variants|browser-flash|firmware-files)/i.test(path)));
  assert.ok(!files.some(path=>/(^|[\\/])(?:tests)([\\/]|$)/.test(path)));
  for(const path of ['native/research.js','native/research.html','native/render.js','runtime.js','official-entry.js']){
    const source=readFileSync(new URL(path,dist),'utf8');
    assert.ok(!/BrowserFlasher|indexedDB|localFirmwareUrl|api\/firmware|localhost:8765|tab=firmware|name="firmware"|prepareFirmware|selectDfu/.test(source),path);
  }
  assert.ok(!readFileSync(new URL('native/research.js',dist),'utf8').includes('D909538B'));
  assert.ok(!readFileSync(new URL('css/app.24b3a275.css',dist),'utf8').match(/url\(["']?\/fonts\//));
  assert.equal(readFileSync(new URL('js/output.xvi3.min.js',dist),'utf8'),removeFirmwareSdkMethods(readFileSync(new URL('official/js/output.xvi3.min.js',root),'utf8')));
});
