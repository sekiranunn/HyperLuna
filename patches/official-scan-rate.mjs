// Build-time patch for the vendor's button polling card. Keep the original
// vendor files intact and fail the build if its component layout changes.
function mountScanRate() {
  if (this.localDevice.modelCN === 'LUNA33') {
    this.rateOptions = [
      {label: '8000 Hz', value: 128},
      {label: '4000 Hz', value: 64},
      {label: '2000 Hz', value: 32},
      {label: '1000 Hz', value: 1}
    ];
    // 0x10 and 0x01 both encode 1 kHz. Normalize the display only.
    if (this.localDevice.scanRateSelectValue === 16) this.localDevice.scanRateSelectValue = 1;
    return;
  }
  // Preserve the vendor's behavior for other models.
  if ([0, 2, 4, 8].includes(this.localDevice.scanRateSelectValue)) {
    this.localDevice.scanRateSelectValue = 1;
    this.setScanRate();
  }
}

async function changeScanRate() {
  // Device configuration is authoritative; the old browser-wide cache could
  // overwrite another profile or an intentionally selected 1 kHz value.
  return this.setScanRate();
}

function uniqueIndex(source, text) {
  const index = source.indexOf(text);
  if (index < 0 || source.indexOf(text, index + text.length) !== -1) throw Error(`Official scan-rate component changed: ${text}`);
  return index;
}

export function patchOfficialScanRate(source) {
  const start = uniqueIndex(source, 'He=[],Oe={props:') + 'He=[],Oe='.length;
  const end = uniqueIndex(source, ',We=Oe,Je=');
  if (end <= start) throw Error('Official scan-rate component boundary changed');
  let component = source.slice(start, end);
  const mountStart = uniqueIndex(component, 'mounted(){');
  const methodsStart = uniqueIndex(component, ',methods:{getLangText:u,async rateSelectChange(){');
  const setterStart = uniqueIndex(component, ',async setScanRate(){');
  const oldMount = component.slice(mountStart, methodsStart);
  if (!oldMount.includes('!0===this.localDevice.isWiredConnection') || !oldMount.includes('scanRateSelectValueFalse')
      || oldMount.split('this.setScanRate()').length !== 4
      || !oldMount.endsWith('this.localDevice.scanRateSelectValue=1,this.setScanRate())}')) {
    throw Error('Official automatic scan-rate rewrite no longer matches');
  }
  const oldChange = component.slice(methodsStart, setterStart);
  if (!oldChange.includes('scanRateSelectValueTrue') || !oldChange.includes('scanRateSelectValueFalse')) {
    throw Error('Official scan-rate cache handler changed');
  }
  component = component.slice(0, mountStart)
    + `mounted:${mountScanRate.toString()},methods:{getLangText:u,rateSelectChange:${changeScanRate.toString()}`
    + component.slice(setterStart);
  return source.slice(0, start) + component + source.slice(end);
}
