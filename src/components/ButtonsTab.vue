<script setup>
import {computed, ref} from 'vue';
import {parseDecimalInt} from '../../advanced/protocol.js';

const props = defineProps({
  store: {type: Object, required: true}
});

const orthoSrc = computed(() => (
  props.store.state.theme === 'dark'
    ? './img/mouseLine_night.9b84629d.png'
    : './img/mouseLine.ff2c2f85.png'
));

// Exact orthographic callout coordinates on 296x248 LUNA33 CAD canvas
const CALLOUTS = [
  {id: 0, code: '01', ax: 126, ay: 64, lx: 8, ly: 44, align: 'left'},
  {id: 1, code: '02', ax: 170, ay: 64, lx: 288, ly: 44, align: 'right'},
  {id: 2, code: '03', ax: 148, ay: 74, lx: 288, ly: 102, align: 'right'},
  {id: 4, code: '04', ax: 108, ay: 106, lx: 8, ly: 108, align: 'left'},
  {id: 3, code: '05', ax: 108, ay: 140, lx: 8, ly: 152, align: 'left'}
];

// Firmware chronological order: Press (PRE -> PLOCK), Release (POST -> RELOCK)
const PHASE_META = [
  {key: 'pre', short: 'PRE'},
  {key: 'plock', short: 'PLOCK'},
  {key: 'post', short: 'POST'},
  {key: 'relock', short: 'RELOCK'}
];

const hoveredField = ref(null);
const focusedField = ref(null);
const activeField = computed(() => hoveredField.value || focusedField.value);

const selectedButtonObj = computed(() => (
  props.store.state.buttons.find(b => b.id === props.store.state.selectedButton) || props.store.state.buttons[0]
));

const orderedDebounceFields = computed(() => {
  const byKey = Object.fromEntries(props.store.state.debounceFields.map(f => [f.key, f]));
  return PHASE_META.map(m => ({...m, ...(byKey[m.key] || {label: m.short})}));
});

function parseMs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 0;
}

