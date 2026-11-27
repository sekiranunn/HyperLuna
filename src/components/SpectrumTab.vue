<script setup>
import {computed, ref, watch, onBeforeUnmount} from 'vue';

const props = defineProps({
  store: {type: Object, required: true}
});

const autoPoll = ref(false);
const hoveredMhz = ref(null);
let pollTimer = null;

const afh = computed(() => props.store.state.receiverAfh);
const lq = computed(() => props.store.state.receiverLq);
const isWireless = computed(() => props.store.state.transportTarget === 2);
const isV4 = computed(() => Boolean(isWireless.value && afh.value?.flags?.v4Capable));
const scanValid = computed(() => Boolean(afh.value?.flags?.scanValid));
const isStale = computed(() => Boolean(props.store.state.receiverAfhStale));
const genAligned = computed(() => !isV4.value || !lq.value || !afh.value || lq.value.scanCount === afh.value.scanCount);
const isLinked = computed(() => {
  if (!isV4.value) return Boolean(afh.value);
  return lq.value ? Boolean(lq.value.linkActive) : Boolean(afh.value?.linkActive);
});

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
  if (isV4.value) {
    props.store.readReceiverLinkQuality({silent: true});
    pollTimer = setInterval(() => {
      if (!props.store.state.connected || props.store.state.transportTarget !== 2 || !isV4.value) {
        stopAuto();
        return;
      }
      props.store.readReceiverLinkQuality({silent: true});
    }, 1000);
  } else {
    props.store.readReceiverAfh({silent: true});
    pollTimer = setInterval(() => {
      if (!props.store.state.connected || props.store.state.transportTarget !== 2) {
        stopAuto();
        return;
      }
      props.store.readReceiverAfh({silent: true});
    }, 2000);
  }
}

watch(
  () => [props.store.state.connected, props.store.state.transportTarget],
  ([conn, target]) => {
    if (!conn || target !== 2) stopAuto();
  }
);

onBeforeUnmount(stopAuto);

const scoreByMhz = computed(() => {
  const map = new Map();
  if (!scanValid.value) return map;
  for (const row of afh.value?.spectrum || []) map.set(row.mhz, row.dbm);
  return map;
});

