import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {watch, nextTick} from 'vue';
import {createDriverStore} from '../src/store/driver.js';
import {DemoDevice} from '../advanced/demo.js';
import {BUTTONS, buttonMask} from '../advanced/protocol.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));

async function editor() {
  const store = createDriverStore(definitions, {acquireDeviceLock: async () => () => {}});
  const device = new DemoDevice({independentDebounce: true});
  device.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
  await store.attach(device);
  return {store, device};
}

async function toggleEveryButton(store) {
  const other = {hyper: store.state.legacy.hyper, tracking: store.state.legacy.tracking};
  for (const {id} of BUTTONS) {
    store.state.selectedButton = id;
    await nextTick();
    let updates = 0;
    const stop = watch(() => store.debounceDraft.value.enabled, () => updates++, {flush: 'sync'});
    const before = store.state.draft.buttons.map(button => button.enabled);
    for (let click = 0; click < 4; click++) {
      store.debounceDraft.value.enabled = !store.debounceDraft.value.enabled;
      await nextTick();
      assert.equal(updates, click + 1, `button ${id}: every toggle must notify the rendered switch`);
      for (let key = 0; key < 5; key++) {
        assert.equal(store.state.draft.buttons[key].enabled, key === id ? ((click % 2) ? before[key] : !before[key]) : before[key]);
      }
      assert.deepEqual({hyper: store.state.legacy.hyper, tracking: store.state.legacy.tracking}, other);
      assert.equal(store.dirty.value, click % 2 === 0, 'the PendingBar dirty flag must update without toggling another control');
    }
    stop();
  }
}

test('live Vue 3 store connection and re-read keep all five debounce switches reactive and isolated', async () => {
  const {store} = await editor();
  try {
    assert.equal(store.dirty.value, false);
    await toggleEveryButton(store);
    await store.readConfig();
    await toggleEveryButton(store);
    await store.disconnect();
    const device = new DemoDevice({independentDebounce: true});
    device.collections = [{usagePage: 0xffff, featureReports: [{reportId: 0, items: [{reportCount: 64, reportSize: 8}]}]}];
    await store.attach(device);
    await toggleEveryButton(store);
  } finally {
    await store.disconnect();
  }
});

test('edits and save/readback preserve reactive per-button flags and timing fields', async () => {
  const {store, device} = await editor();
  try {
    store.state.draft.fps = 7;
    store.state.draft.landingProtection = true;
    store.state.draft.buttons.forEach(button => Object.assign(button, {pre: 0, post: 1.5, plock: 0, relock: 10, enabled: true}));
    store.state.legacy = {...store.state.legacy, polling: 64, hyper: 1, tracking: 0, lod: 138};
    assert.equal('lead' in store.state.draft, false);
    assert.equal('lock' in store.state.draft, false);
    const baseline = store.collectDraft();
    await store.applySettings(baseline, store.cloneBase());
    await toggleEveryButton(store);
    store.state.selectedButton = 1;
    await nextTick();
    let timingUpdates = 0;
    const stop = watch(() => store.debounceDraft.value.post, () => timingUpdates++, {flush: 'sync'});
    store.debounceDraft.value.post = '2.3';
    await nextTick();
    assert.equal(timingUpdates, 1);
    assert.equal(store.state.draft.buttons[0].post, 1.5);
    store.debounceDraft.value.enabled = false;
    await nextTick();
    const draft = store.collectDraft();
    assert.equal(buttonMask(draft.raw), 29);
    await store.applySettings(draft, store.cloneBase());
    assert.equal(buttonMask(device.slots[0]), 29);
    assert.equal(store.dirty.value, false);
    assert.equal(store.state.draft.buttons[1].post, 2.3);
    assert.equal(store.state.draft.buttons[1].enabled, false);
    store.debounceDraft.value.enabled = true;
    await nextTick();
    assert.equal(store.dirty.value, true);
    await store.readConfig();
    assert.equal(store.state.draft.buttons[1].enabled, false);
    assert.equal(store.dirty.value, false);
    stop();
  } finally {
    await store.disconnect();
  }
});
