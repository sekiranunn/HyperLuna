<script setup>
import {computed, ref, watch, onBeforeUnmount} from 'vue';

const props = defineProps({
  store: {type: Object, required: true}
});

const autoPoll = ref(false);
const hoveredMhz = ref(null);
let pollTimer = null;

function stopAuto() {
  autoPoll.value = false;
  clearInterval(pollTimer);
  pollTimer = null;
}

function toggleAuto() {
  if (autoPoll.value) {
    stopAuto();
    return;
  }
  autoPoll.value = true;
  props.store.readReceiverAfh({silent: true});
  pollTimer = setInterval(() => {
    if (!props.store.state.connected || props.store.state.transportTarget !== 2) {
      stopAuto();
      return;
    }
    props.store.readReceiverAfh({silent: true});
  }, 2000);
}

watch(
  () => [props.store.state.connected, props.store.state.transportTarget],
  ([conn, target]) => {
    if (!conn || target !== 2) stopAuto();
  }
);

onBeforeUnmount(stopAuto);

const afh = computed(() => props.store.state.receiverAfh);
const isWireless = computed(() => props.store.state.transportTarget === 2);

const scoreByMhz = computed(() => {
  const map = new Map();
  for (const row of afh.value?.spectrum || []) map.set(row.mhz, row.dbm);
  return map;
});

const floorAndPeak = computed(() => {
  const list = afh.value?.spectrum || [];
  if (!list.length) return {floor: null, peak: null};
  let floor = list[0].dbm;
  let peak = list[0].dbm;
  for (const row of list) {
    if (row.dbm < floor) floor = row.dbm;
    if (row.dbm > peak) peak = row.dbm;
  }
  return {floor, peak};
});

const lastReadText = computed(() => {
  const ts = props.store.state.receiverAfhAt;
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
});

// SVG chart geometry: 38 channels across 2404..2478 MHz, Y-axis -100..-30 dBm
const VB_W = 860;
const VB_H = 336;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 38;
const PAD_B = 34;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;
const DBM_MIN = -100;
const DBM_MAX = -30;

function yForDbm(dbm) {
  const clamped = Math.max(DBM_MIN, Math.min(DBM_MAX, dbm));
  const frac = (clamped - DBM_MIN) / (DBM_MAX - DBM_MIN);
  return PAD_T + PLOT_H * (1 - frac);
}

function xForMhz(mhz) {
  const frac = (mhz - 2403) / (2479 - 2403);
  return PAD_L + Math.max(0, Math.min(1, frac)) * PLOT_W;
}

const yTicks = [-90, -70, -50].map(dbm => ({dbm, y: yForDbm(dbm)}));
const xTicks = [2404, 2412, 2424, 2436, 2450, 2462, 2474, 2478].map(mhz => ({mhz, x: xForMhz(mhz)}));

const wifiBands = [
  {id: 'CH1', start: 2403, end: 2423, y: 14},
  {id: 'CH6', start: 2426, end: 2448, y: 14},
  {id: 'CH11', start: 2451, end: 2473, y: 14},
  {id: 'CH13', start: 2461, end: 2479, y: 26}
].map(b => ({
  ...b,
  x1: xForMhz(b.start),
  x2: xForMhz(b.end),
  mid: (xForMhz(b.start) + xForMhz(b.end)) / 2
}));

function wifiOverlapLabel(mhz) {
  const tags = [];
  if (mhz >= 2401 && mhz <= 2423) tags.push('Wi-Fi CH1');
  if (mhz >= 2426 && mhz <= 2448) tags.push('Wi-Fi CH6');
  if (mhz >= 2451 && mhz <= 2473) tags.push('Wi-Fi CH11');
  if (mhz >= 2461 && mhz <= 2483) tags.push('CH13');
  return tags.length ? tags.join(' / ') : props.store.t('Wi-Fi 保护频带');
}

