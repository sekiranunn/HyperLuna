// LF33 v1. Packet layout matches lunafury-analysis/port/luna.py.
import {decodeFeatures, validateFeatures} from './features.js';
import {decodePhaseDiagnostics} from './phase-diagnostics.js';
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
const echoLength = {1: 1, 2: 17, 3: 1, 4: 1, 6: 3, 7: 2, 8: 2, 9: 10};
const replyMinimum = {0: 17, 1: 27, 2: 27, 3: 27, 4: 11, 5: 11, 6: 13, 7: 13, 8: 20, 9: 20, 10:18, 11:18, 12:60};
export function matches(reply, command, payload, group = 1) {
  if (reply.length < 6 || reply[4] !== group || reply[5] !== command || ![0xa1, 0xa2, 0xa3].includes(reply[0])) return false;
  if (command !== 0x7e) {
    if (!(group === 0 && [0x81, 0x85].includes(command)) && payload.length && reply[6] !== payload[0]) return false;
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
  if (group === 1 && command === 0x7e) return [0, 1, 3, 7, 8, 10, 12].includes(data[3]) || (data[3] === 5 && data[4] === 2);
  return LEGACY_READS.has(`${group}:${command}`) || (group === 0 && [0x81, 0x85].includes(command));
}
const LEGACY_READS = new Set(['1:128', '1:129', '1:139', '1:147', '1:136', '1:137', '1:132', '1:138', '0:152', '0:159']);

export class HidTransport {
  constructor(device, {timeout = 2100, interval = 25, log = () => {}} = {}) {
    if (device.vendorId !== VID || !PIDS.includes(device.productId)) throw Error('请选择正常模式的 Luna33 或其接收器');
    this.device = device;
    this.target = device.productId === 0x0032 ? 0 : 2;
    this.timeout = timeout; this.interval = interval; this.log = log;
    this.tail = Promise.resolve(); this.closed = false;
  }
  exchange(command, data, group = 1) {
    const payload = Uint8Array.from(data);
    const job = this.tail.then(() => this.perform(command, payload, group));
    this.tail = job.catch(() => {});
    return job;
  }
  async perform(command, payload, group) {
    if (this.closed || !this.device.opened) throw Error('设备已断开，请重新连接');
    const query = readonly(command, payload, group), attempts = query ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const record = {at: new Date().toISOString(), group, command, payload: toHex(payload), readonly: query, attempt: attempt + 1};
      try {
        await this.device.sendFeatureReport(0, packet(command, payload, group, this.target));
        const deadline = Date.now() + this.timeout;
        while (Date.now() < deadline) {
          await sleep(this.interval);
          if (this.closed) throw Error('设备已断开');
          let reply;
          try { reply = normalize(await this.device.receiveFeatureReport(0)); }
          catch (e) { if (!this.device.opened || e.name === 'NetworkError') throw e; continue; }
          if (reply[2] !== this.target || !matches(reply, command, payload, group)) continue;
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
  scan_rate: {label: '按键轮询率', group: 0, get: 0x9f, set: 0x1f, codes: [8, 4, 2, 1, 16, 32, 64, 128]},
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
export const equalButtons=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&[5,6].includes(a.length)&&a.length===b.length&&a.every((value,i)=>value.enabled===b[i].enabled&&TIMING_KEYS.every(key=>value[key]===b[i][key]));
export const buttonMask=raw=>(raw[5]&128)?raw[5]&31:raw[4]?31:0;
export function decodeProfile(raw) {
  if (raw.length !== 16) throw Error('配置长度必须为 16 字节');
  const view = new DataView(Uint8Array.from(raw).buffer);
  return {fps: raw[0], lock: raw[1] !== 0, lead: view.getUint16(2, true), debounce: raw[4] !== 0,
    pre: view.getUint16(6, true) / 10, post: view.getUint16(8, true) / 10,
    plock: view.getUint16(10, true) / 10, relock: view.getUint16(12, true) / 10,
    landingProtection:!(raw[14]&1)};
}
export function encodeProfile(original, value, fpsCount = 34, features) {
  if (original.length !== 16) throw Error('请先读取鼠标配置');
  if (!Number.isInteger(value.fps) || value.fps < 0 || value.fps > fpsCount) throw Error('无效的 FPS 预设');
  if (!Number.isInteger(value.lead) || value.lead < 0 || value.lead > 1000) throw Error('相位提前量范围为 0–1000 µs');
  const raw = Uint8Array.from(original), view = new DataView(raw.buffer);
  raw[0] = value.fps; raw[1] = Number(value.lock); view.setUint16(2, value.lead, true); raw[4] = Number(value.debounce);
  if(features?.independentDebounce){
    if(!Array.isArray(value.buttons)||value.buttons.length!==5||value.buttons.some(button=>typeof button.enabled!=='boolean'))throw Error('无效的按键开关');
    const mask=value.buttons.reduce((bits,button,key)=>bits|(Number(button.enabled)<<key),0);
    raw[4]=Number(mask!==0);raw[5]=128|mask;
  }
  if(features?.landingPolicy){
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
export function phaseHint(value, rate) {
  if (!value.lock) return '相位调节已关闭。';
  if (![1000, 2000, 4000].includes(rate)) return '相位调节仅在无线 1000 / 2000 / 4000 Hz 路径生效。';
  const lead = value.lead || 80, period = 1e6 / rate;
  if (lead < 4 || lead >= period / 2) return `${lead} µs 超出当前回报率的运行范围，固件会跳过调节。`;
  const residue = (period - lead) % 125 || 125;
  return `${lead} µs · 周期 ${period} µs · ${residue < 32 ? '进入合并 tick 路径' : `余量 ${residue} µs`}。`;
}
export function registerAddress(page, reg) {
  if (!Number.isInteger(page) || page < 0 || page > 255 || !Number.isInteger(reg) || reg < 0 || reg >= 127) throw Error('页地址需为 00–FF，寄存器地址需为 00–7E');
  return `${hex(page)}:${hex(reg)}`;
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
    const result={save:r[10]&15,attempts:r[10]>>>4,phase:r[11],clockPaused:Boolean(r[12]),saveError:r[13],invalidAges:view.getUint32(14,true)};
    if(result.save>3||result.attempts>3||result.phase>3||r[12]>1)throw Error('无效的固件状态响应');
    return result;
  }
  async runtimeStatus() {
    if(!this.features?.runtimeStatus)return null;
    return this.decodeStatus(await this.extension(10,0));
  }
  async phaseDiagnostics() {
    if(!this.features?.phaseDiagnostics)return null;
    return decodePhaseDiagnostics(await this.extension(12,0));
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
  async getLegacy(slot) {
    this.slot(slot); const out = {};
    for (const [key, spec] of Object.entries(LEGACY)) {
      const data = new Array(spec.length || 2).fill(0); data[0] = slot;
      const r = await this.transport.exchange(spec.get, data, spec.group);
      if (r.length < 8 || r[6] !== slot) throw Error(`${spec.label}响应无效`);
      out[key] = r[7];
    }
    const dpi = await this.transport.exchange(0x81, [slot, 1, 0, 0, 0, 0], 1);
    if (dpi.length < 12) throw Error('DPI 响应不完整');
    out.dpiX = dpi[8] * 256 + dpi[9]; out.dpiY = dpi[10] * 256 + dpi[11];
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
    // Validate the editable fields, but keep all three reserved bytes verbatim.
    encodeProfile(raw, decodeProfile(raw), this.definitions.fps_presets.length);
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
  async peek(page, reg) { registerAddress(page, reg); return (await this.extension(7, page, reg))[12]; }
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
