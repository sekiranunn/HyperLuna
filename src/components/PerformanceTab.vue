<script setup>
import {computed, ref, watch} from 'vue';
import {
  RATES, DPI_MIN, DPI_MAX, DPI_STEP, DPI_MAX_STAGES,
  DEFAULT_DPI_COLORS, ANGLE_TUNE_MIN, ANGLE_TUNE_MAX
} from '../../advanced/protocol.js';
import {formatPeriodMs} from '../store/driver.js';
import {lodHeight} from '../../advanced/lod.js';
import AngleDial from './AngleDial.vue';

const props = defineProps({
  store: {type: Object, required: true}
});

const orthoSrc = computed(() => (
  props.store.state.theme === 'dark'
    ? './img/mouseLine_night.9b84629d.png'
    : './img/mouseLine.ff2c2f85.png'
));

const activeStageObj = computed(() => {
  const {stages, activeStage} = props.store.state.dpiDraft;
  return stages[activeStage - 1] || stages[0] || {x: 800, y: 800, color: '#1342d6'};
});

const xySplit = ref(activeStageObj.value.x !== activeStageObj.value.y);
const isXyDiverged = computed(() => activeStageObj.value.x !== activeStageObj.value.y);

watch(
  () => [props.store.state.slot, props.store.state.dpiDraft.activeStage],
  () => {
    xySplit.value = activeStageObj.value.x !== activeStageObj.value.y;
  }
);

watch(isXyDiverged, diverged => {
  if (diverged) xySplit.value = true;
});

function toggleXySplit() {
  if (xySplit.value) {
    props.store.setActiveDpiValue(activeStageObj.value.x, 'y');
    xySplit.value = false;
  } else {
    xySplit.value = true;
  }
}

// Piecewise-linear perceptual anchors so 400 / 800 / 1600 / 3200 align pixel-accurately with the thumb
function anchorsFor(val) {
  const top = Math.max(6400, val);
  return [DPI_MIN, 400, 800, 1600, 3200, top];
}

function sliderPosFor(val, anchors) {
  const clamped = Math.max(anchors[0], Math.min(anchors[anchors.length - 1], val));
  const segs = anchors.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (clamped <= b || i === segs - 1) {
      const frac = b > a ? (clamped - a) / (b - a) : 0;
      return Math.round(((i + frac) / segs) * 1000);
    }
  }
  return 0;
}

function sliderStyleFor(pos, colorVar = 'var(--cobalt)') {
  const pct = pos / 10;
  return {
    background: `linear-gradient(90deg, ${colorVar} 0%, ${colorVar} ${pct}%, var(--rule-strong) ${pct}%, var(--rule-strong) 100%)`
  };
}

function posToDpi(pos, anchors) {
  const segs = anchors.length - 1;
  const t = Math.max(0, Math.min(1, Number(pos) / 1000)) * segs;
  const i = Math.min(segs - 1, Math.floor(t));
  const frac = t - i;
  const raw = anchors[i] + frac * (anchors[i + 1] - anchors[i]);
  const snapped = Math.round(raw / DPI_STEP) * DPI_STEP;
  return Math.max(DPI_MIN, Math.min(DPI_MAX, snapped));
}

const dpiAnchors = computed(() => anchorsFor(activeStageObj.value.x));
const dpiAnchorsY = computed(() => anchorsFor(activeStageObj.value.y));
const dpiSliderPos = computed(() => sliderPosFor(activeStageObj.value.x, dpiAnchors.value));
const dpiSliderPosY = computed(() => sliderPosFor(activeStageObj.value.y, dpiAnchorsY.value));
const dpiSliderStyle = computed(() => sliderStyleFor(dpiSliderPos.value));
const dpiSliderStyleY = computed(() => sliderStyleFor(dpiSliderPosY.value, 'var(--ink-2)'));

function onDpiSliderInput(event, axis = 'both') {
  const anchors = axis === 'y' ? dpiAnchorsY.value : dpiAnchors.value;
  props.store.setActiveDpiValue(posToDpi(event.target.value, anchors), axis);
}

function onDpiNumberInput(event, axis = 'both') {
  const val = Number(event.target.value);
  if (Number.isFinite(val)) props.store.setActiveDpiValue(val, axis);
}

const pollingHz = computed(() => RATES[props.store.state.legacy.polling] || 0);
const scanHz = computed(() => RATES[props.store.state.legacy.scan_rate] || 0);
const currentLodMm = computed(() => lodHeight(props.store.state.legacy.lod));
const activeAngle = computed(() => (
  props.store.state.base.angleTune !== null ? Number(props.store.state.angleTuneDraft || 0) : 0
));

const lodLiftPx = computed(() => {
  const mm = currentLodMm.value ?? 1.5;
  return Number(Math.max(1.5, Math.min(9.5, ((mm - 0.5) / 1.5) * 9)).toFixed(1));
});

function fpsRates(preset) {
  const [, unit, longest, shortest] = preset;
  const low = 1000 / (unit * 1.25 * longest);
  const high = 1000 / (unit * 1.25 * shortest);
  return {fixed: longest === shortest, low, high};
}

