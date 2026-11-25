import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isLuna33} from '../device-access.js';
import {createDriverStore} from '../src/store/driver.js';
import {DemoDevice} from '../advanced/demo.js';
import {assetUrl} from '../runtime.js';
import {spaOfficialAssets} from '../publication-manifest.mjs';

const root = new URL('../', import.meta.url);
const definitions = JSON.parse(readFileSync(new URL('advanced/protocol-definitions.json', root)));
const collection = () => ({usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]});

function lunaDevice(pid = 0x33) {
  const device = new DemoDevice();
  device.productId = pid;
  device.collections = [collection()];
  device.sent = [];
  const send = device.sendFeatureReport.bind(device);
  device.sendFeatureReport = async (id, packet) => { device.sent.push([...packet]); await send(id, packet); };
  return device;
}

test('LUNA33 identity uses vendor IDs and a usable vendor report, not the product name', () => {
  for (const pid of [0x32, 0x33]) assert.equal(isLuna33(lunaDevice(pid)), true);
  for (const pid of [0x54, 0x84, 0xb032, 0xb033]) assert.equal(isLuna33(lunaDevice(pid)), false);
  assert.equal(isLuna33({...lunaDevice(), vendorId: 0x1234, productName: 'LUNAFURY LUNA33'}), false);
  assert.equal(isLuna33({...lunaDevice(), collections: []}), false);
  const device = lunaDevice(); device.collections[0].featureReports[0].items[0].reportCount = 32;
  assert.equal(isLuna33(device), false);
});

test('the vendor model table confirms that the accepted IDs belong only to LUNA33', () => {
  const source = readFileSync(new URL('official/js/app.1c5e5052.js', root), 'utf8');
  const match = source.match(/JSON\.parse\('(\[\{"ModelEN":"LUNA33".*?\])'\)/);
  assert.ok(match);
  const models = JSON.parse(match[1]);
  for (const model of models) {
    for (const [vid, pid] of [['VIDWired', 'PIDWired'], ['VIDWireless', 'PIDWireless'], ['VIDWireless4K8K', 'PIDWireless4K8K']]) {
      if (!model[pid]) continue;
      const device = {...lunaDevice(), vendorId: parseInt(model[vid], 16), productId: parseInt(model[pid], 16)};
      assert.equal(isLuna33(device), model.ModelEN === 'LUNA33', model.ModelEN);
    }
  }
});

test('real LUNA33 hardware verification is required, and UI state cannot forge access', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  assert.equal(store.hasAccess.value, false);
  store.state.deviceVerified = true;
  await assert.rejects(store.applySettings({}, {}), /连接 LUNAFURY/);
  store.state.deviceVerified = false;
  await assert.rejects(store.attach(lunaDevice(0x54)), /仅支持/);
  assert.equal(store.hasAccess.value, false);
});

test('verified LUNA33 unlocks patched controls using reads only and removal closes the session', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const device = lunaDevice();
  await store.attach(device);
  assert.equal(store.hasAccess.value, true);
  assert.equal(store.state.connected, true);
  assert.equal(store.state.currentFirmware, '0.0.26.0');
  assert.deepEqual(store.state.battery, {charging: false, percent: 88});
  assert.ok(device.sent.every(packet => packet[5] >= 0x80 || (packet[5] === 0x7e && [0, 1, 3, 7, 8, 10].includes(packet[9])) || (packet[5] === 0x7e && packet[9] === 5 && packet[10] === 2)));
  await store.disconnect();
  assert.equal(store.hasAccess.value, false);
  assert.equal(store.state.reviewVisible, false);
  await assert.rejects(store.applySettings({}, {}), /连接 LUNAFURY/);
});

test('stock LUNA33 blocks extension editing cleanly without legacy fallback', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const device = lunaDevice(0x32), send = device.sendFeatureReport.bind(device);
  device.sendFeatureReport = async (id, packet) => {
    await send(id, packet);
    if (packet[5] === 0x7e) device.reply = Uint8Array.from([0xa3, 0, 0, 0, 1, 0x7e, ...new Array(58).fill(0)]);
  };
  await store.attach(device);
  assert.equal(store.hasAccess.value, true);
  assert.equal(store.state.connected, false);
  assert.equal(store.state.stockUnsupported, true);
  assert.match(store.state.message, /HyperLuna 固件/);
  assert.equal(store.state.features.name, '官方固件');
  assert.ok(device.sent.every(packet => packet[4] !== 0xb0 && packet[6] !== 0xb0));
  await store.disconnect();
});

