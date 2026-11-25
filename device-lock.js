// Shared by the original page and the extension page on this origin.
export async function acquireDeviceLock() {
  if (!navigator.locks) throw Error('需要支持 Web Locks 的新版 Edge / Chrome 浏览器');
  return new Promise((resolve, reject) => {
    navigator.locks.request('lunafury-driver-device', {ifAvailable: true}, async lock => {
      if (!lock) { reject(Error('本地驱动已在另一标签页连接设备，请先关闭该标签页')); return; }
      await new Promise(release => resolve(release));
    }).catch(reject);
  });
}
