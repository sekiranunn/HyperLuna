import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  OPTICAL_DIAG_REGS,
  decodeOpticalDiagnostics,
  computeGripAngle,
  computeTrueDpi,
  createPollingTracker,
  pushPollingEvents,
  analyzePollingSamples,
  analyzeSwitchEvents
} from '../src/lib/calibration.js';
import {createDriverStore} from '../src/store/driver.js';
import {DemoDevice} from '../advanced/demo.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));

test('decodeOpticalDiagnostics accurately parses PAW3950 Page 0 optical registers and grades surfaces', () => {
  const real = decodeOpticalDiagnostics({
    productId: 0x53,
    revisionId: 0x00,
    motion: 0x24,
    squal: 0x90,
    rawMean: 0x73,
    rawMax: 0x7a,
    rawMin: 0x3f,
    shutterLow: 0x00,
    shutterHigh: 0x02,
    mode: 0x83
  });
  assert.equal(real.isPaw3950, true);
  assert.equal(real.lifted, false);
  assert.equal(real.squal, 144);
  assert.equal(real.featuresCount, 576);
  assert.equal(real.squalGrade, 'excellent');
  assert.equal(real.contrast, 59);
  assert.equal(real.contrastGrade, 'high');
  assert.equal(real.shutter, 512);
  assert.equal(real.exposureState, 'balanced');
  assert.equal(real.awake, true);
  assert.equal(real.perfCode, 3);

  const reflectiveGlass = decodeOpticalDiagnostics({
    productId: 0x53,
    motion: 0x24,
    squal: 60,
    rawMean: 118,
    rawMax: 127,
    rawMin: 108,
    shutterLow: 0xc8, // 200 ticks (AGC shortened shutter for bright glass)
    shutterHigh: 0x00,
    mode: 0x83
  });
  assert.equal(reflectiveGlass.contrast, 19);
  assert.equal(reflectiveGlass.contrastGrade, 'low');
  assert.equal(reflectiveGlass.exposureState, 'bright');

  const liftedDark = decodeOpticalDiagnostics({
    productId: 0x53,
    motion: 0x34, // bit 4 set = lifted
    squal: 30,
    rawMean: 22,
    rawMax: 40,
    rawMin: 10,
    shutterLow: 0xa0,
    shutterHigh: 0x07, // 1952 ticks
    mode: 0x00
  });
  assert.equal(liftedDark.lifted, true);
  assert.equal(liftedDark.squalGrade, 'poor');
  assert.equal(liftedDark.contrastGrade, 'normal');
  assert.equal(liftedDark.exposureState, 'dark');
  assert.equal(liftedDark.shutter, 1952);
});

test('computeGripAngle reinforces bidirectional left/right swipes, computes linearity, and clamps to +/-30 deg', () => {
  // Simulate swiping back and forth at +6 deg (tan(6 deg) ~= 0.1051)
  const samples = [];
  const slope = Math.tan((6 * Math.PI) / 180);
  for (let i = 0; i < 20; i++) samples.push({dx: 10, dy: 10 * slope});
  for (let i = 0; i < 20; i++) samples.push({dx: -10, dy: -10 * slope});

  const res = computeGripAngle(samples, {currentAngle: 2});
  assert.equal(res.ready, true);
  assert.ok(Math.abs(res.tiltDeg - 6) < 0.05, `expected ~6 deg, got ${res.tiltDeg}`);
  assert.ok(res.linearity > 0.99);
  assert.equal(res.recommendedAngle, 8);

  const inv = computeGripAngle(samples, {currentAngle: 2, invertCompensation: true});
  assert.equal(inv.recommendedAngle, -4);

  // Extreme currentAngle + delta clamps cleanly to [-30, +30]
  const clamped = computeGripAngle(samples, {currentAngle: 28});
  assert.equal(clamped.recommendedAngle, 30);
});

