function replaceOne(source, before, after) {
  if (source.split(before).length !== 2) throw Error(`Official asset reference changed: ${before}`);
  return source.replace(before, after);
}
export function patchAssetPaths(source) {
  source = replaceOne(source, 'i.p="/"', 'i.p=new URL("../",document.currentScript.src).href');
  return replaceOne(source, 'href:"/pdf/LunaFury无线鼠标快速上手教学文档26-7-6.pdf"',
    'href:i.p+"pdf/LunaFury无线鼠标快速上手教学文档26-7-6.pdf"');
}
