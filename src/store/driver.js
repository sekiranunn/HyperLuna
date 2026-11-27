import {reactive, computed} from 'vue';
import {
  HidTransport, LunaClient, RequestTimeout, VID, PIDS, LEGACY, RATES, BUTTONS, TIMING_KEYS,
  DPI_MIN, DPI_MAX, DPI_STEP, DPI_MAX_STAGES, DEFAULT_DPI_COLORS,
  ANGLE_TUNE_MIN, ANGLE_TUNE_MAX,
  LANDING_HOLD_DEFAULT, AIRBORNE_FLOOR_DEFAULT, LANDING_MASK_DEFAULT, parseDecimalInt,
  hex, equal, equalButtons, equalDpiStages, sleep,
  decodeProfile, encodeProfile, decodeTimings, encodeTimings,
  validateLegacy, validateDpiStages, validateSleepSeconds, validateAngleTune, registerAddress
} from '../../advanced/protocol.js';
import {WATCH} from '../../advanced/demo.js';
import {DEFAULT_FEATURES, validateFeatures} from '../../advanced/features.js';
import {isLuna33, requireLuna33} from '../../device-access.js';
import {lodLabel, lodHeightOptions} from '../../advanced/lod.js';
import {translate, savedLanguage, normalizeLanguage, applyDocumentLanguage} from '../../i18n.js';
import {OPTICAL_DIAG_REGS, decodeOpticalDiagnostics} from '../lib/calibration.js';

export const THEME_KEY = 'HYPERLUNA_THEME';
const STOCK_FEATURES = Object.freeze({name: '官方固件', fps: 'none', debounce: 'none', stats: false});
const PATCH_NAMES = Object.freeze({
  fps: 'FPS 预设',
  debounce: '自定义消抖',
  landingProtection: '抬鼠复位防误触',
  pre: '按下前滤波',
  post: '按下后滤波',
  plock: '按下锁定',
  relock: '松开锁定'
});

const blankDraft = () => ({
  fps: null, debounce: false, landingProtection: true,
  landingMask: LANDING_MASK_DEFAULT, landingHoldMs: LANDING_HOLD_DEFAULT,
  airborneFloorMs: AIRBORNE_FLOOR_DEFAULT, airborneLockout: false,
  pre: undefined, post: undefined, plock: undefined, relock: undefined, buttons: []
});

export function fpsLabel(preset) {
  if (!preset) return '';
  const [name, unit, longest, shortest] = preset;
  const low = 1000 / (unit * 1.25 * longest);
  const high = 1000 / (unit * 1.25 * shortest);
  if (high <= 10 || (longest === shortest && ['20k', '19k', '16k'].includes(name))) return name;
  const rate = longest === shortest ? high.toFixed(1) : `${low.toFixed(1)}–${high.toFixed(1)}`;
  return `${name}（${rate}k fps）`;
}

export function formatPeriodMs(hz) {
  if (!hz || !Number.isFinite(hz)) return '—';
  const ms = 1000 / hz;
  return `${ms >= 1 ? ms.toFixed(ms % 1 === 0 ? 1 : 2) : ms.toFixed(3)} ms`;
}

export function sleepLabel(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds === 0) return '关闭';
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

export function savedTheme(storage) {
  try {
    const value = (storage === undefined ? globalThis.localStorage : storage)?.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'light';
  } catch {
    return 'light';
  }
}

export function applyDocumentTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

function parseByte(text, max = 255) {
  const value = String(text).trim().replace(/^0x/i, '');
  if (!/^[\da-f]{1,2}$/i.test(value) || parseInt(value, 16) > max) {
    throw Error(`请输入 00–${hex(max)} 的十六进制值`);
  }
  return parseInt(value, 16);
}

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function cloneStages(stages) {
  return (stages || []).map((stage, i) => ({
    x: Number(stage.x),
    y: Number(stage.y),
    color: stage.color || DEFAULT_DPI_COLORS[i % DEFAULT_DPI_COLORS.length]
  }));
}

function sanitizeLegacy(legacy) {
  const out = {};
  for (const key of Object.keys(LEGACY)) out[key] = legacy[key];
  return out;
}

