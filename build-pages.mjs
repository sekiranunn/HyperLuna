import './build.mjs';
import {readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, lstatSync} from 'node:fs';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {frontendFiles, generatedFiles, publicCatalogue, stockImage} from './publication-manifest.mjs';
import {removeFirmwareSdkMethods} from './patches/remove-firmware.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const out = resolve(root, '.pages-dist');
const marker = '.hyperluna-pages-output';
const signature = 'HyperLuna static build\n';
// Only the fixed, marked output directory directly inside this checkout can be removed.
if (dirname(out) !== resolve(root) || relative(root, out) !== '.pages-dist') throw Error('Unsafe output directory');
if (existsSync(out)) {
  if (lstatSync(out).isSymbolicLink() || !existsSync(resolve(out,marker)) || readFileSync(resolve(out,marker),'utf8') !== signature) throw Error('Refusing to replace an unrecognized output directory');
  rmSync(out, {recursive:true});
}
mkdirSync(out);
function emit(path, bytes) {
  const target = resolve(out,path);
  if (!target.startsWith(out+sep)) throw Error('Output path escaped build directory');
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,bytes);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
emit(marker,signature);
for (const path of [...frontendFiles,...generatedFiles]) {
  let bytes = readFileSync(resolve(root,path));
  emit(path,bytes);
}
const upstream = JSON.parse(readFileSync(resolve(root,'official-manifest.json'),'utf8'));
for (const asset of upstream.files) {
  const path = asset.path.replace(/^\//,'');
  if (!/^(?:favicon\.ico|(?:js|css|fonts|img|pdf)\/[^/]+)$/.test(path)) throw Error('Unexpected official asset path');
  let bytes = readFileSync(resolve(root,'official',path));
  if (sha(bytes) !== asset.sha256) throw Error(`Official asset hash mismatch: ${path}`);
  if (path === 'js/output.xvi3.min.js') bytes = removeFirmwareSdkMethods(bytes.toString('utf8'));
  if (path.endsWith('.css')) bytes = bytes.toString('utf8').replaceAll('/fonts/','../fonts/');
  emit(path,bytes);
}
const catalogue = publicCatalogue(JSON.parse(readFileSync(resolve(root,'variants/catalogue.json'),'utf8')));
if (catalogue.images.map(image=>image.id).join(',') !== 'ABLODDB,ABLOD') throw Error('Unexpected firmware catalogue');
catalogue.images.push(stockImage);
for (const image of catalogue.images) {
  if (!/^[A-Za-z0-9_-]+\.bin$/.test(image.file)) throw Error('Invalid firmware path');
  const bytes = readFileSync(resolve(root,'firmware',image.file));
  if (bytes.length !== 99008 || sha(bytes) !== image.sha256) throw Error(`Firmware hash mismatch: ${image.id}`);
  emit(`firmware/${image.file}`,bytes);
}
emit('firmware/catalogue.json',JSON.stringify(catalogue,null,2)+'\n');
emit('deployment.json',JSON.stringify({mode:'pages',firmwareUpdates:'archived'})+'\n');
emit('official-manifest.json',JSON.stringify(upstream,null,2)+'\n');
emit('.nojekyll','');
console.log(`GitHub Pages artifact: ${out}`);
