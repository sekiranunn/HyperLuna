import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {packet, normalize, matches, HidTransport, LunaClient, RequestTimeout,
  decodeProfile, encodeProfile, equal, validateLegacy, registerAddress} from '../advanced/protocol.js';
import {DemoDevice} from '../advanced/demo.js';
import {createOptions} from '../native/research.js';
import {decodeFeatures, validateFeatures, DEFAULT_FEATURES, VARIANTS} from '../advanced/features.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));
const canonicalPath = new URL('../../lunafury-analysis/port/protocol-definitions.json', import.meta.url);
test('capability replies retain stable IDs for the two non-phase variants', () => {
  assert.throws(()=>decodeFeatures(new Uint8Array(17)));
  for(const variant of VARIANTS){
    const reply=new Uint8Array(19);reply[17]=variant.id;reply[18]=variant.mask;
    assert.equal(decodeFeatures(reply).name,variant.name);
    reply[18]^=1;assert.throws(()=>decodeFeatures(reply));
  }
  const value={fps:7,debounce:true,pre:0,post:1.5,plock:0,relock:10};
  assert.doesNotThrow(()=>validateFeatures(value,VARIANTS[0]));
  assert.throws(()=>validateFeatures(value,VARIANTS[1]));
});

test('unsupported feature mutations are rejected before sending to a variant', async () => {
  const records=[],t=new HidTransport(new DemoDevice(),{interval:1,log:r=>records.push(r)}),c=new LunaClient(t,definitions);
  c.features=VARIANTS[1];
  await assert.rejects(c.telemetry(1));assert.equal(await c.telemetry(),false);
  await assert.rejects(c.statistics());
  await assert.rejects(c.putProfile(1,encodeProfile(new Uint8Array(16),{fps:7,debounce:false,pre:0,post:0,plock:0,relock:0})));
  assert.equal(records.length,0);await t.close();
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
  for (const post of [NaN, Infinity, -1, 101, .15]) assert.throws(() => encodeProfile(raw, {...value, post}));
  assert.throws(() => encodeProfile(raw, {...value, fps: 35})); assert.equal(raw[8], 15);
  assert.throws(() => registerAddress(0, 127)); assert.throws(() => registerAddress(-1, 0));
});
test('native input text validates timing fields and reserves the removed wire bytes', () => {
  const device=new DemoDevice(),raw=device.slots[0],methods=createOptions(definitions,{}).methods;
  const context={draft:{...decodeProfile(raw),pre:'0.0',post:'1.5',plock:'0',relock:'10'},
    base:{raw,legacy:device.legacy[0]},legacy:device.legacy[0],transportTarget:2};
  const result=methods.collectDraft.call(context);
  assert.equal(result.patch.post,1.5);assert.deepEqual([...result.raw.slice(1,4)],[0,0,0]);
  context.draft.post='';assert.throws(()=>methods.collectDraft.call(context));
  context.draft.post='invalid';assert.throws(()=>methods.collectDraft.call(context));
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
  await c.info(); await c.activeProfile(); await c.read(1); await c.telemetry(); await c.peek(24, 122);
  assert.ok(records.length >= 15); assert.ok(records.every(r => r.readonly === true)); await t.close();
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
  await assert.rejects(c.statistics()); await t.close();
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
  const transport = {exchange(command, payload, group = 1) {
    return new Promise((resolve, reject) => { waiting.push({resolve, reject}); child.stdin.write(JSON.stringify({command, payload: Array.from(payload), group}) + '\n'); });
  }};
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