const floorAndPeak = computed(() => {
  if (!scanValid.value) return {floor: null, peak: null};
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

const activeLinkDbm = computed(() => {
  if (!isV4.value || !lq.value) return null;
  if (lq.value.emaDbm !== null) return lq.value.emaDbm;
  if (lq.value.lastDbm !== null) return lq.value.lastDbm;
  return null;
});

const activeSnrDb = computed(() => {
  if (!isLinked.value || !scanValid.value || !genAligned.value || activeLinkDbm.value === null || !afh.value) return null;
  const noise = scoreByMhz.value.get(afh.value.activeCh);
  if (noise === undefined) return null;
  return Math.round(activeLinkDbm.value - noise);
});

const crcSummary = computed(() => {
  if (!isV4.value || !lq.value) return {text: '—', warn: false};
  const err = lq.value.crcErrCount || 0;
  const deltaPct = props.store.state.receiverLqCrcRatePct;
  if (autoPoll.value && deltaPct !== null && deltaPct !== undefined) {
    if (!err && deltaPct === 0) return {text: '0', warn: false};
    return {
      text: `${err} (${deltaPct > 0 && deltaPct < 0.01 ? '<0.01' : deltaPct.toFixed(2)}%)`,
      warn: deltaPct >= 1
    };
  }
  const total = err + (lq.value.rxOkCount || 0);
  if (!err || !total) return {text: String(err), warn: false};
  const pct = (err / total) * 100;
  return {
    text: `${err} (${pct < 0.01 ? '<0.01' : pct.toFixed(2)}%)`,
    warn: pct >= 1
  };
});

function formatCompactCount(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

const rfRateText = computed(() => {
  if (!isV4.value || !lq.value) return '—';
  const hz = props.store.state.receiverLqRateHz;
  if (hz !== null && hz !== undefined && autoPoll.value) {
    return `${hz.toLocaleString()} Hz`;
  }
  return formatCompactCount(lq.value.rxOkCount);
});

const lastReadText = computed(() => {
  const ts = isV4.value
    ? Math.max(props.store.state.receiverLqAt || 0, props.store.state.receiverAfhAt || 0)
    : props.store.state.receiverAfhAt;
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
  if (!a?.spectrum?.length || !scanValid.value) return [];
  const slotOf = new Map();
  a.chTable.forEach((mhz, idx) => slotOf.set(mhz, idx));
  const stepW = PLOT_W / a.spectrum.length;
  const barW = Math.max(7, stepW - 6);
  const slotDbm = isV4.value && genAligned.value ? (lq.value?.slotDbm || []) : [];
  return a.spectrum.map((row, i) => {
    const slot = slotOf.has(row.mhz) ? slotOf.get(row.mhz) : null;
    const isActive = isV4.value
      ? Boolean(isLinked.value && genAligned.value && slot !== null && slot === a.chIdx && row.mhz === a.activeCh)
      : row.mhz === a.activeCh;
    const isLoud = row.dbm >= -70;
    const role = isActive ? 'active' : slot !== null ? 'pool' : isLoud ? 'loud' : 'bg';
    const y = yForDbm(row.dbm);
    const h = Math.max(3, PAD_T + PLOT_H - y);
    const cx = PAD_L + (i + 0.5) * stepW;
    let linkDbm = null;
    if (isV4.value && genAligned.value) {
      if (isActive && activeLinkDbm.value !== null) linkDbm = activeLinkDbm.value;
      else if (slot !== null && slotDbm[slot] !== null && slotDbm[slot] !== undefined) linkDbm = slotDbm[slot];
    }
    const linkY = linkDbm !== null ? yForDbm(linkDbm) : null;
    const snrDb = linkDbm !== null ? Math.round(linkDbm - row.dbm) : null;
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
      linkDbm,
      linkY,
      snrDb,
      wifi: wifiOverlapLabel(row.mhz)
    };
  });
});

const linkMarkers = computed(() => bars.value.filter(b => b.linkDbm !== null));

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

const anyBusy = computed(() => (
  props.store.state.busy || props.store.state.receiverAfhBusy || props.store.state.receiverRescanBusy
));
</script>

<template>
  <div class="swiss-rf">
    <!-- Left 348px Swiss Instrument Monograph Column -->
    <aside :class="['rf-mono', {v4: isV4}]">
      <div class="mono-top">
        <div class="mono-kicker tabular">
          <span>nRF52820 · 2.4G</span>
          <span v-if="!isWireless" class="status-tag muted">■ USB</span>
          <span v-else-if="isV4" :class="['status-tag', lq?.linkActive ? 'live' : 'muted']">
            ■ V4 · {{ lq?.linkActive ? 'LINK' : 'IDLE' }}
          </span>
          <span v-else-if="afh" class="status-tag live">■ AFH v{{ afh.version }}</span>
          <span v-else class="status-tag muted">■ V1 / V2</span>
        </div>

        <div class="rf-figure tabular">
          <span class="rf-hero brand">{{ afh && isWireless ? afh.activeCh : '—' }}</span>
          <span class="rf-unit">MHz</span>
          <span v-if="isV4 && !isLinked" class="rf-idle-tag">{{ store.t('搜索监听') }}</span>
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
          <span class="swiss-tip" role="tooltip">
            {{ store.t(isV4 ? '接收器上电以来的扫频计数' : '接收器上电以来的自动扫频计数') }}
          </span>
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
        <template v-if="isV4">
          <div class="spec-item tip-left">
            <div class="spec-k">LINK</div>
            <div :class="['spec-v', {cobalt: activeLinkDbm !== null && activeLinkDbm > -70, danger: activeLinkDbm !== null && activeLinkDbm <= -78}]">
              {{ activeLinkDbm !== null ? `${activeLinkDbm.toFixed(1)} dBm` : '—' }}
            </div>
            <span class="swiss-tip" role="tooltip">{{ store.t('鼠标信号接收强度（均值）') }}</span>
          </div>
          <div class="spec-item tip-right">
            <div class="spec-k">SNR</div>
            <div :class="['spec-v', {danger: activeSnrDb !== null && activeSnrDb < 15}]">
              {{ activeSnrDb !== null ? `+${activeSnrDb} dB` : '—' }}
            </div>
            <span class="swiss-tip" role="tooltip">{{ store.t('当前信道信噪比（鼠标信号减去环境底噪，越大越好）') }}</span>
          </div>
          <div class="spec-item tip-left">
            <div class="spec-k">CRC ERR</div>
            <div :class="['spec-v', {danger: crcSummary.warn}]">{{ crcSummary.text }}</div>
            <span class="swiss-tip" role="tooltip">
              {{ store.t(autoPoll
                ? '接收器上电以来的硬件 CRC-16 失败帧数与实时误码率'
                : '接收器上电以来的硬件 CRC-16 失败帧数与累计误码率') }}
            </span>
          </div>
          <div class="spec-item tip-right">
            <div class="spec-k">{{ autoPoll ? 'RF RATE' : 'RX PKTS' }}</div>
            <div class="spec-v">{{ rfRateText }}</div>
            <span class="swiss-tip" role="tooltip">
              {{ store.t(autoPoll ? '当前无线有效帧接收速率' : '接收器上电以来的有效无线帧数') }}
            </span>
          </div>
        </template>
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
            :class="['ch-row', {active: isLinked && idx === afh.chIdx, hover: hoveredMhz === mhz}]"
            @mouseenter="hoveredMhz = mhz"
            @mouseleave="hoveredMhz = null"
          >
            <span class="ch-left">
              <span class="ch-idx">0{{ idx + 1 }}</span>
              <span class="ch-mhz">{{ mhz }} MHz</span>
            </span>
            <span class="ch-right">
              <span class="ch-dbm">{{ scoreByMhz.has(mhz) ? `${scoreByMhz.get(mhz)} dBm` : '—' }}</span>
              <span :class="['sq-mark', isLinked && genAligned && idx === afh.chIdx ? 'cobalt' : '']"></span>
            </span>
          </button>
        </div>
        <div v-else class="ch-empty">—</div>
      </div>

      <!-- Bottom Snapshot, Rescan & Reset Controls -->
      <div class="rf-footer">
        <div class="meta-line tabular">
          <span>{{ isStale ? 'CACHED' : isV4 && autoPoll ? 'LIVE' : 'SNAPSHOT' }}</span>
          <span>{{ isWireless && afh ? lastReadText : '—' }}</span>
        </div>
        <div class="rf-act-row">
          <button
            class="sbtn sbtn-cobalt sbtn-sm"
            type="button"
            :disabled="!isWireless || anyBusy"
            @click="store.readReceiverAfh()"
          >{{ store.t('读取快照') }}</button>
          <button
            :class="['sbtn', 'sbtn-sm', {'sbtn-inv': autoPoll}]"
            type="button"
            :disabled="!isWireless || !afh || store.state.receiverRescanBusy"
            @click="toggleAuto"
          >{{ store.t(autoPoll ? '停止读取' : '自动读取') }}</button>
        </div>
        <div v-if="isV4" class="rf-act-row rf-act-sub">
          <button
            class="sbtn sbtn-sm"
            type="button"
            :disabled="anyBusy"
            @click="store.rescanReceiverAfh()"
          >{{ store.t(store.state.receiverRescanBusy ? '扫频中…' : '立即扫频') }}</button>
          <button
            class="sbtn sbtn-sm"
            type="button"
            :disabled="anyBusy"
            @click="store.resetReceiverCounters()"
          >{{ store.t('清零计数') }}</button>
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
          <template v-if="inspectedBar.linkDbm !== null">
            <span class="ins-sep">/</span>
            <span class="ins-slot cobalt">LINK {{ inspectedBar.linkDbm.toFixed(1) }} dBm</span>
            <span class="ins-sep">/</span>
            <span class="ins-wifi">SNR +{{ inspectedBar.snrDb }} dB</span>
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

      <div v-else-if="!scanValid" class="stage-empty">
        <span class="sq-mark"></span>
        <span>{{ store.t('尚无有效频谱数据（上次硬件扫频超时，请点击「立即扫频」重试）。') }}</span>
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

            <!-- 38 Channel Ambient Noise RSSI Bars -->
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
                  v-if="bar.slot !== null && bar.linkDbm === null"
                  :x="bar.cx"
                  :y="Math.max(PAD_T + 9, bar.y - 6)"
                  text-anchor="middle"
                  :class="['slot-tag', bar.role]"
                >{{ bar.slot + 1 }}</text>
              </g>
            </g>

            <!-- Receiver V4 Live Mouse Signal & SNR Headroom Overlay -->
            <g v-if="isV4 && linkMarkers.length" class="link-markers" pointer-events="none">
              <template v-for="m in linkMarkers" :key="`lk-${m.mhz}`">
                <line
                  :x1="m.cx"
                  :y1="m.y"
                  :x2="m.cx"
                  :y2="m.linkY"
                  :class="['snr-stem', m.isActive ? 'active' : 'pool']"
                />
                <polygon
                  :points="`${m.cx},${m.linkY - 4.5} ${m.cx + 4.5},${m.linkY} ${m.cx},${m.linkY + 4.5} ${m.cx - 4.5},${m.linkY}`"
                  :class="['link-diamond', m.isActive ? 'active' : 'pool']"
                />
                <text
                  v-if="m.isActive"
                  :x="m.cx"
                  :y="Math.max(PAD_T + 10, m.linkY - 8)"
                  text-anchor="middle"
                  class="link-lbl"
                >{{ Math.round(m.linkDbm) }}</text>
              </template>
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
            <span v-if="isV4" class="leg-item"><i class="leg-diamond"></i>{{ store.t('鼠标信号强度') }}</span>
          </div>
          <span class="foot-note">
            {{ store.t(isV4 ? '频谱在开机或重连时自动更新' : '接收器缓存数据，开机或空闲时自动更新') }}
          </span>
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

.rf-mono.v4 .mono-top {
  padding: 18px 28px 13px;
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

.rf-idle-tag {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.spec-table {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px 16px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--rule);
}

.rf-mono.v4 .spec-table {
  gap: 9px 16px;
  padding: 12px 28px;
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

.spec-v.cobalt { color: var(--cobalt); }
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

.rf-mono.v4 .ch-head {
  padding: 11px 28px 8px;
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

.rf-mono.v4 .ch-row {
  padding: 8.5px 28px;
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

.rf-mono.v4 .rf-footer {
  padding: 12px 28px 16px;
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
  margin-top: 4px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.rf-act-sub {
  margin-top: 0;
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
  flex-wrap: wrap;
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

.snr-stem {
  stroke-width: 1.2;
  stroke-dasharray: 2 2;
}
.snr-stem.active { stroke: var(--cobalt); opacity: 0.75; }
.snr-stem.pool { stroke: var(--ink-3); opacity: 0.55; }

.link-diamond {
  stroke: var(--paper);
  stroke-width: 1.25;
}
.link-diamond.active { fill: var(--cobalt); }
.link-diamond.pool { fill: var(--ink); }

.link-lbl {
  font-size: 9.5px;
  font-weight: 700;
  fill: var(--cobalt);
}

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

.leg-diamond {
  width: 7px;
  height: 7px;
  display: inline-block;
  background: var(--cobalt);
  transform: rotate(45deg);
}

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
