import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {
  packet, normalize, matches, HidTransport, LunaClient, RequestTimeout,
  decodeProfile, encodeProfile, validateRawLandingGuard, validateRawProfile, parseDecimalInt,
  equal, validateLegacy, registerAddress,
  validateDpiStages, validateSleepSeconds, validateAngleTune
} from '../advanced/protocol.js';
import {DemoDevice} from '../advanced/demo.js';
import {createDriverStore} from '../src/store/driver.js';
import {decodeFeatures, validateFeatures, VARIANTS} from '../advanced/features.js';
import {translate} from '../i18n.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));
const canonicalPath = new URL('../../lunafury-analysis/port/protocol-definitions.json', import.meta.url);

test('capability replies retain stable IDs for the two non-phase variants', () => {
  assert.throws(() => decodeFeatures(new Uint8Array(17)));
  for (const variant of VARIANTS) {
    const reply = new Uint8Array(19); reply[17] = variant.id; reply[18] = variant.mask;
    assert.equal(decodeFeatures(reply).name, variant.name);
    reply[18] ^= 1; assert.throws(() => decodeFeatures(reply));
  }
  const value = {fps: 7, debounce: true, pre: 0, post: 1.5, plock: 0, relock: 10};
  assert.doesNotThrow(() => validateFeatures(value, VARIANTS[0]));
  assert.throws(() => validateFeatures(value, VARIANTS[1]));
});

test('unsupported feature mutations are rejected before sending to a variant', async () => {
  const records = [], t = new HidTransport(new DemoDevice(), {interval: 1, log: r => records.push(r)}), c = new LunaClient(t, definitions);
  c.features = VARIANTS[1];
  await assert.rejects(c.telemetry(1)); assert.equal(await c.telemetry(), false);
  await assert.rejects(c.statistics());
  await assert.rejects(c.putProfile(1, encodeProfile(new Uint8Array(16), {fps: 7, debounce: false, pre: 0, post: 0, plock: 0, relock: 0})));
  assert.equal(records.length, 0); await t.close();
});

test('protocol definitions exactly match firmware preset indexes and counter order', {skip: !existsSync(canonicalPath)}, () => assert.deepEqual(definitions, JSON.parse(readFileSync(canonicalPath))));

test('feature payload has 64 bytes, target and length, no duplicated report ID', () => {
  const p = packet(0x7e, [76, 70, 1, 7, 24, 122], 1, 2);
  assert.equal(p.length, 64); assert.deepEqual([...p.slice(0, 12)], [0, 0, 2, 6, 1, 126, 76, 70, 1, 7, 24, 122]);
  assert.equal(packet(0x7e, [], 1, 0)[2], 0);
  assert.throws(() => packet(1, [256])); assert.throws(() => packet(1, new Array(59).fill(0)));
});

test('normalization handles DataView offsets and native leading report ID', () => {
  const storage = Uint8Array.from([99, 0xa1, 0, 2, 1, 0, 0x85, 1, 88]);
  assert.deepEqual([...normalize(new DataView(storage.buffer, 1, 7))], [0xa1, 0, 2, 1, 0, 0x85, 1]);
  const native = new Uint8Array(65); native.set(storage.slice(1, 8), 1);
  assert.deepEqual([...normalize(native)], [0xa1, 0, 2, 1, 0, 0x85, 1]);
  assert.throws(() => normalize([0xa1, 0, 2, 59, 0, 0]));
  assert.throws(() => normalize([0xa1, 0, 2, 3, 0, 0, 1]));
});

test('cached extension replies must echo operation, profile, full write or register identity', async () => {
  const d = new DemoDevice();
  const request = [76, 70, 1, 2, 1, ...d.slots[0]];
  await d.sendFeatureReport(0, packet(126, request)); const reply = normalize(await d.receiveFeatureReport(0));
  assert.ok(matches(reply, 126, request));
  const stale = reply.slice(); stale[24] ^= 1; assert.equal(matches(stale, 126, request), false);
  assert.equal(matches(reply, 126, [76, 70, 1, 2, 2, ...d.slots[0]]), false);
  await d.sendFeatureReport(0, packet(126, [76, 70, 1, 7, 24, 122]));
  const peek = normalize(await d.receiveFeatureReport(0));
  assert.ok(matches(peek, 126, [76, 70, 1, 7, 24, 122]));
  assert.equal(matches(peek, 126, [76, 70, 1, 7, 24, 121]), false);
  assert.equal(matches(peek.slice(0, 12), 126, [76, 70, 1, 7, 24, 122]), false);
  assert.equal(matches(Uint8Array.from([0xa1, 0, 2, 2, 1, 128, 2, 64]), 128, [1, 0]), false);
  assert.equal(matches(Uint8Array.from([0xa1, 0, 2, 2, 0, 0x83, 1, 95]), 0x83, [0, 0], 0), true);
  // Receiver V4 cmd=0x85 must distinguish 'AF' (sub 0/2) vs 'LQ' (sub 1/3) so stale cache never leaks
  const fakeAf = new Uint8Array(62); fakeAf.set([0xa1, 0, 1, 56, 0, 0x85, 0x41, 0x46, 1]);
  const fakeLq = new Uint8Array(36); fakeLq.set([0xa1, 0, 1, 30, 0, 0x85, 0x4c, 0x51, 1]);
  assert.equal(matches(fakeAf, 0x85, [], 0), true);
  assert.equal(matches(fakeAf, 0x85, [1], 0), false);
  assert.equal(matches(fakeLq, 0x85, [1], 0), true);
  assert.equal(matches(fakeLq, 0x85, [2], 0), false);
});