test('sticky diff bar stages DPI, sleep, angle tune, and legacy edits and applies cleanly on demand', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const device = lunaDevice();
  await store.attach(device);
  store.selectDpiStage(2);
  store.stepActiveDpi(100);
  store.state.sleepDraft = 600;
  store.state.angleTuneDraft = -5;
  store.state.legacy.motion_sync = 1;
  assert.equal(store.dirty.value, true);
  assert.equal(store.pendingChanges.value.rows.length, 5);
  await store.applyPendingChanges();
  assert.equal(store.dirty.value, false);
  assert.equal(device.dpiActive[0], 2);
  assert.equal(device.dpiStages[0][1][0], 900);
  assert.equal(device.sleepWire[0], 600);
  assert.equal(device.angleTune[0], -5);
  assert.equal(device.legacy[0].motion_sync, 1);
  store.state.legacy.ripple = 1;
  assert.equal(store.dirty.value, true);
  store.discardChanges();
  assert.equal(store.dirty.value, false);
  assert.equal(store.state.legacy.ripple, 0);
  await store.disconnect();
});

test('old firmware URLs cannot restore a session or cause firmware, storage, or loopback requests', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const originalFetch = globalThis.fetch;
  const originals = Object.fromEntries(['location', 'indexedDB'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.fetch = async () => { throw Error('Page startup must not request firmware or a local service'); };
  Object.defineProperty(globalThis, 'location', {value: {search: '?tab=firmware&image=stock'}, configurable: true});
  Object.defineProperty(globalThis, 'indexedDB', {get() { throw Error('Must not open old firmware sessions'); }, configurable: true});
  try {
    store.mount();
    assert.equal(store.state.tab, 'performance');
    assert.equal(store.hasAccess.value, false);
    for (const method of ['browserFlasher', 'startFirmware', 'recoverFirmware', 'downloadFirmware', 'downloadBackup', 'openLocalFlasher']) {
      assert.equal(store[method], undefined);
    }
    const device = lunaDevice();
    await store.attach(device);
    const rawAddresses = [[5, 0x43], ...[0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x53].map(reg => [0x0c, reg])];
    const readAddresses = () => device.sent.filter(packet => packet[5] === 0x7e && packet[9] === 7).map(packet => [packet[10], packet[11]]);
    assert.deepEqual(readAddresses(), []);
    await store.readRegisters();
    assert.deepEqual(readAddresses().slice(-rawAddresses.length), rawAddresses);
    assert.ok(store.state.registerRows.every(row => row.value !== null));
    assert.equal(store.state.features.stats, false);
    for (const method of ['readStatistics', 'toggleTelemetry', 'resetStatistics', 'exportLog']) assert.equal(store[method], undefined);
    assert.ok(device.sent.every(packet => packet[5] >= 0x80 || (packet[5] === 0x7e && [0, 1, 3, 7, 8, 10].includes(packet[9])) || (packet[5] === 0x7e && packet[9] === 5 && packet[10] === 2)));
    await store.disconnect();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('assetUrl resolves project site relative paths cleanly', () => {
  const base = 'https://example.github.io/HyperLuna/';
  for (const path of ['css/fonts_hyperos_misans.css', '/fonts/EurostileLTPro-BoldEx2.a50bc14a.otf', 'img/mouseLine.ff2c2f85.png']) {
    assert.equal(assetUrl(path, base), base + path.replace(/^\//, ''));
  }
});

test('Pages artifact keeps standalone Vue 3 SPA and verified firmware while excluding legacy app, updater code, and private data', {skip: !existsSync(new URL('.pages-dist/', root))}, () => {
  const dist = new URL('.pages-dist/', root), files = readdirSync(dist, {recursive: true}).map(String);
  const deployment = JSON.parse(readFileSync(new URL('deployment.json', dist)));
  assert.equal(deployment.mode, 'pages'); assert.equal(deployment.firmwareUpdates, 'archived');
  assert.ok(existsSync(new URL('index.html', dist)));
  assert.ok(existsSync(new URL('advanced/index.html', dist)));
  assert.ok(readFileSync(new URL('advanced/index.html', dist), 'utf8').includes('../'));
  for (const asset of spaOfficialAssets) assert.ok(existsSync(new URL(asset, dist)), asset);
  assert.ok(!existsSync(new URL('legacy/index.html', dist)));
  assert.ok(!existsSync(new URL('official-entry.js', dist)));
  assert.ok(!existsSync(new URL('native/official-app.js', dist)));
  assert.ok(!existsSync(new URL('js/output.xvi3.min.js', dist)));
  assert.ok(!existsSync(new URL('js/chunk-vendors.3562a7a5.js', dist)));

  const catalogue = JSON.parse(readFileSync(new URL('firmware/catalogue.json', dist)));
  const ids = ['ABLODDB', 'ABLOD', 'stock'];
  const rxIds = ['LUNA33_820_ABS_STREAM'];
  const allBins = [...ids, ...rxIds];
  assert.deepEqual(catalogue.images.map(image => image.id), ids);
  assert.deepEqual((catalogue.receiver_images || []).map(image => image.id), rxIds);
  assert.deepEqual(files.filter(path => path.endsWith('.bin')).map(path => path.replaceAll('\\', '/')).sort(), allBins.map(id => 'firmware/' + id + '.bin').sort());
  assert.deepEqual(readdirSync(new URL('firmware/', root)).sort(), allBins.map(id => id + '.bin').sort());

  const hashes = {
    ABLODDB: 'ab2a94e759ce108d2aea022d1e06fbc22201c52f164a4a81161ce3d24a0e3ed6',
    ABLOD: '4ad4f75cf0fc44346550414545b31172c13a4b2faa08fec9536f650c402cee18',
    stock: '416f47366144d1773f37cc6b993f8f43332dba2746bc9cce13e732c038b93057',
    LUNA33_820_ABS_STREAM: '3e7ec6d43fc0b7f78443c83e63c1975d28b9c3cee95a1f86aeb2e26a64e0df42'
  };
  const db = catalogue.images[0];
  assert.equal(db.debounce_schema, 2); assert.equal(db.button_count, 5);
  assert.equal(db.features.per_button_debounce, true); assert.equal(db.features.independent_debounce, true);
  assert.equal(db.config_storage_version, 4);
  for (const image of catalogue.images) {
    assert.equal(image.file, image.id + '.bin'); assert.equal(image.sha256, hashes[image.id]);
    if (image.id !== 'stock') {
      assert.equal(image.name, image.id); assert.equal(image.implementation_revision, 50);
      assert.equal(image.hardware_tested, image.id === 'ABLODDB');
      assert.equal(image.paired_receiver, 'LUNA33_820_ABS_STREAM.bin');
      assert.equal(image.features.phase, 'none'); assert.equal(image.capabilities & (2 | 4 | 128), 0);
    }
    const bytes = readFileSync(new URL('firmware/' + image.file, dist));
    assert.equal(bytes.length, 99008); assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    assert.deepEqual(bytes, readFileSync(new URL('firmware/' + image.file, root)));
  }
  for (const rx of catalogue.receiver_images) {
    assert.equal(rx.file, rx.id + '.bin'); assert.equal(rx.sha256, hashes[rx.id]);
    assert.equal(rx.target, 'nRF52820'); assert.equal(rx.dfu_target, 1);
    assert.equal(rx.at405_modified, false); assert.equal(rx.hardware_tested, true);
    const bytes = readFileSync(new URL('firmware/' + rx.file, dist));
    assert.equal(bytes.length, 28672); assert.equal(createHash('sha256').update(bytes).digest('hex'), rx.sha256);
    assert.deepEqual(bytes, readFileSync(new URL('firmware/' + rx.file, root)));
  }

  assert.ok(!files.some(path => /(?:readme|backup|evidence|\.py$|\.exe$|session|node_modules|variants|browser-flash|firmware-files)/i.test(path)));
  assert.ok(!files.some(path => /(^|[\\/])(?:tests)([\\/]|$)/.test(path)));

  const builtJs = files.filter(path => path.replaceAll('\\', '/').startsWith('assets/') && path.endsWith('.js'));
  assert.ok(builtJs.length >= 1);
  for (const path of builtJs) {
    const source = readFileSync(new URL(path.replaceAll('\\', '/'), dist), 'utf8');
    assert.ok(!/BrowserFlasher|indexedDB|localFirmwareUrl|api\/firmware|localhost:8765|tab=firmware|name="firmware"|prepareFirmware|selectDfu|D909538B/.test(source), path);
  }
});
