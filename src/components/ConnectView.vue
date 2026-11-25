<script setup>
import {computed} from 'vue';

const props = defineProps({
  store: {type: Object, required: true}
});

const orthoSrc = computed(() => (
  props.store.state.theme === 'dark'
    ? './img/mouseLine_night.9b84629d.png'
    : './img/mouseLine.ff2c2f85.png'
));
</script>

<template>
  <section class="connect-sheet">
    <!-- Left Swiss Orthographic Monograph Column (Exact 348px architectural alignment) -->
    <aside class="connect-mono">
      <div class="mono-top">
        <div class="mono-kicker tabular">
          <span>LUNAFURY</span>
          <span>WEBHID INSTRUMENT</span>
        </div>
        <div class="mono-model brand">LUNA33</div>
      </div>

      <div class="spec-grid tabular">
        <div><div class="spec-k">SENSOR</div><div class="spec-v">PAW3950</div></div>
        <div><div class="spec-k">MCU</div><div class="spec-v">nRF52840</div></div>
        <div><div class="spec-k">WIRELESS</div><div class="spec-v">8000 Hz · 2.4G</div></div>
        <div><div class="spec-k">WIRED</div><div class="spec-v">1000 Hz · USB</div></div>
      </div>

      <div class="ortho-stage">
        <div class="ortho-box">
          <img class="ortho-img" :src="orthoSrc" :alt="store.t('LUNA33 鼠标')" />
          <svg class="ortho-svg" viewBox="0 0 288 300" aria-hidden="true">
            <line x1="144" y1="16" x2="144" y2="284" stroke="var(--rule)" stroke-width="1" />
            <line x1="22" y1="152" x2="266" y2="152" stroke="var(--rule)" stroke-width="1" />
            <rect x="141" y="149" width="6" height="6" fill="var(--cobalt)" />
          </svg>
        </div>
      </div>

      <div class="mono-foot tabular">
        <span>VID 0x373E</span>
        <span>PID 0x0032 / 0x0033</span>
      </div>
    </aside>

    <!-- Right Editorial Swiss Access Sheet -->
    <div class="connect-body">
      <div class="access-inner">
        <div class="idx-head">
          <span class="idx-label"><em>00</em>{{ store.t('连接设备') }}</span>
        </div>

        <h1 class="access-title brand">HYPERLUNA</h1>
        <p class="access-sub">{{ store.t('HyperLuna 仅支持 LUNA33 鼠标及其接收器') }}</p>

        <template v-if="store.state.stockUnsupported">
          <div class="stock-block">
            <div class="stock-line tabular">
              <span class="sq-mark cobalt"></span>
              <span>{{ store.t('官方固件') }} {{ store.state.currentFirmware }}</span>
              <span class="sep">/</span>
              <span>{{ store.state.transportTarget === 2 ? '2.4G' : 'USB' }}</span>
            </div>
            <p class="stock-copy">{{ store.t('当前固件不支持 HyperLuna 扩展，请先刷入 HyperLuna 固件。') }}</p>
            <div class="stock-actions">
              <button class="sbtn" type="button" :disabled="store.state.busy" @click="store.disconnect">
                {{ store.t('断开连接') }}
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="connect-band">
            <div class="connect-actions">
              <button
                class="sbtn sbtn-cobalt connect-btn"
                type="button"
                :disabled="store.state.busy"
                @click="store.connect('any')"
              >
                {{ store.state.busy ? store.t('正在连接…') : store.t('连接 LUNA33') }}
              </button>
              <button
                class="sbtn-rule mode-btn"
                type="button"
                :disabled="store.state.busy"
                @click="store.connect('wired')"
              >{{ store.t('有线 USB') }}</button>
              <button
                class="sbtn-rule mode-btn"
                type="button"
                :disabled="store.state.busy"
                @click="store.connect('wireless')"
              >{{ store.t('2.4G 接收器') }}</button>
            </div>

            <p v-if="store.state.message" :class="['connect-msg', {error: store.state.hasError}]">
              {{ store.t(store.state.message) }}
            </p>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.connect-sheet {
  flex: 1;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  min-height: calc(100vh - 52px);
}

.connect-mono {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  padding: 24px 28px 22px;
}

.mono-top {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--rule);
}

.mono-kicker {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
  margin-bottom: 8px;
}

.mono-model {
  font-size: 32px;
  line-height: 0.92;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.spec-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--rule);
}

.spec-k {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.spec-v {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}

.ortho-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
}

.ortho-box {
  position: relative;
  width: 288px;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ortho-img {
  height: 262px;
  width: auto;
  object-fit: contain;
  opacity: 0.88;
  user-select: none;
  pointer-events: none;
}

.ortho-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.mono-foot {
  border-top: 1px solid var(--rule);
  padding-top: 12px;
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.connect-body {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 48px 64px;
}

.access-inner {
  width: 100%;
  max-width: 560px;
}

.access-title {
  margin: 18px 0 8px;
  font-size: 40px;
  line-height: 0.94;
  letter-spacing: 0.06em;
  color: var(--ink);
}

.access-sub {
  margin: 0 0 28px;
  font-size: 14px;
  color: var(--ink-2);
}

.connect-band {
  padding-top: 26px;
  border-top: 2px solid var(--rule-anchor);
}

.connect-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
}

.connect-btn {
  min-width: 204px;
  height: 44px;
  padding: 0 28px;
  font-size: 13.5px;
  letter-spacing: 0.04em;
}

.mode-btn {
  height: 30px;
  font-size: 12.5px;
}

.connect-msg {
  margin: 16px 0 0;
  font-size: 12.5px;
  color: var(--ink-2);
}

.connect-msg.error {
  color: var(--danger);
}

.stock-block {
  padding-top: 20px;
  border-top: 2px solid var(--rule-anchor);
}

.stock-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  margin-bottom: 10px;
}

.sep {
  color: var(--ink-4);
}

.stock-copy {
  margin: 0 0 20px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--ink-2);
}

.stock-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

@media (max-width: 860px) {
  .connect-sheet {
    grid-template-columns: 1fr;
  }
  .connect-mono {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
  .ortho-stage {
    min-height: 200px;
  }
  .connect-body {
    padding: 28px 20px 44px;
  }
}
</style>