test('telemetry query accepts only Boolean state and mutations match the requested state', async () => {
  const d = new DemoDevice(); await d.sendFeatureReport(0, packet(126, [76, 70, 1, 5, 2]));
  const r = normalize(await d.receiveFeatureReport(0));
  assert.ok(matches(r, 126, [76, 70, 1, 5, 2])); assert.equal(matches(r, 126, [76, 70, 1, 5, 1]), false);
  r[10] = 4; assert.equal(matches(r, 126, [76, 70, 1, 5, 2]), false);
});

test('editing preserves reserved bytes, supports 0.1 ms and rejects invalid inputs', () => {
  const raw = Uint8Array.from([7, 1, 80, 0, 1, 0xab, 0, 0, 15, 0, 0, 0, 100, 0, 0xcd, 0xef]);
  const value = {...decodeProfile(raw), post: 2.3}; const out = encodeProfile(raw, value);
  assert.equal(out[5], 0xab); assert.equal(out[14], 0xcd); assert.equal(out[15], 0xef); assert.equal(decodeProfile(out).post, 2.3);
  for (const post of [NaN, Infinity, -1, 101, 0.15]) assert.throws(() => encodeProfile(raw, {...value, post}));
  assert.throws(() => encodeProfile(raw, {...value, fps: 35})); assert.equal(raw[8], 15);
  assert.throws(() => registerAddress(0, 127)); assert.throws(() => registerAddress(-1, 0));
});

test('DPI stages, sleep timeout, angle tuning, and charging battery validate and round-trip cleanly', async () => {
  assert.throws(() => validateDpiStages([], 1));
  assert.throws(() => validateDpiStages([{x: 825, y: 825}], 1));
  assert.throws(() => validateSleepSeconds(30));
  assert.throws(() => validateAngleTune(31));
  const d = new DemoDevice();
  d.battery = {charging: 1, percent: 94};
  const t = new HidTransport(d, {interval: 1}), c = new LunaClient(t, definitions);
  assert.deepEqual(await c.battery(), {charging: true, percent: 94});
  const dpi0 = await c.getDpi(1);
  assert.equal(dpi0.stages.length, 4); assert.equal(dpi0.activeStage, 3);
  await c.putDpi(1, [{x: 800, y: 800}, {x: 1600, y: 1600}, {x: 3200, y: 3200}], 2);
  const dpi1 = await c.getDpi(1);
  assert.deepEqual(dpi1.stages.map(s => s.x), [800, 1600, 3200]); assert.equal(dpi1.activeStage, 2);
  await c.putSleepSeconds(1, 0); assert.equal(d.sleepWire[0], 65535); assert.equal(await c.getSleepSeconds(1), 0);
  await c.putSleepSeconds(1, 600); assert.equal(await c.getSleepSeconds(1), 600);
  await c.putAngleTune(1, -12); assert.equal(await c.getAngleTune(1), -12);
  await c.putAngleTune(1, 8); assert.equal(await c.getAngleTune(1), 8);
  await t.close();
});

test('store input text validates timing fields and reserves the removed wire bytes', () => {
  const device = new DemoDevice(), raw = [...device.slots[0]];
  const store = createDriverStore(definitions);
  store.state.features = {name: 'ABLOD', fps: 'none', debounce: 'none', stats: false};
  store.setBase({raw, legacy: device.legacy[0], slot: 1, active: 1});
  store.state.draft = {...decodeProfile(raw), pre: '0.0', post: '1.5', plock: '0', relock: '10'};
  store.state.features = {name: 'LUNA33_HYPERLUNA', fps: 'presets', debounce: 'fine', stats: false};
  const result = store.collectDraft();
  assert.equal(result.patch.post, 1.5); assert.deepEqual([...result.raw.slice(1, 4)], [0, 0, 0]);
  store.state.draft.post = ''; assert.throws(() => store.collectDraft());
  store.state.draft.post = 'invalid'; assert.throws(() => store.collectDraft());
});

test('concurrent requests serialize complete send/poll transactions', async () => {
  const d = new DemoDevice(), calls = [], original = d.sendFeatureReport.bind(d);
  d.sendFeatureReport = async (id, p) => { calls.push(`send-${p[10]}`); await original(id, p); };
  const receive = d.receiveFeatureReport.bind(d);
  d.receiveFeatureReport = async () => { calls.push(`recv-${d.reply[10]}`); return receive(); };
  const transport = new HidTransport(d, {interval: 1}), client = new LunaClient(transport, definitions);
  const results = await Promise.all([client.getProfile(1), client.getProfile(2)]);
  assert.equal(results[0][0], 7); assert.equal(results[1][0], 0);
  assert.deepEqual(calls, ['send-1', 'recv-1', 'send-2', 'recv-2']); await transport.close();
});

test('cached reports from the receiver target cannot satisfy a mouse-target request', async () => {
  const d = new DemoDevice(); let reads = 0; const original = d.receiveFeatureReport.bind(d);
  d.receiveFeatureReport = async () => {
    const result = await original(); reads++;
    if (reads === 1) result.setUint8(2, 0);
    return result;
  };
  const t = new HidTransport(d, {interval: 1}), client = new LunaClient(t, definitions);
  assert.equal((await client.getProfile(1))[0], 7); assert.equal(reads, 2); await t.close();
});

test('connecting and reading configuration, telemetry state and registers perform no writes', async () => {
  const records = [], t = new HidTransport(new DemoDevice(), {interval: 1, log: r => records.push(r)}), c = new LunaClient(t, definitions);
  await c.info(); await c.activeProfile(); await c.battery(); await c.read(1); await c.telemetry(); await c.peek(24, 122);
  assert.ok(records.length >= 18); assert.ok(records.every(r => r.readonly === true)); await t.close();
});

