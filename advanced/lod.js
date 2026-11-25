const presets = new Map([[0,0.7],[0x87,0.7],[1,1],[0x85,1],[2,2],[0x8f,2]]);
const isByte = code => Number.isInteger(code) && code >= 0 && code <= 255;

// Millimetres between the vendor's presets are a two-point estimate, not a calibration.
export function lodHeight(code) {
  if (!isByte(code)) return null;
  if (presets.has(code)) return presets.get(code);
  return code & 0x80 ? (5 + (code & 0x7f)) / 10 : null;
}

export function lodLabel(code) {
  const height = lodHeight(code);
  const label = height === null ? '当前高度未知' : `${presets.has(code) ? '' : '约 '}${height.toFixed(1)} mm`;
  return isByte(code) ? `${label}（0x${code.toString(16).toUpperCase().padStart(2,'0')}）` : label;
}

export function lodHeightOptions(currentCode) {
  const options = [];
  for (let tenths = 7; tenths <= 30; tenths++) {
    // 1.2 mm would encode as 0x87, reserved by the saved-setting protocol for 0.7 mm.
    if (tenths === 12) continue;
    let value = tenths === 7 ? 0x87 : tenths === 10 ? 1 : tenths === 20 ? 2 : 0x80 | (tenths - 5);
    // Keep the exact saved alias on read; changing another setting must not rewrite LOD.
    if (presets.has(currentCode) && presets.get(currentCode) * 10 === tenths) value = currentCode;
    options.push({value,label:lodLabel(value)});
  }
  if (isByte(currentCode) && !options.some(option => option.value === currentCode)) {
    options.unshift({value:currentCode,label:`${lodLabel(currentCode)}（当前）`});
  }
  return options;
}
