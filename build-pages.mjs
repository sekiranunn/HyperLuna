import {build as viteBuild} from 'vite';
import {readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, lstatSync, readdirSync} from 'node:fs';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {frontendFiles, spaOfficialAssets, publicCatalogue, stockImage} from './publication-manifest.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const out = resolve(root, '.pages-dist');
const viteDist = resolve(root, '.vite-dist');
const marker = '.hyperluna-pages-output';
const signature = 'HyperLuna static build\n';

await viteBuild({configFile: resolve(root, 'vite.config.js'), logLevel: 'warn'});

if (dirname(out) !== resolve(root) || relative(root, out) !== '.pages-dist') throw Error('Unsafe output directory');
if (existsSync(out)) {
  if (lstatSync(out).isSymbolicLink() || !existsSync(resolve(out, marker)) || readFileSync(resolve(out, marker), 'utf8') !== signature) {
    throw Error('Refusing to replace an unrecognized output directory');
  }
  rmSync(out, {recursive: true});
}
mkdirSync(out);

function emit(path, bytes) {
  const target = resolve(out, path);
  if (!target.startsWith(out + sep)) throw Error('Output path escaped build directory');
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, bytes);
}

function copyTree(baseDir, prefix = '') {
  for (const entry of readdirSync(baseDir, {withFileTypes: true})) {
    const src = resolve(baseDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) copyTree(src, rel);
    else emit(rel, readFileSync(src));
  }
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
emit(marker, signature);

// Emit new Vue 3 + Vite SPA at site root
copyTree(viteDist);

// Emit /advanced/ redirect
for (const path of frontendFiles) {
  emit(path, readFileSync(resolve(root, path)));
}

// Emit only the verified static assets actually used by the standalone HyperLuna SPA
const upstream = JSON.parse(readFileSync(resolve(root, 'official-manifest.json'), 'utf8'));
const assetMap = new Map(upstream.files.map(asset => [asset.path.replace(/^\//, ''), asset]));
for (const path of spaOfficialAssets) {
  const asset = assetMap.get(path);
  if (!asset) throw Error(`Missing official asset manifest entry: ${path}`);
  let bytes = readFileSync(resolve(root, 'official', path));
  if (sha(bytes) !== asset.sha256) throw Error(`Official asset hash mismatch: ${path}`);
  if (path.endsWith('.css')) bytes = bytes.toString('utf8').replaceAll('/fonts/', '../fonts/');
  emit(path, bytes);
}

// Emit verified static firmware archives & public catalogue
const catalogue = publicCatalogue(JSON.parse(readFileSync(resolve(root, 'variants/catalogue.json'), 'utf8')));
if (catalogue.images.map(image => image.id).join(',') !== 'ABLODDB,ABLOD') throw Error('Unexpected firmware catalogue');
catalogue.images.push(stockImage);
for (const image of catalogue.images) {
  if (!/^[A-Za-z0-9_-]+\.bin$/.test(image.file)) throw Error('Invalid firmware path');
  const bytes = readFileSync(resolve(root, 'firmware', image.file));
  if (bytes.length !== 99008 || sha(bytes) !== image.sha256) throw Error(`Firmware hash mismatch: ${image.id}`);
  emit(`firmware/${image.file}`, bytes);
}
for (const rx of catalogue.receiver_images ?? []) {
  if (!/^[A-Za-z0-9_-]+\.bin$/.test(rx.file)) throw Error('Invalid receiver firmware path');
  const bytes = readFileSync(resolve(root, 'firmware', rx.file));
  if (bytes.length !== 28672 || sha(bytes) !== rx.sha256) throw Error(`Receiver firmware hash mismatch: ${rx.id}`);
  emit(`firmware/${rx.file}`, bytes);
}

emit('firmware/catalogue.json', JSON.stringify(catalogue, null, 2) + '\n');
emit('deployment.json', JSON.stringify({mode: 'pages', firmwareUpdates: 'archived'}) + '\n');
emit('official-manifest.json', JSON.stringify(upstream, null, 2) + '\n');
emit('.nojekyll', '');
console.log(`GitHub Pages artifact: ${out}`);