test('read timeouts can retry; writes are never automatically resent', async () => {
  class NoReply extends DemoDevice {
    async sendFeatureReport() { this.sends = (this.sends || 0) + 1; }
    async receiveFeatureReport() { return new DataView(new Uint8Array(64).buffer); }
  }
  const d = new NoReply(), t = new HidTransport(d, {timeout: 3, interval: 1});
  await assert.rejects(t.exchange(126, [76, 70, 1, 1, 1]), RequestTimeout); assert.equal(d.sends, 3);
  d.sends = 0;
  await assert.rejects(t.exchange(126, [76, 70, 1, 6, 24, 122, 138]), RequestTimeout); assert.equal(d.sends, 1);
  // Receiver V4 cmd=0x85: subcmd 0x01 (LQ read) retries; subcmd 0x02 (rescan) & 0x03 (reset) never retry!
  d.sends = 0;
  await assert.rejects(t.exchange(0x85, [1], 0, 1), RequestTimeout); assert.equal(d.sends, 3);
  d.sends = 0;
  await assert.rejects(t.exchange(0x85, [2], 0, 1), RequestTimeout); assert.equal(d.sends, 1);
  d.sends = 0;
  await assert.rejects(t.exchange(0x85, [3], 0, 1), RequestTimeout); assert.equal(d.sends, 1);
  // Mouse Rev 51 op=12 (QUIET_WINDOW) is mutating and NEVER retries!
  d.sends = 0;
  await assert.rejects(t.exchange(0x7e, [76, 70, 1, 12, 26]), RequestTimeout); assert.equal(d.sends, 1);
  await t.close();
});

test('write response timeout is resolved with readback, without repeating the write', async () => {
  const d = new DemoDevice(); let writes = 0; const original = d.sendFeatureReport.bind(d);
  d.sendFeatureReport = async (id, p) => {
    await original(id, p);
    if (p[5] === 126 && p[9] === 2) { writes++; d.reply.fill(0); }
  };
  const t = new HidTransport(d, {timeout: 4, interval: 1}), client = new LunaClient(t, definitions);
  const raw = await client.getProfile(1); raw[0] = 8;
  const result = await client.putProfile(1, raw);
  assert.equal(writes, 1); assert.equal(result.timeout, true); assert.ok(equal(await client.getProfile(1), raw)); await t.close();
});

test('writable settings validate mode and distinguish scan rate from polling', () => {
  const values = new DemoDevice().legacy[0]; assert.doesNotThrow(() => validateLegacy(values, 2));
  assert.throws(() => validateLegacy(values, 0));
  assert.throws(() => validateLegacy({...values, scan_sequence: 3}, 2));
  assert.throws(() => validateLegacy({...values, scan_rate: 8}, 2));
  assert.throws(() => validateLegacy({...values, scan_rate: 4}, 2));
  assert.throws(() => validateLegacy({...values, scan_rate: 2}, 2));
  assert.doesNotThrow(() => validateLegacy({...values, polling: 1, scan_rate: 128}, 0));
});

test('preview reads, writes, telemetry and register undo target only its in-memory device', async () => {
  const t = new HidTransport(new DemoDevice(), {interval: 1}), c = new LunaClient(t, definitions);
  assert.equal((await c.info()).magic, 'LF33');
  assert.equal(await c.version(), '0.0.26.0');
  const state = await c.read(1); assert.equal(state.legacy.scan_rate, 64); assert.equal(state.legacy.scan_sequence, 0);
  await c.putLegacy(1, 'scan_rate', 32); assert.equal((await c.read(1)).legacy.polling, 64);
  assert.equal(await c.peek(24, 122), 138); await c.poke(24, 122, 139); assert.equal(await c.peek(24, 122), 139);
  assert.equal(await c.telemetry(), false); await assert.rejects(c.telemetry(1)); assert.equal(await c.telemetry(), false);
  await assert.rejects(c.statistics());
  const afh = await c.receiverAfh();
  assert.ok(afh && afh.version === 1 && afh.activeCh === 2476 && afh.chTable.length === 5 && afh.spectrum.length === 38);
  assert.equal(afh.spectrum[0].mhz, 2404); assert.equal(afh.spectrum[37].mhz, 2478);
  assert.equal(afh.hopCount, 0); assert.equal(afh.scanCount, 1); assert.equal(afh.flags.v4Capable, true);
  // Receiver V4 subcmds: 0x01 live link quality, 0x02 manual 16-pass rescan, 0x03 atomic counter reset
  const lq = await c.receiverLinkQuality();
  assert.ok(lq && lq.version === 1 && lq.linkActive === true && lq.activeCh === 2476);
  assert.equal(lq.emaDbm, -47); assert.equal(lq.lastDbm, -47); assert.equal(lq.bestDbm, -44); assert.equal(lq.worstDbm, -52);
  assert.equal(lq.rxOkCount, 16420); assert.equal(lq.crcErrCount, 1);
  assert.deepEqual(lq.slotDbm, [-47, -49, null, null, null]);
  const rescanned = await c.rescanReceiverAfh();
  assert.equal(rescanned.scanCount, 2); assert.equal(rescanned.flags.manualScan, true); assert.equal(rescanned.lastPasses, 128);
  const resetLq = await c.resetReceiverLinkCounters();
  assert.equal(resetLq.hopCount, 0); assert.equal(resetLq.crcErrCount, 0); assert.equal(resetLq.rxOkCount, 0);
  assert.equal(resetLq.emaDbm, null); assert.equal(resetLq.linkActive, true);
  // Receiver V4 unlinked/idle state reports actual search channel & chIdx=0xFF
  t.device.receiverAfh.linkActive = false;
  const idleAfh = await c.receiverAfh();
  const idleLq = await c.receiverLinkQuality();
  assert.equal(idleAfh.linkActive, false); assert.equal(idleAfh.activeCh, 2433); assert.equal(idleAfh.chIdx, 0xff);
  assert.equal(idleLq.linkActive, false); assert.equal(idleLq.activeCh, 2433); assert.equal(idleLq.chIdx, 0xff);
  t.device.receiverAfh.linkActive = true;
  // Receiver V3 (flags without bit 4) stays backwards-compatible: AF works, V4 subcmds degrade cleanly
  t.device.receiverAfh.flags = 5;
  const v3Afh = await c.receiverAfh();
  assert.equal(v3Afh.flags.v4Capable, false);
  assert.equal(await c.receiverLinkQuality(), null);
  await assert.rejects(c.rescanReceiverAfh());
  await assert.rejects(c.resetReceiverLinkCounters());
  // Older V1/V2 receiver rejecting cmd=0x85 returns null gracefully
  t.device.receiverAfh = null;
  assert.equal(await c.receiverAfh(), null);
  assert.equal(await c.receiverLinkQuality(), null);
  await t.close();
  // Wired device (target=0) skips cmd=0x85 cleanly and returns null
  const wired = new DemoDevice(); wired.productId = 0x0032;
  const tw = new HidTransport(wired, {interval: 1}), cw = new LunaClient(tw, definitions);
  assert.equal(await cw.receiverAfh(), null);
  assert.equal(await cw.receiverLinkQuality(), null);
  await tw.close();
});

