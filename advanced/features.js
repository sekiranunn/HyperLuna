// Stable LF33 wire IDs; retired firmware IDs are deliberately not renumbered.
export const VARIANTS = Object.freeze([
  {id:2,name:'ABLODDB',debounce:'fine',fps:'presets',stats:false,mask:41},
  {id:6,name:'ABLOD',debounce:'none',fps:'none',stats:false,mask:1}
].map(Object.freeze));
export const DEFAULT_FEATURES = VARIANTS[0];
export function decodeFeatures(reply) {
  const feature=VARIANTS.find(value=>value.id===reply[17]);
  if(![19,21,23].includes(reply.length)||!feature||reply[18]!==feature.mask)throw Error('未识别的 LF33 固件功能版本');
  if(reply.length===23&&(![2,25].includes(reply[21])||reply[22]!==7))throw Error('未识别的 LF33 固件功能版本');
  const revision=reply.length===23?{implementationRevision:reply[21],runtimeStatus:true,landingPolicy:feature.debounce!=='none'}:{};
  if(reply.length===21||reply.length===23&&(reply[19]!==0||reply[20]!==0)){
    if(!((reply[19]===1&&reply[20]===6)||(reply[19]===2&&reply[20]===5))||feature.debounce==='none')throw Error('未识别的逐键消抖版本');
    return {...feature,...revision,perButtonDebounce:true,independentDebounce:reply[19]===2,buttonCount:reply[20]};
  }
  return {...feature,...revision};
}
export function validateFeatures(value,features=DEFAULT_FEATURES) {
  const limit=features.fps==='presets'?34:0;
  if(value.fps>limit)throw Error('当前固件不支持此 FPS 预设');
  if(features.debounce==='none'&&(value.debounce||['pre','post','plock','relock'].some(key=>value[key]!==0)))throw Error('当前固件不支持自定义消抖');
}