function fmtMs(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Firmware-accurate dual-trace oscilloscope geometry (matches full_patch.py Filter state machine)
const scope = computed(() => {
  const d = props.store.debounceDraft.value || {};
  const pre = parseMs(d.pre);
  const plock = parseMs(d.plock);
  const post = parseMs(d.post);
  const relock = parseMs(d.relock);

  const scale = v => (v <= 0 ? 0 : Math.round(Math.min(88, 28 + Math.sqrt(v) * 10)));
  const wPre = scale(pre);
  const wPlock = scale(plock);
  const wPost = scale(post);
  const wRelock = scale(relock);

  const xStart = 18;
  const xEnd = 542;
  const lead = 48;
  const usable = xEnd - xStart;
  const used = lead + wPre + wPlock + wPost + wRelock;
  const spare = Math.max(88, usable - used);
  const hold = Math.round(spare * 0.56);

  const xPressRaw = xStart + lead;
  const xPressOut = xPressRaw + wPre;
  const xPlockEnd = xPressOut + wPlock;
  const xRelRaw = xPlockEnd + hold;
  const xRelOut = xRelRaw + wPost;
  const xRelockEnd = Math.min(xEnd - 20, xRelOut + wRelock);

  const yHi = 34;
  const yLo = 76;

  const outPath = [
    `M ${xStart} ${yHi}`,
    `L ${xPressOut} ${yHi}`,
    `L ${xPressOut} ${yLo}`,
    `L ${xRelOut} ${yLo}`,
    `L ${xRelOut} ${yHi}`,
    `L ${xEnd} ${yHi}`
  ].join(' ');

  const rawPts = [`M ${xStart} ${yHi}`, `L ${xPressRaw} ${yHi}`, `L ${xPressRaw} ${yLo}`];
  if (wPre >= 18) {
    const b1 = xPressRaw + Math.min(12, Math.round(wPre * 0.34));
    const b2 = xPressRaw + Math.min(22, Math.round(wPre * 0.64));
    rawPts.push(
      `L ${b1 - 3} ${yLo}`, `L ${b1 - 3} ${yHi + 10}`, `L ${b1 + 1} ${yHi + 10}`, `L ${b1 + 1} ${yLo}`,
      `L ${b2 - 2} ${yLo}`, `L ${b2 - 2} ${yHi + 20}`, `L ${b2 + 1} ${yHi + 20}`, `L ${b2 + 1} ${yLo}`
    );
  }
  if (wPlock >= 20) {
    const k1 = xPressOut + Math.min(16, Math.round(wPlock * 0.42));
    rawPts.push(`L ${k1 - 2} ${yLo}`, `L ${k1 - 2} ${yHi + 14}`, `L ${k1 + 2} ${yHi + 14}`, `L ${k1 + 2} ${yLo}`);
  }
  rawPts.push(`L ${xRelRaw} ${yLo}`, `L ${xRelRaw} ${yHi}`);
  if (wPost >= 18) {
    const r1 = xRelRaw + Math.min(12, Math.round(wPost * 0.38));
    rawPts.push(`L ${r1 - 2} ${yHi}`, `L ${r1 - 2} ${yLo - 12}`, `L ${r1 + 2} ${yLo - 12}`, `L ${r1 + 2} ${yHi}`);
  }
  if (wRelock >= 20) {
    const d1 = xRelOut + Math.min(16, Math.round(wRelock * 0.36));
    const d2 = xRelOut + Math.min(30, Math.round(wRelock * 0.68));
    rawPts.push(
      `L ${d1 - 2} ${yHi}`, `L ${d1 - 2} ${yLo - 8}`, `L ${d1 + 2} ${yLo - 8}`, `L ${d1 + 2} ${yHi}`,
      `L ${d2 - 2} ${yHi}`, `L ${d2 - 2} ${yLo - 18}`, `L ${d2 + 1} ${yLo - 18}`, `L ${d2 + 1} ${yHi}`
    );
  }
  rawPts.push(`L ${xEnd} ${yHi}`);

  const zones = [
    {key: 'pre', short: 'PRE', value: pre, x: xPressRaw, w: wPre, edgeX: xPressRaw},
    {key: 'plock', short: 'PLOCK', value: plock, x: xPressOut, w: wPlock, edgeX: xPressOut},
    {key: 'post', short: 'POST', value: post, x: xRelRaw, w: wPost, edgeX: xRelRaw},
    {key: 'relock', short: 'RELOCK', value: relock, x: xRelOut, w: xRelockEnd - xRelOut, edgeX: xRelOut}
  ];

  return {
    pre, plock, post, relock,
    xStart, xEnd, yHi, yLo,
    xPressRaw, xPressOut, xPlockEnd, xRelRaw, xRelOut, xRelockEnd,
    outPath,
    rawPath: rawPts.join(' '),
    zones
  };
});

function summaryOf(buttonId) {
  const b = props.store.state.draft.buttons?.[buttonId];
  if (!b) return '—';
  return `${b.pre} / ${b.plock} / ${b.post} / ${b.relock}`;
}

function buttonLabel(id) {
  const found = props.store.state.buttons.find(b => b.id === id);
  return found ? props.store.t(found.label) : '';
}

const triggerModes = [
  {value: 1, label: '左键优先'},
  {value: 0, label: '关闭'},
  {value: 2, label: '右键优先'}
];

const isLandingDefault = computed(() => {
  const d = props.store.state.draft;
  return (d.landingMask ?? 0x03) === 0x03
    && parseDecimalInt(d.landingHoldMs) === 28
    && !d.airborneLockout
    && parseDecimalInt(d.airborneFloorMs) === 8;
});

function isLandingKeyEnabled(id) {
  return Boolean(((props.store.state.draft.landingMask ?? 0x03) & (1 << id)));
}
</script>

<template>
  <div class="swiss-buttons">
    <!-- Left 348px Swiss Orthographic Button Selector Column (Aligns with Masthead & Performance Monograph) -->
    <aside class="key-col">
      <div class="col-head">
        <div class="idx-head">
          <span class="idx-label"><em>01</em>{{ store.t('LUNA33 按键选择') }}</span>
          <span class="idx-label tabular">0{{ store.state.buttons.findIndex(b => b.id === store.state.selectedButton) + 1 }} · {{ store.t(selectedButtonObj.label) }}</span>
        </div>
      </div>

      <div class="ortho-picker">
        <div class="callout-stage">
          <img class="ortho-mouse" :src="orthoSrc" :alt="store.t('LUNA33 鼠标')" />

          <svg class="callout-svg" viewBox="0 0 296 248" aria-hidden="true">
            <g v-for="c in CALLOUTS" :key="c.id" :class="['callout-line', {active: store.state.selectedButton === c.id}]">
              <polyline
                :points="`${c.ax},${c.ay} ${c.align === 'left' ? c.ax - 20 : c.ax + 20},${c.ly} ${c.align === 'left' ? c.lx + 54 : c.lx - 54},${c.ly}`"
                fill="none"
              />
              <rect
                :x="c.ax - (store.state.selectedButton === c.id ? 3 : 2)"
                :y="c.ay - (store.state.selectedButton === c.id ? 3 : 2)"
                :width="store.state.selectedButton === c.id ? 6 : 4"
                :height="store.state.selectedButton === c.id ? 6 : 4"
              />
            </g>
          </svg>

          <button
            v-for="c in CALLOUTS"
            :key="c.id"
            type="button"
            :class="['callout-tag', c.align, {active: store.state.selectedButton === c.id}]"
            :style="{top: (c.ly / 248 * 100) + '%'}"
            @click="store.state.selectedButton = c.id"
          >
            <span class="tabular tag-idx">{{ c.code }}</span>
            <span>{{ buttonLabel(c.id) }}</span>
          </button>
        </div>
      </div>

      <div v-if="store.state.features.perButtonDebounce" class="key-list">
        <button
          v-for="(btn, idx) in store.state.buttons"
          :key="btn.id"
          type="button"
          :class="['key-row', {active: store.state.selectedButton === btn.id}]"
          @click="store.state.selectedButton = btn.id"
        >
          <span class="key-left">
            <span class="key-idx tabular">0{{ idx + 1 }}</span>
            <span class="key-name">{{ store.t(btn.label) }}</span>
          </span>
          <span class="key-right">
            <span class="key-vals tabular">{{ summaryOf(btn.id) }} ms</span>
            <span
              v-if="store.state.features.independentDebounce"
              :class="['sq-mark', store.state.draft.buttons?.[btn.id]?.enabled ? 'ok' : '']"
            ></span>
          </span>
        </button>
      </div>
    </aside>

    <!-- Right Editorial Swiss Debounce Oscilloscope + Timing Matrix + Policies -->
    <section class="editor-col">
      <template v-if="store.state.features.perButtonDebounce">
        <div class="editor-head">
          <div>
            <span class="idx-label"><em>02</em>{{ store.t('自定义消抖') }}</span>
            <h2 class="key-hero">{{ store.t(selectedButtonObj.label) }}</h2>
          </div>

          <button
            v-if="store.state.features.independentDebounce"
            type="button"
            role="switch"
            :aria-checked="Boolean(store.debounceDraft.value.enabled)"
            :aria-label="store.t('启用自定义消抖')"
            :disabled="store.state.busy"
            :class="['swiss-toggle', {on: store.debounceDraft.value.enabled}]"
            @click="store.debounceDraft.value.enabled = !store.debounceDraft.value.enabled"
          >
            <span class="st-txt">{{ store.t('启用自定义消抖') }}</span>
            <span class="st-state tabular">{{ store.debounceDraft.value.enabled ? 'ON' : 'OFF' }}</span>
            <span class="bin-sq"></span>
          </button>

          <button
            v-else
            type="button"
            role="switch"
            :aria-checked="Boolean(store.state.draft.debounce)"
            :aria-label="store.t('全部按键启用')"
            :disabled="store.state.busy"
            :class="['swiss-toggle', {on: store.state.draft.debounce}]"
            @click="store.state.draft.debounce = !store.state.draft.debounce"
          >
            <span class="st-txt">{{ store.t('全部按键启用') }}</span>
            <span class="st-state tabular">{{ store.state.draft.debounce ? 'ON' : 'OFF' }}</span>
            <span class="bin-sq"></span>
          </button>
        </div>

        <!-- Dual-Trace Firmware-Accurate Swiss Oscilloscope -->
        <div class="scope-band">
          <div class="scope-bar">
            <div class="trace-keys">
              <span class="trace-key">
                <span class="key-line raw" aria-hidden="true"></span>
                <span>{{ store.t('物理微动') }}</span>
              </span>
              <span class="trace-key">
                <span class="key-line out" aria-hidden="true"></span>
                <span>{{ store.t('上报电平') }}</span>
              </span>
            </div>

            <span :class="['latency-tag', 'tabular', scope.pre > 0 ? 'added' : 'zero']">
              <span :class="['sq-mark', scope.pre > 0 ? 'warn' : 'ok']"></span>
              <span>{{ store.t('按下延迟') }}</span>
              <strong>{{ scope.pre > 0 ? `+${fmtMs(scope.pre)} ms` : '0 ms' }}</strong>
            </span>
          </div>

          <svg class="scope-svg" viewBox="0 0 560 98" role="img" :aria-label="store.t('自定义消抖')">
            <line :x1="scope.xStart" :y1="scope.yHi" :x2="scope.xEnd" :y2="scope.yHi" class="rail" />
            <line :x1="scope.xStart" :y1="scope.yLo" :x2="scope.xEnd" :y2="scope.yLo" class="rail" />

            <g v-for="z in scope.zones" :key="z.key">
              <rect
                v-if="z.w > 0"
                :x="z.x"
                :y="scope.yHi"
                :width="z.w"
                :height="scope.yLo - scope.yHi"
                :class="['zone', `zone-${z.key}`, {hi: activeField === z.key}]"
              />
              <text
                v-if="z.w >= 26"
                :x="z.x + z.w / 2"
                :y="scope.yLo + 14"
                text-anchor="middle"
                :class="['zone-cap', `cap-${z.key}`, {hi: activeField === z.key}]"
              >{{ z.short }}</text>
              <line
                v-if="z.w === 0 && activeField === z.key"
                :x1="z.edgeX"
                :y1="scope.yHi - 8"
                :x2="z.edgeX"
                :y2="scope.yLo + 8"
                :class="['edge-guide', `guide-${z.key}`]"
              />
            </g>

            <path class="trace-raw" :d="scope.rawPath" fill="none" />
            <path class="trace-out" :d="scope.outPath" fill="none" />

            <line :x1="scope.xPressOut" :y1="scope.yHi - 10" :x2="scope.xPressOut" :y2="scope.yLo + 6" class="trigger-edge" />
            <rect :x="scope.xPressOut - 3.2" :y="scope.yLo - 3.2" width="6.4" height="6.4" class="trigger-sq" />
            <rect :x="scope.xRelOut - 3" :y="scope.yHi - 3" width="6" height="6" :class="['release-sq', {active: scope.relock > 0 || scope.post > 0}]" />

            <text :x="scope.xPressRaw" y="18" class="scope-lbl">PRESS</text>
            <text :x="scope.xRelRaw" y="18" class="scope-lbl">RELEASE</text>
          </svg>

          <!-- Uncaged Interactive Chronological Legend -->
          <div class="scope-legend tabular">
            <button
              v-for="z in scope.zones"
              :key="z.key"
              type="button"
              :class="['legend-item', `tone-${z.key}`, {on: z.value > 0, hi: activeField === z.key}]"
              @mouseenter="hoveredField = z.key"
              @mouseleave="hoveredField = null"
              @focus="hoveredField = z.key"
              @blur="hoveredField = null"
            >
              <span :class="['legend-sq', `dot-${z.key}`, {on: z.value > 0}]"></span>
              <span class="legend-code">{{ z.short }}</span>
              <span class="legend-val">{{ fmtMs(z.value) }} ms</span>
            </button>
          </div>
        </div>

        <!-- 2x2 Press (Top) / Release (Bottom) Open Swiss Timing Matrix -->
        <div class="timing-matrix">
          <label
            v-for="field in orderedDebounceFields"
            :key="field.key"
            :class="['timing-cell', `cell-${field.key}`, {hi: activeField === field.key}]"
            @mouseenter="hoveredField = field.key"
            @mouseleave="hoveredField = null"
          >
            <div class="timing-head">
              <span class="timing-name">{{ store.t(field.label) }}</span>
              <span :class="['timing-short', {active: parseMs(store.debounceDraft.value[field.key]) > 0}]">{{ field.short }}</span>
            </div>
            <div class="timing-ctrl">
              <input
                v-model="store.debounceDraft.value[field.key]"
                class="sinput tabular timing-input"
                inputmode="decimal"
                :aria-label="store.t(field.label)"
                :disabled="store.state.busy"
                @focus="focusedField = field.key"
                @blur="focusedField = null"
              />
              <span class="unit">ms</span>
            </div>
          </label>
        </div>
      </template>

      <!-- Global Policies Row -->
      <div class="policy-band">
        <div class="idx-head" style="margin-bottom: 14px;">
          <span class="idx-label"><em>03</em>{{ store.t('触发保护') }}</span>
          <button
            v-if="store.state.features.customLandingGuard && !isLandingDefault"
            class="sbtn-rule"
            type="button"
            :disabled="store.state.busy"
            @click="store.resetLandingDefaults"
          >{{ store.t('恢复默认') }}</button>
        </div>

        <div class="policy-grid">
          <button
            v-if="store.state.features.landingPolicy"
            type="button"
            role="switch"
            :aria-checked="Boolean(store.state.draft.landingProtection)"
            :aria-label="store.t('抬鼠复位防误触')"
            :disabled="store.state.busy"
            :class="['policy-bin', {on: store.state.draft.landingProtection}]"
            @click="store.state.draft.landingProtection = !store.state.draft.landingProtection"
          >
            <div class="pbin-top tabular">
              <span>{{ store.state.draft.landingProtection ? 'ON' : 'OFF' }}</span>
              <span class="bin-sq"></span>
            </div>
            <span class="pbin-name">{{ store.t('抬鼠复位防误触') }}</span>
          </button>

          <div class="policy-strip-block">
            <div class="pstrip-head">
              <span class="pbin-name">{{ store.t('闪电扳机') }}</span>
            </div>
            <div class="swiss-seg-3">
              <button
                v-for="mode in triggerModes"
                :key="mode.value"
                type="button"
                :disabled="store.state.busy"
                :class="['gs-b', {active: store.state.legacy.scan_sequence === mode.value}]"
                @click="store.state.legacy.scan_sequence = mode.value"
              >{{ store.t(mode.label) }}</button>
            </div>
          </div>
        </div>

        <!-- Rev 52+ Lift & Landing Guard Parameters -->
        <div
          v-if="store.state.features.customLandingGuard"
          :class="['lift-custom', {'muted-off': !store.state.draft.landingProtection}]"
        >
          <div class="lift-grid">
            <label class="lift-cell">
              <div class="timing-head">
                <span class="timing-name">{{ store.t('落地锁定') }}</span>
                <span class="tip-wrap">
                  <span :class="['timing-short', {active: parseDecimalInt(store.state.draft.landingHoldMs) > 0}]">HOLD</span>
                  <span class="swiss-tip" role="tooltip">{{ store.t('抬鼠落地后拦截作用按键的新按下动作（0 ms 不锁定）') }}</span>
                </span>
              </div>
              <div class="timing-ctrl">
                <input
                  v-model="store.state.draft.landingHoldMs"
                  class="sinput tabular timing-input"
                  inputmode="numeric"
                  :aria-label="store.t('落地锁定')"
                  :disabled="store.state.busy"
                />
                <span class="unit">ms</span>
              </div>
            </label>

            <div class="lift-cell">
              <div class="timing-head">
                <span class="timing-name">{{ store.t('空中防误触') }}</span>
                <div class="lift-mode" role="group" :aria-label="store.t('空中防误触')">
                  <span class="tip-wrap">
                    <button
                      type="button"
                      :disabled="store.state.busy"
                      :aria-pressed="!store.state.draft.airborneLockout"
                      :class="['lift-mode-b', {active: !store.state.draft.airborneLockout}]"
                      @click="store.state.draft.airborneLockout = false"
                    >{{ store.t('滤波') }}</button>
                    <span class="swiss-tip" role="tooltip">{{ store.t('抬起悬空时对作用按键施加最低按下滤波（0 ms 不追加滤波）') }}</span>
                  </span>
                  <span class="tip-wrap">
                    <button
                      type="button"
                      :disabled="store.state.busy"
                      :aria-pressed="Boolean(store.state.draft.airborneLockout)"
                      :class="['lift-mode-b', {active: store.state.draft.airborneLockout}]"
                      @click="store.state.draft.airborneLockout = true"
                    >{{ store.t('禁用') }}</button>
                    <span class="swiss-tip" role="tooltip">{{ store.t('抬起悬空时拦截作用按键的新按下动作，已按住的拖拽松开不受影响') }}</span>
                  </span>
                </div>
              </div>
              <div v-if="!store.state.draft.airborneLockout" class="timing-ctrl">
                <input
                  v-model="store.state.draft.airborneFloorMs"
                  class="sinput tabular timing-input"
                  inputmode="numeric"
                  :aria-label="store.t('空中防误触')"
                  :disabled="store.state.busy"
                />
                <span class="unit">ms</span>
              </div>
              <div v-else class="lift-lockout-line">
                <span class="sq-mark warn"></span>
                <span>{{ store.t('悬空禁用新触发') }}</span>
              </div>
            </div>
          </div>

          <div class="lift-keys-band">
            <span class="timing-name">{{ store.t('作用按键') }}</span>
            <div class="lift-keys-grid" role="group" :aria-label="store.t('作用按键')">
              <button
                v-for="btn in store.state.buttons"
                :key="btn.id"
                type="button"
                :aria-pressed="isLandingKeyEnabled(btn.id)"
                :disabled="store.state.busy"
                :class="['lift-key-btn', {on: isLandingKeyEnabled(btn.id)}]"
                @click="store.toggleLandingKey(btn.id)"
              >
                <span class="bin-sq"></span>
                <span>{{ store.t(btn.label) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.swiss-buttons {
  flex: 1;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  min-height: calc(100vh - 52px);
}

/* Left 348px Selector Column */
.key-col {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  padding-bottom: 52px;
}

.col-head {
  padding: 20px 28px 14px;
  border-bottom: 1px solid var(--rule);
}

.ortho-picker {
  padding: 20px 26px;
  border-bottom: 1px solid var(--rule);
  display: flex;
  align-items: center;
  justify-content: center;
}

.callout-stage {
  position: relative;
  width: 296px;
  height: 248px;
}

.ortho-mouse {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  height: 214px;
  width: auto;
  object-fit: contain;
  opacity: 0.9;
  user-select: none;
  pointer-events: none;
}

.callout-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.callout-line polyline {
  stroke: var(--rule-strong);
  stroke-width: 1;
}

.callout-line rect {
  fill: var(--ink-3);
}

.callout-line.active polyline {
  stroke: var(--cobalt);
  stroke-width: 1.5;
}

.callout-line.active rect {
  fill: var(--cobalt);
}

.callout-tag {
  position: absolute;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  border: 0;
  border-bottom: 1.5px solid var(--rule-strong);
  background: var(--paper);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
  transition: all 0.1s ease;
}

.callout-tag.left { left: 0; }
.callout-tag.right { right: 0; }

.callout-tag:hover {
  color: var(--ink);
  border-color: var(--rule-anchor);
}

.callout-tag.active {
  background: var(--cobalt);
  border-color: var(--cobalt);
  color: #ffffff;
}

.tag-idx {
  font-size: 9.5px;
  opacity: 0.7;
}

.key-list {
  display: flex;
  flex-direction: column;
}

.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 28px;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  text-align: left;
  transition: background-color 0.1s ease;
}

.key-row:hover {
  background: var(--paper-tint);
}

.key-row.active {
  background: var(--cobalt-soft);
  box-shadow: inset 3px 0 0 var(--cobalt);
}

.key-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.key-idx {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-4);
}

.key-row.active .key-idx {
  color: var(--cobalt);
}

.key-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.key-right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.key-vals {
  font-size: 11.5px;
  color: var(--ink-3);
}

/* Right Swiss Editor Column */
.editor-col {
  display: flex;
  flex-direction: column;
  padding-bottom: 64px;
}

.editor-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 32px 16px;
  border-bottom: 1px solid var(--rule);
}