const bars = computed(() => {
  const a = afh.value;
  if (!a?.spectrum?.length) return [];
  const slotOf = new Map();
  a.chTable.forEach((mhz, idx) => slotOf.set(mhz, idx));
  const stepW = PLOT_W / a.spectrum.length;
  const barW = Math.max(7, stepW - 6);
  return a.spectrum.map((row, i) => {
    const slot = slotOf.has(row.mhz) ? slotOf.get(row.mhz) : null;
    const isActive = row.mhz === a.activeCh;
    const isLoud = row.dbm >= -70;
    const role = isActive ? 'active' : slot !== null ? 'pool' : isLoud ? 'loud' : 'bg';
    const y = yForDbm(row.dbm);
    const h = Math.max(3, PAD_T + PLOT_H - y);
    const cx = PAD_L + (i + 0.5) * stepW;
    return {
      ...row,
      slot,
      isActive,
      role,
      x: cx - barW / 2,
      cx,
      y,
      w: barW,
      h,
      wifi: wifiOverlapLabel(row.mhz)
    };
  });
});

const inspectedBar = computed(() => {
  if (!bars.value.length) return null;
  if (hoveredMhz.value !== null) {
    return bars.value.find(b => b.mhz === hoveredMhz.value) || null;
  }
  return bars.value.find(b => b.isActive) || bars.value[0];
});

const searchMarkers = computed(() => {
  const list = afh.value?.searchCh || [];
  return list.map(mhz => ({mhz, x: xForMhz(mhz)}));
});
</script>

