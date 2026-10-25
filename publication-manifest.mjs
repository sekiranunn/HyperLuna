export const frontendFiles = [
  'index.html', 'official-entry.js', 'device-lock.js', 'device-access.js',
  'runtime.js', 'i18n.js', 'advanced/index.html', 'advanced/protocol.js',
  'advanced/protocol-definitions.json', 'advanced/features.js', 'advanced/demo.js', 'advanced/lod.js',
  'native/entry.js', 'native/header-entry.js', 'native/header-entry.css',
  'native/research.js', 'native/research.html', 'native/style.css'
];
export const generatedFiles = ['native/official-app.js', 'native/vendor-ui.js', 'native/render.js', 'native/build-info.json'];
export const sourceFiles = [
  ...frontendFiles, 'deployment.json', 'build.mjs', 'build-pages.mjs', 'publication-manifest.mjs',
  'package.json', 'package-lock.json', 'official-manifest.json', 'variants/targets.json',
  'patches/official-scan-rate.mjs', 'patches/asset-paths.mjs', 'patches/remove-firmware.mjs',
  'tests/protocol.test.js', 'tests/button-debounce.test.js', 'tests/runtime-status.test.js', 'tests/official-scan-rate.test.js', 'tests/access-pages.test.js', 'tests/lod.test.js', 'tests/i18n.test.js',
  'tests/fixtures/lod-height.html', 'tests/fixtures/lod-height.js', 'tests/helpers/bundled-vue.js',
  'tests/no-phase.test.js',
  '.github/workflows/pages.yml', '.gitattributes'
];
export const stockImage = {
  id:'stock', name:'官方固件 0.26', file:'stock.bin', bytes:99008,
  sha256:'416f47366144d1773f37cc6b993f8f43332dba2746bc9cce13e732c038b93057'
};
export function publicCatalogue(catalogue) {
  const keys = ['id','name','file','sha256','bytes','recommended','features','variant_id','capabilities','hardware_tested','debounce_schema','button_count','implementation_revision','config_storage_version'];
  return {application:'Luna33', base:'0x6000', bytes:99008,
    images:catalogue.images.map(image => Object.fromEntries(keys.filter(key => key in image).map(key => [key,image[key]])))};
}