.key-hero {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--ink);
}

/* Swiss Binary Switch Trigger */
.swiss-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 0;
  border-top: 2px solid var(--rule-strong);
  background: transparent;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}

.swiss-toggle:hover:not(:disabled) {
  background: var(--paper-tint);
}

.swiss-toggle.on {
  border-top: 3px solid var(--cobalt);
  background: var(--cobalt-soft);
}

.st-txt {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}

.swiss-toggle.on .st-txt {
  color: var(--ink);
}

.st-state {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.swiss-toggle.on .st-state {
  color: var(--cobalt);
}

.bin-sq {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--ink-3);
  display: inline-block;
}

.swiss-toggle.on .bin-sq,
.policy-bin.on .bin-sq {
  border-color: var(--cobalt);
  background: var(--cobalt);
}

/* Dual-Trace Swiss Oscilloscope */
.scope-band {
  padding: 16px 32px 14px;
  border-bottom: 1px solid var(--rule);
}

.scope-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.trace-keys {
  display: inline-flex;
  align-items: center;
  gap: 16px;
}

.trace-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-3);
}

.key-line {
  width: 16px;
  height: 0;
  display: inline-block;
}

.key-line.raw {
  border-top: 1.5px dashed var(--ink-4);
}

.key-line.out {
  border-top: 2px solid var(--ink);
}

