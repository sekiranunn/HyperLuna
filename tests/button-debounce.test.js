import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {
  HidTransport, LunaClient, packet, normalize, matches,
  encodeTimings, decodeTimings, encodeProfile, decodeProfile,
  buttonMask, equalButtons, BUTTONS
} from '../advanced/protocol.js';
import {DemoDevice} from '../advanced/demo.js';
import {decodeFeatures} from '../advanced/features.js';
import {createDriverStore} from '../src/store/driver.js';
import {translate} from '../i18n.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));
const times = n => ({pre: n, post: n + 0.1, plock: n + 0.2, relock: n + 0.3});

function device() {
  const d = new DemoDevice({independentDebounce: true});
  d.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  return d;
}

test('five independent switches reject unknown schemas and exclude the bottom button', async () => {
  const d = device();
  await d.sendFeatureReport(0, packet(126, [76, 70, 1, 0]));
  const r = normalize(await d.receiveFeatureReport(0));
  assert.equal(r.length, 23);
  assert.equal(decodeFeatures(r).perButtonDebounce, true);
  assert.equal(decodeFeatures(r).independentDebounce, true);
  assert.equal(decodeFeatures(r).buttonCount, 5);
  for (const [offset, value] of [[17, 99], [18, 0], [19, 3], [20, 6], [20, 7]]) {
    const bad = r.slice(); bad[offset] = value;
    assert.throws(() => decodeFeatures(bad));
  }
  assert.deepEqual(BUTTONS.map(b => b.id), [0, 1, 2, 4, 3]);
});

test('button timing encoding is precise and validates all four fields', () => {
  for (const values of [times(0), times(1.2), {pre: 100, post: 0, plock: 12.3, relock: 99.9}]) {
    assert.deepEqual(decodeTimings(encodeTimings(values)), values);
  }
  for (const key of ['pre', 'post', 'plock', 'relock']) {
    for (const invalid of [-1, 100.1, NaN, Infinity, 0.01, undefined, '2']) {
      assert.throws(() => encodeTimings({...times(1), [key]: invalid}));
    }
  }
  assert.throws(() => encodeTimings(times(1), {debounce: 'ms'}), /整数/);
  assert.throws(() => decodeTimings(new Uint8Array(7)));
});

test('cached replies must match slot, hardware key, and all four written timings', async () => {
  const d = device(), payload = [76, 70, 1, 9, 2, 4, ...encodeTimings(times(2))];
  await d.sendFeatureReport(0, packet(126, payload));
  const r = normalize(await d.receiveFeatureReport(0));
  assert.ok(matches(r, 126, payload));
  for (const index of [10, 11, 12, 14, 16, 18]) {
    const stale = r.slice(); stale[index] ^= 1;
    assert.ok(!matches(stale, 126, payload));
  }
  assert.ok(!matches(r.slice(0, 19), 126, payload));
});

test('every button and profile stays independent; a lost write ACK uses readback without resending', async () => {
  const d = device(), records = [], t = new HidTransport(d, {interval: 1, timeout: 5, log: r => records.push(r)}), c = new LunaClient(t, definitions);
  await c.info();
  const old = await c.read(1);
  assert.equal(old.buttons.length, 5);
  assert.ok(records.every(r => r.readonly));
  const send = d.sendFeatureReport.bind(d); let writes = 0;
  d.sendFeatureReport = async (id, p) => { await send(id, p); if (p[5] === 126 && p[9] === 9) { writes++; d.reply.fill(0); } };
  const result = await c.putButtonTimings(2, 4, times(2));
  assert.equal(result.timeout, true);
  assert.equal(writes, 1);
  assert.deepEqual(await c.getButtonTimings(2, 4), times(2));
  assert.ok(equalButtons((await c.read(1)).buttons, old.buttons));
  for (const key of [0, 1, 2, 3]) assert.deepEqual(await c.getButtonTimings(2, key), {pre: 0, post: 0, plock: 0, relock: 0});
  const count = records.length;
  for (const [slot, key] of [[0, 0], [5, 0], [1, -1], [1, 5], [1, 6], [1, 0.5]]) {
    await assert.rejects(c.putButtonTimings(slot, key, times(1)));
  }
  assert.equal(records.length, count);
  await t.close();
  const legacy = new LunaClient(new HidTransport(new DemoDevice({variantId: 6, perButtonDebounce: false, independentDebounce: false}), {interval: 1}), definitions);
  await legacy.info();
  await assert.rejects(legacy.putButtonTimings(1, 0, times(1)), /不支持逐键/);
  await legacy.transport.close();
});

