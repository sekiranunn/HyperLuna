const VID = 0x373e;
const PIDS = [0x0032, 0x0033];

function hasFeatureReport(collection) {
  return (collection.usagePage === 0xffff && (collection.featureReports || []).some(report =>
    report.reportId === 0 && (report.items || []).reduce((bits, item) => bits + item.reportCount * item.reportSize, 0) === 512)) ||
    (collection.children || []).some(hasFeatureReport);
}

// These IDs belong to LUNA33 in the vendor's model table. TYPE33 uses 0054/0084.
// A product name alone, or an LF33 reply from a different model, is not sufficient.
export function isLuna33(device) {
  return device?.vendorId === VID && PIDS.includes(device.productId) &&
    Array.isArray(device.collections) && device.collections.some(hasFeatureReport);
}

export function requireLuna33(device) {
  if (!isLuna33(device)) throw Error('HyperLuna 仅支持 LUNAFURY LUNA33，请连接对应鼠标或接收器');
}
