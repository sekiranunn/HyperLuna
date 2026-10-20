// Luna33 LF33 v1 capability extension. Old 17-byte replies denote the full port.
export const FULL_FEATURES = Object.freeze({name:'FULL_RESEARCH',phase:'saved',debounce:'fine',fps:'presets',stats:true});
export const VARIANTS = Object.freeze([
  {name:'ABLODLOCKDB',phase:'saved',debounce:'fine',fps:'presets',stats:false,mask:43},
  {name:'ABLODDB',phase:'none',debounce:'fine',fps:'presets',stats:false,mask:41},
  {name:'ABLODSTATSDB',phase:'live',debounce:'ms',fps:'hyperfps',stats:true,mask:213},
  {name:'ABLODSTATS',phase:'live',debounce:'none',fps:'none',stats:true,mask:133},
  {name:'ABLODLOCK',phase:'live',debounce:'none',fps:'none',stats:false,mask:5},
  {name:'ABLOD',phase:'none',debounce:'none',fps:'none',stats:false,mask:1}
].map(Object.freeze));
export function decodeFeatures(reply) {
  if(reply.length===17)return FULL_FEATURES;
  const feature=reply[17]===0?{...FULL_FEATURES,mask:171}:VARIANTS[reply[17]-1];
  if(![19,21].includes(reply.length)||!feature||reply[18]!==feature.mask||(reply.length===19&&reply[17]===0))throw Error('未识别的 LF33 固件功能版本');
  if(reply.length===21){
    if(!((reply[19]===1&&reply[20]===6)||(reply[19]===2&&reply[20]===5))||feature.debounce==='none')throw Error('未识别的逐键消抖版本');
    return {...feature,perButtonDebounce:true,independentDebounce:reply[19]===2,buttonCount:reply[20]};
  }
  return feature;
}
export function validateFeatures(value,features=FULL_FEATURES) {
  const limit=features.fps==='presets'?34:features.fps==='hyperfps'?1:0;
  if(value.fps>limit)throw Error('当前固件不支持此 FPS 预设');
  if(features.phase==='none'&&(value.lock||value.lead!==0))throw Error('当前固件不支持相位调节');
  if(features.debounce==='none'&&(value.debounce||['pre','post','plock','relock'].some(key=>value[key]!==0)))throw Error('当前固件不支持自定义消抖');
  if(features.debounce==='ms'&&['pre','post','plock','relock'].some(key=>!Number.isInteger(value[key])))throw Error('当前固件的消抖参数须为整数 ms');
}