.latency-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}

.latency-tag strong {
  color: var(--ok);
}

.latency-tag.added strong {
  color: var(--warn);
}

.scope-svg {
  width: 100%;
  height: auto;
  display: block;
}

.rail {
  stroke: var(--rule);
  stroke-dasharray: 3 4;
  stroke-width: 1;
}

.zone-pre { fill: var(--warn-soft); }
.zone-pre.hi { fill: rgba(234, 179, 8, 0.3); }
.zone-plock { fill: var(--cobalt-soft); }
.zone-plock.hi { fill: rgba(51, 102, 255, 0.28); }
.zone-post { fill: var(--paper-tint); }
.zone-post.hi { fill: var(--rule-strong); }
.zone-relock { fill: var(--ok-soft); }
.zone-relock.hi { fill: rgba(16, 185, 129, 0.26); }

.zone-cap {
  font-family: var(--fontFamily);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  fill: var(--ink-3);
}

.cap-pre.hi { fill: var(--warn); }
.cap-plock.hi { fill: var(--cobalt); }
.cap-post.hi { fill: var(--ink); }
.cap-relock.hi { fill: var(--ok); }

.edge-guide {
  stroke-width: 1.5;
  stroke-dasharray: 2 2;
}
.guide-pre { stroke: var(--warn); }
.guide-plock { stroke: var(--cobalt); }
.guide-post { stroke: var(--ink-2); }
.guide-relock { stroke: var(--ok); }