// Complete FPS options list ordered intuitively from lowest to highest:
// [0 = stock script, fixed presets ascending (4k -> 20k), dynamic range presets ascending]
const allFpsChoices = computed(() => {
  const presets = props.store.state.definitions?.fps_presets || [];
  const mapped = props.store.fpsOptions.value.map(o => {
    const meta = presets[o.value - 1] ? fpsRates(presets[o.value - 1]) : {fixed: true, low: 0, high: 0};
    return {value: o.value, short: o.name, label: o.label, ...meta};
  });
  mapped.sort((a, b) => {
    if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
    if (Math.abs(a.high - b.high) > 1e-6) return a.high - b.high;
    return a.low - b.low;
  });
  return [
    {value: 0, short: '原厂', label: '原厂模式脚本'},
    ...mapped
  ];
});

const currentFpsIdx = computed(() => {
  const idx = allFpsChoices.value.findIndex(c => c.value === props.store.state.draft.fps);
  return idx < 0 ? 0 : idx;
});

const currentFpsChoice = computed(() => allFpsChoices.value[currentFpsIdx.value] || allFpsChoices.value[0]);

const swissFpsReadout = computed(() => {
  const c = currentFpsChoice.value;
  if (!c || c.value === 0) return props.store.t('原厂脚本');
  return `${c.short} fps`;
});

// Quick 5-stop Swiss bar picking signature stops from available firmware presets
const quickFpsStops = computed(() => {
  const all = allFpsChoices.value;
  if (all.length <= 5) return all;
  const want = ['13k', '14k', '16k', '20k'];
  const picked = [all[0]];
  for (const name of want) {
    const found = all.find(c => c.short === name);
    if (found) picked.push(found);
  }
  return picked.length >= 3 ? picked : all.slice(0, 5);
});

function stepFps(delta) {
  const list = allFpsChoices.value;
  const next = Math.max(0, Math.min(list.length - 1, currentFpsIdx.value + delta));
  props.store.state.draft.fps = list[next].value;
}

// LOD quick stops (0.7..2.0 mm PAW3950 hardware range) + fine hex stepping
const lodQuickStops = [
  {mm: 0.7, code: 0x87, label: '0.7'},
  {mm: 1.0, code: 1, label: '1.0'},
  {mm: 1.5, code: 0x8a, label: '1.5'},
  {mm: 2.0, code: 2, label: '2.0'}
];

function selectQuickLod(preset) {
  const match = props.store.lodOptions.value.find(opt => lodHeight(opt.value) === preset.mm);
  props.store.state.legacy.lod = match ? match.value : preset.code;
}

const currentLodIdx = computed(() => {
  const idx = props.store.lodOptions.value.findIndex(opt => opt.value === props.store.state.legacy.lod);
  return idx < 0 ? 0 : idx;
});

const swissLodReadout = computed(() => {
  const code = props.store.state.legacy.lod;
  const mm = currentLodMm.value;
  const hexCode = Number.isInteger(code) ? `0x${code.toString(16).toUpperCase().padStart(2, '0')}` : '';
  if (mm === null) return hexCode ? `${props.store.t('当前高度未知')} · ${hexCode}` : props.store.t('当前高度未知');
  return hexCode ? `${mm.toFixed(1)} mm · ${hexCode}` : `${mm.toFixed(1)} mm`;
});

function stepLod(delta) {
  const list = props.store.lodOptions.value;
  const next = Math.max(0, Math.min(list.length - 1, currentLodIdx.value + delta));
  if (list[next]) props.store.state.legacy.lod = list[next].value;
}

// Canonical 6-stop Swiss sleep presets + 1-minute fine stepper (0 = Off, 60..3600s in 60s steps)
const sleepQuickStops = [0, 60, 180, 300, 600, 1800];