test('computeTrueDpi measures physical ruler distance and quantizes compensated DPI to 50 DPI steps', () => {
  // 100 mm = 3.93700787 inches. If sensor reads +4% high at 1600 DPI -> ~6551 counts -> measured ~1664 DPI
  const counts = Math.round((100 / 25.4) * 1664);
  const res = computeTrueDpi(counts, 0, 100, 1600);
  assert.equal(res.ready, true);
  assert.equal(res.measuredDpi, 1664);
  assert.equal(res.deviationPct, 4);
  // 1600^2 / 1664 = 1538.46 -> nearest 50 step = 1550
  assert.equal(res.compensatedDpi, 1550);

  const shortDrag = computeTrueDpi(5, 0, 100, 1600);
  assert.equal(shortDrag.ready, false);
});

test('analyzePollingSamples computes Hz, median/P95/P99, MAD jitter, IPS, and 12-bin histogram', () => {
  // 100 events near 1.0 ms (1000 Hz) with tiny jitter
  const dts = Array.from({length: 100}, (_, i) => (i % 5 === 0 ? 1.05 : i % 5 === 1 ? 0.95 : 1.0));
  const counts = Array.from({length: 100}, () => 40);
  const res = analyzePollingSamples(dts, counts, 1600);
  assert.equal(res.ready, true);
  assert.equal(res.count, 100);
  assert.equal(res.avgHz, 1000);
  assert.equal(res.medianMs, 1);
  assert.equal(res.madUs, 0);
  assert.ok(res.peakIps > 24 && res.peakIps < 27);
  assert.equal(res.buckets.length, 12);

  // Coalesced 4000 Hz stream quantized to 1.0 ms OS timer ticks (4 packets sharing each ms timestamp)
  const tr = createPollingTracker(500);
  const quantizedBatch = [];
  for (let ms = 100; ms <= 125; ms++) {
    for (let k = 0; k < 4; k++) quantizedBatch.push({timeStamp: ms, movementX: 4, movementY: 0});
  }
  pushPollingEvents(tr, quantizedBatch);
  const qRes = analyzePollingSamples(tr.intervals, tr.counts, 1600);
  assert.equal(qRes.ready, true);
  assert.equal(qRes.avgHz, 4000);
  assert.equal(qRes.medianMs, 0.25);

  // 100 ms sliding window filters short OS HID flush bursts (12 packets in 0.96 ms) on a steady 4000 Hz stream
  const burstStream = [
    ...Array.from({length: 500}, () => 0.25),
    2.04,
    ...Array.from({length: 12}, () => 0.08),
    ...Array.from({length: 500}, () => 0.25)
  ];
  const bRes = analyzePollingSamples(burstStream, burstStream.map(() => 4), 1600);
  assert.equal(bRes.ready, true);
  assert.ok(bRes.peakHz >= 3950 && bRes.peakHz <= 4200, `expected 100 ms peakHz near 4000 Hz, got ${bRes.peakHz}`);

  // Sustained 150 ms burst at 4000 Hz inside a 2000 Hz stream is still detected accurately
  const mixedStream = [
    ...Array.from({length: 400}, () => 0.5),
    ...Array.from({length: 600}, () => 0.25),
    ...Array.from({length: 400}, () => 0.5)
  ];
  const mRes = analyzePollingSamples(mixedStream, mixedStream.map(() => 4), 1600);
  assert.equal(mRes.ready, true);
  assert.equal(mRes.peakHz, 4000);
  assert.ok(mRes.avgHz < 3000);
});

test('analyzeSwitchEvents flags real <25 ms double-click chatter and <8 ms micro holds without penalizing fast clicking', () => {
  const events = [
    // Normal rapid LMB clicking (~35 ms gap, 40 ms hold) — must NOT false-flag!
    {button: 0, type: 'down', t: 100},
    {button: 0, type: 'up', t: 140},
    {button: 0, type: 'down', t: 175},
    {button: 0, type: 'up', t: 215},
    // Real switch bounce LMB (16 ms gap after release + 6 ms micro-hold pulse!)
    {button: 0, type: 'down', t: 231},
    {button: 0, type: 'up', t: 237},
    // Normal RMB click
    {button: 2, type: 'down', t: 300},
    {button: 2, type: 'up', t: 350},
    {button: 2, type: 'down', t: 480},
    {button: 2, type: 'up', t: 535}
  ];
  const res = analyzeSwitchEvents(events, {chatterMs: 25, minHoldMs: 8});
  assert.equal(res.byButton[0].presses, 3);
  assert.equal(res.byButton[0].chatterCount, 1);
  assert.equal(res.byButton[0].microHoldCount, 1);
  assert.equal(res.byButton[0].minGapMs, 16);
  assert.equal(res.byButton[0].minHoldMs, 6);
  assert.equal(res.byButton[2].presses, 2);
  assert.equal(res.byButton[2].chatterCount, 0);
  assert.equal(res.byButton[2].minGapMs, 130);
});