<template>
  <div class="swiss-rf">
    <!-- Left 348px Swiss Instrument Monograph Column -->
    <aside class="rf-mono">
      <div class="mono-top">
        <div class="mono-kicker tabular">
          <span>nRF52820 · 2.4G</span>
          <span v-if="!isWireless" class="status-tag muted">■ USB</span>
          <span v-else-if="afh" class="status-tag live">■ AFH v{{ afh.version }}</span>
          <span v-else class="status-tag muted">■ V1 / V2</span>
        </div>

        <div class="rf-figure tabular">
          <span class="rf-hero brand">{{ afh && isWireless ? afh.activeCh : '—' }}</span>
          <span class="rf-unit">MHz</span>
        </div>
      </div>

      <div class="spec-table tabular">
        <div class="spec-item tip-left">
          <div class="spec-k">HOPS</div>
          <div class="spec-v">{{ afh && isWireless ? afh.hopCount : '—' }}</div>
          <span class="swiss-tip" role="tooltip">{{ store.t('接收器上电以来的跳频计数') }}</span>
        </div>
        <div class="spec-item tip-right">
          <div class="spec-k">SCANS</div>
          <div class="spec-v">{{ afh && isWireless ? afh.scanCount : '—' }}</div>
          <span class="swiss-tip" role="tooltip">{{ store.t('接收器上电以来的自动扫频计数') }}</span>
        </div>
        <div class="spec-item tip-left">
          <div class="spec-k">FLOOR</div>
          <div class="spec-v">{{ afh && isWireless && floorAndPeak.floor !== null ? `${floorAndPeak.floor} dBm` : '—' }}</div>
          <span class="swiss-tip" role="tooltip">{{ store.t('上次扫频的环境底噪强度，越低越好') }}</span>
        </div>
        <div class="spec-item tip-right">
          <div class="spec-k">PEAK</div>
          <div :class="['spec-v', {danger: afh && isWireless && floorAndPeak.peak >= -70}]">
            {{ afh && isWireless && floorAndPeak.peak !== null ? `${floorAndPeak.peak} dBm` : '—' }}
          </div>
          <span class="swiss-tip" role="tooltip">{{ store.t('上次扫频的干扰峰值强度（≥ -70 dBm 为强干扰）') }}</span>
        </div>
      </div>

      <!-- 5-Channel Co-Edged Hop Table -->
      <div class="ch-section">
        <div class="ch-head">
          <span class="idx-label"><em>01</em>{{ store.t('跳频表') }}</span>
          <span v-if="afh && isWireless" class="idx-label tabular">
            {{ afh.searchCh[0] }} / {{ afh.searchCh[1] }}
          </span>
        </div>

        <div v-if="afh && isWireless" class="ch-list tabular">
          <button
            v-for="(mhz, idx) in afh.chTable"
            :key="idx"
            type="button"
            :class="['ch-row', {active: idx === afh.chIdx, hover: hoveredMhz === mhz}]"
            @mouseenter="hoveredMhz = mhz"
            @mouseleave="hoveredMhz = null"
          >
            <span class="ch-left">
              <span class="ch-idx">0{{ idx + 1 }}</span>
              <span class="ch-mhz">{{ mhz }} MHz</span>
            </span>
            <span class="ch-right">
              <span class="ch-dbm">{{ scoreByMhz.get(mhz) ?? '—' }} dBm</span>
              <span :class="['sq-mark', idx === afh.chIdx ? 'cobalt' : '']"></span>
            </span>
          </button>
        </div>
        <div v-else class="ch-empty">—</div>
      </div>

      <!-- Bottom Snapshot & Sync Controls -->
      <div class="rf-footer">
        <div class="meta-line tabular">
          <span>SNAPSHOT</span>
          <span>{{ isWireless && afh ? lastReadText : '—' }}</span>
        </div>
        <div class="rf-act-row">
          <button
            class="sbtn sbtn-cobalt sbtn-sm"
            type="button"
            :disabled="!isWireless || store.state.busy || store.state.receiverAfhBusy"
            @click="store.readReceiverAfh()"
          >{{ store.t('读取快照') }}</button>
          <button
            :class="['sbtn', 'sbtn-sm', {'sbtn-inv': autoPoll}]"
            type="button"
            :disabled="!isWireless || !afh"
            @click="toggleAuto"
          >{{ store.t(autoPoll ? '停止读取' : '自动读取') }}</button>
        </div>
      </div>
    </aside>

    <!-- Right Open Swiss Spectrum Analyzer -->
    <section class="rf-stage">
      <div class="stage-head">
        <div>
          <span class="idx-label"><em>02</em>{{ store.t('频谱分析') }}</span>
          <h2 class="stage-title brand tabular">2404 — 2478 MHz</h2>
        </div>

        <div v-if="isWireless && afh && inspectedBar" class="inspector-readout tabular">
          <span class="ins-mhz">{{ inspectedBar.mhz }} MHz</span>
          <span class="ins-sep">/</span>
          <span :class="['ins-dbm', {danger: inspectedBar.dbm >= -70}]">{{ inspectedBar.dbm }} dBm</span>
          <span class="ins-sep">/</span>
          <span class="ins-wifi">{{ inspectedBar.wifi }}</span>
          <template v-if="inspectedBar.slot !== null">
            <span class="ins-sep">/</span>
            <span :class="['ins-slot', {cobalt: inspectedBar.isActive}]">CH{{ inspectedBar.slot }}</span>
          </template>
        </div>
      </div>

      <div v-if="!isWireless" class="stage-empty">
        <span class="sq-mark"></span>
        <span>{{ store.t('当前为有线 USB，请连接 2.4G 接收器。') }}</span>
      </div>

      <div v-else-if="!afh" class="stage-empty">
        <span class="sq-mark"></span>
        <span>{{ store.t('当前接收器未启用 2.4G 频谱遥测（需 Receiver V3）。') }}</span>
      </div>

      <template v-else>
        <div class="chart-wrap">
          <svg
            class="rf-svg"
            :viewBox="`0 0 ${VB_W} ${VB_H}`"
            role="img"
            :aria-label="store.t('2.4G 射频频谱')"
            @mouseleave="hoveredMhz = null"
          >
            <!-- Wi-Fi Band Technical Drafting Brackets -->
            <g class="wifi-brackets">
              <template v-for="band in wifiBands" :key="band.id">
                <path
                  :d="`M ${band.x1} ${band.y + 4} L ${band.x1} ${band.y} L ${band.x2} ${band.y} L ${band.x2} ${band.y + 4}`"
                  fill="none"
                  class="wifi-line"
                />
                <text :x="band.mid" :y="band.y - 3" text-anchor="middle" class="wifi-lbl">
                  {{ band.id }}
                </text>
              </template>
            </g>

            <!-- Horizontal dBm Hairline Grid -->
            <g class="grid-lines">
              <line
                :x1="PAD_L"
                :y1="PAD_T + PLOT_H"
                :x2="VB_W - PAD_R"
                :y2="PAD_T + PLOT_H"
                class="axis-line"
              />
              <template v-for="tick in yTicks" :key="tick.dbm">
                <line
                  :x1="PAD_L"
                  :y1="tick.y"
                  :x2="VB_W - PAD_R"
                  :y2="tick.y"
                  :class="['grid-line', {threshold: tick.dbm === -70}]"
                />
                <text :x="PAD_L - 8" :y="tick.y + 3.5" text-anchor="end" class="axis-txt">
                  {{ tick.dbm }}
                </text>
              </template>
            </g>

            <!-- Active Channel Vertical Hairline Guide -->
            <line
              v-if="inspectedBar"
              :x1="inspectedBar.cx"
              :y1="PAD_T"
              :x2="inspectedBar.cx"
              :y2="PAD_T + PLOT_H"
              class="inspect-guide"
            />

            <!-- 38 Channel RSSI Bars -->
            <g class="bars">
              <g
                v-for="bar in bars"
                :key="bar.mhz"
                class="bar-hit"
                @mouseenter="hoveredMhz = bar.mhz"
              >
                <rect
                  :x="bar.x - 3"
                  :y="PAD_T"
                  :width="bar.w + 6"
                  :height="PLOT_H"
                  fill="transparent"
                />
                <rect
                  :x="bar.x"
                  :y="bar.y"
                  :width="bar.w"
                  :height="bar.h"
                  :class="['rf-bar', bar.role, {hover: hoveredMhz === bar.mhz}]"
                />
                <text
                  v-if="bar.slot !== null"
                  :x="bar.cx"
                  :y="Math.max(PAD_T + 9, bar.y - 6)"
                  text-anchor="middle"
                  :class="['slot-tag', bar.role]"
                >{{ bar.slot + 1 }}</text>
              </g>
            </g>

            <!-- Search Channel Baseline Ticks -->
            <g class="search-ticks">
              <polygon
                v-for="sm in searchMarkers"
                :key="sm.mhz"
                :points="`${sm.x},${PAD_T + PLOT_H + 1} ${sm.x - 3.5},${PAD_T + PLOT_H + 7} ${sm.x + 3.5},${PAD_T + PLOT_H + 7}`"
                class="search-tri"
              />
            </g>

            <!-- X-Axis MHz Ticks -->
            <g class="x-ticks">
              <text
                v-for="tick in xTicks"
                :key="tick.mhz"
                :x="tick.x"
                :y="VB_H - 8"
                text-anchor="middle"
                class="axis-txt"
              >{{ tick.mhz }}</text>
            </g>
          </svg>
        </div>

        <div class="stage-foot">
          <div class="legend-row">
            <span class="leg-item"><i class="leg-sq active"></i>{{ store.t('当前驻留信道') }}</span>
            <span class="leg-item"><i class="leg-sq pool"></i>{{ store.t('跳频表') }}</span>
            <span class="leg-item"><i class="leg-sq loud"></i>≥ -70 dBm</span>
          </div>
          <span class="foot-note">{{ store.t('接收器缓存数据，开机或空闲时自动更新') }}</span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.swiss-rf {
  flex: 1;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  min-height: calc(100vh - 52px);
}