test('Vue 3 store independently switches five keys and saves only changed timing policies', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const d = device(), packets = [], send = d.sendFeatureReport.bind(d);
  d.sendFeatureReport = async (id, p) => { packets.push([...p]); await send(id, p); };
  await store.attach(d);
  assert.ok(store.state.features.perButtonDebounce);
  assert.equal(store.dirty.value, false);
  const before = store.cloneBase();
  for (const button of BUTTONS) {
    store.state.selectedButton = button.id;
    Object.assign(store.debounceDraft.value, times(button.id + 1));
  }
  store.state.draft.buttons[1].enabled = false;
  store.state.draft.buttons[3].enabled = false;
  const draft = store.collectDraft(), rows = store.changeRows(draft);
  assert.equal(rows.filter(r => r.name === '自定义消抖').length, 0);
  assert.equal(rows.filter(r => r.name.endsWith('：自定义消抖')).length, 2);
  assert.equal(rows.filter(r => r.name.includes('：')).length, 22);
  assert.equal(draft.patch.buttons.length, 5);
  assert.equal(buttonMask(draft.raw), 21);
  packets.length = 0;
  await store.applySettings(draft, before);
  assert.equal(store.dirty.value, false);
  assert.equal(buttonMask(store.state.base.raw), 21);
  for (let key = 0; key < 5; key++) {
    assert.deepEqual(store.state.base.buttons[key], {...times(key + 1), enabled: ![1, 3].includes(key)});
  }
  const keyWrites = packets.filter(p => p[5] === 126 && p[9] === 9);
  assert.deepEqual(keyWrites.map(p => p[11]), [1, 2, 3, 4]);
  assert.equal(packets.filter(p => p[5] === 126 && p[9] === 2).length, 1);
  for (const language of ['EN', 'JPN']) {
    for (const row of rows) {
      assert.ok(!/[\u4e00-\u9fff]/u.test(language === 'EN' ? translate(row.name, language) : ''));
    }
  }
  const vue = readFileSync(new URL('../src/components/ButtonsTab.vue', import.meta.url), 'utf8');
  assert.ok(vue.includes('store.debounceDraft.value[field.key]'));
  assert.ok(vue.includes('store.debounceDraft.value.enabled'));
  assert.ok(!vue.includes('在线驱动暂不提供固件更新'));
  assert.ok(!vue.includes('浏览器仍未向网页返回 DFU 接口'));
  await store.disconnect();
});

test('a change to another key after preview prevents any write', async () => {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const d = device();
  await store.attach(d);
  store.state.draft.buttons[1].pre = 2;
  const draft = store.collectDraft();
  const expected = store.cloneBase();
  d.slots[0][5] = 128 | 15;
  let writes = 0;
  const send = d.sendFeatureReport.bind(d);
  d.sendFeatureReport = async (id, p) => { if (p[5] === 126 && [2, 9].includes(p[9])) writes++; await send(id, p); };
  await assert.rejects(store.applySettings(draft, expected), /其他操作改变/);
  assert.equal(writes, 0);
  await store.disconnect();
});