.trace-raw {
  stroke: var(--ink-4);
  stroke-width: 1.1;
  stroke-dasharray: 2.5 2;
}

.trace-out {
  stroke: var(--ink);
  stroke-width: 1.9;
  stroke-linejoin: miter;
}

.trigger-edge {
  stroke: var(--cobalt);
  stroke-width: 1.15;
  stroke-dasharray: 2 2;
}

.trigger-sq {
  fill: var(--cobalt);
}

.release-sq {
  fill: var(--paper);
  stroke: var(--ink-3);
  stroke-width: 1.6;
}

.release-sq.active {
  stroke: var(--ok);
}

.scope-lbl {
  font-family: var(--fontFamily);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  fill: var(--ink-3);
}

.scope-legend {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--rule);
  margin-top: 10px;
  padding-top: 6px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: 5px 8px;
  border: 0;
  background: transparent;
  font-size: 11px;
  color: var(--ink-3);
  transition: background-color 0.1s ease, color 0.1s ease;
}

.legend-item.on { color: var(--ink); }
.legend-item.hi { background: var(--paper-tint); color: var(--ink); }

.legend-sq {
  width: 6px;
  height: 6px;
  background: var(--rule-strong);
  flex-shrink: 0;
}

.legend-sq.on.dot-pre { background: var(--warn); }
.legend-sq.on.dot-plock { background: var(--cobalt); }
.legend-sq.on.dot-post { background: var(--ink-2); }
.legend-sq.on.dot-relock { background: var(--ok); }