test('Rev 51 quietWindow coordinates silent mouse window before Receiver V4 rescan', async () => {
  // 1. Protocol & feature gating
  const d51 = new DemoDevice({implementationRevision: 51});
  const t51 = new HidTransport(d51, {interval: 1}), c51 = new LunaClient(t51, definitions);
  const info51 = await c51.info();
  assert.equal(info51.features.implementationRevision, 51);
  assert.equal(info51.features.quietWindow, true);
  assert.equal(await c51.requestMouseQuietWindow(500), 500);
  assert.equal(d51.lastQuietWindowMs, 500);
  await assert.rejects(c51.requestMouseQuietWindow(40), /50–500 ms/);
  await assert.rejects(c51.requestMouseQuietWindow(510), /50–500 ms/);
  await t51.close();

  const d50 = new DemoDevice({implementationRevision: 50});
  const t50 = new HidTransport(d50, {interval: 1}), c50 = new LunaClient(t50, definitions);
  const info50 = await c50.info();
  assert.equal(info50.features.quietWindow, false);
  await assert.rejects(c50.requestMouseQuietWindow(260), /Rev 51/);
  await t50.close();

  // 2. Store coordinated rescan: linked Rev 51 sends op=12 BEFORE 0x85 0x02; idle or Rev 50 skips op=12!
  const runStoreScan = async (rev, linkActive) => {
    const dev = new DemoDevice({implementationRevision: rev});
    dev.receiverAfh.linkActive = linkActive;
    dev.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
    const order = [];
    const origSend = dev.sendFeatureReport.bind(dev);
    dev.sendFeatureReport = async (id, p) => {
      if (p[5] === 0x7e && p[9] === 12) order.push(`op12:${p[10] * 10}`);
      if (p[2] === 1 && p[4] === 0 && p[5] === 0x85) order.push(`rx85:${p[3] ? p[6] : 0}`);
      return origSend(id, p);
    };
    const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
    await store.attach(dev);
    order.length = 0;
    await store.rescanReceiverAfh();
    const msg = store.state.message;
    await store.disconnect();
    return {order, msg};
  };

  const linkedRev51 = await runStoreScan(51, true);
  assert.deepEqual(linkedRev51.order, ['rx85:1', 'op12:500', 'rx85:2', 'rx85:1']);
  assert.match(linkedRev51.msg, /鼠标静默/);

  const idleRev51 = await runStoreScan(51, false);
  assert.deepEqual(idleRev51.order, ['rx85:1', 'rx85:2', 'rx85:1']);

  const linkedRev50 = await runStoreScan(50, true);
  assert.deepEqual(linkedRev50.order, ['rx85:1', 'rx85:2', 'rx85:1']);

  // 3. Codex P1-1: guard() exclusivity during rescan + honest reporting on op=12 rejection & window overrun!
  const devGuard = new DemoDevice({implementationRevision: 51});
  devGuard.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const origSendG = devGuard.sendFeatureReport.bind(devGuard);
  let batteryDuringRescan = 0;
  const storeG = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await storeG.attach(devGuard);
  devGuard.sendFeatureReport = async (id, p) => {
    if (p[5] === 0x83) batteryDuringRescan++;
    if (p[2] === 1 && p[5] === 0x85 && p[6] === 2) {
      // Attempt concurrent guard()-protected readConfig while receiverRescanBusy is true -> MUST be ignored!
      await storeG.readConfig();
    }
    return origSendG(id, p);
  };
  await storeG.rescanReceiverAfh();
  assert.equal(batteryDuringRescan, 0, 'guard() allowed concurrent HID traffic during quiet rescan!');

  // op=12 rejected (0xA2): must NOT claim mouse silence!
  devGuard.sendFeatureReport = async (id, p) => {
    if (p[5] === 0x7e && p[9] === 12) {
      devGuard.reply.fill(0);
      devGuard.reply.set([0xa2, 0, 2, 0, 1, 0x7e]);
      return;
    }
    return origSendG(id, p);
  };
  await storeG.rescanReceiverAfh();
  assert.match(storeG.state.message, /未进入静默/);

  // Quiet window overrun (> 515 ms elapsed): must NOT claim confirmed silent scan!
  devGuard.sendFeatureReport = async (id, p) => {
    if (p[2] === 1 && p[5] === 0x85 && p[6] === 2) {
      await new Promise(r => setTimeout(r, 520));
    }
    return origSendG(id, p);
  };
  await storeG.rescanReceiverAfh();
  assert.match(storeG.state.message, /可能已超时/);

  // 4. Codex P1-1 optical exclusivity + P2-4 cached 3s chTable mismatch & generation alignment + P2-5 u16 rollover!
  devGuard.sendFeatureReport = origSendG;
  storeG.state.opticalDiagBusy = true;
  let scansWhileOpticalBusy = 0;
  devGuard.sendFeatureReport = async (id, p) => {
    if (p[2] === 1 && p[5] === 0x85 && p[6] === 2) scansWhileOpticalBusy++;
    return origSendG(id, p);
  };
  await storeG.rescanReceiverAfh();
  assert.equal(scansWhileOpticalBusy, 0, 'rescanReceiverAfh ran while opticalDiagBusy was true!');
  storeG.state.opticalDiagBusy = false;

  let afReads = 0;
  devGuard.sendFeatureReport = async (id, p) => {
    if (p[2] === 1 && p[5] === 0x85 && (p[3] === 0 || p[6] === 0)) afReads++;
    return origSendG(id, p);
  };
  devGuard.receiverAfh.scanCount += 1;
  devGuard.receiverAfh.chTable = [74, 50, 24, 4, 62];
  devGuard.receiverAfh.activeCh = 74;
  devGuard.receiverAfh.chIdx = 0;
  devGuard.receiverAfh.crcErrCount = 65535;
  await storeG.readReceiverLinkQuality();
  assert.equal(afReads, 1, 'Autonomous scanCount change did not trigger full AF spectrum refresh!');
  assert.equal(storeG.state.receiverAfh.scanCount, devGuard.receiverAfh.scanCount);
  assert.deepEqual(storeG.state.receiverAfh.chTable, [2474, 2450, 2424, 2404, 2462]);
  // Cached 3s selection changes chTable/activeCh WITHOUT changing scanCount -> MUST still refresh AF!
  devGuard.receiverAfh.chTable = [72, 50, 24, 4, 62];
  devGuard.receiverAfh.activeCh = 72;
  await storeG.readReceiverLinkQuality();
  assert.equal(afReads, 2, 'Cached 3s chTable change without scanCount bump did not refresh AF!');
  assert.equal(storeG.state.receiverAfh.chTable[0], 2472);
  await new Promise(r => setTimeout(r, 220));
  devGuard.receiverAfh.rxOkCount += 100;
  devGuard.receiverAfh.crcErrCount = 1; // wrapped +2 modulo 65536 across 65535 -> 0 -> 1!
  await storeG.readReceiverLinkQuality();
  assert.ok(storeG.state.receiverLqCrcRatePct > 1.5 && storeG.state.receiverLqCrcRatePct < 2.5,
    `Modular CRC delta failed across u16 rollover: ${storeG.state.receiverLqCrcRatePct}`);
  await storeG.disconnect();
});