/* Left 348px Monograph Column (Exact Parity with PerformanceTab / ButtonsTab) */
.rf-mono {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  padding-bottom: 52px;
}

.mono-top {
  padding: 22px 28px 16px;
  border-bottom: 1px solid var(--rule);
}

.mono-kicker {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
  margin-bottom: 10px;
}

.status-tag.live { color: var(--cobalt); }
.status-tag.muted { color: var(--ink-3); }

.rf-figure {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.rf-hero {
  font-size: 38px;
  line-height: 0.9;
  letter-spacing: 0.02em;
  color: var(--ink);
}

.rf-unit {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.spec-table {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px 16px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--rule);
}

.spec-item {
  position: relative;
  cursor: default;
}

.spec-k {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.swiss-tip {
  position: absolute;
  bottom: calc(100% + 6px);
  z-index: 30;
  width: max-content;
  max-width: 220px;
  padding: 6px 9px;
  background: var(--inv-bg);
  color: var(--inv-ink);
  font-style: normal;
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

.tip-left .swiss-tip { left: 0; }
.tip-right .swiss-tip { right: 0; }

.spec-item:hover .swiss-tip {
  opacity: 1;
  transform: translateY(0);
}

.spec-v {
  margin-top: 2px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}

.spec-v.danger { color: var(--danger); }

.ch-section {
  display: flex;
  flex-direction: column;
}

.ch-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 14px 28px 10px;
  border-bottom: 1px solid var(--rule);
}

.ch-list {
  display: flex;
  flex-direction: column;
}

.ch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 28px;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  text-align: left;
  transition: background-color 0.1s ease;
}

.ch-row:hover,
.ch-row.hover {
  background: var(--paper-tint);
}

.ch-row.active {
  background: var(--cobalt-soft);
  box-shadow: inset 3px 0 0 var(--cobalt);
}

.ch-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.ch-idx {
  font-size: 10px;
  font-weight: 700;
  color: var(--ink-4);
}

.ch-row.active .ch-idx { color: var(--cobalt); }

.ch-mhz {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}

.ch-right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.ch-dbm {
  font-size: 11.5px;
  color: var(--ink-3);
}

.ch-empty {
  padding: 20px 28px;
  font-size: 12px;
  color: var(--ink-4);
}

.rf-footer {
  margin-top: auto;
  border-top: 1px solid var(--rule);
  padding: 14px 28px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-line {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.meta-line > span:nth-child(2) { color: var(--ink-2); }

.rf-act-row {
  margin-top: 6px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* Right Open Swiss Analyzer */
.rf-stage {
  display: flex;
  flex-direction: column;
  padding-bottom: 52px;
  min-width: 0;
}

.stage-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 20px 32px 16px;
  border-bottom: 1px solid var(--rule);
}

.stage-title {
  margin: 6px 0 0;
  font-size: 22px;
  line-height: 1.05;
  letter-spacing: 0.02em;
  color: var(--ink);
}

.inspector-readout {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-2);
}

.ins-mhz {
  font-weight: 700;
  color: var(--ink);
}

.ins-dbm.danger { color: var(--danger); font-weight: 700; }
.ins-sep { color: var(--ink-4); }
.ins-slot { font-weight: 700; color: var(--ink); }
.ins-slot.cobalt { color: var(--cobalt); }

.stage-empty {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 32px;
  font-size: 13px;
  color: var(--ink-2);
}

.chart-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 24px 32px 12px;
  min-height: 300px;
}

.rf-svg {
  width: 100%;
  height: auto;
  display: block;
}

.wifi-line {
  stroke: var(--rule-strong);
  stroke-width: 1;
}

.wifi-lbl {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  fill: var(--ink-3);
}

.axis-line {
  stroke: var(--rule-strong);
  stroke-width: 1;
}

.grid-line {
  stroke: var(--rule);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.grid-line.threshold {
  stroke: var(--rule-strong);
}

.inspect-guide {
  stroke: var(--rule-strong);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.axis-txt {
  font-size: 10px;
  fill: var(--ink-3);
}

.rf-bar { transition: opacity 0.1s ease; }
.rf-bar.bg { fill: var(--ink-4); opacity: 0.55; }
.rf-bar.loud { fill: var(--danger); opacity: 0.78; }
.rf-bar.pool { fill: var(--ink); opacity: 0.8; }
.rf-bar.active { fill: var(--cobalt); opacity: 1; }
.rf-bar.hover { opacity: 1; }

.slot-tag {
  font-size: 9px;
  font-weight: 700;
}
.slot-tag.active { fill: var(--cobalt); }
.slot-tag.pool { fill: var(--ink-2); }

.search-tri {
  fill: var(--ink-3);
}

.stage-foot {
  border-top: 1px solid var(--rule);
  padding: 12px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--ink-2);
}

.leg-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.leg-sq {
  width: 7px;
  height: 7px;
  display: inline-block;
}
.leg-sq.active { background: var(--cobalt); }
.leg-sq.pool { background: var(--ink); opacity: 0.8; }
.leg-sq.loud { background: var(--danger); opacity: 0.78; }

.foot-note {
  font-size: 11px;
  color: var(--ink-3);
}

@media (max-width: 1100px) {
  .swiss-rf { grid-template-columns: 1fr; }
  .rf-mono {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 0;
  }
}
</style>