function shortSleep(sec) {
  if (sec === 0) return props.store.t('关闭');
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

const currentSleepSeconds = computed(() => {
  const sec = Number(props.store.state.sleepDraft);
  return Number.isFinite(sec) && sec >= 0 ? sec : 0;
});

const currentSleepLabel = computed(() => {
  const sec = currentSleepSeconds.value;
  if (sec === 0) return props.store.t('关闭');
  if (sec % 60 === 0) return props.store.t('{count} 分钟', {count: sec / 60});
  return props.store.t('{count} 秒', {count: sec});
});

function stepSleep(deltaMinutes) {
  const curMin = currentSleepSeconds.value <= 0 ? 0 : Math.round(currentSleepSeconds.value / 60);
  const nextMin = Math.max(0, Math.min(60, curMin + deltaMinutes));
  props.store.state.sleepDraft = nextMin * 60;
}

const performanceModes = [
  {num: '01', key: 'hyper', label: '竞技模式'},
  {num: '02', key: 'tracking', label: '追踪模式'}
];

const correctionModes = [
  {num: '03', key: 'motion_sync', label: '运动同步'},
  {num: '04', key: 'ripple', label: '波纹控制'},
  {num: '05', key: 'angle_snap', label: '直线修正'}
];

const firmwareCode = computed(() => {
  const f = props.store.state.features;
  const rev = f.implementationRevision ? `R${f.implementationRevision}` : '';
  return [f.name, rev].filter(Boolean).join(' ') || '—';
});

const saveMeta = computed(() => {
  const rt = props.store.state.runtime;
  if (!rt) return {cls: 'ok', text: '■ SYNCED'};
  if (rt.save === 1) return {cls: 'cobalt', text: '■ SAVING'};
  if (rt.save === 3) return {cls: 'danger', text: '■ ERROR'};
  return {cls: 'ok', text: '■ SYNCED'};
});
</script>

<template>
  <div class="swiss-canvas">
    <!-- Left Open Swiss Monograph Column (348px) -->
    <aside class="monograph">
      <div class="mono-top">
        <div class="mono-kicker tabular">
          <span>LUNAFURY</span>
          <span class="live-link">■ {{ store.state.transportTarget === 2 ? '2.4G LIVE' : 'USB LIVE' }}</span>
        </div>
        <div class="mono-model brand">LUNA33</div>
      </div>

      <div class="spec-table tabular">
        <div><div class="spec-k">SENSOR</div><div class="spec-v">PAW3950</div></div>
        <div><div class="spec-k">MCU</div><div class="spec-v">nRF52840</div></div>
        <div><div class="spec-k">FIRMWARE</div><div class="spec-v">{{ firmwareCode }}</div></div>
        <div>
          <div class="spec-k">SLOT</div>
          <div class="spec-v">0{{ store.state.slot }}{{ store.state.base.active === store.state.slot ? ' · ACTIVE' : '' }}</div>
        </div>
      </div>

      <!-- Orthographic LUNA33 Technical Drawing with Live Optical Axis -->
      <div class="ortho-stage">
        <div class="ortho-box">
          <img class="ortho-img" :src="orthoSrc" :alt="store.t('LUNA33 鼠标')" />
          <svg class="ortho-svg" viewBox="0 0 288 300" aria-hidden="true">
            <line x1="144" y1="18" x2="144" y2="282" stroke="var(--rule)" stroke-width="1" />
            <line x1="22" y1="152" x2="266" y2="152" stroke="var(--rule)" stroke-width="1" />
            <g :transform="`rotate(${activeAngle} 144 152)`">
              <line x1="144" y1="98" x2="144" y2="206" stroke="var(--cobalt)" stroke-width="1.6" />
              <line x1="122" y1="152" x2="166" y2="152" stroke="var(--cobalt)" stroke-width="1" opacity="0.5" />
              <polygon points="144,89 140,99 148,99" fill="var(--cobalt)" />
              <rect x="141.5" y="149.5" width="5" height="5" fill="var(--cobalt)" />
            </g>
          </svg>

          <div class="ortho-meta om-tl tabular">DPI<b>{{ isXyDiverged ? `${activeStageObj.x}/${activeStageObj.y}` : activeStageObj.x }}</b></div>
          <div class="ortho-meta om-tr tabular">RATE<b>{{ pollingHz }} Hz</b></div>
          <div class="ortho-meta om-bl tabular">LOD<b>{{ currentLodMm !== null ? `${currentLodMm.toFixed(1)} mm` : '—' }}</b></div>
          <div v-if="store.state.base.angleTune !== null" class="ortho-meta om-br tabular">
            AXIS<b>{{ activeAngle > 0 ? '+' : '' }}{{ activeAngle }}°</b>
          </div>
        </div>
      </div>

      <!-- Bottom Power & Onboard Flash Bar -->
      <div class="power-block">
        <template v-if="store.state.battery">
          <div class="power-top">
            <span class="idx-label">{{ store.state.battery.charging ? 'CHARGING' : 'BATTERY' }}</span>
            <span :class="['power-num', 'brand', 'tabular', {charging: store.state.battery.charging}]">
              {{ store.state.battery.percent }}%<svg
                v-if="store.state.battery.charging"
                class="bolt"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="currentColor"
                aria-hidden="true"
              ><path d="M9.3 1.2 3.2 9.1h4.1l-.7 5.7 6.2-7.9H8.7l.6-5.7Z" /></svg>
            </span>
          </div>
          <div class="swiss-bar">
            <div class="swiss-bar-fill" :style="{width: `${Math.max(0, Math.min(100, store.state.battery.percent))}%`}"></div>
          </div>
        </template>

        <div class="mem-line tabular">
          <span>ONBOARD FLASH</span>
          <span :class="['mem-state', saveMeta.cls]">{{ saveMeta.text }}</span>
        </div>
      </div>
    </aside>

    <!-- Right Open Editorial Swiss Grid -->
    <section class="work-grid">
      <!-- ROW 1: DPI Monument + Open Calibrated Drafting Ruler -->
      <div v-if="store.state.dpiDraft.stages.length" class="row-dpi">
        <div class="dpi-mast">
          <div class="idx-head">
            <span class="idx-label"><em>01</em>{{ store.t('灵敏度 / DPI') }}</span>
            <button
              v-if="store.state.dpiDraft.stages.length > 1"
              class="sbtn-rule stage-rm"
              type="button"
              :disabled="store.state.busy"
              :title="store.t('减少档位')"
              @click="store.removeDpiStage"
            >− {{ store.t('减少档位') }}</button>
          </div>

          <div class="dpi-figure">
            <span :class="['dpi-huge', 'brand', 'tabular', {split: isXyDiverged}]">
              {{ isXyDiverged ? `${activeStageObj.x} / ${activeStageObj.y}` : activeStageObj.x }}
            </span>
            <span class="dpi-u">DPI</span>
          </div>

          <div class="stage-bar tabular" role="radiogroup" :aria-label="store.t('DPI 档位')">
            <button
              v-for="(stage, idx) in store.state.dpiDraft.stages"
              :key="idx"
              type="button"
              :disabled="store.state.busy"
              :class="['st-cell', {active: store.state.dpiDraft.activeStage === idx + 1}]"
              :style="{'--sc': DEFAULT_DPI_COLORS[idx % DEFAULT_DPI_COLORS.length]}"
              @click="store.selectDpiStage(idx + 1)"
            >
              <span class="st-n">0{{ idx + 1 }}</span>
              <span :class="['st-v', {split: stage.x !== stage.y}]">{{ stage.x === stage.y ? stage.x : `${stage.x}/${stage.y}` }}</span>
            </button>
            <button
              v-if="store.state.dpiDraft.stages.length < DPI_MAX_STAGES"
              class="st-add"
              type="button"
              :disabled="store.state.busy"
              :title="store.t('增加档位')"
              :aria-label="store.t('增加档位')"
              @click="store.addDpiStage"
            >+</button>
          </div>
        </div>

        <div class="dpi-ruler-bay">
          <div class="idx-head">
            <span class="idx-label tabular">50 — 30,000 · STEP 50</span>
            <div class="dpi-head-tools">
              <button
                type="button"
                :class="['xy-toggle', {active: xySplit}]"
                :disabled="store.state.busy"
                :aria-pressed="xySplit"
                @click="toggleXySplit"
              >{{ store.t('独立 X/Y') }}</button>

              <div v-if="!xySplit" class="step-box tabular">
                <button
                  class="step-b"
                  type="button"
                  :disabled="store.state.busy || activeStageObj.x <= DPI_MIN"
                  aria-label="-50"
                  @click="store.stepActiveDpi(-DPI_STEP)"
                >−</button>
                <input
                  class="step-in tabular"
                  type="number"
                  :min="DPI_MIN"
                  :max="DPI_MAX"
                  :step="DPI_STEP"
                  :value="activeStageObj.x"
                  :disabled="store.state.busy"
                  :aria-label="store.t('当前 DPI 数值')"
                  @change="onDpiNumberInput($event, 'both')"
                />
                <button
                  class="step-b"
                  type="button"
                  :disabled="store.state.busy || activeStageObj.x >= DPI_MAX"
                  aria-label="+50"
                  @click="store.stepActiveDpi(DPI_STEP)"
                >+</button>
              </div>
            </div>
          </div>

          <div v-if="!xySplit" class="ruler-wrap">
            <input
              class="swiss-range"
              type="range"
              min="0"
              max="1000"
              step="1"
              :value="dpiSliderPos"
              :style="dpiSliderStyle"
              :disabled="store.state.busy"
              :aria-label="store.t('当前 DPI 数值')"
              @input="onDpiSliderInput($event, 'both')"
            />
            <div class="ruler-scale tabular">
              <button
                v-for="(anchor, idx) in dpiAnchors"
                :key="anchor"
                type="button"
                :disabled="store.state.busy"
                :class="['r-mark', {active: activeStageObj.x === anchor}]"
                :style="{left: `calc(5px + (100% - 10px) * ${idx / (dpiAnchors.length - 1)})`}"
                @click="store.setActiveDpiValue(anchor, 'both')"
              >{{ anchor }}</button>
            </div>
          </div>

          <div v-else class="xy-stack">
            <div class="xy-axis-row">
              <span class="xy-axis-tag axis-x tabular">X</span>
              <div class="xy-slider-col">
                <input
                  class="swiss-range"
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  :value="dpiSliderPos"
                  :style="dpiSliderStyle"
                  :disabled="store.state.busy"
                  :aria-label="store.t('X 轴 DPI')"
                  @input="onDpiSliderInput($event, 'x')"
                />
                <div class="ruler-scale compact tabular">
                  <button
                    v-for="(anchor, idx) in dpiAnchors"
                    :key="`x-${anchor}`"
                    type="button"
                    :disabled="store.state.busy"
                    :class="['r-mark', {active: activeStageObj.x === anchor}]"
                    :style="{left: `calc(5px + (100% - 10px) * ${idx / (dpiAnchors.length - 1)})`}"
                    @click="store.setActiveDpiValue(anchor, 'x')"
                  >{{ anchor }}</button>
                </div>
              </div>
              <div class="step-box compact tabular">
                <button
                  class="step-b"
                  type="button"
                  :disabled="store.state.busy || activeStageObj.x <= DPI_MIN"
                  aria-label="X -50"
                  @click="store.stepActiveDpi(-DPI_STEP, 'x')"
                >−</button>
                <input
                  class="step-in tabular"
                  type="number"
                  :min="DPI_MIN"
                  :max="DPI_MAX"
                  :step="DPI_STEP"
                  :value="activeStageObj.x"
                  :disabled="store.state.busy"
                  :aria-label="store.t('X 轴 DPI')"
                  @change="onDpiNumberInput($event, 'x')"
                />
                <button
                  class="step-b"
                  type="button"
                  :disabled="store.state.busy || activeStageObj.x >= DPI_MAX"
                  aria-label="X +50"
                  @click="store.stepActiveDpi(DPI_STEP, 'x')"
                >+</button>
              </div>
            </div>

            <div class="xy-axis-row">
              <span class="xy-axis-tag axis-y tabular">Y</span>
              <div class="xy-slider-col">
                <input
                  class="swiss-range range-y"
                  type="range"
                  min="0"
                  max="1000"
                  step="1"
                  :value="dpiSliderPosY"
                  :style="dpiSliderStyleY"
                  :disabled="store.state.busy"
                  :aria-label="store.t('Y 轴 DPI')"
                  @input="onDpiSliderInput($event, 'y')"
                />
                <div class="ruler-scale compact tabular">
                  <button
                    v-for="(anchor, idx) in dpiAnchorsY"
                    :key="`y-${anchor}`"
                    type="button"
                    :disabled="store.state.busy"
                    :class="['r-mark', 'mark-y', {active: activeStageObj.y === anchor}]"
                    :style="{left: `calc(5px + (100% - 10px) * ${idx / (dpiAnchorsY.length - 1)})`}"
                    @click="store.setActiveDpiValue(anchor, 'y')"
                  >{{ anchor }}</button>
                </div>
              </div>
              <div class="step-box compact tabular">
                <button
                  class="step-b"
                  type="button"
                  :disabled="store.state.busy || activeStageObj.y <= DPI_MIN"
                  aria-label="Y -50"
                  @click="store.stepActiveDpi(-DPI_STEP, 'y')"
                >−</button>
                <input
                  class="step-in tabular"
                  type="number"
                  :min="DPI_MIN"
                  :max="DPI_MAX"
                  :step="DPI_STEP"
                  :value="activeStageObj.y"
                  :disabled="store.state.busy"
                  :aria-label="store.t('Y 轴 DPI')"
                  @change="onDpiNumberInput($event, 'y')"
                />
                <button
                  class="step-b"
                  type="button"
                  :disabled="store.state.busy || activeStageObj.y >= DPI_MAX"
                  aria-label="Y +50"
                  @click="store.stepActiveDpi(DPI_STEP, 'y')"
                >+</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ROW 2: Polling & Zero-Dropdown Sensor Timing / LOD / Sleep -->
      <div class="row-mid">
        <div class="poll-col">
          <div class="idx-head">
            <span class="idx-label"><em>02</em>{{ store.t('轮询率 / POLLING') }}</span>
          </div>

          <div class="hz-lockup">
            <div class="dpi-figure">
              <span class="hz-monument brand tabular">{{ pollingHz }}</span>
              <span class="dpi-u">Hz</span>
            </div>
            <div class="hz-period-tag tabular">
              <span>INTERVAL</span>
              <b>{{ formatPeriodMs(pollingHz) }}</b>
            </div>
          </div>

          <div class="swiss-seg tabular">
            <button
              v-for="item in store.pollingOptions.value"
              :key="item.hz"
              type="button"
              :disabled="store.state.busy || item.disabled"
              :class="['ss-b', {active: pollingHz === item.hz}]"
              @click="store.state.legacy.polling = item.value"
            >{{ item.hz }}</button>
          </div>

          <div class="scan-band">
            <div class="t-head">
              <span class="t-name">{{ store.t('按键轮询率') }}</span>
              <span class="t-val tabular">{{ scanHz }} Hz · {{ formatPeriodMs(scanHz) }}</span>
            </div>
            <div class="swiss-seg tabular">
              <button
                v-for="item in store.scanRateOptions.value"
                :key="item.hz"
                type="button"
                :disabled="store.state.busy"
                :class="['ss-b', {active: scanHz === item.hz}]"
                @click="store.state.legacy.scan_rate = item.value"
              >{{ item.hz }}</button>
            </div>
          </div>
        </div>

        <div class="timing-col">
          <!-- FPS Preset: Quick 5-stop Swiss strip + right-anchored ‹/› fine stepper -->
          <div v-if="store.state.features.fps !== 'none'" class="t-row">
            <div class="t-head">
              <span class="t-name">{{ store.t('传感器帧率') }}</span>
              <div class="val-jog tabular">
                <span class="t-val">{{ swissFpsReadout }}</span>
                <span class="jog-pair">
                  <button class="mini-jog" type="button" :disabled="store.state.busy || currentFpsIdx <= 0" aria-label="Lower FPS" @click="stepFps(-1)">‹</button>
                  <button class="mini-jog" type="button" :disabled="store.state.busy || currentFpsIdx >= allFpsChoices.length - 1" aria-label="Higher FPS" @click="stepFps(1)">›</button>
                </span>
              </div>
            </div>
            <div class="grid-strip tabular" :style="{gridTemplateColumns: `repeat(${quickFpsStops.length}, 1fr)`}">
              <button
                v-for="choice in quickFpsStops"
                :key="choice.value"
                type="button"
                :disabled="store.state.busy"
                :class="['gs-b', {active: store.state.draft.fps === choice.value}]"
                @click="store.state.draft.fps = choice.value"
              >{{ store.t(choice.short) }}</button>
            </div>
          </div>

          <!-- LOD Height: Quick 5-stop Swiss strip + right-anchored ‹/› fine stepper + clean side silhouette -->
          <div class="t-row">
            <div class="t-head">
              <span class="t-name">{{ store.t('LOD 响应高度') }}</span>
              <div class="val-jog tabular">
                <span class="t-val">{{ swissLodReadout }}</span>
                <span class="jog-pair">
                  <button class="mini-jog" type="button" :disabled="store.state.busy || currentLodIdx <= 0" aria-label="Lower LOD" @click="stepLod(-1)">‹</button>
                  <button class="mini-jog" type="button" :disabled="store.state.busy || currentLodIdx >= store.lodOptions.value.length - 1" aria-label="Higher LOD" @click="stepLod(1)">›</button>
                </span>
              </div>
            </div>
            <div class="lod-flex">
              <div
                class="grid-strip tabular"
                style="flex:1"
                :style="{gridTemplateColumns: `repeat(${lodQuickStops.length}, 1fr)`}"
              >
                <button
                  v-for="preset in lodQuickStops"
                  :key="preset.mm"
                  type="button"
                  :disabled="store.state.busy"
                  :class="['gs-b', {active: currentLodMm === preset.mm}]"
                  @click="selectQuickLod(preset)"
                >{{ preset.label }}</button>
              </div>

              <svg viewBox="0 0 82 34" width="82" height="34" aria-hidden="true">
                <line x1="0" y1="31" x2="82" y2="31" stroke="var(--rule-strong)" stroke-width="1" stroke-dasharray="2 2" />
                <line x1="41" :y1="29 - lodLiftPx" x2="41" y2="31" stroke="var(--cobalt)" stroke-width="1.4" />
                <g class="lod-mouse-g" :style="{transform: `translateY(${-lodLiftPx}px)`}">
                  <path d="M 13 29 C 14 21 25 15.5 41 15.5 C 55 15.5 65 20.5 68 27.5 L 67 29 Z" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.35" />
                  <rect x="54" y="17" width="4.5" height="2.2" fill="var(--cobalt)" />
                </g>
              </svg>
            </div>
          </div>

          <!-- Sleep Timeout: 6 canonical stops + 1-minute ‹/› fine stepper -->
          <div v-if="store.state.base.sleepSeconds !== null" class="t-row">
            <div class="t-head">
              <span class="t-name">{{ store.t('休眠时间') }}</span>
              <div class="val-jog tabular">
                <span class="t-val">{{ currentSleepLabel }}</span>
                <span class="jog-pair">
                  <button
                    class="mini-jog"
                    type="button"
                    :disabled="store.state.busy || currentSleepSeconds <= 0"
                    aria-label="-1m"
                    @click="stepSleep(-1)"
                  >‹</button>
                  <button
                    class="mini-jog"
                    type="button"
                    :disabled="store.state.busy || currentSleepSeconds >= 3600"
                    aria-label="+1m"
                    @click="stepSleep(1)"
                  >›</button>
                </span>
              </div>
            </div>
            <div class="grid-strip tabular" :style="{gridTemplateColumns: `repeat(${sleepQuickStops.length}, 1fr)`}">
              <button
                v-for="sec in sleepQuickStops"
                :key="sec"
                type="button"
                :disabled="store.state.busy"
                :class="['gs-b', {active: store.state.sleepDraft === sec}]"
                @click="store.state.sleepDraft = sec"
              >{{ shortSleep(sec) }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ROW 3: Open Editorial Swiss Binary Matrix + Geometric Angle Compass -->
      <div :class="['row-bot', {single: store.state.base.angleTune === null}]">
        <div class="matrix-col">
          <div class="idx-head">
            <span class="idx-label"><em>03</em>{{ store.t('传感器与算法 / SENSOR & DSP') }}</span>
            <span class="idx-label">PAW3950</span>
          </div>

          <div class="bin-row-2">
            <button
              v-for="item in performanceModes"
              :key="item.key"
              type="button"
              role="switch"
              :aria-checked="Boolean(store.state.legacy[item.key])"
              :aria-label="store.t(item.label)"
              :disabled="store.state.busy"
              :class="['bin-tile', {on: store.state.legacy[item.key] === 1}]"
              @click="store.state.legacy[item.key] = store.state.legacy[item.key] === 1 ? 0 : 1"
            >
              <div class="bin-top tabular">
                <span>{{ item.num }} · {{ store.state.legacy[item.key] === 1 ? 'ON' : 'OFF' }}</span>
                <span class="bin-sq"></span>
              </div>
              <span class="bin-name">{{ store.t(item.label) }}</span>
            </button>
          </div>

          <div class="bin-row-3">
            <button
              v-for="item in correctionModes"
              :key="item.key"
              type="button"
              role="switch"
              :aria-checked="Boolean(store.state.legacy[item.key])"
              :aria-label="store.t(item.label)"
              :disabled="store.state.busy"
              :class="['bin-tile', {on: store.state.legacy[item.key] === 1}]"
              @click="store.state.legacy[item.key] = store.state.legacy[item.key] === 1 ? 0 : 1"
            >
              <div class="bin-top tabular">
                <span>{{ item.num }} · {{ store.state.legacy[item.key] === 1 ? 'ON' : 'OFF' }}</span>
                <span class="bin-sq"></span>
              </div>
              <span class="bin-name">{{ store.t(item.label) }}</span>
            </button>
          </div>
        </div>

        <div v-if="store.state.base.angleTune !== null" class="compass-col">
          <div class="idx-head">
            <span class="idx-label"><em>04</em>{{ store.t('角度 / AXIS') }}</span>
            <button
              class="reset-rule"
              type="button"
              :style="{visibility: store.state.angleTuneDraft !== 0 ? 'visible' : 'hidden'}"
              :disabled="store.state.busy"
              @click="store.state.angleTuneDraft = 0"
            >RESET</button>
          </div>

          <AngleDial
            v-model="store.state.angleTuneDraft"
            :min="ANGLE_TUNE_MIN"
            :max="ANGLE_TUNE_MAX"
            :disabled="store.state.busy"
            :aria-label="store.t('角度 / AXIS')"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.swiss-canvas {
  flex: 1;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  min-height: calc(100vh - 52px);
}

/* Left Open Swiss Monograph Column */
.monograph {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  padding: 22px 28px 20px;
  min-height: 0;
}

.mono-top {
  padding-bottom: 16px;
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

.live-link {
  color: var(--cobalt);
}

.mono-model {
  font-size: 32px;
  line-height: 0.92;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.spec-table {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px 16px;
  padding: 13px 0;
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 276px;
}

.ortho-box {
  position: relative;
  width: 288px;
  height: 296px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ortho-img {
  height: 256px;
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

.ortho-meta {
  position: absolute;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.ortho-meta b {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  margin-top: 1px;
}

.om-tl { left: 4px; top: 8px; }
.om-tr { right: 4px; top: 8px; text-align: right; }
.om-bl { left: 4px; bottom: 8px; }
.om-br { right: 4px; bottom: 8px; text-align: right; }
.om-br b { color: var(--cobalt); }

.power-block {
  border-top: 1px solid var(--rule);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.power-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.power-num {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 24px;
  line-height: 1;
  color: var(--ink);
}

.power-num.charging {
  color: var(--ok);
}

.bolt {
  align-self: center;
}

.swiss-bar {
  height: 4px;
  width: 100%;
  background: var(--rule);
}

.swiss-bar-fill {
  height: 100%;
  background: var(--cobalt);
  transition: width 0.25s ease;
}

.mem-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.mem-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
}

.mem-state.ok {
  color: var(--ok);
}

.mem-state.cobalt {
  color: var(--cobalt);
}

.mem-state.danger {
  color: var(--danger);
}

/* Right Open Editorial Swiss Grid */
.work-grid {
  display: grid;
  grid-template-rows: minmax(184px, auto) minmax(244px, 1fr) minmax(236px, 1fr);
  min-height: 0;
  padding-bottom: 52px;
}

/* ROW 1: DPI */
.row-dpi {
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  border-bottom: 1px solid var(--rule);
}

.dpi-mast {
  padding: 20px 28px 16px;
  border-right: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
}

.stage-rm {
  height: auto;
  font-size: 10.5px;
  border-bottom-width: 1px;
}

.dpi-figure {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.dpi-huge {
  font-size: 44px;
  line-height: 0.88;
  letter-spacing: 0.015em;
  color: var(--ink);
}

.dpi-huge.split {
  font-size: 26px;
  line-height: 1;
}

.dpi-u {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.stage-bar {
  display: flex;
  gap: 5px;
  width: 100%;
  min-width: 0;
}

.st-cell {
  flex: 0 1 68px;
  min-width: 0;
  height: 36px;
  border: 0;
  border-top: 2px solid var(--rule);
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 4px 4px 0;
  text-align: left;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.st-cell:hover:not(:disabled) {
  background: var(--paper-tint);
}

.st-cell.active {
  border-top: 3px solid var(--sc, var(--cobalt));
  background: var(--paper-tint);
}

.st-n {
  font-size: 8.5px;
  font-weight: 600;
  color: var(--ink-4);
}

.st-v {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.st-v.split {
  font-size: 9.5px;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.st-cell.active .st-v {
  color: var(--ink);
  font-weight: 700;
}

.st-add {
  width: 26px;
  flex: 0 0 26px;
  border: 0;
  border-top: 2px solid transparent;
  background: transparent;
  font-size: 16px;
  color: var(--ink-3);
}

.st-add:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.dpi-ruler-bay {
  padding: 20px 32px 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
}

.dpi-head-tools {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}

.xy-toggle {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--rule-strong);
  background: transparent;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--ink-2);
  white-space: nowrap;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.xy-toggle:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}

.xy-toggle.active {
  border-color: var(--cobalt);
  background: var(--cobalt);
  color: #ffffff;
}

.xy-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.xy-axis-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
}

.xy-axis-tag {
  font-size: 12px;
  font-weight: 700;
  line-height: 22px;
  letter-spacing: 0.06em;
}

.xy-axis-tag.axis-x {
  color: var(--cobalt);
}

.xy-axis-tag.axis-y {
  color: var(--ink-2);
}

.xy-slider-col {
  padding-top: 9px;
}

.ruler-scale.compact {
  height: 22px;
  margin-top: 2px;
}

.ruler-scale.compact .r-mark {
  padding-top: 7px;
  font-size: 10px;
}

.step-box.compact .step-b {
  width: 24px;
  height: 22px;
  font-size: 14px;
}

.step-box.compact .step-in {
  width: 56px;
  height: 22px;
  font-size: 12px;
}

.swiss-range.range-y::-webkit-slider-thumb {
  background: var(--ink-2);
}

.swiss-range.range-y::-moz-range-thumb {
  background: var(--ink-2);
}

.r-mark.mark-y.active {
  color: var(--ink);
}

.r-mark.mark-y.active::before {
  background: var(--ink);
}

.step-box {
  display: inline-flex;
  align-items: center;
  border-bottom: 1.5px solid var(--rule-strong);
}

.step-b {
  width: 28px;
  height: 26px;
  border: 0;
  background: transparent;
  font-size: 15px;
  font-weight: 500;
  color: var(--ink-2);
}

.step-b:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.step-in {
  width: 64px;
  height: 26px;
  border: 0;
  background: transparent;
  text-align: center;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}

.step-in:focus {
  outline: none;
  background: var(--paper-tint);
}

.ruler-wrap {
  padding: 12px 0 4px;
}

.swiss-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 2px;
  background: var(--rule-strong);
  outline: none;
  cursor: ew-resize;
}

.swiss-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 22px;
  background: var(--cobalt);
  border: 0;
  cursor: ew-resize;
}

.swiss-range::-moz-range-thumb {
  width: 10px;
  height: 22px;
  background: var(--cobalt);
  border: 0;
  border-radius: 0;
  cursor: ew-resize;
}

.ruler-scale {
  position: relative;
  height: 28px;
  margin-top: 4px;
}

.r-mark {
  position: absolute;
  transform: translateX(-50%);
  border: 0;
  background: transparent;
  padding: 9px 0 0;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
}

.r-mark::before {
  content: "";
  position: absolute;
  top: 0;
  left: 50%;
  width: 1px;
  height: 5px;
  background: var(--rule-strong);
}

.r-mark:hover:not(:disabled) {
  color: var(--ink);
}

.r-mark.active {
  color: var(--cobalt);
  font-weight: 700;
}

.r-mark.active::before {
  height: 7px;
  width: 2px;
  background: var(--cobalt);
}

/* ROW 2: Polling & Sensor Timing */
.row-mid {
  display: grid;
  grid-template-columns: 1.04fr 0.96fr;
  border-bottom: 1px solid var(--rule);
  min-height: 0;
}

.poll-col {
  border-right: 1px solid var(--rule);
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
}

.hz-lockup {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.hz-monument {
  font-size: 50px;
  line-height: 0.85;
  letter-spacing: 0.015em;
  color: var(--ink);
}

.hz-period-tag {
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}

.hz-period-tag span {
  display: block;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.swiss-seg {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}

.ss-b {
  height: 31px;
  border: 0;
  background: transparent;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-2);
  transition: background-color 0.1s ease, color 0.1s ease;
}

.ss-b:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.ss-b.active {
  background: var(--cobalt);
  color: #ffffff;
  font-weight: 700;
}

.scan-band {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timing-col {
  display: flex;
  flex-direction: column;
}

.t-row {
  flex: 1;
  padding: 12px 32px;
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 9px;
}

.t-row:last-child {
  border-bottom: 0;
}

.t-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.t-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  white-space: nowrap;
}

.t-val {
  font-size: 12px;
  font-weight: 700;
  color: var(--cobalt);
  white-space: nowrap;
}

.val-jog {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.jog-pair {
  display: inline-flex;
  align-items: center;
  border-bottom: 1px solid var(--rule-strong);
  flex-shrink: 0;
}

.mini-jog {
  width: 22px;
  height: 20px;
  border: 0;
  background: transparent;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  color: var(--ink-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.mini-jog:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.grid-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-top: 1px solid var(--rule);
}

.gs-b {
  height: 29px;
  border: 0;
  background: transparent;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-2);
  transition: background-color 0.1s ease, color 0.1s ease;
}

.gs-b:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.gs-b.active {
  background: var(--inv-bg);
  color: var(--inv-ink);
  font-weight: 700;
}

.lod-flex {
  display: flex;
  align-items: center;
  gap: 16px;
}

.lod-mouse-g {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

/* ROW 3: Open Swiss Binary Sensor Matrix + Geometric Angle Compass */
.row-bot {
  display: grid;
  grid-template-columns: 1.32fr 0.68fr;
  min-height: 0;
}

.row-bot.single {
  grid-template-columns: 1fr;
}

.matrix-col {
  border-right: 1px solid var(--rule);
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
}

.row-bot.single .matrix-col {
  border-right: 0;
}

.bin-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.bin-row-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}

.bin-tile {
  height: 62px;
  padding: 10px 10px 8px;
  border: 0;
  border-top: 1.5px solid var(--rule-strong);
  background: transparent;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: left;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.bin-tile:hover:not(:disabled) {
  background: var(--paper-tint);
}

.bin-tile.on {
  border-top: 3px solid var(--cobalt);
  background: var(--cobalt-soft);
}

.bin-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.bin-tile.on .bin-top {
  color: var(--cobalt);
}

.bin-sq {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--ink-3);
  display: inline-block;
}

.bin-tile.on .bin-sq {
  border-color: var(--cobalt);
  background: var(--cobalt);
}

.bin-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.bin-tile.on .bin-name {
  color: var(--ink);
  font-weight: 700;
}

.compass-col {
  padding: 20px 26px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.reset-rule {
  border: 0;
  border-bottom: 1.5px solid var(--cobalt);
  background: transparent;
  padding: 0 2px 1px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--cobalt);
}

.reset-rule:hover:not(:disabled) {
  background: var(--cobalt);
  color: #ffffff;
}

@media (max-width: 1120px) {
  .swiss-canvas {
    grid-template-columns: 1fr;
  }
  .monograph {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
  .ortho-stage {
    min-height: 210px;
  }
  .work-grid {
    grid-template-rows: auto auto auto;
  }
  .row-dpi,
  .row-mid,
  .row-bot {
    grid-template-columns: 1fr;
  }
  .dpi-mast,
  .poll-col,
  .matrix-col {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
}

@media (max-width: 640px) {
  .bin-row-2,
  .bin-row-3 {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .swiss-seg {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