test('Rev 52 customizable Lift & Landing Guard encodes canonically, validates bounds, and round-trips through store', async () => {
  const f52 = {landingPolicy: true, customLandingGuard: true};
  const base = Uint8Array.from([7, 0, 0, 0, 1, 0x9f, 0, 0, 15, 0, 0, 0, 100, 0, 0, 0]);
  const def = decodeProfile(base);
  assert.equal(def.landingProtection, true);
  assert.equal(def.landingMask, 0x03);
  assert.equal(def.landingHoldMs, 28);
  assert.equal(def.airborneFloorMs, 8);
  assert.equal(def.airborneLockout, false);

  // Canonical defaults keep raw[14]=0, raw[15]=0, raw[2]=0
  const encDef = encodeProfile(base, def, 34, f52);
  assert.deepEqual([encDef[2], encDef[14], encDef[15]], [0, 0, 0]);

  // Custom hold + custom floor + 5-key mask
  const encCustom = encodeProfile(base, {
    ...def, landingHoldMs: 60, airborneFloorMs: 20, airborneLockout: false, landingMask: 0x1f
  }, 34, f52);
  assert.deepEqual([encCustom[2], encCustom[14], encCustom[15]], [20, 0xfe, 60]);
  assert.deepEqual(decodeProfile(encCustom), {
    ...def, landingHoldMs: 60, airborneFloorMs: 20, airborneLockout: false, landingMask: 0x1f
  });

  // Airborne lockout (255) + 0 ms hold + master OFF preserves custom settings
  const encLockOff = encodeProfile(base, {
    ...def, landingProtection: false, landingHoldMs: 0, airborneLockout: true, landingMask: 0x05
  }, 34, f52);
  assert.deepEqual([encLockOff[2], encLockOff[14], encLockOff[15]], [255, 0x97, 0]);
  const decLockOff = decodeProfile(encLockOff);
  assert.equal(decLockOff.landingProtection, false);
  assert.equal(decLockOff.landingHoldMs, 0);
  assert.equal(decLockOff.airborneLockout, true);
  assert.equal(decLockOff.airborneFloorMs, 8);
  assert.equal(decLockOff.landingMask, 0x05);

  // Validation rejects out-of-range / fractional inputs and malformed raw packets
  for (const bad of [
    {landingHoldMs: -1}, {landingHoldMs: 101}, {landingHoldMs: 12.5},
    {airborneFloorMs: -1}, {airborneFloorMs: 101}, {airborneFloorMs: 4.5},
    {landingMask: -1}, {landingMask: 32}, {landingProtection: 1}, {airborneLockout: 1}
  ]) {
    assert.throws(() => encodeProfile(base, {...def, ...bad}, 34, f52));
  }
  const badRaw1 = base.slice(); badRaw1[14] = 0x04; assert.throws(() => validateRawLandingGuard(badRaw1));
  const badRaw2 = base.slice(); badRaw2[2] = 8; assert.throws(() => validateRawLandingGuard(badRaw2));
  const badRaw3 = base.slice(); badRaw3[14] = 0x80; badRaw3[15] = 101; assert.throws(() => validateRawLandingGuard(badRaw3));
  const badRaw4 = base.slice(); badRaw4[14] = 0x80; badRaw4[2] = 200; assert.throws(() => validateRawLandingGuard(badRaw4));

  // DemoDevice enforces Rev 52 op=2 validation and Vue store stages, translates, saves, and resets cleanly
  const dev = new DemoDevice({implementationRevision: 52});
  dev.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await store.attach(dev);
  assert.equal(store.state.features.implementationRevision, 52);
  assert.equal(store.state.features.customLandingGuard, true);
  store.state.draft.landingHoldMs = '45';
  store.state.draft.airborneLockout = true;
  store.toggleLandingKey(2); // add MMB -> 0x07 (LMB, RMB, MMB)
  const draft = store.collectDraft();
  const rows = store.changeRows(draft);
  assert.deepEqual(rows.map(r => r.name), ['落地锁定', '空中防误触', '作用按键']);
  for (const lang of ['EN', 'JPN']) {
    store.languageChanged(lang);
    for (const row of rows) {
      if (lang === 'EN') {
        assert.ok(!/[\u4e00-\u9fff]/u.test(store.t(row.name)), row.name);
        assert.ok(!/[\u4e00-\u9fff]/u.test(store.t(row.before)), String(row.before));
        assert.ok(!/[\u4e00-\u9fff]/u.test(store.t(row.after)), String(row.after));
      } else {
        assert.ok(store.t(row.after).length > 0);
      }
    }
  }
  store.languageChanged('ZH');
  // Catch-all list template must NOT exist in i18n.js (Codex P2-6)
  assert.equal(translate('α、β', 'EN'), 'α、β');
  // Strict decimal integer parser rejects '', '1e2', '0x20', '28.5' (Codex P3-10)
  for (const badTxt of ['', ' ', '1e2', '0x20', '28.5', '-1']) {
    assert.ok(Number.isNaN(parseDecimalInt(badTxt)), badTxt);
  }
  assert.equal(parseDecimalInt(' 28 '), 28);
  assert.equal(parseDecimalInt('0'), 0);
  await store.applyPendingChanges();
  assert.equal(store.dirty.value, false);
  assert.deepEqual([dev.slots[0][2], dev.slots[0][14], dev.slots[0][15]], [255, 0x9e, 45]);
  // Reset defaults returns canonical legacy bytes [0, 0, 0]
  store.resetLandingDefaults();
  await store.applyPendingChanges();
  assert.deepEqual([dev.slots[0][2], dev.slots[0][14], dev.slots[0][15]], [0, 0, 0]);

  // Codex P2-4: Valid non-canonical Lift Guard bytes [raw[2]=8, raw[14]=0x8e, raw[15]=28] MUST NOT trigger op=2 on unrelated legacy edit!
  dev.slots[0][2] = 8; dev.slots[0][14] = 0x8e; dev.slots[0][15] = 28;
  await store.readConfig();
  let op2Sent = 0;
  const origSend = dev.sendFeatureReport.bind(dev);
  dev.sendFeatureReport = async (id, pkt) => {
    if (pkt[5] === 0x7e && pkt[9] === 2) op2Sent++;
    return origSend(id, pkt);
  };
  store.state.legacy.ripple = 1;
  assert.deepEqual(store.pendingChanges.value.rows.map(r => r.name), ['波纹控制']);
  await store.applyPendingChanges();
  assert.equal(op2Sent, 0, 'Unrelated legacy edit unexpectedly rewrote valid non-canonical Lift Guard bytes!');
  assert.deepEqual([dev.slots[0][2], dev.slots[0][14], dev.slots[0][15]], [8, 0x8e, 28]);
  await store.disconnect();

  // Codex P2-5 & Firmware P3-1: putProfile & DemoDevice reject raw[4]=2, raw[5]=0x01/0xA0, timing>1000, FPS=35, extra op=2 arg!
  const devV = new DemoDevice({implementationRevision: 52});
  const tV = new HidTransport(devV, {interval: 1}), cV = new LunaClient(tV, definitions);
  await cV.info();
  const goodRaw = await cV.getProfile(1);
  for (const mutate of [
    r => { r[4] = 2; },
    r => { r[5] = 0x01; },
    r => { r[5] = 0xa0; },
    r => { r[0] = 35; },
    r => { r[6] = 0x00; r[7] = 0x04; }, // 1024 > 1000
  ]) {
    const bad = goodRaw.slice(); mutate(bad);
    assert.throws(() => validateRawProfile(bad, 34, cV.features));
    await assert.rejects(cV.putProfile(1, bad));
    await assert.rejects(cV.extension(2, 1, ...bad));
  }
  await assert.rejects(cV.extension(2, 1, ...goodRaw, 0)); // extra byte rejected by DemoDevice!
  await tV.close();

  // Codex P2-5: Legacy ABLOD (variantId=6) DemoDevice negotiates cleanly with default args and Rev 51 rejects raw[1]=1!
  const dev6 = new DemoDevice({variantId: 6});
  dev6.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const store6 = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await store6.attach(dev6);
  assert.equal(store6.dirty.value, false);
  assert.equal(store6.pendingChanges.value.error, '');
  await store6.disconnect();
  const dev51 = new DemoDevice({implementationRevision: 51});
  const t51v = new HidTransport(dev51, {interval: 1}), c51v = new LunaClient(t51v, definitions);
  await c51v.info();
  const raw51 = await c51v.getProfile(1); raw51[1] = 1;
  await assert.rejects(c51v.extension(2, 1, ...raw51));
  await t51v.close();
});

