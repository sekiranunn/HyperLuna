// Explicit in-memory preview. This module never calls navigator.hid.
import {LEGACY} from './protocol.js';
import {RUNTIME_STATUS_REVISIONS,VARIANTS} from './features.js';
export const WATCH = [
  [0, 0x4e, 'FPS · 周期参数'], [0, 0x4f, 'FPS · 周期参数'],
  [0, 0x51, 'FPS · 周期参数'], [0, 0x52, 'FPS · 周期参数'],
  [5, 0x44, 'FPS · 时序参数'], [6, 0x53, 'FPS · 模式参数'],
  [6, 0x62, 'FPS · 模式参数'], [6, 0x6d, 'FPS · 时序参数'],
  [6, 0x6e, 'FPS · 时序参数'], [7, 0x42, 'FPS · 基础周期'],
  [0x18, 0x7a, 'LOD 原始值'], [5, 0x51, '模式脚本'],
  [5, 0x5f, '模式脚本'], [5, 0x6d, '模式脚本'],
  [5, 0x6e, '模式脚本'], [9, 0x40, '模式脚本'],
  [5, 0x43, '静止降频控制'],
  [0x0c, 0x4d, 'DSP 参数'], [0x0c, 0x4e, 'DSP 参数'], [0x0c, 0x4f, 'DSP 参数'],
  [0x0c, 0x50, 'DSP 参数'], [0x0c, 0x51, 'DSP 参数'], [0x0c, 0x53, 'DSP 参数']
];
export class DemoDevice {
  constructor({perButtonDebounce=false,independentDebounce=undefined,implementationRevision=53,variantId=2}={}) {
    const resolvedIndep = independentDebounce === undefined ? variantId !== 6 : independentDebounce;
    this.vendorId = 0x373e; this.productId = 0x0033; this.productName = 'Luna33 · 模拟设备'; this.opened = true;
    const defaultSlot0 = variantId === 6 ? new Array(16).fill(0) : [7, 0, 0, 0, 1, 0, 0, 0, 15, 0, 0, 0, 100, 0, 0, 0];
    this.slots = Array.from({length: 4}, (_, i) => Uint8Array.from(i ? new Array(16).fill(0) : defaultSlot0));
    this.perButtonDebounce=perButtonDebounce||resolvedIndep;this.independentDebounce=resolvedIndep;
    this.implementationRevision=implementationRevision;this.saveState=2;this.saveError=0;this.clockPaused=0;this.invalidAges=0;this.statusQueue=[];
    this.variantId=variantId;
    this.buttonCount=resolvedIndep?5:6;
    this.buttons=this.slots.map(raw=>Array.from({length:this.buttonCount},()=>raw.slice(6,14)));
    this.legacy = Array.from({length: 4}, () => ({polling: 64, scan_rate: 64, hyper: 1, tracking: 0, lod: 138, motion_sync: 0, angle_snap: 0, ripple: 0, scan_sequence: 0}));
    this.dpiStages = Array.from({length: 4}, () => [[400, 400], [800, 800], [1600, 1600], [3200, 3200]]);
    this.dpiActive = [3, 2, 2, 2];
    this.dpiColors = [239,68,68, 22,93,255, 12,222,145, 192,132,252, 245,158,11, 226,232,240];
    this.sleepWire = [300, 300, 300, 300];
    this.angleTune = [0, 0, 0, 0];
    this.battery = {charging: 0, percent: 88};
    this.receiverAfh = {
      flags: 0x11,
      chTable: [76, 24, 64, 12, 42],
      searchCh: [33, 71],
      activeCh: 76,
      chIdx: 0,
      lastPasses: 128,
      scanCount: 1,
      hopCount: 0,
      hopPending: 0,
      skipNextScan: 0,
      crcErrCount: 1,
      rxOkCount: 16420,
      emaQ4: 752,
      lastRssi: 47,
      bestRssi: 44,
      worstRssi: 52,
      slotRssi: [47, 49, 0, 0, 0],
      linkActive: true,
      scores: [
        85, 87, 86, 87, 88, 89, 90, 91, 90, 89, 91, 89, 89, 88, 89, 85,
        81, 82, 80, 82, 79, 74, 61, 65, 81, 87, 89, 89, 88, 88, 89, 89,
        89, 89, 90, 90, 93, 91
      ]
    };
    const rawParameters = [26,32,33,36,40,44,45,46,47,48,49,50,51,52,53].includes(implementationRevision)
      ? [0x67, 0x01, 0x08, 0xbf, 0x00, 0x00, 0x00]
      : [0x64, 0x90, 0x0a, 0xbf, 0x14, 0x15, 0x1e];
    const values = [2, 87, 2, 87, 69, 2, 2, 143, 112, 29, 138, 64, 144, 184, 207, 1, ...rawParameters];
    this.regs = new Map(WATCH.map(([p, r], i) => [`${p}:${r}`, values[i]]));
    // Realistic PAW3950 Page 0 optical diagnostic defaults (read-only op=7)
    const opticalDefaults = [
      ['0:0', 0x53], ['0:1', 0x00], ['0:2', 0x24], ['0:7', 0x90],
      ['0:8', 0x73], ['0:9', 0x7a], ['0:10', 0x3f], ['0:11', 0x00],
      ['0:12', 0x02], ['0:64', 0x83]
    ];
    for (const [k, v] of opticalDefaults) this.regs.set(k, v);
    this.enabled = false; this.reply = new Uint8Array(64); this.counts = new Uint32Array(32);
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendFeatureReport(id, packet) {
    const [,,, length, group, command] = packet, data = packet.slice(6, 6 + length); let payload = data, status = 0xa1;
    if (command === 0x7e) {
      const op = data[3], args = data.slice(4), prefix = Array.from(data.slice(0, 4));
      switch (op) {
        case 0: payload = [...prefix, 76, 70, 51, 51, 1, 34, 32,...(this.perButtonDebounce||this.implementationRevision?[this.variantId,this.variantId?VARIANTS.find(value=>value.id===this.variantId).mask:171,this.perButtonDebounce?(this.independentDebounce?2:1):0,this.perButtonDebounce?this.buttonCount:0]:[]),...(this.implementationRevision?[this.implementationRevision,this.implementationRevision===4?31:this.implementationRevision===3?15:7]:[])]; break;
        case 1: payload = [...prefix, args[0], ...this.slots[args[0] - 1]]; break;
        case 2: {
          const slot = args[0], raw = args.slice(1, 17);
          if (args.length !== 17 || slot < 1 || slot > 4 || raw.length !== 16) { status = 0xa2; break; }
          const view = new DataView(raw.buffer, raw.byteOffset, 16);
          const badTimings = Array.from({length: 4}, (_, i) => view.getUint16(6 + i * 2, true)).some(n => n > 1000);
          const badMask = this.independentDebounce && raw[5] !== 0 && (!(raw[5] & 0x80) || (raw[5] & 0x60));
          const maxFps = this.variantId === 6 ? 0 : 34;
          if (raw[0] > maxFps || raw[4] > 1 || badTimings || badMask) { status = 0xa2; break; }
          if (this.implementationRevision >= 52) {
            const flags = raw[14], hold = raw[15], air = raw[2];
            const badLift = raw[1] !== 0 || raw[3] !== 0
              || (!(flags & 0x02) && (flags & 0x7c))
              || (!(flags & 0x80) ? (hold !== 0 || air !== 0) : (hold > 100 || (air > 100 && air !== 255)));
            if (badLift) { status = 0xa2; break; }
          } else {
            const badLegacyReserved = raw[1] !== 0 || raw[2] !== 0 || raw[3] !== 0
              || (this.variantId !== 6 && (raw[14] > 1 || raw[15] !== 0));
            if (badLegacyReserved) { status = 0xa2; break; }
          }
          this.slots[slot - 1] = raw; this.buttons[slot - 1][0] = args.slice(7, 15); payload = [...prefix, ...args]; break;
        }
        case 3: {
          const bytes = new Uint8Array(this.counts.buffer, args[0] * 16, 16);
          payload = [...prefix, args[0], ...bytes]; break;
        }
        case 4: this.counts.fill(0); payload = [...prefix, 0]; break;
        case 5: if (args[0] !== 2) this.enabled = args[0] === 1; payload = [...prefix, Number(this.enabled)]; break;
        case 6: this.regs.set(`${args[0]}:${args[1]}`, args[2]); payload = [...prefix, ...args]; break;
        case 7: payload = [...prefix, args[0], args[1], this.regs.get(`${args[0]}:${args[1]}`) || 0]; break;
        case 8:
        case 9: {
          const [slot,key]=args;
          if(!this.perButtonDebounce||slot<1||slot>4||key>=this.buttonCount||args.length!==(op===8?2:10)){status=0xa2;break;}
          if(op===9){
            const bytes=args.slice(2),view=new DataView(bytes.buffer,bytes.byteOffset,8);
            if(Array.from({length:4},(_,i)=>view.getUint16(i*2,true)).some(n=>n>1000)){status=0xa2;break;}
            this.buttons[slot-1][key]=bytes;
            if(key===0)this.slots[slot-1].set(bytes,6);
          }
          payload=[...prefix,slot,key,...this.buttons[slot-1][key]];break;
        }
        case 10:
        case 11: {
          if(!RUNTIME_STATUS_REVISIONS.includes(this.implementationRevision)){status=0xa3;break;}
          if(op===11)this.saveState=2;
          this.saveState=this.statusQueue.shift()??this.saveState;
          const age=new Uint8Array(4);new DataView(age.buffer).setUint32(0,this.invalidAges,true);
          payload=[...prefix,this.saveState,0,this.clockPaused,this.saveError,...age];break;
        }
        case 12: {
          if(this.implementationRevision<51){status=0xa3;break;}
          if(args.length!==1||args[0]<5||args[0]>50){status=0xa2;break;}
          this.lastQuietWindowMs=args[0]*10;
          payload=[...prefix,args[0]];break;
        }
        default: status = 0xa3;
      }
    } else if (group === 0 && command === 0x81) payload = [0, 0, 26, 0];
    else if (group === 0 && command === 0x83) payload = [this.battery.charging, this.battery.percent];
    else if (packet[2] === 1 && group === 0 && command === 0x85) {
      const a = this.receiverAfh;
      const sub = data.length ? data[0] : 0;
      const isV4 = Boolean(a && (a.flags & 0x10));
      const buildAf = () => {
        const wireFlags = isV4 ? ((a.flags | 0x10 | (a.linkActive ? 0x20 : 0)) & 255) : (a.flags & 255);
        const repCh = (isV4 && !a.linkActive) ? a.searchCh[0] : a.activeCh;
        const repIdx = (isV4 && !a.linkActive) ? 0xff : a.chIdx;
        return [
          0x41, 0x46, 1, wireFlags, ...a.chTable, ...a.searchCh, repCh, repIdx, a.lastPasses,
          a.scanCount & 255, (a.scanCount >> 8) & 255, a.hopCount & 255, (a.hopCount >> 8) & 255,
          ...a.scores
        ];
      };
      const buildLq = () => {
        const wireFlags = (a.flags | 0x10 | (a.linkActive ? 0x20 : 0)) & 255;
        const repCh = a.linkActive ? a.activeCh : a.searchCh[0];
        const repIdx = a.linkActive ? a.chIdx : 0xff;
        const rx = a.rxOkCount >>> 0;
        const ema = a.emaQ4 & 0xffff;
        const crc = a.crcErrCount & 0xffff;
        return [
          0x4c, 0x51, 1, wireFlags, repCh, repIdx,
          a.flags & 255, a.lastPasses & 255,
          a.scanCount & 255, (a.scanCount >> 8) & 255,
          a.hopCount & 255, (a.hopCount >> 8) & 255,
          a.hopPending & 255, a.skipNextScan & 255,
          crc & 255, (crc >> 8) & 255,
          rx & 255, (rx >> 8) & 255, (rx >> 16) & 255, (rx >>> 24) & 255,
          ema & 255, (ema >> 8) & 255,
          a.lastRssi & 255, a.bestRssi & 255, a.worstRssi & 255,
          ...(a.slotRssi || [0, 0, 0, 0, 0]).slice(0, 5)
        ];
      };
      if (!a) { status = 0xa3; payload = []; }
      else if (sub === 0) { payload = buildAf(); }
      else if (sub === 1) {
        if (!isV4) { status = 0xa3; payload = []; }
        else { payload = buildLq(); }
      } else if (sub === 2) {
        if (!isV4) { status = 0xa3; payload = []; }
        else {
          a.flags = 0x19;
          a.lastPasses = 128;
          a.scanCount = (a.scanCount + 1) & 0xffff;
          a.chIdx = 0;
          a.activeCh = a.chTable[0];
          a.slotRssi = [0, 0, 0, 0, 0];
          payload = buildAf();
        }
      } else if (sub === 3) {
        if (!isV4) { status = 0xa3; payload = []; }
        else {
          a.hopCount = 0;
          a.hopPending = 0;
          a.crcErrCount = 0;
          a.rxOkCount = 0;
          a.emaQ4 = 0;
          a.lastRssi = 0;
          a.bestRssi = 0;
          a.worstRssi = 0;
          a.slotRssi = [0, 0, 0, 0, 0];
          payload = buildLq();
        }
      } else { status = 0xa3; payload = []; }
    }
    else if (group === 0 && command === 0x85) payload = [1];
    else if (group === 0 && command === 0x87) {
      const w = this.sleepWire[(data[0] || 1) - 1];
      payload = [data[0], (w >> 8) & 255, w & 255];
    } else if (group === 0 && command === 0x07) {
      const w = (data[1] << 8) | data[2];
      this.sleepWire[(data[0] || 1) - 1] = w;
      payload = [data[0], data[1], data[2]];
    } else if (group === 1 && command === 0x81) {
      const stages = this.dpiStages[(data[0] || 1) - 1];
      payload = [data[0], stages.length];
      for (const [x, y] of stages) payload.push((x >> 8) & 255, x & 255, (y >> 8) & 255, y & 255);
    } else if (group === 1 && command === 0x01) {
      const count = Math.max(1, Math.min(6, data[1] || 1)), next = [];
      for (let i = 0; i < count; i++) {
        const o = 2 + i * 4;
        next.push([(data[o] << 8) | data[o + 1], (data[o + 2] << 8) | data[o + 3]]);
      }
      this.dpiStages[(data[0] || 1) - 1] = next;
      payload = [data[0], count];
    } else if (group === 1 && command === 0x82) {
      payload = [data[0], this.dpiActive[(data[0] || 1) - 1]];
    } else if (group === 1 && command === 0x02) {
      this.dpiActive[(data[0] || 1) - 1] = data[1];
      payload = [data[0], data[1]];
    } else if (group === 2 && command === 0x81) {
      payload = [data[0], ...this.dpiColors];
    } else if (group === 1 && command === 0x94) {
      const deg = this.angleTune[(data[0] || 1) - 1];
      payload = [data[0], deg >= 0 ? deg : (256 + deg) & 255];
    } else if (group === 1 && command === 0x14) {
      this.angleTune[(data[0] || 1) - 1] = data[1] > 127 ? data[1] - 256 : data[1];
      payload = [data[0], data[1]];
    } else {
      const found = Object.entries(LEGACY).find(([, s]) => s.group === group && [s.get, s.set].includes(command));
      if (!found) status = 0xa3;
      else {
        const [key, spec] = found;
        if (command === spec.set) this.legacy[data[0] - 1][key] = data[1];
        payload = new Array(spec.length || 2).fill(0); payload[0] = data[0]; payload[1] = this.legacy[data[0] - 1][key];
      }
    }
    this.reply = new Uint8Array(64); this.reply.set([status, 0, packet[2], payload.length, group, command, ...payload]);
  }
  async receiveFeatureReport() { return new DataView(this.reply.slice().buffer); }
}
