export const PHASE_COUNTERS = Object.freeze([
  'adjusted','wired','link_down','sensor_busy','clock_paused','unsupported_rate',
  'invalid_lead','compare_pending','compare_margin','capture_failed',
  'frame_clock_recovered','health_clock_recovered'
]);
export const PHASE_REASONS = Object.freeze([
  '调节成功','有线模式','无线链路未就绪','SPI 忙','采样定时器已暂停',
  '回报率不支持调相','提前量超出范围','比较事件待处理','比较余量不足',
  '定时器捕获失败','运动帧时基恢复','ACK 时基恢复'
]);
export function summarizePhaseCounters(counters) {
  const adjusted=counters.adjusted,failed=counters.capture_failed;
  const skipped=PHASE_COUNTERS.slice(1,9).reduce((sum,key)=>sum+counters[key],0)+counters.frame_clock_recovered;
  return {adjusted,skipped,failed,frames:adjusted+skipped+failed,healthRescues:counters.health_clock_recovered};
}
export function decodePhaseDiagnostics(reply) {
  if(reply.length!==60)throw Error('无效的相位诊断响应');
  const view=new DataView(reply.buffer,reply.byteOffset,reply.byteLength);
  const counters=Object.fromEntries(PHASE_COUNTERS.map((key,index)=>[key,view.getUint32(12+index*4,true)]));
  const totals=summarizePhaseCounters(counters),version=reply[10],reason=reply[11];
  if(version>1||reason>10)throw Error('未识别的相位诊断格式');
  // Version zero denotes an unfinished producer transaction. Before the very
  // first frame it is also the coherent empty state from zero-initialized RAM.
  if(version===0&&totals.frames>0)return {busy:true};
  return {busy:false,lastReason:version===1?reason:null,counters,...totals};
}
export function phaseCounterWindow(previous,current,elapsedMs) {
  if(!previous||current.busy||previous.busy||elapsedMs<=0||elapsedMs>15000)return null;
  if(previous.reference||current.reference){
    if(!previous.reference||!current.reference)return null;
    const counters=Object.fromEntries(REFERENCE_COUNTERS.map(key=>[key,(current.counters[key]-previous.counters[key])>>>0]));
    if(Object.values(counters).some(value=>value>Math.ceil(elapsedMs*50)+256))return null;
    return {reference:true,counters,seconds:elapsedMs/1000,...counters};
  }
  const limit=Math.ceil(elapsedMs*50)+256;
  const counters=Object.fromEntries(PHASE_COUNTERS.map(key=>[key,(current.counters[key]-previous.counters[key])>>>0]));
  // Accept a nearby uint32 wrap, but reject reset/reconnect samples that would
  // otherwise appear as billions of events. This bound is deliberately loose.
  if(Object.values(counters).some(value=>value>limit))return null;
  return {counters,seconds:elapsedMs/1000,...summarizePhaseCounters(counters)};
}

export const REFERENCE_COUNTERS=Object.freeze(['accepted','rejected','expired','timestampRejected']);
export const REFERENCE_LABELS=Object.freeze(['有效参考','参考拒绝','参考超时','时间戳拒绝']);
export const REFERENCE_STATES=Object.freeze(['参考已关闭','等待参考','正在获取参考','上次读取时已锁定','保持周期（参考中断）']);
export function decodeReferenceDiagnostics(reply){
  if(reply.length!==52||reply[0]!==161||reply[3]!==46||reply[4]!==1||reply[5]!==126||
     ![76,70,1,13,1].every((value,i)=>reply[6+i]===value))throw Error('无效的参考诊断响应');
  const view=new DataView(reply.buffer,reply.byteOffset,reply.byteLength),state=reply[27];
  const period=view.getUint16(16,true),lead=view.getUint16(18,true),valid=reply[25],confidence=reply[26];
  if([11,12,13,25].some(i=>reply[i]>1)||reply[14]||reply[15]||state>4||confidence>4||
     (state===0?(period!==0||lead!==0):(![250,500,1000].includes(period)||lead<4||lead>=period/2))||
     (state===3&&(!valid||confidence!==4)))throw Error('未识别的参考诊断格式');
  const counters=Object.fromEntries(REFERENCE_COUNTERS.map((key,i)=>[key,view.getUint32([32,36,40,48][i],true)]));
  return {reference:true,busy:false,state,period,lead,valid:Boolean(valid),confidence,
    captureValid:Boolean(reply[11]),packetPending:Boolean(reply[12]),txStampValid:Boolean(reply[13]),
    lastLocal:view.getUint32(20,true),lastTick:reply[24],pending:view.getInt32(28,true),
    lastError:view.getInt32(44,true),counters,...counters};
}
