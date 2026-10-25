import {Script} from 'node:vm';

function removeBefore(source, start, end) {
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw Error('Official firmware UI changed');
  const first = source.indexOf(start), last = source.indexOf(end, first);
  if (last < first) throw Error('Official firmware UI boundaries changed');
  return source.slice(0, first) + source.slice(last);
}

export function removeFirmwareUi(source) {
  source = removeBefore(source,
    't("div",{staticClass:"settingsModuleItem",on:{click:function(t){e.updateDialogVisible=!0}}}',
    't("div",{staticClass:"settingsModuleItem",on:{click:e.oepnSettingDialog}}');
  // Do not mount the upstream updater dialog, including its update buttons.
  source = removeBefore(source, 't("UpdateDialog",{attrs:{visible:e.updateDialogVisible,', 't("SettingDialog",{ref:"settingDialogRef",');
  new Script(source);
  return source;
}

// The pinned, formatted upstream SDK repeats some class methods. Remove both
// definitions so an earlier updater cannot become effective after deletion.
// Verify boundaries and syntax; leave the saved upstream source unchanged.
export function removeFirmwareSdkMethods(source) {
  const counts = {enterBL:2, getBLFWVer:2, erase:2, programByDataParams:2, program:2,
    verify:2, exitBL:2, toPercent:2, getAddress:1, getFetchFWFile:1, FwUpdate:1};
  for (const [name, expected] of Object.entries(counts)) {
    const pattern = new RegExp('^  (?:async )?' + name + '\\([^\\r\\n]*\\) \\{\\r?\\n[\\s\\S]*?^  \\}\\r?\\n', 'gm');
    if ([...source.matchAll(pattern)].length !== expected) throw Error(`Official SDK firmware method changed: ${name}`);
    source = source.replace(pattern, '');
  }
  new Script(source);
  return source;
}
