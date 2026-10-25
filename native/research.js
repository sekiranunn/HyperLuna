import {HidTransport, LunaClient, VID, PIDS, LEGACY, RATES, BUTTONS, TIMING_KEYS, hex, equal, equalButtons, decodeProfile, encodeProfile, decodeTimings, encodeTimings, validateLegacy, registerAddress} from '../advanced/protocol.js';
import {WATCH} from '../advanced/demo.js';
import {DEFAULT_FEATURES, validateFeatures} from '../advanced/features.js';
import {assetUrl} from '../runtime.js';
import {FIRMWARE_NOTICE, isLuna33, requireLuna33} from '../device-access.js';
import {lodLabel, lodHeightOptions} from '../advanced/lod.js';
import {translate, savedLanguage, normalizeLanguage, applyDocumentLanguage} from '../i18n.js';
const stockFeatures = {name:'官方固件',fps:'none',debounce:'none',stats:false};
const patchNames = {fps:'FPS 预设',debounce:'自定义消抖',landingProtection:'抬鼠复位防误触',pre:'按下前滤波',post:'按下后滤波',plock:'按下锁定',relock:'松开锁定'};
const blank = () => ({fps:null,debounce:false,landingProtection:true,pre:undefined,post:undefined,plock:undefined,relock:undefined});
function fpsLabel(preset) {
  if (!preset) return '';
  const [name,unit,longest,shortest] = preset;
  const low = 1000 / (unit * 1.25 * longest), high = 1000 / (unit * 1.25 * shortest);
  if (high <= 10 || (longest === shortest && ['20k','19k','16k'].includes(name))) return name;
  const rate = longest === shortest ? high.toFixed(1) : `${low.toFixed(1)}–${high.toFixed(1)}`;
  return `${name}（${rate}k fps）`;
}
function parseByte(text, max = 255) {
  const value = String(text).trim().replace(/^0x/i,'');
  if (!/^[\da-f]{1,2}$/i.test(value) || parseInt(value,16) > max) throw Error(`请输入 00–${hex(max)} 的十六进制值`);
  return parseInt(value,16);
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function createOptions(definitions, {acquireDeviceLock, addHeaderEntry}) {
  let client=null, transport=null, release=null, pending=null, lastSource=null;
  let acknowledged=false, admittedDevice=null;
  const requireAccess = () => {
    if (!acknowledged) throw Error('请先阅读并确认固件风险提示');
    if (!(admittedDevice?.opened && isLuna33(admittedDevice))) throw Error('请先连接 LUNAFURY LUNA33');
  };
  const records=[];
  return {
    data() { return {definitions,language:savedLanguage(),headerUpdater:new window.XviUpdater(),themeMode:'1',tab:'settings',connected:false,demo:false,busy:false,deviceName:'',currentFirmware:'',transportTarget:2,slot:1,
      riskVisible:true,riskAcknowledged:false,firmwareNotice:FIRMWARE_NOTICE,deviceVerified:false,
      base:{raw:[],legacy:{},active:1,slot:1},draft:blank(),legacy:{},message:'',hasError:false,telemetry:false,activity:[],counterRows:[],features:DEFAULT_FEATURES,buttons:BUTTONS,selectedButton:0,runtime:null,runtimeReadAt:0,
      registerRows:WATCH.map(([page,reg,label])=>({key:registerAddress(page,reg),page,reg,label,value:null,baseline:null,input:'',undo:null})),pageHex:'18',addressHex:'7A',
      rates:[[8,125],[4,250],[2,500],[1,1000],[16,1000],[32,2000],[64,4000],[128,8000]].map(([value,label])=>({value,label:`${label} Hz`})),
      debounceFields:[{key:'pre',label:'按下前滤波'},{key:'post',label:'按下后滤波'},{key:'plock',label:'按下锁定'},{key:'relock',label:'松开锁定'}],
      reviewVisible:false,reviewTitle:'',reviewRows:[],reviewDescription:''}; },
    computed: {
      hasAccess(){return this.riskAcknowledged && this.deviceVerified;},
      primaryColor(){return this.themeMode==='1'?'#1b46b5':'#165dff';},
      fpsOptions(){return this.features.fps==='presets'?definitions.fps_presets.map((p,i)=>({value:i+1,label:fpsLabel(p)})):[{value:1,label:fpsLabel(definitions.fps_presets[0])}];},
      lodOptions(){return lodHeightOptions(this.base.legacy.lod);},
      debounceDraft(){return this.draft.buttons?.[this.selectedButton]||{};},
      dirty() { if (!this.connected) return false; try { return this.changeRows(this.collectDraft()).length > 0; } catch { return true; } },
    },
    async mounted() {
      this.languageChanged(this.language);
      window.addEventListener('beforeunload',this.beforeUnload);
      if (navigator.hid) navigator.hid.addEventListener('disconnect',this.deviceRemoved);
    },
    beforeDestroy() { window.removeEventListener('beforeunload',this.beforeUnload); if(navigator.hid)navigator.hid.removeEventListener('disconnect',this.deviceRemoved); transport?.close(); release?.(); },
    methods: {
      t(text,values){return translate(text,this.language,values);},
      activityText(entry){const split=entry.indexOf('  ');return split<0?this.t(entry):entry.slice(0,split+2)+this.t(entry.slice(split+2));},
      byte:hex,asset:assetUrl,rate(code){ return `${RATES[code]||'?'} Hz`; },
      acceptRisk(){acknowledged=true;this.riskAcknowledged=true;this.riskVisible=false;},
      leaveHyperLuna(){location.href=assetUrl();},
      log(text){ this.activity.push(`${new Date().toLocaleTimeString()}  ${text}`); if(this.activity.length>200)this.activity.shift(); },
      fail(error){ this.message=error.message||String(error); this.hasError=true; this.$message.error(this.t(this.message)); this.log(this.message); },
      notify(text){ this.message=text; this.hasError=false; },
      setRuntime(status){this.runtime=status;this.runtimeReadAt=status?Date.now():0;},
      async guard(work,connecting=false) { if(this.busy)return; this.busy=true; try { if(!connecting)requireAccess();await work(); } catch(e){this.fail(e);} finally{this.busy=false;} },
      beforeUnload(e){ if(this.dirty){e.preventDefault();e.returnValue='';} },
      beforeTab(){ return !this.busy; },
      themeChanged(mode){ this.themeMode=mode;document.body.classList.toggle('night-mode',mode!=='1'); },
      languageChanged(lang){this.language=normalizeLanguage(lang);applyDocumentLanguage(this.language);if(this.$refs?.header)addHeaderEntry(this.$refs.header.$el,this.t('官方设置'),assetUrl(),'el-icon-back');},
      collectDraft(){
        const patch={...this.draft};
        if(this.features?.perButtonDebounce){
          if(!Array.isArray(patch.buttons)||patch.buttons.length!==this.features.buttonCount)throw Error('请先读取鼠标配置');
          patch.buttons=patch.buttons.map(value=>{
            const times={};for(const key of TIMING_KEYS){if(value[key]===undefined||value[key]===null||String(value[key]).trim()==='')throw Error('请填写完整参数');times[key]=Number(value[key]);}
            const normalized=decodeTimings(encodeTimings(times,this.features));
            if(this.features.independentDebounce){if(typeof value.enabled!=='boolean')throw Error('无效的按键开关');normalized.enabled=value.enabled;}
            return normalized;
          });
          Object.assign(patch,patch.buttons[0]);
          if(this.features.independentDebounce)patch.debounce=patch.buttons.some(button=>button.enabled);
        }
        for(const key of ['fps',...TIMING_KEYS]){if(patch[key]===undefined||patch[key]===null||String(patch[key]).trim()==='')throw Error('请填写完整参数');patch[key]=Number(patch[key]);}
        const raw=encodeProfile(this.base.raw,patch,definitions.fps_presets.length,this.features),legacy={...this.legacy};
        validateLegacy(legacy,this.transportTarget);validateFeatures(patch,this.features);return{raw,legacy,patch};
      },
      patchText(key,value){ if(key==='fps')return value?fpsLabel(definitions.fps_presets[value-1])||String(value):'原厂脚本';if(['debounce','landingProtection'].includes(key))return value?'开启':'关闭';return `${value} ms`; },
      legacyText(key,value){ if(key==='lod')return lodLabel(value);if(key==='polling'||key==='scan_rate')return this.rate(value);if(key==='scan_sequence')return ['关闭','左键优先','右键优先'][value];return value?'开启':'关闭'; },
      changeRows(draft){
        const out=[],old=decodeProfile(this.base.raw);
        for(const key of Object.keys(patchNames))if(!(key==='landingProtection'&&!this.features.landingPolicy)&&!(this.features.perButtonDebounce&&TIMING_KEYS.includes(key))&&!(this.features.independentDebounce&&key==='debounce')&&old[key]!==draft.patch[key])out.push({name:patchNames[key],before:this.patchText(key,old[key]),after:this.patchText(key,draft.patch[key])});
        if(this.features.independentDebounce)for(const button of BUTTONS){const before=this.base.buttons[button.id].enabled,after=draft.patch.buttons[button.id].enabled;if(before!==after)out.push({name:`${button.label}：自定义消抖`,before:this.patchText('debounce',before),after:this.patchText('debounce',after)});}
        if(this.features.perButtonDebounce)for(const button of BUTTONS)for(const key of TIMING_KEYS){const before=this.base.buttons[button.id][key],after=draft.patch.buttons[button.id][key];if(before!==after)out.push({name:`${button.label}：${patchNames[key]}`,before:this.patchText(key,before),after:this.patchText(key,after)});}
        for(const[key,spec]of Object.entries(LEGACY))if(this.base.legacy[key]!==draft.legacy[key])out.push({name:spec.label,before:this.legacyText(key,this.base.legacy[key]),after:this.legacyText(key,draft.legacy[key])});return out;
      },
      setBase(base){
        const draft=decodeProfile(base.raw);
        if(this.features.perButtonDebounce)draft.buttons=base.buttons.map(value=>({...value}));
        // Vue 2 must observe the complete object, including the per-button fields.
        this.base=base;this.slot=base.slot;this.draft=draft;this.legacy={...base.legacy};
      },
      async attach(device){
        if(!acknowledged)throw Error('请先阅读并确认固件风险提示');
        requireLuna33(device);
        lastSource={demo:false,productId:device.productId,target:device.productId===0x32?0:2};records.length=0;this.activity=[];
        transport=new HidTransport(device,{interval:25,log:r=>{records.push({...r,demo:false});if(records.length>4000)records.shift();}});client=new LunaClient(transport,definitions);
        this.currentFirmware=await client.version();const slot=await client.activeProfile();
        let info;
        try{info=await client.info();}catch(error){if(error.status!==0xa3)throw error;}
        if(info){this.features=info.features;this.setBase(await client.read(slot));this.telemetry=await client.telemetry();this.setRuntime(await client.runtimeStatus());this.connected=true;}
        else{this.features=stockFeatures;}
        this.transportTarget=transport.target;this.deviceName='LUNAFURY LUNA33';admittedDevice=device;this.deviceVerified=true;
        this.registerRows.forEach(r=>{r.value=r.baseline=r.undo=null;r.input='';});this.counterRows=[];
        this.notify(info?'已连接':'当前固件不支持 HyperLuna 扩展，请使用官方设置。');this.log('LUNAFURY LUNA33 已连接');
      },
      async connect(){
        if(this.deviceVerified){await this.disconnect();return;}
        await this.guard(async()=>{
          if(!acknowledged){this.riskVisible=true;return;}
          if(!navigator.hid||!isSecureContext)throw Error('请在新版 Edge / Chrome 中通过 HTTPS 或 localhost 打开');
          release=await acquireDeviceLock();
          try{
            const granted=(await navigator.hid.getDevices()).filter(isLuna33),devices=granted.length===1?granted:await navigator.hid.requestDevice({filters:PIDS.map(productId=>({vendorId:VID,productId,usagePage:0xffff}))});
            const device=devices.find(isLuna33);if(!device){release?.();release=null;this.notify('请选择 LUNAFURY LUNA33 鼠标或接收器');return;}
            if(!device.opened)await device.open();await this.attach(device);
          }catch(e){await this.disconnect();throw e;}
        },true);
      },
      async disconnect(){
        const closing=transport;transport=null;client=null;admittedDevice=null;this.deviceVerified=false;this.connected=false;this.demo=false;this.currentFirmware='';this.features=DEFAULT_FEATURES;this.draft=blank();this.legacy={};this.setRuntime(null);this.base={raw:[],legacy:{},active:1,slot:1};this.reviewVisible=false;pending=null;
        if(closing)await closing.close();release?.();release=null;this.notify('设备已断开。');
      },
      async deviceRemoved(event){if(transport?.device===event.device){await this.disconnect();this.fail(Error('设备已拔出，请重新连接'));}},
      async readConfig(){await this.guard(async()=>{this.setBase(await client.read(this.slot));this.setRuntime(await client.runtimeStatus());if(this.runtime?.save===3&&this.runtime.attempts>=3)throw Error('保存失败，当前参数尚未写入存储；请重试保存');this.notify(`已重新读取配置 ${this.slot}。`);});},
      async retrySave(){await this.guard(async()=>{this.notify('正在保存到鼠标存储…');await client.retrySave({onStatus:status=>this.setRuntime(status)});this.setBase(await client.read(this.slot));this.notify('设置已保存，回读核对通过。');});},
      async changeSlot(slot){if(this.dirty){this.slot=this.base.slot;this.$message.warning(this.t('请先应用更改，或重新读取以放弃草稿'));return;}await this.guard(async()=>{try{this.setBase(await client.read(slot));}catch(e){this.slot=this.base.slot;throw e;}});},
      loadPreset(){
        if(!this.connected||this.busy)return;
        if(this.transportTarget===0){this.fail(Error('4k 预设需要通过无线接收器连接'));return;}
        const features=this.features,draft={fps:features.fps==='presets'?7:features.fps==='hyperfps'?1:0,landingProtection:true,debounce:features.debounce!=='none',pre:0,post:features.debounce==='fine'?1.5:features.debounce==='ms'?2:0,plock:0,relock:features.debounce==='none'?0:10};
        if(features.perButtonDebounce)draft.buttons=Array.from({length:features.buttonCount},()=>({...Object.fromEntries(TIMING_KEYS.map(key=>[key,draft[key]])),...(features.independentDebounce?{enabled:true}:{})}));
        if(features.buttonCount===6)draft.buttons[5]={...this.base.buttons[5]};
        this.draft=draft;
        this.legacy={...this.legacy,polling:64,hyper:1,tracking:0,lod:138,motion_sync:0,angle_snap:0,ripple:0};this.notify('已载入预设，待应用');
      },
      review(title,description,rows,action){requireAccess();this.reviewTitle=title;this.reviewDescription=description;this.reviewRows=rows;pending=action;this.reviewVisible=true;},
      confirmReview(){const action=pending;pending=null;this.reviewVisible=false;if(action)return this.guard(action);},
      reviewSettings(){try{const draft=this.collectDraft(),expected=structuredClone(this.base),rows=this.changeRows(draft);if(!rows.length)return;this.review(`应用到配置 ${this.slot}`,this.demo?'更新演示配置':'保存鼠标配置',rows,()=>this.applySettings(draft,expected));}catch(e){this.fail(e);}},
      async applySettings(draft,expected){
        requireAccess();
        const fresh=await client.read(expected.slot);
        if(!equal(fresh.raw,expected.raw)||JSON.stringify(fresh.legacy)!==JSON.stringify(expected.legacy)||fresh.active!==expected.active||(this.features.perButtonDebounce&&!equalButtons(fresh.buttons,expected.buttons)))throw Error('鼠标配置已被其他操作改变，本次未写入，请重新读取');
        const keys=Object.keys(LEGACY).filter(key=>fresh.legacy[key]!==draft.legacy[key]);let current=Uint8Array.from(fresh.raw);
        try{
          if(current[1]&&keys.some(key=>['polling','hyper','tracking'].includes(key))){current[1]=0;await client.putProfile(expected.slot,current);}
          for(const key of keys){await client.putLegacy(expected.slot,key,draft.legacy[key]);this.log(`${LEGACY[key].label}已写入并回读`);}
          if(!equal(current,draft.raw))await client.putProfile(expected.slot,draft.raw);
          if(this.features.perButtonDebounce)for(let key=1;key<this.features.buttonCount;key++)if(TIMING_KEYS.some(name=>fresh.buttons[key][name]!==draft.patch.buttons[key][name]))await client.putButtonTimings(expected.slot,key,draft.patch.buttons[key]);
          const final=await client.read(expected.slot);if(!equal(final.raw,draft.raw)||Object.keys(LEGACY).some(key=>final.legacy[key]!==draft.legacy[key])||(this.features.perButtonDebounce&&!equalButtons(final.buttons,draft.patch.buttons)))throw Error('最终配置与请求值不同');
          if(this.features.runtimeStatus){this.notify('正在保存到鼠标存储…');await client.waitForSave({onStatus:status=>this.setRuntime(status)});}
          this.setBase(final);this.notify(this.demo?'演示参数已更新并回读。':this.features.runtimeStatus?'设置已保存，回读核对通过。':'设置已写入，回读核对通过。');this.log('扩展配置保存与回读完成');
        }catch(e){try{this.setBase(await client.read(expected.slot));}catch{}throw Error(`部分设置可能已生效：${e.message}，请以重新读取为准`);}
      },
      async readRegisters(){await this.guard(async()=>{for(const row of this.registerRows){row.value=await client.peek(row.page,row.reg);row.input=hex(row.value);if(row.baseline===null)row.baseline=row.value;}this.notify(`已读取 ${this.registerRows.length} 项寄存器`);this.log('传感器观察地址读取完成');});},
      async readOne(){await this.guard(async()=>{const page=parseByte(this.pageHex),reg=parseByte(this.addressHex,126),key=registerAddress(page,reg);let row=this.registerRows.find(r=>r.key===key);if(!row){row={key,page,reg,label:'手动添加',value:null,baseline:null,input:'',undo:null};this.registerRows.push(row);}row.value=await client.peek(page,reg);row.input=hex(row.value);this.notify(`${key} = ${hex(row.value)}`);});},
      setBaseline(){this.registerRows.forEach(row=>{if(row.value!==null)row.baseline=row.value;});this.notify('已设为对比基线');},
      registerRowClass({row}){return row.value!==null&&row.baseline!==null&&row.value!==row.baseline?'lf-register-changed':'';},
      reviewRegister(row,undo=false){try{const value=undo?row.undo:parseByte(row.input),expected=row.value;this.review(`${undo?'恢复':'写入'}寄存器 ${row.key}`,'写入所选地址',[{name:row.key,before:expected===null?'写前读取':hex(expected),after:hex(value)}],async()=>{const old=await client.peek(row.page,row.reg);if(expected!==null&&old!==expected){row.value=old;row.input=hex(old);throw Error('寄存器已发生变化，本次未写入，请核对后重试');}row.value=await client.poke(row.page,row.reg,value);row.undo=old;row.input=hex(row.value);this.notify(`${row.key} 已写入并回读为 ${hex(row.value)}。`);this.log(`寄存器 ${row.key}：${hex(old)} → ${hex(value)}`);});}catch(e){this.fail(e);}},
      snapshot(){return{format:'lunafury-lf33-snapshot-v1',demo:lastSource?.demo??false,device:lastSource,at:new Date().toISOString(),config:this.connected?this.base:null,registers:Object.fromEntries(this.registerRows.filter(r=>r.value!==null).map(r=>[r.key,r.value]))};},
      exportSnapshot(){download(`Luna33-${this.demo?'DEMO-':''}snapshot-${Date.now()}.json`,this.snapshot());},
      async importSnapshot(event){try{const file=event.target.files[0];if(!file)return;if(file.size>262144)throw Error('快照需小于 256 KiB');const data=JSON.parse(await file.text());if(data.format!=='lunafury-lf33-snapshot-v1'||data.demo!==this.demo||!this.connected)throw Error('请连接同一模式的设备，再导入对应快照');const entries=Object.entries(data.registers||{});if(entries.length>256)throw Error('快照地址过多');const valid=entries.map(([key,value])=>{if(!/^[\da-f]{2}:[\da-f]{2}$/i.test(key)||!Number.isInteger(value)||value<0||value>255)throw Error('无效的快照数据');const[page,reg]=key.split(':').map(v=>parseInt(v,16));return{key:registerAddress(page,reg),page,reg,value};});for(const item of valid){let row=this.registerRows.find(r=>r.key===item.key);if(!row){row={key:item.key,page:item.page,reg:item.reg,label:'导入地址',value:null,baseline:null,input:'',undo:null};this.registerRows.push(row);}row.baseline=item.value;}this.notify('已导入对比基线');}catch(e){this.fail(e);}finally{event.target.value='';}},
      async readStatistics(){await this.guard(async()=>{this.telemetry=await client.telemetry();const values=await client.statistics();this.setRuntime(await client.runtimeStatus());if(this.runtime)Object.assign(values,{clock_pause_seen:Number(this.runtime.clockPaused),invalid_age_snapshots:this.runtime.invalidAges});this.counterRows=Object.entries(values).map(([name,value])=>({name,value:value.toLocaleString()}));this.notify('已读取计数器');});},
      async toggleTelemetry(){await this.guard(async()=>{this.telemetry=await client.telemetry();this.telemetry=await client.telemetry(Number(!this.telemetry));this.notify(`遥测已${this.telemetry?'开启':'关闭'}`);});},
      resetStatistics(){this.review('清零计数器','清零全部计数器',[{name:'累计计数',before:'当前值',after:'0'}],async()=>{await client.extension(4,0);this.counterRows=[];this.notify('计数器已清零。');});},
      exportLog(){download(`Luna33-${lastSource?.demo?'DEMO-':''}log-${Date.now()}.json`,{...this.snapshot(),transactions:records,activity:this.activity,counters:this.counterRows,runtime:this.runtime});}
    }
  };
}
