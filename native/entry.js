import {acquireDeviceLock} from '../device-lock.js';
import {addHeaderEntry} from './header-entry.js';
import {assetUrl} from '../runtime.js';
import {translate, savedLanguage, applyDocumentLanguage} from '../i18n.js';
const language = savedLanguage();
applyDocumentLanguage(language);
document.getElementById('native-error').textContent = translate('驱动加载中',language);
const load = src => new Promise((resolve, reject) => {
  const script = document.createElement('script'); script.src = assetUrl(src); script.onload = resolve; script.onerror = () => reject(Error(`资源载入失败：${src}`)); document.head.append(script);
});
try {
  await load('/js/output.xvi3.min.js'); await load('/js/chunk-vendors.3562a7a5.js'); await load('/native/vendor-ui.js');
  const [{createOptions}, template, definitions] = await Promise.all([import('./research.js'), import('./render.js'), fetch(assetUrl('advanced/protocol-definitions.json')).then(r => r.json())]);
  const {Vue, Header} = window.LunaNative;
  const localHeader = {...Header, methods: {...Header.methods, goToLink() { location.href = assetUrl(); }}};
  const options = createOptions(definitions, {acquireDeviceLock, addHeaderEntry});
  new Vue({...options, components: {HeaderMain: localHeader}, render: template.render, staticRenderFns: template.staticRenderFns}).$mount('#app');
  document.getElementById('native-error').remove();
} catch (error) { document.getElementById('native-error').textContent = translate(error.message,language); }
