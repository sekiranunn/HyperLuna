import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

// Exercise the same Vue runtime as the driver, without a browser or another Vue dependency.
const context=createContext({self:{},setTimeout,clearTimeout});
runInContext(readFileSync(new URL('../../official/js/chunk-vendors.3562a7a5.js',import.meta.url),'utf8'),context);
const modules=context.self.webpackChunkmouse[0][1],cache=new Map();
function requireModule(id){
  if(cache.has(id))return cache.get(id).exports;
  const module={exports:{}};cache.set(id,module);
  modules[id](module,module.exports,requireModule);return module.exports;
}
requireModule.r=exports=>Object.defineProperty(exports,'__esModule',{value:true});
requireModule.d=(exports,definitions)=>{for(const [key,get] of Object.entries(definitions))Object.defineProperty(exports,key,{enumerable:true,get});};
const vueId=Object.keys(modules).find(id=>modules[id].toString().includes('._init=function'));
if(!vueId)throw Error('Bundled Vue runtime not found');
export const Vue=requireModule(vueId).default;