const port = fileURLToPath(new URL('../../lunafury-analysis/port', import.meta.url));
const python = fileURLToPath(new URL('../../.hyperdrako-analysis-venv/Scripts/python.exe', import.meta.url));
test(
  'browser client writes five-key policies, switch masks, and Rev 52+ custom Lift Guard on the unified Rev 53 LUNA33_HYPERLUNA ARM image',
  {timeout: 120000, skip: !existsSync(port + '/abs_stream_rev53_mouse_patch.py') || !existsSync(python)},
  async () => {
    const code = `import sys,json
sys.path.insert(0,sys.argv[1])
import abs_stream_rev53_mouse_patch as rev53,full_model
m=full_model.FullModel(*rev53.build())
for line in sys.stdin:
 try:
  q=json.loads(line)
  r=m.protocol(q['command'],q['payload'],q['group'],outer=True)
  print(json.dumps({'reply':list(r)}),flush=True)
 except Exception as e: print(json.dumps({'error':str(e)}),flush=True)
`;
    const child = spawn(python, ['-X', 'utf8', '-B', '-c', code, port], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    const waiting = []; let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { while (waiting.length) waiting.shift().reject(error); });
    child.on('exit', exit => { while (waiting.length) waiting.shift().reject(Error(`ARM exited ${exit}: ${stderr}`)); });
    const lines = createInterface({input: child.stdout});
    lines.on('line', line => {
      const pending = waiting.shift(); if (!pending) return;
      try { const r = JSON.parse(line); if (r.error) pending.reject(Error(r.error)); else pending.resolve(Uint8Array.from(r.reply)); }
      catch (e) { pending.reject(e); }
    });
    const c = new LunaClient({
      exchange(command, payload, group = 1) {
        return new Promise((resolve, reject) => {
          waiting.push({resolve, reject});
          child.stdin.write(JSON.stringify({command, payload: [...payload], group}) + '\n');
        });
      }
    }, definitions);
    try {
      const features = (await c.info()).features;
      assert.equal(features.independentDebounce, true);
      assert.equal(c.phaseDiagnostics, undefined);
      assert.equal(features.name, 'LUNA33_HYPERLUNA');
      assert.equal(features.implementationRevision, 53);
      assert.equal(features.quietWindow, true);
      assert.equal(features.customLandingGuard, true);
      assert.equal(features.buttonCount, 5);
      const policy = n => features.debounce === 'ms' ? {pre: n, post: n + 1, plock: n + 2, relock: n + 3} : times(n);
      for (let slot = 1; slot <= 4; slot++) for (let key = 0; key < 5; key++) await c.putButtonTimings(slot, key, policy(slot * 5 + key));
      for (let slot = 1; slot <= 4; slot++) for (let key = 0; key < 5; key++) assert.deepEqual(await c.getButtonTimings(slot, key), policy(slot * 5 + key));
      for (let mask = 0; mask < 32; mask++) {
        const raw = await c.getProfile(1), value = decodeProfile(raw);
        value.buttons = Array.from({length: 5}, (_, key) => ({enabled: Boolean(mask & (1 << key))}));
        const requested = encodeProfile(raw, value, 34, features);
        await c.putProfile(1, requested);
        assert.equal(buttonMask(await c.getProfile(1)), mask);
      }
      // Rev 52 custom Lift Guard round-trip on live ARM image
      const liftCases = [
        {landingProtection: true, landingHoldMs: 60, airborneFloorMs: 20, airborneLockout: false, landingMask: 0x1f},
        {landingProtection: true, landingHoldMs: 0, airborneFloorMs: 8, airborneLockout: true, landingMask: 0x05},
        {landingProtection: false, landingHoldMs: 42, airborneFloorMs: 12, airborneLockout: false, landingMask: 0x18},
        {landingProtection: true, landingHoldMs: 28, airborneFloorMs: 8, airborneLockout: false, landingMask: 0x03}
      ];
      for (const cfg of liftCases) {
        const raw = await c.getProfile(1), value = {...decodeProfile(raw), ...cfg};
        value.buttons = Array.from({length: 5}, () => ({enabled: true}));
        const requested = encodeProfile(raw, value, 34, features);
        await c.putProfile(1, requested);
        const readback = decodeProfile(await c.getProfile(1));
        assert.equal(readback.landingProtection, cfg.landingProtection);
        assert.equal(readback.landingHoldMs, cfg.landingHoldMs);
        assert.equal(readback.airborneLockout, cfg.airborneLockout);
        assert.equal(readback.airborneFloorMs, cfg.airborneLockout ? 8 : cfg.airborneFloorMs);
        assert.equal(readback.landingMask, cfg.landingMask);
      }
      // Malformed Lift Guard bytes must be rejected by firmware ProtocolOp2Validate (0xA2)
      const validRaw = await c.getProfile(1);
      for (const [idx, val] of [[14, 0x04], [2, 8], [15, 28]]) {
        const bad = validRaw.slice(); bad[idx] = val;
        const reply = await c.extension(2, 1, ...bad);
        assert.equal(reply[0], 0xa2);
      }
      await assert.rejects(c.getButtonTimings(1, 5), /按键编号/);
    } finally {
      child.stdin.end(); lines.close(); child.kill();
    }
  }
);