.legend-code {
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.06em;
}

.legend-val {
  font-weight: 600;
}

/* Open 2x2 Timing Matrix */
.timing-matrix {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--rule);
}

.timing-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 32px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  transition: background-color 0.1s ease;
}

.timing-cell.hi {
  background: var(--paper-tint);
}

.timing-cell:nth-child(2n) { border-right: 0; }
.timing-cell:nth-last-child(-n+2) { border-bottom: 0; }

.timing-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.timing-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.timing-short {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-4);
}

.cell-pre .timing-short.active { color: var(--warn); }
.cell-plock .timing-short.active { color: var(--cobalt); }
.cell-post .timing-short.active { color: var(--ink); }
.cell-relock .timing-short.active { color: var(--ok); }

.timing-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timing-input {
  width: 100%;
}

.unit {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}

/* Global Policies */
.policy-band {
  padding: 20px 32px;
}

.policy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  align-items: start;
}

.policy-bin {
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

.policy-bin:hover:not(:disabled) {
  background: var(--paper-tint);
}

.policy-bin.on {
  border-top: 3px solid var(--cobalt);
  background: var(--cobalt-soft);
}

.pbin-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.policy-bin.on .pbin-top {
  color: var(--cobalt);
}

.pbin-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.policy-strip-block {
  border-top: 1.5px solid var(--rule-strong);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.swiss-seg-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid var(--rule);
}

.gs-b {
  height: 29px;
  border: 0;
  background: transparent;
  font-size: 11.5px;
  font-weight: 600;
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
}

/* Rev 52+ Lift & Landing Guard Parameters */
.lift-custom {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: opacity 0.14s ease;
}

.lift-custom.muted-off {
  opacity: 0.48;
}

.lift-custom.muted-off:hover,
.lift-custom.muted-off:focus-within {
  opacity: 1;
}

.lift-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  align-items: start;
}