test('independent X/Y DPI edits, diff preview, and hardware round-trip through store', async () => {
  const dev = new DemoDevice({implementationRevision: 52, variantId: 2});
  dev.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await store.attach(dev);

  // Active stage starts linked at 1600/1600 (stage 3 in DemoDevice)
  assert.deepEqual(
    {x: store.state.dpiDraft.stages[2].x, y: store.state.dpiDraft.stages[2].y},
    {x: 1600, y: 1600}
  );

  // Split X and Y independently
  store.setActiveDpiValue(1800, 'x');
  store.setActiveDpiValue(1200, 'y');
  store.stepActiveDpi(50, 'y');
  assert.equal(store.state.dpiDraft.stages[2].x, 1800);
  assert.equal(store.state.dpiDraft.stages[2].y, 1250);

  // Diff preview formats diverged stage as X/Y
  const dpiRow = store.pendingChanges.value.rows.find(r => r.name === 'DPI 档位');
  assert.ok(dpiRow, 'expected DPI diff row');
  assert.ok(dpiRow.after.includes('1800/1250'), dpiRow.after);

  // Apply and verify readback on DemoDevice
  await store.applyPendingChanges();
  assert.equal(store.dirty.value, false);
  assert.deepEqual(dev.dpiStages[0][2], [1800, 1250]);
  assert.equal(store.state.base.dpiStages[2].x, 1800);
  assert.equal(store.state.base.dpiStages[2].y, 1250);

  // Linked edit re-syncs both axes cleanly
  store.setActiveDpiValue(2000);
  assert.equal(store.state.dpiDraft.stages[2].x, 2000);
  assert.equal(store.state.dpiDraft.stages[2].y, 2000);

  // addDpiStage preserves split offset when previous stage is split
  store.selectDpiStage(4);
  store.setActiveDpiValue(3200, 'x');
  store.setActiveDpiValue(2400, 'y');
  store.addDpiStage();
  assert.equal(store.state.dpiDraft.stages.at(-1).x, 3600);
  assert.equal(store.state.dpiDraft.stages.at(-1).y, 2800);

  await store.disconnect();
});

