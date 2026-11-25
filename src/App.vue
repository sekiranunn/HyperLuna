<script setup>
import {onMounted, onBeforeUnmount, watch, ref} from 'vue';
import definitions from '../advanced/protocol-definitions.json';
import {acquireDeviceLock} from '../device-lock.js';
import {createDriverStore} from './store/driver.js';
import TopBar from './components/TopBar.vue';
import ConnectView from './components/ConnectView.vue';
import PerformanceTab from './components/PerformanceTab.vue';
import ButtonsTab from './components/ButtonsTab.vue';
import RegistersTab from './components/RegistersTab.vue';
import SpectrumTab from './components/SpectrumTab.vue';
import CalibrateTab from './components/CalibrateTab.vue';
import PendingBar from './components/PendingBar.vue';
import RegisterConfirmModal from './components/RegisterConfirmModal.vue';

const store = createDriverStore(definitions, {acquireDeviceLock});

const tabs = [
  {id: 'performance', num: '01', label: '性能与传感'},
  {id: 'buttons', num: '02', label: '按键与消抖'},
  {id: 'registers', num: '03', label: '寄存器'},
  {id: 'spectrum', num: '04', label: '2.4G 频谱'},
  {id: 'calibrate', num: '05', label: '校准与诊断'}
];

const toastVisible = ref(false);
let toastTimer = null;

watch(
  () => [store.state.message, store.state.hasError],
  ([msg, isErr]) => {
    clearTimeout(toastTimer);
    if (!msg || !store.state.connected) {
      toastVisible.value = false;
      return;
    }
    toastVisible.value = true;
    if (!isErr) {
      toastTimer = setTimeout(() => { toastVisible.value = false; }, 2600);
    }
  }
);

function beforeUnload(event) {
  if (store.dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}

onMounted(() => {
  store.mount();
  window.addEventListener('beforeunload', beforeUnload);
  if (navigator.hid) navigator.hid.addEventListener('disconnect', store.deviceRemoved);
});

onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  window.removeEventListener('beforeunload', beforeUnload);
  if (navigator.hid) navigator.hid.removeEventListener('disconnect', store.deviceRemoved);
  store.disconnect();
});
</script>

<template>
  <div class="app-shell">
    <TopBar :store="store" :tabs="tabs" />

    <main class="app-main">
      <ConnectView v-if="!store.state.connected" :store="store" />
      <template v-else>
        <PerformanceTab v-if="store.state.tab === 'performance'" :store="store" />
        <ButtonsTab v-else-if="store.state.tab === 'buttons'" :store="store" />
        <SpectrumTab v-else-if="store.state.tab === 'spectrum'" :store="store" />
        <CalibrateTab v-else-if="store.state.tab === 'calibrate'" :store="store" />
        <RegistersTab v-else :store="store" />
      </template>
    </main>

    <div class="bottom-dock">
      <transition name="toast-fade">
        <div v-if="toastVisible && store.state.message" class="toast-anchor" role="status" aria-live="polite">
          <div :class="['toast-box', {error: store.state.hasError}]">
            <span :class="['sq-mark', store.state.hasError ? 'danger' : 'ok']"></span>
            <span>{{ store.t(store.state.message) }}</span>
            <button
              class="sbtn sbtn-icon toast-close"
              type="button"
              :aria-label="store.t('关闭提示')"
              @click="toastVisible = false"
            >×</button>
          </div>
        </div>
      </transition>

      <PendingBar :store="store" />
    </div>

    <RegisterConfirmModal :store="store" />
  </div>
</template>