export function createDriverStore(definitions, {acquireDeviceLock, onError = () => {}} = {}) {
  let client = null;
  let transport = null;
  let releaseLock = null;
  let pendingRegisterAction = null;
  let lastSource = null;
  let admittedDevice = null;
  let lastLqSample = null;

  const requireAccess = () => {
    if (!(admittedDevice?.opened && isLuna33(admittedDevice))) throw Error('请先连接 LUNAFURY LUNA33');
  };

  const state = reactive({
    definitions,
    language: savedLanguage(),
    theme: savedTheme(),
    tab: 'performance',
    connected: false,
    stockUnsupported: false,
    busy: false,
    saving: false,
    deviceName: '',
    currentFirmware: '',
    transportTarget: 2,
    battery: null,
    slot: 1,
    deviceVerified: false,
    base: {raw: [], legacy: {}, active: 1, slot: 1, buttons: [], dpiStages: [], dpiActiveStage: 1, sleepSeconds: null, angleTune: null},
    draft: blankDraft(),
    legacy: {},
    dpiDraft: {stages: [], activeStage: 1},
    sleepDraft: null,
    angleTuneDraft: null,
    features: DEFAULT_FEATURES,
    buttons: BUTTONS,
    selectedButton: 0,
    runtime: null,
    runtimeReadAt: 0,
    receiverAfh: null,
    receiverAfhAt: 0,
    receiverAfhStale: false,
    receiverAfhBusy: false,
    receiverLq: null,
    receiverLqAt: 0,
    receiverLqRateHz: null,
    receiverLqCrcRatePct: null,
    receiverRescanBusy: false,
    opticalDiag: null,
    opticalDiagAt: 0,
    opticalDiagBusy: false,
    opticalBaseline: null,
    diffExpanded: false,
    message: '',
    hasError: false,
    registerRows: WATCH.map(([page, reg, label]) => ({
      key: registerAddress(page, reg), page, reg, label,
      value: null, baseline: null, input: '', undo: null
    })),
    pageHex: '18',
    addressHex: '7A',
    reviewVisible: false,
    reviewKicker: 'PAW3950 WRITE',
    reviewTitle: '',
    reviewDescription: '',
    reviewRows: [],
    debounceFields: [
      {key: 'pre', short: 'PRE', label: '按下前滤波'},
      {key: 'post', short: 'POST', label: '按下后滤波'},
      {key: 'plock', short: 'PLOCK', label: '按下锁定'},
      {key: 'relock', short: 'RELOCK', label: '松开锁定'}
    ]
  });

  const LIST_SEPARATORS = {ZH: '、', EN: ', ', JPN: '・'};
  const t = (text, values) => (
    Array.isArray(text)
      ? text.map(item => translate(item, state.language)).join(LIST_SEPARATORS[state.language] || ', ')
      : translate(text, state.language, values)
  );
  const rate = code => `${RATES[code] || '?'} Hz`;

  const hasAccess = computed(() => state.deviceVerified);
  const fpsOptions = computed(() => (
    state.features.fps === 'presets'
      ? definitions.fps_presets.map((p, i) => ({value: i + 1, name: p[0], label: fpsLabel(p)}))
      : [{value: 1, name: definitions.fps_presets[0][0], label: fpsLabel(definitions.fps_presets[0])}]
  ));
  const lodOptions = computed(() => lodHeightOptions(state.base.legacy.lod));
  const debounceDraft = computed(() => state.draft.buttons?.[state.selectedButton] || {});
  const pollingOptions = computed(() => (
    [
      {value: 8, hz: 125}, {value: 4, hz: 250}, {value: 2, hz: 500},
      {value: state.legacy.polling === 16 ? 16 : 1, hz: 1000},
      {value: 32, hz: 2000}, {value: 64, hz: 4000}, {value: 128, hz: 8000}
    ].map(item => ({...item, disabled: state.transportTarget === 0 && item.hz > 1000}))
  ));
  const scanRateOptions = computed(() => (
    [
      {value: state.legacy.scan_rate === 16 ? 16 : 1, hz: 1000},
      {value: 32, hz: 2000}, {value: 64, hz: 4000}, {value: 128, hz: 8000}
    ]
  ));

  function patchText(key, value) {
    if (key === 'fps') return value ? fpsLabel(definitions.fps_presets[value - 1]) || String(value) : '原厂脚本';
    if (['debounce', 'landingProtection'].includes(key)) return value ? '开启' : '关闭';
    return `${value} ms`;
  }

  function legacyText(key, value) {
    if (key === 'lod') return lodLabel(value);
    if (key === 'polling' || key === 'scan_rate') return rate(value);
    if (key === 'scan_sequence') return ['关闭', '左键优先', '右键优先'][value];
    return value ? '开启' : '关闭';
  }

  function formatStages(stages) {
    return stages.map(s => (s.x === s.y ? `${s.x}` : `${s.x}/${s.y}`)).join(' · ');
  }

  function airborneText(lockout, floorMs) {
    return lockout ? '空中禁用' : `${floorMs} ms`;
  }

  function landingMaskText(mask) {
    const bits = mask & 31;
    if (!bits) return '无';
    if (bits === 31) return '全部 5 键';
    return BUTTONS.filter(button => bits & (1 << button.id)).map(button => button.label);
  }

  function toggleLandingKey(id) {
    if (!Number.isInteger(id) || id < 0 || id > 4) return;
    const current = Number.isInteger(state.draft.landingMask) ? state.draft.landingMask : LANDING_MASK_DEFAULT;
    state.draft.landingMask = current ^ (1 << id);
  }

  function resetLandingDefaults() {
    state.draft.landingMask = LANDING_MASK_DEFAULT;
    state.draft.landingHoldMs = LANDING_HOLD_DEFAULT;
    state.draft.airborneFloorMs = AIRBORNE_FLOOR_DEFAULT;
    state.draft.airborneLockout = false;
  }

  function collectDraft() {
    const patch = {...state.draft};
    if (state.features?.perButtonDebounce) {
      if (!Array.isArray(patch.buttons) || patch.buttons.length !== state.features.buttonCount) {
        throw Error('请先读取鼠标配置');
      }
      patch.buttons = patch.buttons.map(value => {
        const times = {};
        for (const key of TIMING_KEYS) {
          if (value[key] === undefined || value[key] === null || String(value[key]).trim() === '') {
            throw Error('请填写完整参数');
          }
          times[key] = Number(value[key]);
        }
        const normalized = decodeTimings(encodeTimings(times, state.features));
        if (state.features.independentDebounce) {
          if (typeof value.enabled !== 'boolean') throw Error('无效的按键开关');
          normalized.enabled = value.enabled;
        }
        return normalized;
      });
      Object.assign(patch, patch.buttons[0]);
      if (state.features.independentDebounce) {
        patch.debounce = patch.buttons.some(button => button.enabled);
      }
    }
    for (const key of ['fps', ...TIMING_KEYS]) {
      if (patch[key] === undefined || patch[key] === null || String(patch[key]).trim() === '') {
        throw Error('请填写完整参数');
      }
      patch[key] = Number(patch[key]);
    }
    if (state.features?.customLandingGuard) {
      if (patch.landingHoldMs === undefined || patch.landingHoldMs === null || String(patch.landingHoldMs).trim() === '') {
        throw Error('请填写完整参数');
      }
      patch.landingHoldMs = parseDecimalInt(patch.landingHoldMs);
      if (!patch.airborneLockout) {
        if (patch.airborneFloorMs === undefined || patch.airborneFloorMs === null || String(patch.airborneFloorMs).trim() === '') {
          throw Error('请填写完整参数');
        }
        patch.airborneFloorMs = parseDecimalInt(patch.airborneFloorMs);
      } else {
        patch.airborneFloorMs = AIRBORNE_FLOOR_DEFAULT;
      }
    }
    const raw = encodeProfile(state.base.raw, patch, definitions.fps_presets.length, state.features);
    const legacy = sanitizeLegacy(state.legacy);
    validateLegacy(legacy, state.transportTarget);
    validateFeatures(patch, state.features);

    let dpi = null;
    if (state.base.dpiStages?.length) {
      const stages = cloneStages(state.dpiDraft.stages);
      const activeStage = Number(state.dpiDraft.activeStage);
      validateDpiStages(stages, activeStage);
      dpi = {stages, activeStage};
    }

    let sleepSeconds = state.sleepDraft;
    if (state.base.sleepSeconds !== null && state.base.sleepSeconds !== undefined) {
      sleepSeconds = Number(state.sleepDraft);
      validateSleepSeconds(sleepSeconds);
    }

    let angleTune = state.angleTuneDraft;
    if (state.base.angleTune !== null && state.base.angleTune !== undefined) {
      angleTune = Number(state.angleTuneDraft);
      validateAngleTune(angleTune);
    }

    return {raw, legacy, patch, dpi, sleepSeconds, angleTune};
  }

  function normalizeBaseRecord(base) {
    return {
      slot: base.slot,
      active: base.active,
      raw: Array.from(base.raw || []),
      legacy: {...(base.legacy || {})},
      buttons: (base.buttons || []).map(value => ({...value})),
      dpiStages: cloneStages(base.dpiStages ?? base.legacy?.dpiStages ?? []),
      dpiActiveStage: base.dpiActiveStage ?? base.legacy?.dpiActiveStage ?? 1,
      sleepSeconds: base.sleepSeconds !== undefined ? base.sleepSeconds : (base.legacy?.sleepSeconds ?? null),
      angleTune: base.angleTune !== undefined ? base.angleTune : (base.legacy?.angleTune ?? null),
      at: base.at
    };
  }

  function diffSlotConfig(baseRecord, draft) {
    const base = normalizeBaseRecord(baseRecord);
    const out = [];
    const old = decodeProfile(base.raw);
    for (const key of Object.keys(PATCH_NAMES)) {
      if (key === 'landingProtection' && !state.features.landingPolicy) continue;
      if (state.features.perButtonDebounce && TIMING_KEYS.includes(key)) continue;
      if (state.features.independentDebounce && key === 'debounce') continue;
      if (old[key] !== draft.patch[key]) {
        out.push({name: PATCH_NAMES[key], before: patchText(key, old[key]), after: patchText(key, draft.patch[key])});
      }
    }
    if (state.features.customLandingGuard) {
      if (old.landingHoldMs !== draft.patch.landingHoldMs) {
        out.push({
          name: '落地锁定',
          before: `${old.landingHoldMs} ms`,
          after: `${draft.patch.landingHoldMs} ms`
        });
      }
      if (old.airborneLockout !== draft.patch.airborneLockout || (!old.airborneLockout && old.airborneFloorMs !== draft.patch.airborneFloorMs)) {
        out.push({
          name: '空中防误触',
          before: airborneText(old.airborneLockout, old.airborneFloorMs),
          after: airborneText(draft.patch.airborneLockout, draft.patch.airborneFloorMs)
        });
      }
      if (old.landingMask !== draft.patch.landingMask) {
        out.push({
          name: '作用按键',
          before: landingMaskText(old.landingMask),
          after: landingMaskText(draft.patch.landingMask)
        });
      }
    }
    if (state.features.independentDebounce) {
      for (const button of BUTTONS) {
        const before = base.buttons[button.id].enabled;
        const after = draft.patch.buttons[button.id].enabled;
        if (before !== after) {
          out.push({
            name: `${button.label}：自定义消抖`,
            before: patchText('debounce', before),
            after: patchText('debounce', after)
          });
        }
      }
    }
    if (state.features.perButtonDebounce) {
      for (const button of BUTTONS) {
        for (const key of TIMING_KEYS) {
          const before = base.buttons[button.id][key];
          const after = draft.patch.buttons[button.id][key];
          if (before !== after) {
            out.push({
              name: `${button.label}：${PATCH_NAMES[key]}`,
              before: patchText(key, before),
              after: patchText(key, after)
            });
          }
        }
      }
    }
    for (const [key, spec] of Object.entries(LEGACY)) {
      if (base.legacy[key] !== draft.legacy[key]) {
        out.push({name: spec.label, before: legacyText(key, base.legacy[key]), after: legacyText(key, draft.legacy[key])});
      }
    }
    if (draft.dpi && base.dpiStages?.length) {
      if (draft.dpi.activeStage !== base.dpiActiveStage) {
        out.push({
          name: '当前 DPI 档位',
          before: `档位 ${base.dpiActiveStage}`,
          after: `档位 ${draft.dpi.activeStage}`
        });
      }
      if (!equalDpiStages(draft.dpi.stages, base.dpiStages)) {
        out.push({
          name: 'DPI 档位',
          before: formatStages(base.dpiStages),
          after: formatStages(draft.dpi.stages)
        });
      }
    }
    if (base.sleepSeconds !== null && base.sleepSeconds !== undefined && draft.sleepSeconds !== base.sleepSeconds) {
      out.push({name: '休眠时间', before: sleepLabel(base.sleepSeconds), after: sleepLabel(draft.sleepSeconds)});
    }
    if (base.angleTune !== null && base.angleTune !== undefined && draft.angleTune !== base.angleTune) {
      out.push({name: '角度微调', before: `${base.angleTune}°`, after: `${draft.angleTune}°`});
    }
    return out;
  }

  function changeRows(draft) {
    return diffSlotConfig(state.base, draft);
  }

  const pendingChanges = computed(() => {
    if (!state.connected) return {rows: [], error: ''};
    try {
      return {rows: changeRows(collectDraft()), error: ''};
    } catch (error) {
      return {rows: [], error: error.message || String(error)};
    }
  });

  const dirty = computed(() => state.connected && (pendingChanges.value.rows.length > 0 || Boolean(pendingChanges.value.error)));

  function fail(error) {
    state.message = error.message || String(error);
    state.hasError = true;
    onError(t(state.message));
  }

  function notify(text) {
    state.message = text;
    state.hasError = false;
  }

  function setRuntime(status) {
    state.runtime = status;
    state.runtimeReadAt = status ? Date.now() : 0;
  }

  async function guard(work, connecting = false) {
    if (state.busy || state.receiverRescanBusy || state.opticalDiagBusy) return;
    state.busy = true;
    try {
      if (!connecting) requireAccess();
      await work();
    } catch (error) {
      fail(error);
    } finally {
      state.busy = false;
    }
  }

  function setTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    applyDocumentTheme(state.theme);
    try { globalThis.localStorage?.setItem(THEME_KEY, state.theme); } catch {}
  }

  function toggleTheme() {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  function languageChanged(lang) {
    state.language = normalizeLanguage(lang);
    applyDocumentLanguage(state.language);
    try { globalThis.localStorage?.setItem('LANG', state.language); } catch {}
  }

  function setBase(base) {
    const normalized = normalizeBaseRecord(base);
    const draft = decodeProfile(normalized.raw);
    if (state.features.perButtonDebounce) {
      draft.buttons = normalized.buttons.map(value => ({...value}));
    }
    state.base = normalized;
    state.slot = normalized.slot;
    state.draft = draft;
    state.legacy = sanitizeLegacy(normalized.legacy);
    state.dpiDraft = {stages: cloneStages(normalized.dpiStages), activeStage: normalized.dpiActiveStage};
    state.sleepDraft = normalized.sleepSeconds;
    state.angleTuneDraft = normalized.angleTune;
    state.diffExpanded = false;
  }

  function discardChanges() {
    if (!state.connected) return;
    setBase(state.base);
    notify('已放弃未应用的更改');
  }

  async function attach(device) {
    requireLuna33(device);
    lastSource = {demo: false, productId: device.productId, target: device.productId === 0x32 ? 0 : 2};
    transport = new HidTransport(device, {interval: 25});
    client = new LunaClient(transport, definitions);
    state.currentFirmware = await client.version();
    const slot = await client.activeProfile();
    state.battery = await client.battery();
    let info;
    try {
      info = await client.info();
    } catch (error) {
      if (error.status !== 0xa3) throw error;
    }
    if (info) {
      state.features = info.features;
      setBase(await client.read(slot));
      setRuntime(await client.runtimeStatus());
      state.connected = true;
      state.stockUnsupported = false;
    } else {
      state.features = STOCK_FEATURES;
      state.connected = false;
      state.stockUnsupported = true;
    }
    state.transportTarget = transport.target;
    state.receiverAfh = transport.target === 2 ? await client.receiverAfh() : null;
    state.receiverAfhAt = state.receiverAfh ? Date.now() : 0;
    state.receiverAfhStale = false;
    lastLqSample = null;
    state.receiverLqRateHz = null;
    state.receiverLqCrcRatePct = null;
    if (state.receiverAfh?.flags?.v4Capable) {
      const lq = await client.receiverLinkQuality();
      applyLinkQuality(lq);
    } else {
      state.receiverLq = null;
      state.receiverLqAt = 0;
    }
    state.deviceName = 'LUNAFURY LUNA33';
    admittedDevice = device;
    state.deviceVerified = true;
    state.registerRows.forEach(r => { r.value = r.baseline = r.undo = null; r.input = ''; });
    notify(info ? '已连接' : '当前固件不支持 HyperLuna 扩展，请先刷入 HyperLuna 固件。');
  }

  async function connect(mode = 'any') {
    if (state.deviceVerified) {
      await disconnect();
      return;
    }
    const targetMode = mode === 'wired' || mode === 'wireless' ? mode : 'any';
    const pids = targetMode === 'wired' ? [0x0032] : targetMode === 'wireless' ? [0x0033] : PIDS;
    await guard(async () => {
      if (!globalThis.navigator?.hid || !globalThis.isSecureContext) {
        throw Error('请在新版 Edge / Chrome 中通过 HTTPS 或 localhost 打开');
      }
      releaseLock = acquireDeviceLock ? await acquireDeviceLock() : null;
      try {
        const devices = await navigator.hid.requestDevice({
          filters: pids.map(productId => ({vendorId: VID, productId, usagePage: 0xffff, usage: 0}))
        });
        const device = devices.find(isLuna33);
        if (!device) {
          releaseLock?.(); releaseLock = null;
          notify('请选择 LUNAFURY LUNA33 鼠标或接收器');
          return;
        }
        if (!device.opened) await device.open();
        try {
          await attach(device);
        } catch (error) {
          if (error instanceof RequestTimeout && targetMode === 'any') {
            const others = (await navigator.hid.getDevices())
              .filter(d => isLuna33(d) && d !== device && d.productId !== device.productId);
            if (others.length) {
              const prev = transport;
              transport = null;
              client = null;
              if (prev) await prev.close();
              const alt = others[0];
              if (!alt.opened) await alt.open();
              await attach(alt);
              return;
            }
            if (device.productId === 0x0033) {
              throw Error('2.4G 接收器无响应；如使用有线连接，请点击「有线 USB」选择鼠标');
            }
          }
          throw error;
        }
      } catch (error) {
        await disconnect();
        throw error;
      }
    }, true);
  }

  async function disconnect() {
    const closing = transport;
    transport = null;
    client = null;
    admittedDevice = null;
    state.deviceVerified = false;
    state.connected = false;
    state.stockUnsupported = false;
    state.currentFirmware = '';
    state.battery = null;
    state.features = DEFAULT_FEATURES;
    state.draft = blankDraft();
    state.legacy = {};
    state.dpiDraft = {stages: [], activeStage: 1};
    state.sleepDraft = null;
    state.angleTuneDraft = null;
    setRuntime(null);
    state.receiverAfh = null;
    state.receiverAfhAt = 0;
    state.receiverAfhStale = false;
    state.receiverAfhBusy = false;
    state.receiverLq = null;
    state.receiverLqAt = 0;
    state.receiverLqRateHz = null;
    state.receiverLqCrcRatePct = null;
    state.receiverRescanBusy = false;
    lastLqSample = null;
    state.opticalDiag = null;
    state.opticalDiagAt = 0;
    state.opticalDiagBusy = false;
    state.opticalBaseline = null;
    state.base = {raw: [], legacy: {}, active: 1, slot: 1, buttons: [], dpiStages: [], dpiActiveStage: 1, sleepSeconds: null, angleTune: null};
    state.diffExpanded = false;
    state.reviewVisible = false;
    pendingRegisterAction = null;
    if (closing) await closing.close();
    releaseLock?.(); releaseLock = null;
    notify('设备已断开。');
  }

  async function deviceRemoved(event) {
    if (transport?.device === event.device) {
      await disconnect();
      fail(Error('设备已拔出，请重新连接'));
    }
  }

  async function readConfig() {
    await guard(async () => {
      state.battery = await client.battery();
      setBase(await client.read(state.slot));
      setRuntime(await client.runtimeStatus());
      if (state.transportTarget === 2) {
        state.receiverAfh = await client.receiverAfh();
        state.receiverAfhAt = state.receiverAfh ? Date.now() : 0;
        state.receiverAfhStale = false;
        if (state.receiverAfh?.flags?.v4Capable) {
          applyLinkQuality(await client.receiverLinkQuality());
        } else {
          applyLinkQuality(null);
        }
      }
      if (state.runtime?.save === 3 && state.runtime.attempts >= 3) {
        throw Error('保存失败，当前参数尚未写入存储；请重试保存');
      }
      notify(`已重新读取配置 ${state.slot}。`);
    });
  }

  function applyLinkQuality(lq) {
    const now = Date.now();
    state.receiverLq = lq;
    state.receiverLqAt = lq ? now : 0;
    if (!lq) {
      lastLqSample = null;
      state.receiverLqRateHz = null;
      state.receiverLqCrcRatePct = null;
      return;
    }
    // Only merge live activeCh/chIdx/hopCount into receiverAfh when both snapshots belong to the same scan generation!
    if (state.receiverAfh && state.receiverAfh.scanCount === lq.scanCount) {
      state.receiverAfh = {
        ...state.receiverAfh,
        activeCh: lq.activeCh,
        chIdx: lq.chIdx,
        hopCount: lq.hopCount
      };
    }
    if (lastLqSample && now > lastLqSample.at) {
      const dt = (now - lastLqSample.at) / 1000;
      const dOk = (lq.rxOkCount - lastLqSample.rxOkCount) >>> 0;
      const dCrc = (lq.crcErrCount - lastLqSample.crcErrCount) & 0xffff;
      // Treat huge apparent jump (e.g. counter reset where new < old) as fresh baseline
      const resetDetected = lq.rxOkCount < lastLqSample.rxOkCount && (lastLqSample.rxOkCount - lq.rxOkCount) < 0x80000000;
      if (resetDetected) {
        state.receiverLqRateHz = null;
        state.receiverLqCrcRatePct = null;
      } else if (dt >= 0.2 && dt <= 10) {
        state.receiverLqRateHz = Math.round(dOk / dt);
        const dTotal = dOk + dCrc;
        state.receiverLqCrcRatePct = dTotal > 0 ? (dCrc / dTotal) * 100 : 0;
      }
    }
    lastLqSample = {at: now, rxOkCount: lq.rxOkCount, crcErrCount: lq.crcErrCount};
  }

  let receiverPollPromise = null;

  async function waitSilentPoll() {
    while (receiverPollPromise) {
      try { await receiverPollPromise; } catch {}
    }
  }

  async function readReceiverAfh({silent = false} = {}) {
    if (state.busy || state.receiverAfhBusy || state.receiverRescanBusy || state.opticalDiagBusy) return;
    if (silent && receiverPollPromise) return;
    if (!state.connected || state.transportTarget !== 2 || !client) return;
    const run = async () => {
      try {
        if (!silent) await waitSilentPoll();
        if (!state.connected || state.transportTarget !== 2 || !client) return;
        requireAccess();
        let afh = await client.receiverAfh();
        let lq = null;
        if (afh?.flags?.v4Capable) {
          lq = await client.receiverLinkQuality();
          if (lq && lq.scanCount !== afh.scanCount) {
            const retryAfh = await client.receiverAfh();
            if (retryAfh) afh = retryAfh;
            if (afh.scanCount !== lq.scanCount) lq = await client.receiverLinkQuality();
          }
        }
        state.receiverAfh = afh;
        state.receiverAfhAt = afh ? Date.now() : 0;
        state.receiverAfhStale = false;
        applyLinkQuality(lq);
        if (!silent) {
          notify(afh ? '已读取 2.4G 频谱快照' : '当前接收器不支持 2.4G 频谱遥测');
        }
      } catch (error) {
        if (state.receiverAfh) state.receiverAfhStale = true;
        if (!silent) fail(error);
      }
    };
    if (silent) {
      const task = run();
      receiverPollPromise = task;
      try {
        await task;
      } finally {
        if (receiverPollPromise === task) receiverPollPromise = null;
      }
      return;
    }
    state.receiverAfhBusy = true;
    try {
      await run();
    } finally {
      state.receiverAfhBusy = false;
    }
  }

  async function readReceiverLinkQuality({silent = true} = {}) {
    if (state.busy || state.receiverAfhBusy || state.receiverRescanBusy || state.opticalDiagBusy) return;
    if (silent && receiverPollPromise) return;
    if (!state.connected || state.transportTarget !== 2 || !client || !state.receiverAfh?.flags?.v4Capable) return;
    const run = async () => {
      try {
        if (!silent) await waitSilentPoll();
        if (!state.connected || state.transportTarget !== 2 || !client || !state.receiverAfh?.flags?.v4Capable) return;
        requireAccess();
        let lq = await client.receiverLinkQuality();
        // Refresh AF if scanCount changed OR cached 3s selection moved chTable[chIdx] without bumping scanCount!
        const tableMismatch = Boolean(
          lq && state.receiverAfh && lq.linkActive && lq.chIdx < 5
          && state.receiverAfh.chTable?.[lq.chIdx] !== lq.activeCh
        );
        if (lq && state.receiverAfh && (lq.scanCount !== state.receiverAfh.scanCount || tableMismatch)) {
          const freshAfh = await client.receiverAfh();
          if (freshAfh) {
            if (freshAfh.scanCount !== lq.scanCount) {
              lq = await client.receiverLinkQuality();
            }
            state.receiverAfh = freshAfh;
            state.receiverAfhAt = Date.now();
            state.receiverAfhStale = false;
          }
        }
        applyLinkQuality(lq);
      } catch (error) {
        if (state.receiverAfh) state.receiverAfhStale = true;
        if (!silent) fail(error);
      }
    };
    if (silent) {
      const task = run();
      receiverPollPromise = task;
      try {
        await task;
      } finally {
        if (receiverPollPromise === task) receiverPollPromise = null;
      }
      return;
    }
    state.receiverAfhBusy = true;
    try {
      await run();
    } finally {
      state.receiverAfhBusy = false;
    }
  }

  async function rescanReceiverAfh() {
    if (state.busy || state.receiverAfhBusy || state.receiverRescanBusy || state.opticalDiagBusy) return;
    if (!state.connected || state.transportTarget !== 2 || !client) return;
    state.receiverRescanBusy = true;
    try {
      await waitSilentPoll();
      if (!state.connected || state.transportTarget !== 2 || !client) return;
      requireAccess();
      const preLq = state.receiverAfh?.flags?.v4Capable ? await client.receiverLinkQuality() : null;
      if (preLq) applyLinkQuality(preLq);
      const linked = preLq ? Boolean(preLq.linkActive) : Boolean(state.receiverAfh?.linkActive);
      // Conservative host-side proof for 500 ms mouse quiet window:
      // - Mouse enters RADIO->POWER=0 25 ms AFTER receiving op=12 (latest possible start = replyAt + 25 ms)
      // - Mouse wakes 525 ms AFTER receiving op=12 (earliest possible wake = sentAt + 525 ms)
      // Wait 35 ms AFTER op=12 reply so sweep starts strictly after latest silence entry,
      // AND require sweep finishes <= sentAt + 515 ms (strictly before earliest wake)!
      const QUIET_MS = 500;
      const QUIET_POST_REPLY_WAIT_MS = 35;
      const QUIET_LATEST_START_MS = 135;
      const QUIET_MAX_END_MS = 515;
      let quietState = 'none';
      let quietSentAt = 0;
      let startElapsed = 0;
      if (linked && state.features?.quietWindow) {
        try {
          quietSentAt = Date.now();
          await client.requestMouseQuietWindow(QUIET_MS);
          await sleep(QUIET_POST_REPLY_WAIT_MS);
          startElapsed = Date.now() - quietSentAt;
          quietState = startElapsed <= QUIET_LATEST_START_MS ? 'armed' : 'unconfirmed';
        } catch (error) {
          if (!(error instanceof RequestTimeout) && ![0xa2, 0xa3].includes(error?.status)) throw error;
          quietState = 'rejected';
        }
      }
      const afh = await client.rescanReceiverAfh();
      if (quietState === 'armed') {
        const endElapsed = Date.now() - quietSentAt;
        quietState = endElapsed <= QUIET_MAX_END_MS ? 'confirmed' : 'unconfirmed';
      }
      state.receiverAfh = afh;
      state.receiverAfhAt = afh ? Date.now() : 0;
      state.receiverAfhStale = false;
      lastLqSample = null;
      state.receiverLqRateHz = null;
      state.receiverLqCrcRatePct = null;
      if (afh?.flags?.v4Capable) {
        const reconnectWait = quietState === 'confirmed' || quietState === 'unconfirmed' ? 220 : 180;
        await sleep(reconnectWait);
        if (client && state.connected) {
          const postLq = await client.receiverLinkQuality();
          if (postLq && afh && postLq.scanCount !== afh.scanCount) {
            const alignedAfh = await client.receiverAfh();
            if (alignedAfh) {
              state.receiverAfh = alignedAfh;
              state.receiverAfhAt = Date.now();
            }
          }
          applyLinkQuality(postLq);
        }
      }
      if (quietState === 'confirmed') {
        notify('已完成鼠标静默与 2.4G 纯净全频段扫频，跳频表已更新');
      } else if (quietState === 'unconfirmed') {
        notify('已完成 2.4G 全频段扫频（鼠标静默窗口可能已超时，建议重试以确保纯净）');
      } else if (quietState === 'rejected') {
        notify('鼠标未进入静默窗口，已完成普通 2.4G 全频段扫频并更新跳频表');
      } else {
        notify('已完成 2.4G 全频段扫频并更新跳频表');
      }
    } catch (error) {
      if (state.receiverAfh) state.receiverAfhStale = true;
      fail(error);
    } finally {
      state.receiverRescanBusy = false;
    }
  }

  async function resetReceiverCounters() {
    if (state.busy || state.receiverAfhBusy || state.receiverRescanBusy || state.opticalDiagBusy) return;
    if (!state.connected || state.transportTarget !== 2 || !client) return;
    state.receiverAfhBusy = true;
    try {
      await waitSilentPoll();
      if (!state.connected || state.transportTarget !== 2 || !client) return;
      requireAccess();
      lastLqSample = null;
      state.receiverLqRateHz = null;
      state.receiverLqCrcRatePct = null;
      const lq = await client.resetReceiverLinkCounters();
      applyLinkQuality(lq);
      notify('接收器链路与跳频计数已清零');
    } catch (error) {
      fail(error);
    } finally {
      state.receiverAfhBusy = false;
    }
  }

  async function readOpticalDiagnostics({silent = false} = {}) {
    if (state.busy || state.opticalDiagBusy || state.receiverAfhBusy || state.receiverRescanBusy) return;
    if (!state.connected || !client) return;
    state.opticalDiagBusy = true;
    try {
      requireAccess();
      const raw = {};
      for (const spec of OPTICAL_DIAG_REGS) {
        raw[spec.key] = await client.peek(spec.page, spec.reg);
      }
      state.opticalDiag = decodeOpticalDiagnostics(raw);
      state.opticalDiagAt = Date.now();
      if (!silent) notify('已读取 PAW3950 光学表面快照');
    } catch (error) {
      if (!silent) fail(error);
    } finally {
      state.opticalDiagBusy = false;
    }
  }

  function saveOpticalBaseline() {
    if (!state.opticalDiag) return;
    state.opticalBaseline = {...state.opticalDiag};
    notify('已保存当前垫面作为对比基线');
  }

  function clearOpticalBaseline() {
    state.opticalBaseline = null;
  }

  async function retrySave() {
    await guard(async () => {
      state.saving = true;
      try {
        notify('正在保存到鼠标存储…');
        await client.retrySave({onStatus: status => setRuntime(status)});
        setBase(await client.read(state.slot));
        notify('设置已保存，回读核对通过。');
      } finally {
        state.saving = false;
      }
    });
  }

  async function changeSlot(slot) {
    const next = Number(slot);
    if (dirty.value) {
      state.slot = state.base.slot;
      fail(Error('请先应用更改，或重新读取以放弃草稿'));
      return;
    }
    await guard(async () => {
      try {
        setBase(await client.read(next));
        notify(`已切换到配置 ${next}。`);
      } catch (error) {
        state.slot = state.base.slot;
        throw error;
      }
    });
  }

  function selectDpiStage(index) {
    if (index >= 1 && index <= state.dpiDraft.stages.length) {
      state.dpiDraft.activeStage = index;
    }
  }

  function setActiveDpiValue(value, axis = 'both') {
    const stage = state.dpiDraft.stages[state.dpiDraft.activeStage - 1];
    if (!stage) return;
    const clamped = Math.max(DPI_MIN, Math.min(DPI_MAX, Math.round(Number(value) / DPI_STEP) * DPI_STEP));
    if (!Number.isFinite(clamped)) return;
    if (axis === 'x') {
      stage.x = clamped;
    } else if (axis === 'y') {
      stage.y = clamped;
    } else {
      stage.x = clamped;
      stage.y = clamped;
    }
  }

  function stepActiveDpi(delta, axis = 'both') {
    const stage = state.dpiDraft.stages[state.dpiDraft.activeStage - 1];
    if (!stage) return;
    const baseVal = axis === 'y' ? stage.y : stage.x;
    setActiveDpiValue(baseVal + delta, axis);
  }

  function addDpiStage() {
    if (state.dpiDraft.stages.length >= DPI_MAX_STAGES) return;
    const last = state.dpiDraft.stages.at(-1);
    const nextX = Math.min(DPI_MAX, Math.max(DPI_MIN, (last?.x || 800) + 400));
    const nextY = last && last.x !== last.y
      ? Math.min(DPI_MAX, Math.max(DPI_MIN, last.y + 400))
      : nextX;
    const idx = state.dpiDraft.stages.length;
    state.dpiDraft.stages.push({x: nextX, y: nextY, color: DEFAULT_DPI_COLORS[idx % DEFAULT_DPI_COLORS.length]});
  }

  function removeDpiStage() {
    if (state.dpiDraft.stages.length <= 1) return;
    state.dpiDraft.stages.pop();
    if (state.dpiDraft.activeStage > state.dpiDraft.stages.length) {
      state.dpiDraft.activeStage = state.dpiDraft.stages.length;
    }
  }

  async function writeSingleSlot(slot, draft, fresh) {
    const freshBaseLegacy = sanitizeLegacy(fresh.legacy);
    const freshStages = fresh.legacy?.dpiStages || [];
    const freshActiveDpi = fresh.legacy?.dpiActiveStage ?? 1;
    const freshSleep = fresh.legacy?.sleepSeconds ?? null;
    const freshAngle = fresh.legacy?.angleTune ?? null;
    const keys = Object.keys(LEGACY).filter(key => freshBaseLegacy[key] !== draft.legacy[key]);
    let current = Uint8Array.from(fresh.raw);
    const dpiChanged = Boolean(
      draft.dpi && freshStages.length &&
      (!equalDpiStages(freshStages, draft.dpi.stages) || freshActiveDpi !== draft.dpi.activeStage)
    );
    const sleepChanged = freshSleep !== null && draft.sleepSeconds !== null && draft.sleepSeconds !== undefined && draft.sleepSeconds !== freshSleep;
    const angleChanged = freshAngle !== null && draft.angleTune !== null && draft.angleTune !== undefined && draft.angleTune !== freshAngle;

    if (current[1] && keys.some(key => ['polling', 'hyper', 'tracking'].includes(key))) {
      current[1] = 0;
      await client.putProfile(slot, current);
    }
    if (dpiChanged) {
      await client.putDpi(slot, draft.dpi.stages, draft.dpi.activeStage);
    }
    if (sleepChanged) {
      await client.putSleepSeconds(slot, draft.sleepSeconds);
    }
    if (angleChanged) {
      await client.putAngleTune(slot, draft.angleTune);
    }
    for (const key of keys) {
      await client.putLegacy(slot, key, draft.legacy[key]);
    }
    if (!equal(current, draft.raw)) {
      await client.putProfile(slot, draft.raw);
    }
    if (state.features.perButtonDebounce) {
      for (let key = 1; key < state.features.buttonCount; key++) {
        if (TIMING_KEYS.some(name => fresh.buttons[key][name] !== draft.patch.buttons[key][name])) {
          await client.putButtonTimings(slot, key, draft.patch.buttons[key]);
        }
      }
    }
    const final = await client.read(slot);
    const finalLegacy = sanitizeLegacy(final.legacy);
    if (
      !equal(final.raw, draft.raw) ||
      Object.keys(LEGACY).some(key => finalLegacy[key] !== draft.legacy[key]) ||
      (state.features.perButtonDebounce && !equalButtons(final.buttons, draft.patch.buttons)) ||
      (dpiChanged && (!equalDpiStages(final.legacy.dpiStages, draft.dpi.stages) || final.legacy.dpiActiveStage !== draft.dpi.activeStage)) ||
      (sleepChanged && final.legacy.sleepSeconds !== draft.sleepSeconds) ||
      (angleChanged && final.legacy.angleTune !== draft.angleTune)
    ) {
      throw Error('最终配置与请求值不同');
    }
    return final;
  }

  async function applySettings(draft, expected) {
    requireAccess();
    const fresh = await client.read(expected.slot);
    const freshBaseLegacy = sanitizeLegacy(fresh.legacy);
    const expectedBaseLegacy = sanitizeLegacy(expected.legacy);
    const freshStages = fresh.legacy?.dpiStages || [];
    const expectedStages = expected.dpiStages ?? expected.legacy?.dpiStages ?? [];
    const freshActiveDpi = fresh.legacy?.dpiActiveStage ?? 1;
    const expectedActiveDpi = expected.dpiActiveStage ?? expected.legacy?.dpiActiveStage ?? 1;
    const freshSleep = fresh.legacy?.sleepSeconds ?? null;
    const expectedSleep = expected.sleepSeconds !== undefined ? expected.sleepSeconds : (expected.legacy?.sleepSeconds ?? null);
    const freshAngle = fresh.legacy?.angleTune ?? null;
    const expectedAngle = expected.angleTune !== undefined ? expected.angleTune : (expected.legacy?.angleTune ?? null);

    if (
      !equal(fresh.raw, expected.raw) ||
      JSON.stringify(freshBaseLegacy) !== JSON.stringify(expectedBaseLegacy) ||
      fresh.active !== expected.active ||
      (state.features.perButtonDebounce && !equalButtons(fresh.buttons, expected.buttons)) ||
      (expectedStages.length && (!equalDpiStages(freshStages, expectedStages) || freshActiveDpi !== expectedActiveDpi)) ||
      (expectedSleep !== null && freshSleep !== expectedSleep) ||
      (expectedAngle !== null && freshAngle !== expectedAngle)
    ) {
      throw Error('鼠标配置已被其他操作改变，本次未写入，请重新读取');
    }

    state.saving = true;
    try {
      const final = await writeSingleSlot(expected.slot, draft, fresh);
      if (state.features.runtimeStatus) {
        notify('正在保存到鼠标存储…');
        await client.waitForSave({onStatus: status => setRuntime(status)});
      }
      setBase(final);
      notify(state.features.runtimeStatus ? '设置已保存，回读核对通过。' : '设置已写入，回读核对通过。');
    } catch (error) {
      try { setBase(await client.read(expected.slot)); } catch {}
      throw Error(`部分设置可能已生效：${error.message}，请以重新读取为准`);
    } finally {
      state.saving = false;
    }
  }

  function serializeSlotRecord(record) {
    const base = normalizeBaseRecord(record);
    const decoded = decodeProfile(base.raw);
    const entry = {
      slot: base.slot,
      fps: decoded.fps,
      debounce: decoded.debounce,
      pre: decoded.pre,
      post: decoded.post,
      plock: decoded.plock,
      relock: decoded.relock,
      landingProtection: decoded.landingProtection,
      legacy: sanitizeLegacy(base.legacy)
    };
    if (state.features.customLandingGuard) {
      entry.landingMask = decoded.landingMask;
      entry.landingHoldMs = decoded.landingHoldMs;
      entry.airborneFloorMs = decoded.airborneFloorMs;
      entry.airborneLockout = decoded.airborneLockout;
    }
    if (state.features.perButtonDebounce) {
      entry.buttons = base.buttons.map(b => {
        const row = {pre: b.pre, post: b.post, plock: b.plock, relock: b.relock};
        if (state.features.independentDebounce) row.enabled = Boolean(b.enabled);
        return row;
      });
    }
    if (base.dpiStages.length) {
      entry.dpi = {
        activeStage: base.dpiActiveStage,
        stages: cloneStages(base.dpiStages)
      };
    }
    if (base.sleepSeconds !== null && base.sleepSeconds !== undefined) {
      entry.sleepSeconds = base.sleepSeconds;
    }
    if (base.angleTune !== null && base.angleTune !== undefined) {
      entry.angleTune = base.angleTune;
    }
    return entry;
  }

  function buildDraftFromSlotPayload(payload, freshBase) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw Error('无效的配置文件格式');
    }
    const base = normalizeBaseRecord(freshBase);
    const patch = {
      fps: Number(payload.fps),
      debounce: Boolean(payload.debounce),
      pre: Number(payload.pre),
      post: Number(payload.post),
      plock: Number(payload.plock),
      relock: Number(payload.relock),
      landingProtection: payload.landingProtection === undefined ? true : Boolean(payload.landingProtection)
    };
    if (state.features.customLandingGuard) {
      patch.landingMask = payload.landingMask === undefined ? LANDING_MASK_DEFAULT : parseDecimalInt(payload.landingMask);
      patch.landingHoldMs = payload.landingHoldMs === undefined ? LANDING_HOLD_DEFAULT : parseDecimalInt(payload.landingHoldMs);
      patch.airborneLockout = Boolean(payload.airborneLockout);
      patch.airborneFloorMs = patch.airborneLockout
        ? AIRBORNE_FLOOR_DEFAULT
        : (payload.airborneFloorMs === undefined ? AIRBORNE_FLOOR_DEFAULT : parseDecimalInt(payload.airborneFloorMs));
    } else if (
      payload.airborneLockout ||
      (payload.landingMask !== undefined && payload.landingMask !== LANDING_MASK_DEFAULT) ||
      (payload.landingHoldMs !== undefined && payload.landingHoldMs !== LANDING_HOLD_DEFAULT) ||
      (payload.airborneFloorMs !== undefined && payload.airborneFloorMs !== AIRBORNE_FLOOR_DEFAULT)
    ) {
      throw Error('当前固件不支持自定义抬起防误触参数');
    }

    if (state.features.perButtonDebounce) {
      const srcButtons = Array.isArray(payload.buttons) ? payload.buttons : null;
      if (!srcButtons || srcButtons.length !== state.features.buttonCount) {
        throw Error('配置文件缺少完整的逐键消抖参数');
      }
      patch.buttons = srcButtons.map(value => {
        const times = {};
        for (const key of TIMING_KEYS) times[key] = Number(value?.[key]);
        const normalized = decodeTimings(encodeTimings(times, state.features));
        if (state.features.independentDebounce) {
          if (typeof value?.enabled !== 'boolean') throw Error('无效的按键开关');
          normalized.enabled = value.enabled;
        }
        return normalized;
      });
      Object.assign(patch, patch.buttons[0]);
      if (state.features.independentDebounce) {
        patch.debounce = patch.buttons.some(button => button.enabled);
      }
    }

    const raw = encodeProfile(base.raw, patch, definitions.fps_presets.length, state.features);
    if (!payload.legacy || typeof payload.legacy !== 'object' || Array.isArray(payload.legacy)) {
      throw Error('配置文件缺少基础性能参数');
    }
    const legacy = sanitizeLegacy(payload.legacy);
    validateLegacy(legacy, state.transportTarget);
    validateFeatures(patch, state.features);

    let dpi = null;
    if (base.dpiStages.length) {
      if (payload.dpi) {
        const stages = cloneStages(payload.dpi.stages);
        const activeStage = Number(payload.dpi.activeStage);
        validateDpiStages(stages, activeStage);
        dpi = {stages, activeStage};
      } else {
        dpi = {stages: cloneStages(base.dpiStages), activeStage: base.dpiActiveStage};
      }
    }

    let sleepSeconds = base.sleepSeconds;
    if (base.sleepSeconds !== null && base.sleepSeconds !== undefined && payload.sleepSeconds !== undefined && payload.sleepSeconds !== null) {
      sleepSeconds = Number(payload.sleepSeconds);
      validateSleepSeconds(sleepSeconds);
    }

    let angleTune = base.angleTune;
    if (base.angleTune !== null && base.angleTune !== undefined && payload.angleTune !== undefined && payload.angleTune !== null) {
      angleTune = Number(payload.angleTune);
      validateAngleTune(angleTune);
    }

    return {raw, legacy, patch, dpi, sleepSeconds, angleTune};
  }

  function slotBrief(record) {
    const base = normalizeBaseRecord(record);
    const stage = base.dpiStages[base.dpiActiveStage - 1] || base.dpiStages[0];
    const dpiStr = stage ? (stage.x === stage.y ? `${stage.x} DPI` : `${stage.x}/${stage.y} DPI`) : '—';
    return `${dpiStr} · ${rate(base.legacy.polling)}`;
  }

  async function buildAllProfilesBackup() {
    requireAccess();
    const slots = {};
    let activeSlot = state.base.active;
    for (let s = 1; s <= 4; s++) {
      const rec = await client.read(s);
      activeSlot = rec.active;
      slots[String(s)] = serializeSlotRecord(rec);
    }
    return {
      format: 'hyperluna-profiles-v1',
      exportedAt: new Date().toISOString(),
      firmware: {
        name: state.features.name || '',
        revision: state.features.implementationRevision || 0,
        buttonCount: state.features.buttonCount || 0,
        independentDebounce: Boolean(state.features.independentDebounce),
        customLandingGuard: Boolean(state.features.customLandingGuard)
      },
      activeSlot,
      slots
    };
  }

  async function exportAllProfiles() {
    if (dirty.value) {
      fail(Error('请先应用或放弃当前未保存的更改，再导出配置'));
      return;
    }
    await guard(async () => {
      const backup = await buildAllProfilesBackup();
      downloadJson(`Luna33-profiles-${Date.now()}.json`, backup);
      notify('已导出全部 4 组配置。');
    });
  }

  async function prepareCopySlot(targetSlots) {
    if (dirty.value) {
      fail(Error('请先应用或放弃当前未保存的更改，再复制槽位'));
      return;
    }
    const sourceSlot = state.slot;
    const targets = [...new Set((Array.isArray(targetSlots) ? targetSlots : [targetSlots]).map(Number))]
      .filter(s => Number.isInteger(s) && s >= 1 && s <= 4 && s !== sourceSlot)
      .sort((a, b) => a - b);
    if (!targets.length) return;

    await guard(async () => {
      const sourceRecord = await client.read(sourceSlot);
      const sourcePayload = serializeSlotRecord(sourceRecord);
      const plan = [];
      for (const target of targets) {
        const freshTarget = await client.read(target);
        const draft = buildDraftFromSlotPayload(sourcePayload, freshTarget);
        const rows = diffSlotConfig(freshTarget, draft);
        plan.push({slot: target, freshTarget, draft, rows});
      }
      const changedPlans = plan.filter(item => item.rows.length > 0);
      if (!changedPlans.length) {
        notify('目标槽位与当前配置已完全一致，无需复制。');
        return;
      }

      state.reviewKicker = 'PROFILE COPY';
      state.reviewTitle = targets.length === 1
        ? `复制配置 ${sourceSlot} 到配置 ${targets[0]}`
        : `复制配置 ${sourceSlot} 到所选槽位`;
      state.reviewDescription = `将配置 ${sourceSlot} 的完整参数写入目标槽位并保存到板载存储`;
      state.reviewRows = targets.length === 1
        ? changedPlans[0].rows
        : plan.map(item => ({
            name: `配置 ${item.slot}`,
            before: slotBrief(item.freshTarget),
            after: item.rows.length ? `${item.rows.length} 项变更` : '无变更'
          }));

      pendingRegisterAction = async () => {
        state.saving = true;
        try {
          for (const item of changedPlans) {
            const latestTarget = await client.read(item.slot);
            const draft = buildDraftFromSlotPayload(sourcePayload, latestTarget);
            await writeSingleSlot(item.slot, draft, latestTarget);
          }
          if (state.features.runtimeStatus) {
            notify('正在保存到鼠标存储…');
            await client.waitForSave({onStatus: status => setRuntime(status)});
          }
          setBase(await client.read(state.slot));
          notify(
            changedPlans.length === 1
              ? `已将配置 ${sourceSlot} 复制到配置 ${changedPlans[0].slot}。`
              : `已将配置 ${sourceSlot} 复制到 ${changedPlans.length} 个槽位。`
          );
        } catch (error) {
          try { setBase(await client.read(state.slot)); } catch {}
          throw Error(`部分设置可能已生效：${error.message}，请以重新读取为准`);
        } finally {
          state.saving = false;
        }
      };
      state.reviewVisible = true;
    });
  }

  async function prepareImportProfiles(fileOrEvent) {
    const input = fileOrEvent?.target;
    try {
      const file = input ? input.files?.[0] : fileOrEvent;
      if (!file) return;
      if (dirty.value) throw Error('请先应用或放弃当前未保存的更改，再导入配置');
      if (file.size > 262144) throw Error('配置文件需小于 256 KiB');
      const data = JSON.parse(await file.text());
      if (!data || data.format !== 'hyperluna-profiles-v1' || !data.slots || typeof data.slots !== 'object' || Array.isArray(data.slots)) {
        throw Error('无效的 HyperLuna 配置文件');
      }
      const rawKeys = Object.keys(data.slots);
      if (!rawKeys.length || rawKeys.some(k => !['1', '2', '3', '4'].includes(k))) {
        throw Error('配置文件不包含有效的 1–4 号槽位');
      }
      const slotKeys = rawKeys.map(Number).sort((a, b) => a - b);

      await guard(async () => {
        const plan = [];
        for (const slot of slotKeys) {
          const fresh = await client.read(slot);
          const draft = buildDraftFromSlotPayload(data.slots[String(slot)], fresh);
          const rows = diffSlotConfig(fresh, draft);
          plan.push({slot, payload: data.slots[String(slot)], fresh, draft, rows});
        }
        const changedPlans = plan.filter(item => item.rows.length > 0);
        if (!changedPlans.length) {
          notify('导入配置与鼠标当前配置一致，无需写入。');
          return;
        }

        state.reviewKicker = 'PROFILE IMPORT';
        state.reviewTitle = `导入 ${changedPlans.length} 组配置`;
        state.reviewDescription = '核对将要更新的槽位后写入鼠标并保存到板载存储';
        state.reviewRows = changedPlans.length === 1 && plan.length === 1
          ? changedPlans[0].rows
          : plan.map(item => ({
              name: `配置 ${item.slot}`,
              before: slotBrief(item.fresh),
              after: item.rows.length ? `${item.rows.length} 项变更` : '无变更'
            }));

        pendingRegisterAction = async () => {
          state.saving = true;
          try {
            for (const item of changedPlans) {
              const latest = await client.read(item.slot);
              const draft = buildDraftFromSlotPayload(item.payload, latest);
              await writeSingleSlot(item.slot, draft, latest);
            }
            if (state.features.runtimeStatus) {
              notify('正在保存到鼠标存储…');
              await client.waitForSave({onStatus: status => setRuntime(status)});
            }
            setBase(await client.read(state.slot));
            notify(`已导入并保存 ${changedPlans.length} 组配置。`);
          } catch (error) {
            try { setBase(await client.read(state.slot)); } catch {}
            throw Error(`部分设置可能已生效：${error.message}，请以重新读取为准`);
          } finally {
            state.saving = false;
          }
        };
        state.reviewVisible = true;
      });
    } catch (error) {
      fail(error);
    } finally {
      if (input) input.value = '';
    }
  }

  function cloneBase() {
    return {
      slot: state.base.slot,
      active: state.base.active,
      raw: Array.from(state.base.raw || []),
      legacy: sanitizeLegacy(state.base.legacy || {}),
      buttons: (state.base.buttons || []).map(b => ({...b})),
      dpiStages: cloneStages(state.base.dpiStages),
      dpiActiveStage: state.base.dpiActiveStage,
      sleepSeconds: state.base.sleepSeconds,
      angleTune: state.base.angleTune,
      at: state.base.at
    };
  }

  async function applyPendingChanges() {
    await guard(async () => {
      const draft = collectDraft();
      const rows = changeRows(draft);
      if (!rows.length) return;
      await applySettings(draft, cloneBase());
    });
  }

  async function readRegisters() {
    await guard(async () => {
      for (const row of state.registerRows) {
        row.value = await client.peek(row.page, row.reg);
        row.input = hex(row.value);
        if (row.baseline === null) row.baseline = row.value;
      }
      notify(`已读取 ${state.registerRows.length} 项寄存器`);
    });
  }

  async function readOne() {
    await guard(async () => {
      const page = parseByte(state.pageHex);
      const reg = parseByte(state.addressHex, 126);
      const key = registerAddress(page, reg);
      let row = state.registerRows.find(r => r.key === key);
      if (!row) {
        row = {key, page, reg, label: '手动添加', value: null, baseline: null, input: '', undo: null};
        state.registerRows.push(row);
      }
      row.value = await client.peek(page, reg);
      row.input = hex(row.value);
      notify(`${key} = ${hex(row.value)}`);
    });
  }

  function setBaseline() {
    state.registerRows.forEach(row => {
      if (row.value !== null) row.baseline = row.value;
    });
    notify('已设为对比基线');
  }

  function reviewRegister(row, undo = false) {
    try {
      requireAccess();
      const value = undo ? row.undo : parseByte(row.input);
      const expected = row.value;
      state.reviewKicker = 'PAW3950 WRITE';
      state.reviewTitle = `${undo ? '恢复' : '写入'}寄存器 ${row.key}`;
      state.reviewDescription = '写入所选地址';
      state.reviewRows = [{
        name: row.key,
        before: expected === null ? '写前读取' : hex(expected),
        after: hex(value)
      }];
      pendingRegisterAction = async () => {
        const old = await client.peek(row.page, row.reg);
        if (expected !== null && old !== expected) {
          row.value = old;
          row.input = hex(old);
          throw Error('寄存器已发生变化，本次未写入，请核对后重试');
        }
        row.value = await client.poke(row.page, row.reg, value);
        row.undo = old;
        row.input = hex(row.value);
        notify(`${row.key} 已写入并回读为 ${hex(row.value)}。`);
      };
      state.reviewVisible = true;
    } catch (error) {
      fail(error);
    }
  }

  async function confirmReview() {
    const action = pendingRegisterAction;
    pendingRegisterAction = null;
    state.reviewVisible = false;
    if (action) return guard(action);
  }

  function cancelReview() {
    pendingRegisterAction = null;
    state.reviewVisible = false;
  }

  function snapshot() {
    return {
      format: 'lunafury-lf33-snapshot-v1',
      demo: lastSource?.demo ?? false,
      device: lastSource,
      at: new Date().toISOString(),
      config: state.connected ? state.base : null,
      registers: Object.fromEntries(state.registerRows.filter(r => r.value !== null).map(r => [r.key, r.value]))
    };
  }

  function exportSnapshot() {
    downloadJson(`Luna33-snapshot-${Date.now()}.json`, snapshot());
  }

  async function importSnapshot(event) {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 262144) throw Error('快照需小于 256 KiB');
      const data = JSON.parse(await file.text());
      if (data.format !== 'lunafury-lf33-snapshot-v1' || data.demo || !state.connected) {
        throw Error('请连接同一模式的设备，再导入对应快照');
      }
      const entries = Object.entries(data.registers || {});
      if (entries.length > 256) throw Error('快照地址过多');
      const valid = entries.map(([key, value]) => {
        if (!/^[\da-f]{2}:[\da-f]{2}$/i.test(key) || !Number.isInteger(value) || value < 0 || value > 255) {
          throw Error('无效的快照数据');
        }
        const [page, reg] = key.split(':').map(v => parseInt(v, 16));
        return {key: registerAddress(page, reg), page, reg, value};
      });
      for (const item of valid) {
        let row = state.registerRows.find(r => r.key === item.key);
        if (!row) {
          row = {key: item.key, page: item.page, reg: item.reg, label: '导入地址', value: null, baseline: null, input: '', undo: null};
          state.registerRows.push(row);
        }
        row.baseline = item.value;
      }
      notify('已导入对比基线');
    } catch (error) {
      fail(error);
    } finally {
      if (event.target) event.target.value = '';
    }
  }

  function mount() {
    applyDocumentLanguage(state.language);
    applyDocumentTheme(state.theme);
  }

  return {
    state,
    t,
    byte: hex,
    rate,
    hasAccess,
    fpsOptions,
    lodOptions,
    debounceDraft,
    pollingOptions,
    scanRateOptions,
    pendingChanges,
    dirty,
    patchText,
    legacyText,
    collectDraft,
    changeRows,
    diffSlotConfig,
    setTheme,
    toggleTheme,
    languageChanged,
    setBase,
    cloneBase,
    discardChanges,
    attach,
    connect,
    disconnect,
    deviceRemoved,
    readConfig,
    readReceiverAfh,
    readReceiverLinkQuality,
    rescanReceiverAfh,
    resetReceiverCounters,
    readOpticalDiagnostics,
    saveOpticalBaseline,
    clearOpticalBaseline,
    retrySave,
    changeSlot,
    selectDpiStage,
    setActiveDpiValue,
    stepActiveDpi,
    addDpiStage,
    removeDpiStage,
    toggleLandingKey,
    resetLandingDefaults,
    applySettings,
    applyPendingChanges,
    buildAllProfilesBackup,
    exportAllProfiles,
    prepareCopySlot,
    prepareImportProfiles,
    readRegisters,
    readOne,
    setBaseline,
    reviewRegister,
    confirmReview,
    cancelReview,
    snapshot,
    exportSnapshot,
    importSnapshot,
    fail,
    notify,
    setRuntime,
    mount
  };
}
