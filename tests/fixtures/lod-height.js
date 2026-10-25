// Local UI fixture only. It is excluded from the Pages artifact and never opens HID.
import {assetUrl} from '../../.pages-dist/runtime.js';
import {createOptions} from '../../.pages-dist/native/research.js';
import {DemoDevice} from '../../.pages-dist/advanced/demo.js';
import {render,staticRenderFns} from '../../.pages-dist/native/render.js';
import {addHeaderEntry} from '../../.pages-dist/native/header-entry.js';
const params=new URL(location.href).searchParams;
const load = path => new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=assetUrl(path);script.onload=resolve;script.onerror=reject;document.head.append(script);
});
await load('js/output.xvi3.min.js');await load('js/chunk-vendors.3562a7a5.js');await load('native/vendor-ui.js');
const definitions=await fetch(assetUrl('advanced/protocol-definitions.json')).then(response=>response.json());
const options=createOptions(definitions,{addHeaderEntry,acquireDeviceLock:async()=>()=>{}});
const simulated=new DemoDevice({independentDebounce:!params.has('shared'),implementationRevision:24,variantId:1});
simulated.collections=[{usagePage:0xffff,featureReports:[{reportId:0,items:[{reportCount:64,reportSize:8}]}]}];
new window.LunaNative.Vue({...options,render,staticRenderFns,components:{HeaderMain:window.LunaNative.Header},
  data(){const state=options.data();return {...state,riskVisible:false,
    registerRows:state.registerRows.map(row=>{const value=simulated.regs.get(`${row.page}:${row.reg}`);return {...row,value,baseline:value,input:value.toString(16).toUpperCase().padStart(2,'0')};}),
    counterRows:[{name:'motion_irq_count',value:'1,240'},{name:'usb_report_count',value:'1,236'}],
  };},
  async mounted(){
    this.languageChanged(params.get('lang')||this.language);this.acceptRisk();await this.connect();
    this.$watch(()=>JSON.stringify({selected:this.selectedButton,buttons:this.draft.buttons,phase:this.draft.lock,hyper:this.legacy.hyper,tracking:this.legacy.tracking,dirty:this.dirty,saved:[...simulated.slots[0]]}),value=>{document.getElementById('fixture-state').textContent=value;},{immediate:true});
  },beforeDestroy(){},methods:{...options.methods,
    async connect(){
      if(this.deviceVerified){await this.disconnect();return;}
      await this.guard(async()=>{await simulated.open();await this.attach(simulated);this.demo=true;},true);
    }
  }
}).$mount('#app');
