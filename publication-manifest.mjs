export const frontendFiles = ['advanced/index.html'];
export const spaOfficialAssets = [
  'favicon.ico',
  'css/fonts_hyperos_misans.css',
  'fonts/EurostileLTPro-BoldEx2.a50bc14a.otf',
  'img/mouseLine.ff2c2f85.png',
  'img/mouseLine_night.9b84629d.png'
];
export const sourceFiles = [
  ...frontendFiles, 'index.html', 'vite.config.js', 'deployment.json',
  'device-lock.js', 'device-access.js', 'runtime.js', 'i18n.js',
  'build-pages.mjs', 'publication-manifest.mjs',
  'package.json', 'package-lock.json', 'official-manifest.json', 'variants/targets.json',
  'advanced/protocol.js', 'advanced/protocol-definitions.json', 'advanced/features.js', 'advanced/demo.js', 'advanced/lod.js',
  'src/main.js', 'src/App.vue', 'src/store/driver.js', 'src/lib/calibration.js',
  'src/styles/tokens.css', 'src/styles/base.css',
  'src/components/TopBar.vue', 'src/components/ConnectView.vue',
  'src/components/PerformanceTab.vue', 'src/components/AngleDial.vue', 'src/components/ButtonsTab.vue',
  'src/components/RegistersTab.vue', 'src/components/SpectrumTab.vue', 'src/components/CalibrateTab.vue',
  'src/components/PendingBar.vue', 'src/components/RegisterConfirmModal.vue',
  'tests/protocol.test.js', 'tests/button-debounce.test.js', 'tests/debounce-reactivity.test.js',
  'tests/runtime-status.test.js', 'tests/access-pages.test.js', 'tests/calibration.test.js',
  'tests/lod.test.js', 'tests/i18n.test.js', 'tests/no-phase.test.js',
  '.github/workflows/pages.yml', '.gitattributes'
];
export const stockImage = {
  id: 'stock', name: '官方固件 0.26', file: 'stock.bin', bytes: 99008,
  sha256: '416f47366144d1773f37cc6b993f8f43332dba2746bc9cce13e732c038b93057'
};
export function publicCatalogue(catalogue) {
  const keys = ['id', 'name', 'file', 'sha256', 'bytes', 'recommended', 'features', 'variant_id', 'capabilities', 'hardware_tested', 'debounce_schema', 'button_count', 'implementation_revision', 'config_storage_version', 'paired_receiver'];
  const rxKeys = ['id', 'name', 'file', 'target', 'dfu_target', 'base', 'bytes', 'sha256', 'hardware_tested', 'at405_modified', 'protocol'];
  const result = {
    application: 'Luna33', base: '0x6000', bytes: 99008,
    images: catalogue.images.map(image => Object.fromEntries(keys.filter(key => key in image).map(key => [key, image[key]])))
  };
  if (Array.isArray(catalogue.receiver_images) && catalogue.receiver_images.length) {
    result.receiver_images = catalogue.receiver_images.map(image => Object.fromEntries(rxKeys.filter(key => key in image).map(key => [key, image[key]])));
  }
  return result;
}