.lift-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lift-cell .timing-short.active {
  color: var(--cobalt);
}

.lift-mode {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.tip-wrap {
  position: relative;
  display: inline-flex;
}

.swiss-tip {
  position: absolute;
  right: 0;
  bottom: calc(100% + 7px);
  z-index: 30;
  width: max-content;
  max-width: 230px;
  padding: 6px 9px;
  background: var(--inv-bg);
  color: var(--inv-ink);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.tip-wrap:hover .swiss-tip,
.tip-wrap:focus-within .swiss-tip {
  opacity: 1;
  transform: translateY(0);
}

.lift-mode-b {
  padding: 0 0 2px;
  border: 0;
  border-bottom: 1.5px solid transparent;
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  transition: color 0.1s ease, border-color 0.1s ease;
}

.lift-mode-b:hover:not(:disabled) {
  color: var(--ink);
}

.lift-mode-b.active {
  color: var(--cobalt);
  border-bottom-color: var(--cobalt);
}

.lift-lockout-line {
  height: 32px;
  padding: 0 8px;
  border-bottom: 1.5px solid var(--rule-strong);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.lift-keys-band {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lift-keys-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.lift-key-btn {
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-top: 1.5px solid var(--rule-strong);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  white-space: nowrap;
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
}

.lift-key-btn:hover:not(:disabled) {
  background: var(--paper-tint);
  color: var(--ink);
}

.lift-key-btn.on {
  border-top: 2.5px solid var(--cobalt);
  background: var(--cobalt-soft);
  color: var(--ink);
}

.lift-key-btn.on .bin-sq {
  border-color: var(--cobalt);
  background: var(--cobalt);
}

@media (max-width: 1100px) {
  .swiss-buttons {
    grid-template-columns: 1fr;
  }
  .key-col {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 0;
  }
  .policy-grid,
  .lift-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .timing-matrix {
    grid-template-columns: 1fr;
  }
  .timing-cell {
    border-right: 0;
  }
  .scope-legend {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .lift-keys-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