test('1-4 slot JSON export/import and one-click slot copy validate, confirm, and persist cleanly', async () => {
  const dev = new DemoDevice({implementationRevision: 52, variantId: 2});
  dev.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await store.attach(dev);

  // Configure distinct settings on Slot 1 (split X/Y DPI, Rev 52 Lift Guard, per-button debounce, angle, sleep)
  store.setActiveDpiValue(1600, 'x');
  store.setActiveDpiValue(1200, 'y');
  store.state.draft.fps = 7;
  store.state.draft.landingHoldMs = 42;
  store.state.draft.airborneLockout = true;
  store.state.draft.landingMask = 0x07;
  store.state.draft.buttons[1] = {enabled: true, pre: 0.5, post: 1, plock: 2, relock: 4};
  store.state.sleepDraft = 600;
  store.state.angleTuneDraft = -5;
  await store.applyPendingChanges();
  assert.equal(store.dirty.value, false);

  // 1. Export all 4 slots into canonical JSON
  const backup = await store.buildAllProfilesBackup();
  assert.equal(backup.format, 'hyperluna-profiles-v1');
  assert.deepEqual(Object.keys(backup.slots).sort(), ['1', '2', '3', '4']);
  assert.deepEqual(backup.slots['1'].dpi.stages[2].x, 1600);
  assert.deepEqual(backup.slots['1'].dpi.stages[2].y, 1200);
  assert.equal(backup.slots['1'].landingHoldMs, 42);
  assert.equal(backup.slots['1'].airborneLockout, true);
  assert.equal(backup.slots['1'].landingMask, 0x07);
  assert.equal(backup.slots['1'].buttons[1].pre, 0.5);
  assert.equal(backup.slots['1'].sleepSeconds, 600);
  assert.equal(backup.slots['1'].angleTune, -5);

  // 2. Copy Slot 1 -> Slot 2 (single-slot copy opens field-level confirmation modal)
  await store.prepareCopySlot([2]);
  assert.equal(store.state.reviewVisible, true);
  assert.equal(store.state.reviewKicker, 'PROFILE COPY');
  assert.equal(store.state.reviewTitle, '复制配置 1 到配置 2');
  assert.ok(store.state.reviewRows.length >= 4);
  await store.confirmReview();
  assert.equal(store.state.reviewVisible, false);
  assert.deepEqual(dev.dpiStages[1][2], [1600, 1200]);
  assert.equal(dev.sleepWire[1], 600);
  assert.equal(dev.angleTune[1], -5);
  assert.deepEqual(Array.from(dev.slots[1]), Array.from(dev.slots[0]));
  assert.deepEqual(Array.from(dev.buttons[1][1]), Array.from(dev.buttons[0][1]));

  // Re-copying identical Slot 1 -> Slot 2 is a safe no-op
  await store.prepareCopySlot([2]);
  assert.equal(store.state.reviewVisible, false);
  assert.equal(store.state.message, '目标槽位与当前配置已完全一致，无需复制。');

  // 3. Multi-slot copy Slot 1 -> Slots 3 & 4
  await store.prepareCopySlot([3, 4]);
  assert.equal(store.state.reviewVisible, true);
  assert.equal(store.state.reviewRows.length, 2);
  await store.confirmReview();
  assert.deepEqual(dev.dpiStages[2][2], [1600, 1200]);
  assert.deepEqual(dev.dpiStages[3][2], [1600, 1200]);

  // 4. Import backup back onto modified mouse -> restores Slot 2/3/4 back to backup defaults
  const fakeFile = obj => ({
    size: JSON.stringify(obj).length,
    text: async () => JSON.stringify(obj)
  });
  await store.prepareImportProfiles(fakeFile(backup));
  assert.equal(store.state.reviewVisible, true);
  assert.equal(store.state.reviewKicker, 'PROFILE IMPORT');
  assert.equal(store.state.reviewTitle, '导入 3 组配置');
  await store.confirmReview();
  assert.equal(store.state.reviewVisible, false);
  assert.deepEqual(dev.dpiStages[1][2], [1600, 1600]);
  assert.equal(dev.sleepWire[1], 300);
  assert.equal(dev.angleTune[1], 0);
  assert.deepEqual(dev.dpiStages[0][2], [1600, 1200]);

  // 5. Importing identical backup again is a clean no-op
  await store.prepareImportProfiles(fakeFile(backup));
  assert.equal(store.state.reviewVisible, false);
  assert.equal(store.state.message, '导入配置与鼠标当前配置一致，无需写入。');

  // 6. Malformed format / invalid slot key / oversized file are rejected without opening modal
  await store.prepareImportProfiles(fakeFile({format: 'wrong', slots: {}}));
  assert.equal(store.state.hasError, true);
  assert.equal(store.state.reviewVisible, false);

  await store.prepareImportProfiles(fakeFile({format: 'hyperluna-profiles-v1', slots: {'5': backup.slots['1']}}));
  assert.equal(store.state.hasError, true);
  assert.equal(store.state.reviewVisible, false);

  // 7. Dirty draft blocks copy/export/import
  store.setActiveDpiValue(2000, 'x');
  assert.equal(store.dirty.value, true);
  await store.prepareCopySlot([2]);
  assert.equal(store.state.hasError, true);
  assert.equal(store.state.reviewVisible, false);
  store.discardChanges();
  await store.disconnect();

  // 8. Legacy Rev 50 device rejects custom Rev 52 Lift Guard backup cleanly without writing
  const dev50 = new DemoDevice({implementationRevision: 50, variantId: 2});
  dev50.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const store50 = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await store50.attach(dev50);
  await store50.prepareImportProfiles(fakeFile(backup));
  assert.equal(store50.state.hasError, true);
  assert.equal(store50.state.message, '当前固件不支持自定义抬起防误触参数');
  assert.equal(store50.state.reviewVisible, false);
  await store50.disconnect();

  // 9. Wired USB (PID 0x0032) rejects importing >1000 Hz wireless backup cleanly
  const devWired = new DemoDevice({implementationRevision: 52, variantId: 2});
  devWired.productId = 0x0032;
  devWired.legacy.forEach(l => { l.polling = 1; });
  devWired.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const storeWired = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  await storeWired.attach(devWired);
  await storeWired.prepareImportProfiles(fakeFile(backup));
  assert.equal(storeWired.state.hasError, true);
  assert.equal(storeWired.state.message, '有线回报率最高为 1000 Hz，请连接无线接收器后设置');
  assert.equal(storeWired.state.reviewVisible, false);
  await storeWired.disconnect();
});

