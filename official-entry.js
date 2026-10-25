import {acquireDeviceLock} from './device-lock.js';
import {addHeaderEntry} from './native/header-entry.js';
import {assetUrl} from './runtime.js';
import {translate, savedLanguage, applyDocumentLanguage} from './i18n.js';
const language = savedLanguage();
applyDocumentLanguage(language);
document.getElementById('driver-error').textContent = translate('驱动加载中',language);
const load = src => new Promise((resolve, reject) => {
  const script = document.createElement('script'); script.src = assetUrl(src);
  script.onload = resolve; script.onerror = () => reject(Error(`无法载入本地资源 ${src}`)); document.head.append(script);
});
let release;
try {
  release = await acquireDeviceLock();
  // Preserve vendor resources; mount the generated scan-rate fix after locking.
  await load('/js/output.xvi3.min.js');
  await load('/js/chunk-vendors.3562a7a5.js');
  await load('/native/official-app.js');
  document.getElementById('driver-error').remove();
  addHeaderEntry(document.querySelector('.headerMain'), 'HyperLuna', assetUrl('advanced/'));
} catch (error) {
  const target = document.getElementById('driver-error'); target.textContent = `${translate(error.message,language)} `;
  const link = document.createElement('a'); link.href=assetUrl('advanced/'); link.textContent=translate('进入 HyperLuna',language); target.append(link);
}
window.addEventListener('pagehide', () => release?.());
