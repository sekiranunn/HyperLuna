// Explicit in-memory preview. This module never calls navigator.hid.
import {LEGACY} from './protocol.js';
export const WATCH = [
  [0, 0x4e, 'FPS · 周期参数'], [0, 0x4f, 'FPS · 周期参数'],
  [0, 0x51, 'FPS · 周期参数'], [0, 0x52, 'FPS · 周期参数'],
  [5, 0x44, 'FPS · 时序参数'], [6, 0x53, 'FPS · 模式参数'],
  [6, 0x62, 'FPS · 模式参数'], [6, 0x6d, 'FPS · 时序参数'],
  [6, 0x6e, 'FPS · 时序参数'], [7, 0x42, 'FPS · 基础周期'],
  [0x18, 0x7a, 'LOD 原始值'], [5, 0x51, '模式脚本'],
  [5, 0x5f, '模式脚本'], [5, 0x6d, '模式脚本'],
  [5, 0x6e, '模式脚本'], [9, 0x40, '模式脚本']
];
export class DemoDevice {
  constructor({perButtonDebounce=false,independentDebounce=false,implementationRevision=0}={}) {
    this.vendorId = 0x373e; this.productId = 0x0033; this.productName = 'Luna33 · 模拟设备'; this.opened = true;
    this.slots = Array.from({length: 4}, (_, i) => Uint8Array.from(i ? new Array(16).fill(0) : [7, 1, 80, 0, 1, 0, 0, 0, 15, 0, 0, 0, 100, 0, 0, 0]));
    this.perButtonDebounce=perButtonDebounce||independentDebounce;this.independentDebounce=independentDebounce;
    this.implementationRevision=implementationRevision;this.saveState=2;this.saveError=0;this.phase=1;this.clockPaused=0;this.invalidAges=0;this.statusQueue=[];
    this.buttonCount=independentDebounce?5:6;
    this.buttons=this.slots.map(raw=>Array.from({length:this.buttonCount},()=>raw.slice(6,14)));
    this.legacy = Array.from({length: 4}, () => ({polling: 64, scan_rate: 64, hyper: 1, tracking: 0, lod: 138, motion_sync: 0, angle_snap: 0, ripple: 0, scan_sequence: 0}));
    const values = [2, 87, 2, 87, 69, 2, 2, 143, 112, 29, 138, 64, 144, 184, 207, 1];
    this.regs = new Map(WATCH.map(([p, r], i) => [`${p}:${r}`, values[i]]));
    this.enabled = false; this.reply = new Uint8Array(64); this.counts = new Uint32Array(32);
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendFeatureReport(id, packet) {
    const [,,, length, group, command] = packet, data = packet.slice(6, 6 + length); let payload = data, status = 0xa1;
    if (command === 0x7e) {
      const op = data[3], args = data.slice(4), prefix = Array.from(data.slice(0, 4));
      switch (op) {
        case 0: payload = [...prefix, 76, 70, 51, 51, 1, 34, 32,...(this.perButtonDebounce||this.implementationRevision?[0,171,this.perButtonDebounce?(this.independentDebounce?2:1):0,this.perButtonDebounce?this.buttonCount:0]:[]),...(this.implementationRevision?[this.implementationRevision,7]:[])]; break;
        case 1: payload = [...prefix, args[0], ...this.slots[args[0] - 1]]; break;
        case 2: this.slots[args[0] - 1] = args.slice(1, 17);this.buttons[args[0]-1][0]=args.slice(7,15); payload = [...prefix, ...args]; break;
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
          if(this.implementationRevision!==2){status=0xa3;break;}
          if(op===11)this.saveState=2;
          this.saveState=this.statusQueue.shift()??this.saveState;
          const age=new Uint8Array(4);new DataView(age.buffer).setUint32(0,this.invalidAges,true);
          payload=[...prefix,this.saveState,this.phase,this.clockPaused,this.saveError,...age];break;
        }
        default: status = 0xa3;
      }
    } else if (group === 0 && command === 0x81) payload = [0, 0, 26, 0];
    else if (group === 0 && command === 0x85) payload = [1];
    else if (group === 1 && command === 0x81) payload = [data[0], 1, 6, 64, 6, 64];
    else {
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