test('JavaScript LF33 client executes extension protocol on the actual patched ARM model', {timeout: 60000, skip: !existsSync(new URL('../../.hyperdrako-analysis-venv/Scripts/python.exe', import.meta.url)) || !existsSync(canonicalPath)}, async () => {
  const python = fileURLToPath(new URL('../../.hyperdrako-analysis-venv/Scripts/python.exe', import.meta.url));
  const worker = fileURLToPath(new URL('./arm-worker.py', import.meta.url));
  const child = spawn(python, ['-X', 'utf8', '-B', worker], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  const waiting = []; let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', e => { while (waiting.length) waiting.shift().reject(e); });
  child.on('exit', code => { while (waiting.length) waiting.shift().reject(Error(`ARM worker exited ${code}: ${stderr}`)); });
  const lines = createInterface({input: child.stdout});
  lines.on('line', line => {
    const pending = waiting.shift(); if (!pending) return;
    try { const data = JSON.parse(line); if (data.error) pending.reject(Error(data.error)); else pending.resolve(Uint8Array.from(data.reply)); } catch (e) { pending.reject(e); }
  });
  const transport = {
    exchange(command, payload, group = 1) {
      return new Promise((resolve, reject) => { waiting.push({resolve, reject}); child.stdin.write(JSON.stringify({command, payload: Array.from(payload), group}) + '\n'); });
    }
  };
  try {
    const client = new LunaClient(transport, definitions); assert.equal((await client.info()).counterCount, 32);
    const raw = await client.getProfile(1), requested = encodeProfile(raw, {fps: 7, debounce: true, pre: 0, post: 1.5, plock: 0, relock: 10});
    await client.putProfile(1, requested); assert.deepEqual(decodeProfile(await client.getProfile(1)), decodeProfile(requested));
    for (let slot = 2; slot <= 4; slot++) assert.equal((await client.getProfile(slot)).length, 16);
    assert.equal(await client.telemetry(), false); await assert.rejects(client.telemetry(1));
    await assert.rejects(client.statistics());
    const old = await client.peek(24, 122); await client.poke(24, 122, 138); assert.equal(await client.peek(24, 122), 138); await client.poke(24, 122, old);
  } finally { child.stdin.end(); lines.close(); child.kill(); }
});
