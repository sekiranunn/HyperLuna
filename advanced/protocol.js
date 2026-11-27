// LF33 v1. Packet layout matches lunafury-analysis/port/luna.py.
import {decodeFeatures, validateFeatures} from './features.js';
export const VID = 0x373e;
export const PIDS = [0x0032, 0x0033];
export const hex = n => Number(n).toString(16).padStart(2, '0').toUpperCase();
export const toHex = a => Array.from(a, hex).join('');
export const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function packet(command, payload, group = 1, target = 2) {
  if (payload.length > 58 || ![...payload, command, group, target].every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw Error('无效的 HID 数据');
  const out = new Uint8Array(64);
  out.set([0, 0, target, payload.length, group, command, ...payload]);
  return out;
}
export function normalize(raw) {
  let bytes = raw instanceof DataView ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : new Uint8Array(raw);
  if (bytes.length === 65 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (bytes.length < 6 || bytes[3] > 58 || bytes.length < 6 + bytes[3]) throw Error('HID 响应不完整');
  return bytes.slice(0, 6 + bytes[3]);
}
const echoLength = {1: 1, 2: 17, 3: 1, 4: 1, 6: 3, 7: 2, 8: 2, 9: 10, 12: 1};
const replyMinimum = {0: 17, 1: 27, 2: 27, 3: 27, 4: 11, 5: 11, 6: 13, 7: 13, 8: 20, 9: 20, 10:18, 11:18, 12: 11};
export function matches(reply, command, payload, group = 1) {
  if (reply.length < 6 || reply[4] !== group || reply[5] !== command || ![0xa1, 0xa2, 0xa3].includes(reply[0])) return false;
  if (command !== 0x7e) {
    if (reply[2] === 1 && group === 0 && command === 0x85 && reply[0] === 0xa1) {
      const sub = payload.length ? payload[0] : 0;
      if (sub === 0 || sub === 2) return reply.length >= 62 && reply[6] === 0x41 && reply[7] === 0x46;
      if (sub === 1 || sub === 3) return reply.length >= 36 && reply[6] === 0x4c && reply[7] === 0x51;
    }
    if (!(group === 0 && [0x81, 0x83, 0x85].includes(command)) && payload.length && reply[6] !== payload[0]) return false;
    return true;
  }
  // A stock firmware can reject the capability probe without echoing LF33.
  if (payload[3] === 0 && reply[0] === 0xa3 && reply[3] === 0) return true;
  if (!equal(reply.slice(6, 10), payload.slice(0, 4))) return false;
  const op = payload[3], count = echoLength[op] || 0;
  if (count && !equal(reply.slice(10, 10 + count), payload.slice(4, 4 + count))) return false;
  if (reply[0] === 0xa1) {
    if (!replyMinimum[op] || reply.length < replyMinimum[op]) return false;
    if (op === 5 && (payload[4] === 2 ? ![0, 1].includes(reply[10]) : reply[10] !== payload[4])) return false;
  } else if (op === 5 && reply[10] !== payload[4]) return false;
  return true;
}
export class RequestTimeout extends Error {
  constructor() { super('设备响应超时。请保持鼠标唤醒，并关闭其他驱动页面后重新读取。'); this.name = 'RequestTimeout'; }
}
function readonly(command, data, group) {
  if (group === 1 && command === 0x7e) return [0, 1, 3, 7, 8, 10].includes(data[3]) || (data[3] === 5 && data[4] === 2);
  if (group === 0 && command === 0x85) return data.length === 0 || data[0] === 0 || data[0] === 1;
  return LEGACY_READS.has(`${group}:${command}`) || (group === 0 && command === 0x81);
}
const LEGACY_READS = new Set([
  '1:128', '1:129', '1:130', '1:132', '1:136', '1:137', '1:138', '1:139', '1:147', '1:148',
  '0:131', '0:135', '0:152', '0:159', '2:129'
]);

export class HidTransport {
  constructor(device, {timeout = 2100, interval = 25, log = () => {}} = {}) {
    if (device.vendorId !== VID || !PIDS.includes(device.productId)) throw Error('请选择正常模式的 Luna33 或其接收器');
    this.device = device;
    this.target = device.productId === 0x0032 ? 0 : 2;
    this.timeout = timeout; this.interval = interval; this.log = log;
    this.tail = Promise.resolve(); this.closed = false;
  }
  exchange(command, data, group = 1, target = this.target) {
    const payload = Uint8Array.from(data);
    const job = this.tail.then(() => this.perform(command, payload, group, target));
    this.tail = job.catch(() => {});
    return job;
  }
  async perform(command, payload, group, target = this.target) {
    if (this.closed || !this.device.opened) throw Error('设备已断开，请重新连接');
    const query = readonly(command, payload, group), attempts = query ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const record = {at: new Date().toISOString(), target, group, command, payload: toHex(payload), readonly: query, attempt: attempt + 1};
      try {
        await this.device.sendFeatureReport(0, packet(command, payload, group, target));
        const deadline = Date.now() + this.timeout;
        while (Date.now() < deadline) {
          await sleep(this.interval);
          if (this.closed) throw Error('设备已断开');
          let reply;
          try { reply = normalize(await this.device.receiveFeatureReport(0)); }
          catch (e) { if (!this.device.opened || e.name === 'NetworkError') throw e; continue; }
          if (reply[2] !== target || !matches(reply, command, payload, group)) continue;
          record.reply = toHex(reply); this.log(record);
          if (reply[0] !== 0xa1) throw Object.assign(Error(`设备拒绝命令（0x${hex(reply[0])}）`), {status: reply[0]});
          return reply;
        }
        throw new RequestTimeout();
      } catch (error) {
        if (!record.reply) { record.error = error.message; this.log(record); }
        if (!(error instanceof RequestTimeout) || !query || attempt === attempts - 1) throw error;
        await sleep(100);
      }
    }
  }
  async close() {
    this.closed = true;
    await this.tail;
    if (this.device.opened) await this.device.close();
  }
}

export const LEGACY = {
  polling: {label: '回报率', group: 1, get: 0x80, set: 0, codes: [8, 4, 2, 1, 16, 32, 64, 128]},
  scan_rate: {label: '按键轮询率', group: 0, get: 0x9f, set: 0x1f, codes: [1, 16, 32, 64, 128]},
  hyper: {label: '竞技模式', group: 1, get: 0x8b, set: 0x0b, codes: [0, 1]},
  tracking: {label: '追踪模式', group: 1, get: 0x93, set: 0x13, codes: [0, 1]},
  lod: {label: 'LOD 高度', group: 1, get: 0x88, set: 8},
  motion_sync: {label: '运动同步', group: 1, get: 0x89, set: 9, codes: [0, 1]},
  angle_snap: {label: '直线修正', group: 1, get: 0x84, set: 4, codes: [0, 1]},
  ripple: {label: '波纹控制', group: 1, get: 0x8a, set: 10, codes: [0, 1]},
  scan_sequence: {label: '闪电扳机', group: 0, get: 0x98, set: 0x18, codes: [0, 1, 2], length: 4}
};
export const RATES = {8: 125, 4: 250, 2: 500, 1: 1000, 16: 1000, 32: 2000, 64: 4000, 128: 8000};
export const TIMING_KEYS = Object.freeze(['pre', 'post', 'plock', 'relock']);
// Hardware indices follow the stock GPIO scanner (back = 3, forward = 4).
export const BUTTONS = Object.freeze([
  {id:0,label:'左键'}, {id:1,label:'右键'}, {id:2,label:'中键'},
  {id:4,label:'前侧键'}, {id:3,label:'后侧键'}
].map(Object.freeze));
export function decodeTimings(raw) {
  if(raw.length!==8)throw Error('消抖参数响应不完整');
  const view=new DataView(Uint8Array.from(raw).buffer);
  return Object.fromEntries(TIMING_KEYS.map((key,i)=>[key,view.getUint16(i*2,true)/10]));
}
export function encodeTimings(value,features) {
  const raw=new Uint8Array(8),view=new DataView(raw.buffer);
  TIMING_KEYS.forEach((key,i)=>{
    const n=value[key];
    if(!Number.isFinite(n)||n<0||n>100||Math.abs(n*10-Math.round(n*10))>1e-7)throw Error('消抖范围为 0–100 ms，步进 0.1 ms');
    if(features?.debounce==='ms'&&!Number.isInteger(n))throw Error('当前固件的消抖参数须为整数 ms');
    view.setUint16(i*2,Math.round(n*10),true);
  });
  return raw;
}
export const LANDING_HOLD_DEFAULT = 28, LANDING_HOLD_MIN = 0, LANDING_HOLD_MAX = 100;
export const AIRBORNE_FLOOR_DEFAULT = 8, AIRBORNE_FLOOR_MIN = 0, AIRBORNE_FLOOR_MAX = 100, AIRBORNE_LOCKOUT_CODE = 255;
export const LANDING_MASK_DEFAULT = 0x03;
export function parseDecimalInt(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : NaN;
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return NaN;
  return Number(text);
}
export const equalButtons=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&[5,6].includes(a.length)&&a.length===b.length&&a.every((value,i)=>value.enabled===b[i].enabled&&TIMING_KEYS.every(key=>value[key]===b[i][key]));
export const buttonMask=raw=>(raw[5]&128)?raw[5]&31:raw[4]?31:0;
function isValidRawLandingGuard(raw) {
  const flags = raw[14], hold = raw[15], air = raw[2];
  if (raw[1] !== 0 || raw[3] !== 0) return false;
  if (!(flags & 0x02) && (flags & 0x7c)) return false;
  if (!(flags & 0x80)) return hold === 0 && air === 0;
  return hold <= LANDING_HOLD_MAX && (air <= AIRBORNE_FLOOR_MAX || air === AIRBORNE_LOCKOUT_CODE);
}
export function validateRawLandingGuard(raw) {
  if (raw.length !== 16) throw Error('配置长度必须为 16 字节');
  const flags = raw[14], hold = raw[15], air = raw[2];
  if (raw[1] !== 0 || raw[3] !== 0) throw Error('无效的抬鼠复位防误触设置');
  if (!(flags & 0x02) && (flags & 0x7c)) throw Error('无效的抬鼠复位防误触设置');
  if (!(flags & 0x80)) {
    if (hold !== 0 || air !== 0) throw Error('无效的抬鼠复位防误触设置');
  } else {
    if (hold > LANDING_HOLD_MAX) throw Error('落地锁定时长须为 0–100 ms 的整数');
    if (air > AIRBORNE_FLOOR_MAX && air !== AIRBORNE_LOCKOUT_CODE) throw Error('空中滤波下限须为 0–100 ms 的整数');
  }
}
export function validateRawProfile(raw, fpsCount = 34, features) {
  if (!raw || raw.length !== 16 || !Array.from(raw).every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw Error('配置长度必须为 16 字节');
  }
  if (raw[0] > fpsCount) throw Error('无效的 FPS 预设');
  if (raw[4] > 1) throw Error('无效的按键开关');
  if (features?.independentDebounce && raw[5] !== 0 && (!(raw[5] & 0x80) || (raw[5] & 0x60))) {
    throw Error('无效的按键开关');
  }
  const view = new DataView(Uint8Array.from(raw).buffer);
  for (let i = 0; i < 4; i++) {
    if (view.getUint16(6 + i * 2, true) > 1000) throw Error('消抖范围为 0–100 ms，步进 0.1 ms');
  }
  if (features?.customLandingGuard) {
    validateRawLandingGuard(raw);
  } else if (features?.landingPolicy) {
    if (raw[1] !== 0 || raw[2] !== 0 || raw[3] !== 0 || raw[14] > 1 || raw[15] !== 0) {
      throw Error('无效的抬鼠复位防误触设置');
    }
  }
}
export function decodeProfile(raw) {
  if (raw.length !== 16) throw Error('配置长度必须为 16 字节');
  const view = new DataView(Uint8Array.from(raw).buffer);
  const flags = raw[14];
  const customMask = Boolean(flags & 0x02);
  const customTiming = Boolean(flags & 0x80);
  const airborneLockout = customTiming && raw[2] === AIRBORNE_LOCKOUT_CODE;
  return {
    fps: raw[0], debounce: raw[4] !== 0,
    pre: view.getUint16(6, true) / 10, post: view.getUint16(8, true) / 10,
    plock: view.getUint16(10, true) / 10, relock: view.getUint16(12, true) / 10,
    landingProtection: !(flags & 1),
    landingMask: customMask ? ((flags >> 2) & 0x1f) : LANDING_MASK_DEFAULT,
    landingHoldMs: customTiming ? raw[15] : LANDING_HOLD_DEFAULT,
    airborneFloorMs: customTiming ? (airborneLockout ? AIRBORNE_FLOOR_DEFAULT : raw[2]) : AIRBORNE_FLOOR_DEFAULT,
    airborneLockout
  };
}
export function encodeProfile(original, value, fpsCount = 34, features) {
  if (original.length !== 16) throw Error('请先读取鼠标配置');
  if (!Number.isInteger(value.fps) || value.fps < 0 || value.fps > fpsCount) throw Error('无效的 FPS 预设');
  const raw = Uint8Array.from(original), view = new DataView(raw.buffer);
  raw[0] = value.fps; raw.fill(0,1,4); raw[4] = Number(value.debounce);
  if(features?.independentDebounce){
    if(!Array.isArray(value.buttons)||value.buttons.length!==5||value.buttons.some(button=>typeof button.enabled!=='boolean'))throw Error('无效的按键开关');
    const mask=value.buttons.reduce((bits,button,key)=>bits|(Number(button.enabled)<<key),0);
    raw[4]=Number(mask!==0);raw[5]=128|mask;
  }
  if(features?.customLandingGuard){
    if(typeof value.landingProtection!=='boolean')throw Error('无效的抬鼠复位防误触设置');
    const mask=value.landingMask===undefined?LANDING_MASK_DEFAULT:value.landingMask;
    if(!Number.isInteger(mask)||mask<0||mask>31)throw Error('无效的防误触按键范围');
    const hold=value.landingHoldMs===undefined?LANDING_HOLD_DEFAULT:value.landingHoldMs;
    if(!Number.isInteger(hold)||hold<LANDING_HOLD_MIN||hold>LANDING_HOLD_MAX)throw Error('落地锁定时长须为 0–100 ms 的整数');
    if(value.airborneLockout!==undefined&&typeof value.airborneLockout!=='boolean')throw Error('无效的抬鼠复位防误触设置');
    const lockout=Boolean(value.airborneLockout);
    const floor=value.airborneFloorMs===undefined?AIRBORNE_FLOOR_DEFAULT:value.airborneFloorMs;
    if(!lockout&&(!Number.isInteger(floor)||floor<AIRBORNE_FLOOR_MIN||floor>AIRBORNE_FLOOR_MAX))throw Error('空中滤波下限须为 0–100 ms 的整数');
    const origValid = isValidRawLandingGuard(original);
    const prev = origValid ? decodeProfile(original) : null;
    const maskUnchanged = origValid && mask === prev.landingMask;
    const timingUnchanged = origValid && hold === prev.landingHoldMs && lockout === prev.airborneLockout
      && (lockout || floor === prev.airborneFloorMs);
    const maskBits = maskUnchanged
      ? (original[14] & 0x7e)
      : (mask !== LANDING_MASK_DEFAULT ? (0x02 | (mask << 2)) : 0);
    let timingBit, outHold, outAir;
    if (timingUnchanged) {
      timingBit = original[14] & 0x80;
      outHold = original[15];
      outAir = original[2];
    } else {
      const useCustomTiming = lockout || hold !== LANDING_HOLD_DEFAULT || floor !== AIRBORNE_FLOOR_DEFAULT;
      timingBit = useCustomTiming ? 0x80 : 0;
      outHold = useCustomTiming ? hold : 0;
      outAir = useCustomTiming ? (lockout ? AIRBORNE_LOCKOUT_CODE : floor) : 0;
    }
    raw[14] = Number(!value.landingProtection) | maskBits | timingBit;
    raw[15] = outHold;
    raw[2] = outAir;
  }else if(features?.landingPolicy){
    if(typeof value.landingProtection!=='boolean')throw Error('无效的抬鼠复位防误触设置');
    raw[14]=Number(!value.landingProtection);raw[15]=0;
  }
  ['pre', 'post', 'plock', 'relock'].forEach((key, i) => {
    const n = value[key];
    if (!Number.isFinite(n) || n < 0 || n > 100 || Math.abs(n * 10 - Math.round(n * 10)) > 1e-7) throw Error('消抖范围为 0–100 ms，步进 0.1 ms');
    view.setUint16(6 + i * 2, Math.round(n * 10), true);
  });
  return raw;
}
export function validateLegacy(values, target = 2) {
  for (const [key, spec] of Object.entries(LEGACY)) {
    const v = values[key];
    if (!Number.isInteger(v) || v < 0 || v > 255 || (spec.codes && !spec.codes.includes(v))) throw Error(`${spec.label}的值无效`);
  }
  if (target === 0 && RATES[values.polling] > 1000) throw Error('有线回报率最高为 1000 Hz，请连接无线接收器后设置');
}
export const DPI_MIN = 50, DPI_MAX = 30000, DPI_STEP = 50, DPI_MAX_STAGES = 6;
export const DEFAULT_DPI_COLORS = Object.freeze(['#c83b2b', '#1342d6', '#0e8a5c', '#6d3fc0', '#c4760a', '#3d5a73']);
export const SLEEP_PRESETS_SECONDS = Object.freeze([0, 60, 180, 300, 600, 1800]);
export const ANGLE_TUNE_MIN = -30, ANGLE_TUNE_MAX = 30;
export function validateDpiStages(stages, activeStage) {
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > DPI_MAX_STAGES) throw Error(`DPI 档位数量需为 1–${DPI_MAX_STAGES}`);
  if (!Number.isInteger(activeStage) || activeStage < 1 || activeStage > stages.length) throw Error('当前 DPI 档位无效');
  for (const stage of stages) {
    for (const axis of [stage?.x, stage?.y]) {
      if (!Number.isInteger(axis) || axis < DPI_MIN || axis > DPI_MAX || axis % DPI_STEP !== 0) {
        throw Error(`DPI 范围为 ${DPI_MIN}–${DPI_MAX}，步进 ${DPI_STEP}`);
      }
    }
  }
}
export function validateSleepSeconds(seconds) {
  if (!Number.isInteger(seconds) || (seconds !== 0 && (seconds < 60 || seconds > 3600))) {
    throw Error('休眠时间无效');
  }
}
export function validateAngleTune(degrees) {
  if (!Number.isInteger(degrees) || degrees < ANGLE_TUNE_MIN || degrees > ANGLE_TUNE_MAX) {
    throw Error(`角度微调范围为 ${ANGLE_TUNE_MIN}° 至 +${ANGLE_TUNE_MAX}°`);
  }
}
export function equalDpiStages(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((stage, i) => stage.x === b[i].x && stage.y === b[i].y);
}
export function registerAddress(page, reg) {
  if (!Number.isInteger(page) || page < 0 || page > 255 || !Number.isInteger(reg) || reg < 0 || reg >= 127) throw Error('页地址需为 00–FF，寄存器地址需为 00–7E');
  return `${hex(page)}:${hex(reg)}`;
}
export function decodeReceiverAfh(reply) {
  const bytes = reply instanceof Uint8Array ? reply : Uint8Array.from(reply);
  if (bytes.length < 62 || bytes[6] !== 0x41 || bytes[7] !== 0x46 || bytes[8] !== 1) {
    throw Error('无效的接收器频谱遥测响应');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawFlags = bytes[9];
  const chTable = Array.from({length: 5}, (_, i) => 2400 + bytes[10 + i]);
  const searchCh = [2400 + bytes[15], 2400 + bytes[16]];
  const activeCh = 2400 + bytes[17];
  const chIdx = bytes[18];
  const lastPasses = bytes[19];
  const scanCount = view.getUint16(20, true);
  const hopCount = view.getUint16(22, true);
  const spectrum = Array.from({length: 38}, (_, i) => ({mhz: 2404 + 2 * i, dbm: -bytes[24 + i]}));
  return {
    version: bytes[8],
    flags: {
      raw: rawFlags,
      scanValid: Boolean(rawFlags & 1),
      hwTimeout: Boolean(rawFlags & 2),
      lastWasQuick: Boolean(rawFlags & 4),
      manualScan: Boolean(rawFlags & 8),
      v4Capable: Boolean(rawFlags & 16),
      linkActive: Boolean(rawFlags & 32)
    },
    linkActive: Boolean(rawFlags & 32),
    chTable, searchCh, activeCh, chIdx, lastPasses, scanCount, hopCount, spectrum
  };
}
export function decodeReceiverLinkQuality(reply) {
  const bytes = reply instanceof Uint8Array ? reply : Uint8Array.from(reply);
  if (bytes.length < 36 || bytes[6] !== 0x4c || bytes[7] !== 0x51 || bytes[8] !== 1) {
    throw Error('无效的接收器链路质量响应');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wireFlags = bytes[9];
  const activeCh = 2400 + bytes[10];
  const chIdx = bytes[11];
  const lastPasses = bytes[13];
  const scanCount = view.getUint16(14, true);
  const hopCount = view.getUint16(16, true);
  const crcErrCount = view.getUint16(20, true);
  const rxOkCount = view.getUint32(22, true);
  const emaQ4 = view.getUint16(26, true);
  const lastRaw = bytes[28];
  const bestRaw = bytes[29];
  const worstRaw = bytes[30];
  const slotDbm = Array.from({length: 5}, (_, i) => (bytes[31 + i] ? -bytes[31 + i] : null));
  return {
    version: bytes[8],
    flags: {
      raw: wireFlags,
      scanValid: Boolean(wireFlags & 1),
      hwTimeout: Boolean(wireFlags & 2),
      lastWasQuick: Boolean(wireFlags & 4),
      manualScan: Boolean(wireFlags & 8),
      v4Capable: Boolean(wireFlags & 16),
      linkActive: Boolean(wireFlags & 32)
    },
    linkActive: Boolean(wireFlags & 32),
    activeCh,
    chIdx,
    lastPasses,
    scanCount,
    hopCount,
    crcErrCount,
    rxOkCount,
    emaQ4,
    emaDbm: emaQ4 ? -Number((emaQ4 / 16).toFixed(1)) : null,
    lastDbm: lastRaw ? -lastRaw : null,
    bestDbm: bestRaw ? -bestRaw : null,
    worstDbm: worstRaw ? -worstRaw : null,
    slotDbm
  };
}

export class LunaClient {
  constructor(transport, definitions) { this.transport = transport; this.definitions = definitions; }
  extension(op, ...data) { return this.transport.exchange(0x7e, [0x4c, 0x46, 1, op, ...data]); }
  async version() {
    const reply = await this.transport.exchange(0x81, new Array(16).fill(0), 0);
    if (reply.length < 10) throw Error('固件版本响应不完整');
    return Array.from(reply.slice(6, 10)).join('.');
  }
  async info() {
    const r = await this.extension(0);
    if (String.fromCharCode(...r.slice(10, 14)) !== 'LF33' || r[14] !== 1 || r[15] !== this.definitions.fps_presets.length || r[16] !== this.definitions.counters.length) throw Error('未识别到兼容的 LF33 v1 固件');
    this.features = decodeFeatures(r);
    return {magic: 'LF33', protocol: r[14], fpsCount: r[15], counterCount: r[16], features:this.features};
  }
  decodeStatus(r) {
    const view=new DataView(r.buffer,r.byteOffset,r.byteLength);
    const result={save:r[10]&15,attempts:r[10]>>>4,clockPaused:Boolean(r[12]),saveError:r[13],invalidAges:view.getUint32(14,true)};
    if(result.save>3||result.attempts>3||r[11]!==0||r[12]>1)throw Error('无效的固件状态响应');
    return result;
  }
  async runtimeStatus() {
    if(!this.features?.runtimeStatus)return null;
    return this.decodeStatus(await this.extension(10,0));
  }

  async waitForSave({timeout=10000,interval=100,onStatus=()=>{}}={}) {
    if(!this.features?.runtimeStatus)return null;
    const deadline=Date.now()+timeout;
    do{
      const status=await this.runtimeStatus();onStatus(status);
      if(status.save===0||status.save===2)return status;
      if(status.save===3&&status.attempts>=3)throw Error('保存失败，当前参数尚未写入存储；请重试保存');
      if(Date.now()>=deadline)break;
      await sleep(interval);
    }while(true);
    throw Error('保存尚未确认，请重新读取状态');
  }
  async retrySave(options) {
    if(!this.features?.runtimeStatus)throw Error('当前固件不支持保存状态');
    // Mutations are sent once. If the reply is lost, inspect state instead of
    // replaying a flash request whose outcome is unknown.
    try{await this.extension(11,0);}catch(error){if(!(error instanceof RequestTimeout))throw error;}
    return this.waitForSave(options);
  }
  slot(slot) { if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw Error('配置槽必须为 1–4'); }
  async activeProfile() {
    const r = await this.transport.exchange(0x85, [0], 0); this.slot(r[6]); return r[6];
  }
  async getProfile(slot) { this.slot(slot); return (await this.extension(1, slot)).slice(11, 27); }
  async battery() {
    try {
      const r = await this.transport.exchange(0x83, [0, 0], 0);
      if (r.length >= 8 && r[6] <= 1 && r[7] <= 100) return {charging: r[6] === 1, percent: r[7]};
    } catch (error) {
      if (![0xa2, 0xa3].includes(error.status) && !(error instanceof RequestTimeout)) throw error;
    }
    return null;
  }
  async receiverAfh() {
    if (this.transport.target !== 2) return null;
    try {
      const r = await this.transport.exchange(0x85, [], 0, 1);
      return decodeReceiverAfh(r);
    } catch (error) {
      if ([0xa2, 0xa3].includes(error.status) || error instanceof RequestTimeout) return null;
      throw error;
    }
  }
  async receiverLinkQuality() {
    if (this.transport.target !== 2) return null;
    try {
      const r = await this.transport.exchange(0x85, [1], 0, 1);
      return decodeReceiverLinkQuality(r);
    } catch (error) {
      if ([0xa2, 0xa3].includes(error.status) || error instanceof RequestTimeout) return null;
      throw error;
    }
  }
  async rescanReceiverAfh() {
    if (this.transport.target !== 2) throw Error('当前为有线 USB，请连接 2.4G 接收器。');
    try {
      const r = await this.transport.exchange(0x85, [2], 0, 1);
      return decodeReceiverAfh(r);
    } catch (error) {
      if (error.status === 0xa2) throw Error('硬件扫频超时，已保留原频谱与无线连接，请稍后重试');
      if (error.status === 0xa3) throw Error('当前接收器不支持手动扫频（需 Receiver V4）');
      throw error;
    }
  }
  async resetReceiverLinkCounters() {
    if (this.transport.target !== 2) throw Error('当前为有线 USB，请连接 2.4G 接收器。');
    try {
      const r = await this.transport.exchange(0x85, [3], 0, 1);
      return decodeReceiverLinkQuality(r);
    } catch (error) {
      if (error.status === 0xa3) throw Error('当前接收器不支持链路计数清零（需 Receiver V4）');
      throw error;
    }
  }
  async requestMouseQuietWindow(durationMs = 500) {
    if (!this.features?.quietWindow) throw Error('当前鼠标固件不支持静默扫频窗口（需 Rev 51）');
    const units = Math.round(Number(durationMs) / 10);
    if (!Number.isInteger(units) || units < 5 || units > 50) throw Error('静默窗口须为 50–500 ms');
    const r = await this.extension(12, units);
    return r[10] * 10;
  }
  async getDpi(slot) {
    this.slot(slot);
    const dpi = await this.transport.exchange(0x81, [slot, DPI_MAX_STAGES, 0, 0, 0, 0, 0, 0, 0, 0], 1);
    if (dpi.length < 12 || dpi[6] !== slot) throw Error('DPI 响应不完整');
    const count = Math.max(1, Math.min(DPI_MAX_STAGES, dpi[7] || 1));
    let activeStage = 1;
    try {
      const act = await this.transport.exchange(0x82, [slot, 0], 1);
      if (act.length >= 8 && act[6] === slot && act[7] >= 1 && act[7] <= count) activeStage = act[7];
    } catch (error) {
      if (![0xa2, 0xa3].includes(error.status)) throw error;
    }
    const colors = [...DEFAULT_DPI_COLORS];
    try {
      const c = await this.transport.exchange(0x81, [slot, ...new Array(18).fill(0)], 2);
      if (c.length >= 7 + count * 3 && c[6] === slot) {
        for (let i = 0; i < count; i++) {
          const r = c[7 + i * 3], g = c[8 + i * 3], b = c[9 + i * 3];
          colors[i] = `#${hex(r)}${hex(g)}${hex(b)}`;
        }
      }
    } catch (error) {
      if (![0xa2, 0xa3].includes(error.status)) throw error;
    }
    const stages = [];
    for (let i = 0; i < count; i++) {
      const o = 8 + i * 4;
      if (o + 3 >= dpi.length) break;
      stages.push({x: (dpi[o] << 8) | dpi[o + 1], y: (dpi[o + 2] << 8) | dpi[o + 3], color: colors[i]});
    }
    if (!stages.length) throw Error('DPI 响应不完整');
    if (activeStage > stages.length) activeStage = 1;
    return {stages, activeStage};
  }
  async putDpi(slot, stages, activeStage) {
    this.slot(slot);
    validateDpiStages(stages, activeStage);
    const bytes = [];
    for (const stage of stages) {
      bytes.push((stage.x >> 8) & 255, stage.x & 255, (stage.y >> 8) & 255, stage.y & 255);
    }
    while (bytes.length < 24) bytes.push(0);
    try { await this.transport.exchange(0x01, [slot, stages.length, ...bytes], 1); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; }
    try { await this.transport.exchange(0x02, [slot, activeStage], 1); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; }
    await sleep(350);
    const readback = await this.getDpi(slot);
    if (readback.activeStage !== activeStage || !equalDpiStages(readback.stages, stages)) {
      throw Error('DPI 写入后的回读不一致，请重新读取');
    }
    return readback;
  }
  async getSleepSeconds(slot) {
    this.slot(slot);
    try {
      const r = await this.transport.exchange(0x87, [slot, 0, 0], 0);
      if (r.length >= 9 && r[6] === slot) {
        const raw = (r[7] << 8) | r[8];
        return raw === 65535 ? 0 : raw;
      }
    } catch (error) {
      if (![0xa2, 0xa3].includes(error.status)) throw error;
    }
    return null;
  }
  async putSleepSeconds(slot, seconds) {
    this.slot(slot);
    validateSleepSeconds(seconds);
    const wire = seconds === 0 ? 65535 : seconds;
    try { await this.transport.exchange(0x07, [slot, (wire >> 8) & 255, wire & 255], 0); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; }
    await sleep(350);
    const readback = await this.getSleepSeconds(slot);
    if (readback !== seconds) throw Error('休眠时间写入后的回读不一致，请重新读取');
    return readback;
  }
  async getAngleTune(slot) {
    this.slot(slot);
    try {
      const r = await this.transport.exchange(0x94, [slot, 0], 1);
      if (r.length >= 8 && r[6] === slot) {
        const deg = r[7] > 127 ? r[7] - 256 : r[7];
        if (deg >= ANGLE_TUNE_MIN && deg <= ANGLE_TUNE_MAX) return deg;
      }
    } catch (error) {
      if (![0xa2, 0xa3].includes(error.status)) throw error;
    }
    return null;
  }
  async putAngleTune(slot, degrees) {
    this.slot(slot);
    validateAngleTune(degrees);
    const wire = degrees >= 0 ? degrees : (256 + degrees) & 255;
    try { await this.transport.exchange(0x14, [slot, wire], 1); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; }
    await sleep(350);
    const readback = await this.getAngleTune(slot);
    if (readback !== degrees) throw Error('角度微调写入后的回读不一致，请重新读取');
    return readback;
  }
  async getLegacy(slot) {
    this.slot(slot); const out = {};
    for (const [key, spec] of Object.entries(LEGACY)) {
      const data = new Array(spec.length || 2).fill(0); data[0] = slot;
      const r = await this.transport.exchange(spec.get, data, spec.group);
      if (r.length < 8 || r[6] !== slot) throw Error(`${spec.label}响应无效`);
      out[key] = r[7];
    }
    const dpi = await this.getDpi(slot);
    const current = dpi.stages[dpi.activeStage - 1] || dpi.stages[0];
    out.dpiX = current.x; out.dpiY = current.y;
    out.dpiStages = dpi.stages; out.dpiActiveStage = dpi.activeStage;
    out.sleepSeconds = await this.getSleepSeconds(slot);
    out.angleTune = await this.getAngleTune(slot);
    return out;
  }
  async read(slot) {
    this.slot(slot);
    const result={slot, raw: Array.from(await this.getProfile(slot)), legacy: await this.getLegacy(slot), active: await this.activeProfile(), at: new Date().toISOString()};
    if(this.features?.perButtonDebounce){result.buttons=[];for(let key=0;key<this.features.buttonCount;key++){
      const times=await this.getButtonTimings(slot,key);
      if(this.features.independentDebounce)times.enabled=Boolean(buttonMask(result.raw)&(1<<key));
      result.buttons.push(times);
    }}
    return result;
  }
  button(slot,key){
    this.slot(slot);
    if(!this.features?.perButtonDebounce)throw Error('当前固件不支持逐键消抖');
    if(!Number.isInteger(key)||key<0||key>=this.features.buttonCount)throw Error('无效的按键编号');
  }
  async getButtonTimings(slot,key){
    this.button(slot,key);
    return decodeTimings((await this.extension(8,slot,key)).slice(12,20));
  }
  async putButtonTimings(slot,key,value){
    this.button(slot,key);const raw=encodeTimings(value,this.features);let timeout=false;
    try{await this.extension(9,slot,key,...raw);}catch(error){if(!(error instanceof RequestTimeout))throw error;timeout=true;}
    await sleep(350);
    if(!equal(encodeTimings(await this.getButtonTimings(slot,key),this.features),raw))throw Error('按键消抖回读不一致，请重新读取');
    return {timeout,verified:true};
  }
  async putProfile(slot, raw) {
    this.slot(slot);
    // Validate the actual raw bytes before sending so malformed fields never reach the transport.
    validateRawProfile(raw, this.definitions.fps_presets.length, this.features);
    validateFeatures(decodeProfile(raw),this.features);
    let timeout = false;
    try { await this.extension(2, slot, ...raw); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; timeout = true; }
    await sleep(350);
    if (!equal(await this.getProfile(slot), raw)) throw Error('扩展配置回读不一致；写入结果未确认，请重新读取');
    return {timeout, verified: true};
  }
  async putLegacy(slot, key, value) {
    this.slot(slot); const spec = LEGACY[key];
    if (!spec || !Number.isInteger(value) || value < 0 || value > 255 || (spec.codes && !spec.codes.includes(value))) throw Error('无效的官方设置');
    const data = new Array(spec.length || 2).fill(0); data[0] = slot; data[1] = value;
    try { await this.transport.exchange(spec.set, data, spec.group); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; }
    await sleep(350);
    const query = new Array(spec.length || 2).fill(0); query[0] = slot;
    const r = await this.transport.exchange(spec.get, query, spec.group);
    if (r[7] !== value) throw Error(`${spec.label}写入后的回读不一致，请重新读取`);
  }
  async peek(page, reg, {retries = 9, retryDelayMs = 12} = {}) {
    registerAddress(page, reg);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return (await this.extension(7, page, reg))[12];
      } catch (error) {
        if (error?.status !== 0xa2) throw error;
        if (attempt === retries) {
          throw Object.assign(Error('传感器正忙或处于休眠态，请轻移鼠标唤醒后重试'), {status: 0xa2});
        }
        await sleep(retryDelayMs + attempt * 4);
      }
    }
  }
  async poke(page, reg, value) {
    registerAddress(page, reg);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw Error('寄存器值需为 00–FF');
    try { await this.extension(6, page, reg, value); } catch (e) { if (!(e instanceof RequestTimeout)) throw e; }
    const readback = await this.peek(page, reg);
    if (readback !== value) throw Error(`寄存器回读为 ${hex(readback)}，与写入值不一致`);
    return readback;
  }
  async telemetry(value = 2) {
    if (![0, 1, 2].includes(value)) throw Error('无效的遥测操作');
    if(this.features?.stats===false){if(value===1)throw Error('当前固件不支持遥测');return false;}
    return (await this.extension(5, value))[10] === 1;
  }
  async statistics() {
    if(this.features?.stats===false)throw Error('当前固件不支持遥测');
    const values = [];
    for (let page = 0; page < 8; page++) {
      const r = await this.extension(3, page), view = new DataView(r.buffer, r.byteOffset + 11, 16);
      for (let i = 0; i < 4; i++) values.push(view.getUint32(i * 4, true));
    }
    return Object.fromEntries(this.definitions.counters.map((name, i) => [name, values[i]]));
  }
}