test('driver store readOpticalDiagnostics performs read-only op=7 queries and recognizes Rev 48/49/50', async () => {
  for (const rev of [48, 49, 50]) {
    const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
    const device = new DemoDevice({implementationRevision: rev});
    device.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
    const sent = [];
    const origSend = device.sendFeatureReport.bind(device);
    device.sendFeatureReport = async (id, pkt) => { sent.push([...pkt]); await origSend(id, pkt); };

    try {
      await store.attach(device);
      assert.equal(store.state.connected, true);
      assert.equal(store.state.features.implementationRevision, rev);

      const beforeLen = sent.length;
      await store.readOpticalDiagnostics();
      const diagPackets = sent.slice(beforeLen);
      assert.equal(diagPackets.length, OPTICAL_DIAG_REGS.length);
      assert.ok(diagPackets.every(p => p[5] === 0x7e && p[9] === 7));
      assert.equal(store.state.opticalDiag.isPaw3950, true);
      assert.equal(store.state.opticalDiag.squal, 144);
      assert.equal(store.state.opticalDiag.shutter, 512);

      store.saveOpticalBaseline();
      assert.equal(store.state.opticalBaseline.squal, 144);
      store.clearOpticalBaseline();
      assert.equal(store.state.opticalBaseline, null);
    } finally {
      await store.disconnect();
    }
  }
});

test('peek automatically retries transient 0xA2 SPI-busy replies and surfaces clear error if sensor stays busy', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const device = new DemoDevice({implementationRevision: 50});
  device.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  const origSend = device.sendFeatureReport.bind(device);

  // Inject transient 0xA2 collisions on the first 2 reads of reg 00:08 and 00:40
  const busyCounts = new Map([['0:8', 2], ['0:64', 2]]);
  let peekAttempts = 0;
  device.sendFeatureReport = async (id, pkt) => {
    await origSend(id, pkt);
    if (pkt[5] === 0x7e && pkt[9] === 7) {
      peekAttempts++;
      const key = `${pkt[10]}:${pkt[11]}`;
      const left = busyCounts.get(key) || 0;
      if (left > 0) {
        busyCounts.set(key, left - 1);
        device.reply = new Uint8Array(64);
        device.reply.set([0xa2, 0, pkt[2], 6, 1, 0x7e, 0x4c, 0x46, 1, 7, pkt[10], pkt[11]]);
      }
    }
  };

  try {
    await store.attach(device);
    await store.readOpticalDiagnostics();
    assert.equal(store.state.hasError, false);
    assert.equal(store.state.opticalDiag.rawMean, 0x73);
    assert.equal(store.state.opticalDiag.mode, 0x83);
    assert.equal(peekAttempts, OPTICAL_DIAG_REGS.length + 4);

    // Persistent 0xA2 (e.g., mouse resting) reports clear user-facing error instead of raw 0xA2
    busyCounts.set('0:0', 99);
    await store.readOpticalDiagnostics();
    assert.equal(store.state.hasError, true);
    assert.equal(store.state.message, '传感器正忙或处于休眠态，请轻移鼠标唤醒后重试');

    // Non-0xA2 rejection (e.g., 0xA3 unsupported) fails immediately without retrying
    let a3Attempts = 0;
    device.sendFeatureReport = async (id, pkt) => {
      await origSend(id, pkt);
      if (pkt[5] === 0x7e && pkt[9] === 7) {
        a3Attempts++;
        device.reply = new Uint8Array(64);
        device.reply.set([0xa3, 0, pkt[2], 6, 1, 0x7e, 0x4c, 0x46, 1, 7, pkt[10], pkt[11]]);
      }
    };
    await store.readOpticalDiagnostics();
    assert.equal(a3Attempts, 1);
    assert.equal(store.state.hasError, true);
    assert.equal(store.state.message, '设备拒绝命令（0xA3）');
  } finally {
    await store.disconnect();
  }
});
