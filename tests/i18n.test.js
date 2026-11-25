import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {messages, translate, savedLanguage, applyDocumentLanguage} from '../i18n.js';
import {createDriverStore} from '../src/store/driver.js';
import {DemoDevice} from '../advanced/demo.js';
import {lodHeightOptions} from '../advanced/lod.js';

const definitions = JSON.parse(readFileSync(new URL('../advanced/protocol-definitions.json', import.meta.url)));
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('English and Japanese catalogue entries are complete and preserve all placeholders', () => {
  assert.equal(new Set(messages.map(row => row[0])).size, messages.length);
  for (const [chinese, english, japanese] of messages) {
    assert.ok(english?.trim(), chinese);
    assert.ok(japanese?.trim(), chinese);
    assert.notEqual(english, chinese);
    assert.deepEqual(placeholders(english), placeholders(chinese), chinese);
    assert.deepEqual(placeholders(japanese), placeholders(chinese), chinese);
    assert.equal(translate(chinese, 'ZH'), chinese);
    assert.equal(translate(chinese, 'EN'), english);
    assert.equal(translate(chinese, 'JPN'), japanese);
  }
});

test('language choice uses the official LANG key and safely falls back to Chinese', () => {
  for (const language of ['ZH', 'EN', 'JPN']) {
    const storage = {getItem(key) { assert.equal(key, 'LANG'); return language; }};
    assert.equal(savedLanguage(storage), language);
  }
  assert.equal(savedLanguage({getItem() { return 'invalid'; }}), 'ZH');
  assert.equal(savedLanguage({getItem() { throw Error('storage disabled'); }}), 'ZH');
  assert.equal(savedLanguage(null), 'ZH');
});

test('dynamic errors translate nested setting names and preserve diagnostic codes', () => {
  assert.equal(translate('设备拒绝命令（0xA3）', 'EN'), 'Device rejected the command (0xA3).');
  assert.equal(translate('已重新读取配置 3。', 'JPN'), 'プロファイル 3 を再読み込みしました。');
  assert.equal(
    translate('部分设置可能已生效：按键轮询率的值无效，请以重新读取为准', 'EN'),
    'Some settings may have taken effect: Invalid value for Button scan rate. Reload to check the current values.'
  );
  assert.equal(translate('寄存器 18:7A：8A → 88', 'EN'), 'Register 18:7A: 8A → 88');
  for (const value of ['ABLODLOCKDB', '14k（13.8k fps）', '0x6000', 'motion_irq_count']) {
    assert.equal(translate(value, 'JPN'), value);
  }
});

test('LOD translations preserve every option value, aliases, and current unknown codes', () => {
  for (let code = 0; code < 256; code++) {
    const options = lodHeightOptions(code);
    for (const option of options) {
      for (const language of ['EN', 'JPN']) {
        const label = translate(option.label, language);
        assert.ok(label.includes(`0x${option.value.toString(16).toUpperCase().padStart(2, '0')}`));
        assert.ok(!label.includes('当前'));
        assert.ok(!label.includes('未知'));
      }
    }
  }
  assert.equal(translate('约 1.5 mm（0x8A）', 'EN'), 'Approx. 1.5 mm (0x8A)');
  assert.equal(translate('当前高度未知（0x59）（当前）', 'EN'), 'Unknown height (0x59) (Current)');
  assert.equal(translate('约 3.1 mm（0x9A）（当前）', 'JPN'), '約 3.1 mm（0x9A）（現在）');
});

test('live language changes translate existing feedback and previews without touching settings or HID', () => {
  const oldDocument = globalThis.document;
  const style = new Map();
  globalThis.document = {documentElement: {lang: '', dataset: {}, style: {setProperty(key, value) { style.set(key, value); }}}};
  try {
    const errors = [];
    const store = createDriverStore(definitions, {onError: text => errors.push(text)});
    const simulated = new DemoDevice();
    store.state.connected = true;
    store.setBase({raw: [...simulated.slots[0]], legacy: {...simulated.legacy[0], lod: 0x85}, slot: 1, active: 1});
    store.state.draft.fps = 8;
    const before = store.collectDraft(), rows = store.changeRows(before);
    store.state.message = '已读取 16 项寄存器';
    store.state.reviewTitle = '应用到配置 1';
    store.state.reviewRows = rows;
    for (const [language, htmlLang] of [['EN', 'en'], ['JPN', 'ja'], ['ZH', 'zh-CN']]) {
      store.languageChanged(language);
      assert.equal(document.documentElement.lang, htmlLang);
      assert.deepEqual(store.collectDraft(), before);
      assert.deepEqual(store.state.reviewRows, rows);
      if (language !== 'ZH') {
        assert.notEqual(store.t(store.state.message), store.state.message);
        assert.notEqual(store.t(store.state.reviewTitle), store.state.reviewTitle);
        assert.notEqual(store.t(rows[0].name), rows[0].name);
      }
    }
    store.languageChanged('JPN');
    store.fail(Error('设备拒绝命令（0xA3）'));
    assert.equal(errors.at(-1), 'デバイスがコマンドを拒否しました（0xA3）。');
    assert.equal(store.state.message, '设备拒绝命令（0xA3）');
    assert.equal(store.state.deviceVerified, false);
    applyDocumentLanguage('unknown');
    assert.equal(document.documentElement.lang, 'zh-CN');
  } finally {
    globalThis.document = oldDocument;
  }
});
