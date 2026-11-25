import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lodHeight, lodLabel, lodHeightOptions} from '../advanced/lod.js';
import {DemoDevice} from '../advanced/demo.js';
import {createDriverStore} from '../src/store/driver.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));

function device() {
  const result = new DemoDevice();
  result.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  result.packets = [];
  const send = result.sendFeatureReport.bind(result);
  result.sendFeatureReport = async (id, packet) => { result.packets.push([...packet]); await send(id, packet); };
  return result;
}

test('height labels include saved raw codes and avoid the reserved 1.2 mm code', () => {
  for (const [code, height] of [[0, 0.7], [0x87, 0.7], [1, 1], [0x85, 1], [2, 2], [0x8f, 2]]) {
    assert.equal(lodHeight(code), height);
    assert.equal(lodLabel(code), `${height.toFixed(1)} mm（0x${code.toString(16).toUpperCase().padStart(2, '0')}）`);
  }
  assert.equal(lodHeight(0x8a), 1.5);
  assert.equal(lodLabel(0x8a), '约 1.5 mm（0x8A）');
  const choices = lodHeightOptions(0x8a);
  assert.equal(choices.length, 13);
  for (const option of choices) assert.equal(lodHeight(option.value), parseFloat(option.label.replace('约 ', '')));
  assert.ok(!choices.some(option => option.label.includes('1.2')));
  assert.ok(choices.some(option => option.value === 0x87 && option.label === '0.7 mm（0x87）'));
  assert.equal(choices.at(-1).value, 2);
  assert.equal(choices.at(-1).label, '2.0 mm（0x02）');
  assert.ok(choices.every(option => lodHeight(option.value) <= 2.0));
  assert.equal(lodHeight(0x90), null);
  assert.equal(lodHeight(0x99), null);
  assert.equal(lodLabel(0x99), '当前高度未知（0x99）');
});

test('reading every saved LOD code preserves its exact byte, including aliases and unknown heights', () => {
  const store = createDriverStore(definitions);
  const raw = [...new DemoDevice().slots[0]], legacy = new DemoDevice().legacy[0];
  store.state.connected = true;
  for (let code = 0; code < 256; code++) {
    store.setBase({raw, legacy: {...legacy, lod: code}, slot: 1, active: 1});
    assert.equal(store.state.legacy.lod, code);
    assert.ok(store.lodOptions.value.some(option => option.value === code));
    assert.equal(store.collectDraft().legacy.lod, code);
    assert.equal(store.dirty.value, false);
    assert.ok(!store.changeRows(store.collectDraft()).some(row => row.name === 'LOD 高度'));
  }
  assert.equal(lodHeight(0x59), null);
  assert.equal(lodLabel(0x59), '当前高度未知（0x59）');
});

test('height selection previews millimetres, writes one LOD setting, and verifies the saved code', async () => {
  const store = createDriverStore(definitions), mouse = device();
  await store.attach(mouse);
  const expected = store.cloneBase();
  const before = mouse.packets.length;
  store.state.legacy.lod = store.lodOptions.value.find(option => option.label === '约 1.3 mm（0x88）').value;
  const draft = store.collectDraft(), rows = store.changeRows(draft);
  assert.deepEqual(rows, [{name: 'LOD 高度', before: '约 1.5 mm（0x8A）', after: '约 1.3 mm（0x88）'}]);
  await store.applySettings(draft, expected);
  const writes = mouse.packets.slice(before).filter(packet => packet[4] === 1 && packet[5] === 8);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(6, 8), [1, 0x88]);
  assert.equal(mouse.legacy[0].lod, 0x88);
  assert.equal(store.state.legacy.lod, 0x88);
  assert.equal(store.dirty.value, false);
  await store.disconnect();
});
