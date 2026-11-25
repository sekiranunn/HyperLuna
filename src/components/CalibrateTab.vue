<script setup>
import {computed, ref, onBeforeUnmount} from 'vue';
import {RATES} from '../../advanced/protocol.js';
import {
  computeGripAngle,
  computeTrueDpi,
  createPollingTracker,
  pushPollingEvents,
  analyzePollingSamples,
  analyzeSwitchEvents
} from '../lib/calibration.js';

const props = defineProps({
  store: {type: Object, required: true}
});

const activeTool = ref('optical');
const lockedEl = ref(null);

function selectTool(id) {
  if (activeTool.value === id) return;
  stopAllCaptures();
  activeTool.value = id;
}

const configuredDpi = computed(() => {
  const idx = (props.store.state.dpiDraft?.activeStage || 1) - 1;
  return Number(props.store.state.dpiDraft?.stages?.[idx]?.x || 1600);
});
const currentAngle = computed(() => Number(props.store.state.angleTuneDraft ?? 0));
const pollingHz = computed(() => RATES[props.store.state.legacy.polling] || 0);

// ================= Robust Chromium / W3C Pointer Lock Helper =================
async function acquirePointerLock(el) {
  if (!el?.requestPointerLock) return false;
  if (document.pointerLockElement === el) {
    lockedEl.value = el;
    return true;
  }
  const tryReq = async opts => {
    let cleanup = () => {};
    const waiter = new Promise(resolve => {
      if (document.pointerLockElement === el) {
        resolve(true);
        return;
      }
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(ok);
      };
      const onChange = () => finish(document.pointerLockElement === el);
      const onErr = () => finish(false);
      const timer = setTimeout(() => finish(document.pointerLockElement === el), 350);
      cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onErr);
      };
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onErr);
    });
    try {
      const res = opts ? el.requestPointerLock(opts) : el.requestPointerLock();
      if (res && typeof res.then === 'function') await res;
    } catch {
      cleanup();
      return false;
    }
    if (document.pointerLockElement === el) {
      cleanup();
      return true;
    }
    return waiter;
  };

  // Prefer raw unadjusted hardware movement; fall back cleanly to standard pointer lock.
  let ok = await tryReq({unadjustedMovement: true});
  if (!ok) ok = await tryReq(null);
  if (ok) lockedEl.value = el;
  return ok;
}

function releasePointerLock(el) {
  if (!el || document.pointerLockElement === el) {
    try { document.exitPointerLock?.(); } catch {}
  }
  if (!el || lockedEl.value === el) lockedEl.value = null;
}

// ================= 1. PAW3950 Optical Surface =================
const opt = computed(() => props.store.state.opticalDiag);
const optBase = computed(() => props.store.state.opticalBaseline);
const optTimeText = computed(() => {
  const ts = props.store.state.opticalDiagAt;
  return ts ? new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
});

const squalLabel = computed(() => {
  const g = opt.value?.squalGrade;
  if (g === 'excellent') return props.store.t('极佳纹理');
  if (g === 'good') return props.store.t('良好纹理');
  if (g === 'fair') return props.store.t('纹理偏弱');
  return props.store.t('纹理过低');
});

const contrastLabel = computed(() => {
  const g = opt.value?.contrastGrade;
  if (g === 'high') return props.store.t('对比明显');
  if (g === 'normal') return props.store.t('对比一般');
  return props.store.t('对比偏低');
});

const exposureLabel = computed(() => {
  const e = opt.value?.exposureState;
  if (e === 'bright') return props.store.t('高反光 / 短快门');
  if (e === 'dark') return props.store.t('低反射 / 长快门');
  return props.store.t('曝光均衡');
});

const modeLabel = computed(() => {
  const m = opt.value;
  if (!m) return '—';
  const names = ['HP', 'LP', 'Office', 'Corded'];
  return `${names[m.perfCode] || 'Mode'} · ${m.awake ? 'Awake' : 'Rest'}`;
});

function fmtDelta(cur, base) {
  if (cur === null || cur === undefined || base === null || base === undefined) return '';
  const d = cur - base;
  if (d === 0) return '±0';
  return `${d > 0 ? '+' : ''}${d}`;
}

// ================= 2. Grip Angle Calibration =================
const anglePadEl = ref(null);
const angleActive = ref(false);
const angleInvert = ref(false);
const angleSamples = ref([]);
const angleLocked = computed(() => angleActive.value && lockedEl.value === anglePadEl.value);

// Non-reactive per-stream buffers flushed on rAF (~60 fps) so 4K/8K input never stalls Vue.
// Tracks pointerrawupdate, pointermove (coalesced), and mousemove independently (zero double-counting)
// and automatically reads whichever stream the browser delivers at full rate (even with no button held).
let angleRawBuf = [];
let angleMoveBuf = [];
let angleMouseBuf = [];
let angleDirty = false;
let angleRafId = 0;

function extractSubEvents(event) {
  if (typeof event.getCoalescedEvents === 'function') {
    const list = event.getCoalescedEvents();
    if (list && list.length) return list;
  }
  return [event];
}

function pickAngleBuffer() {
  let best = angleMoveBuf;
  if (angleRawBuf.length > best.length) best = angleRawBuf;
  if (angleMouseBuf.length > best.length) best = angleMouseBuf;
  return best;
}

function flushAngleSamples() {
  angleDirty = false;
  angleSamples.value = pickAngleBuffer().slice(-4000);
}

function scheduleAngleFlush() {
  if (angleRafId) return;
  angleRafId = requestAnimationFrame(() => {
    angleRafId = 0;
    if (angleDirty) flushAngleSamples();
    if (angleActive.value) scheduleAngleFlush();
  });
}

function pushAngleBuf(buf, event) {
  if (!angleActive.value || document.pointerLockElement !== anglePadEl.value) return;
  const events = extractSubEvents(event);
  let pushed = false;
  for (let i = 0; i < events.length; i++) {
    const dx = Number(events[i].movementX || 0);
    const dy = Number(events[i].movementY || 0);
    if (dx !== 0 || dy !== 0) {
      buf.push({dx, dy});
      pushed = true;
    }
  }
  if (!pushed) {
    const dx = Number(event.movementX || 0);
    const dy = Number(event.movementY || 0);
    if (dx !== 0 || dy !== 0) {
      buf.push({dx, dy});
      pushed = true;
    }
  }
  if (buf.length > 4400) buf.splice(0, buf.length - 4000);
  if (pushed) angleDirty = true;
}

const handleAngleRaw = event => pushAngleBuf(angleRawBuf, event);
const handleAnglePointer = event => pushAngleBuf(angleMoveBuf, event);
const handleAngleMouse = event => pushAngleBuf(angleMouseBuf, event);

const angleResult = computed(() =>
  computeGripAngle(angleSamples.value, {
    currentAngle: currentAngle.value,
    invertCompensation: angleInvert.value
  })
);

const angleTrailPath = computed(() => {
  const pts = angleResult.value.trail;
  if (!pts || pts.length < 2) return '';
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(60, maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 220 / span;
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(300 + (p.x - cx) * scale).toFixed(1)} ${(104 + (p.y - cy) * scale).toFixed(1)}`)
    .join(' ');
});

const angleAxisLine = computed(() => {
  if (!angleResult.value.ready) return null;
  const rad = (angleResult.value.tiltDeg * Math.PI) / 180;
  const len = 210;
  const dx = Math.cos(rad) * len;
  const dy = Math.sin(rad) * len;
  return {x1: 300 - dx, y1: 104 - dy, x2: 300 + dx, y2: 104 + dy};
});

function stopAngleCapture() {
  if (!angleActive.value) return;
  angleActive.value = false;
  if (angleRafId) {
    cancelAnimationFrame(angleRafId);
    angleRafId = 0;
  }
  if (angleDirty) flushAngleSamples();
  const el = anglePadEl.value;
  if (el) {
    el.removeEventListener('pointerrawupdate', handleAngleRaw);
    el.removeEventListener('pointermove', handleAnglePointer);
    el.removeEventListener('mousemove', handleAngleMouse);
  }
  releasePointerLock(el);
}

async function startAngleCapture() {
  stopPollingCapture();
  stopDpiCapture();
  const el = anglePadEl.value;
  const ok = await acquirePointerLock(el);
  if (!ok) {
    props.store.fail(Error('浏览器未锁定光标，请稍候 1 秒后重试'));
    return;
  }
  angleRawBuf = [];
  angleMoveBuf = [];
  angleMouseBuf = [];
  angleSamples.value = [];
  angleDirty = false;
  angleActive.value = true;
  if ('onpointerrawupdate' in window) {
    el.addEventListener('pointerrawupdate', handleAngleRaw, {passive: true});
  }
  el.addEventListener('pointermove', handleAnglePointer, {passive: true});
  el.addEventListener('mousemove', handleAngleMouse, {passive: true});
  scheduleAngleFlush();
}

function stageRecommendedAngle() {
  if (!angleResult.value.ready) return;
  props.store.state.angleTuneDraft = angleResult.value.recommendedAngle;
  props.store.notify('已将建议偏角暂存到角度微调，请在底部确认保存');
}

// ================= 3. Physical-Distance Ruler DPI =================
// Two-step pointer-locked workflow:
// 1) Click canvas/button to lock cursor inside the browser (never escapes viewport).
// 2) While locked, align to 0 mm, hold LMB and drag exact distance, release LMB to compute.
const dpiPadEl = ref(null);
const dpiDistanceMm = ref(100);
const dpiArmed = ref(false);
const dpiDragging = ref(false);
const dpiDx = ref(0);
const dpiDy = ref(0);
const dpiLocked = computed(() => dpiArmed.value && lockedEl.value === dpiPadEl.value);

let dpiAccX = 0;
let dpiAccY = 0;
let dpiDirty = false;
let dpiRafId = 0;

function flushDpi() {
  dpiDirty = false;
  dpiDx.value = dpiAccX;
  dpiDy.value = dpiAccY;
}

function scheduleDpiFlush() {
  if (dpiRafId) return;
  dpiRafId = requestAnimationFrame(() => {
    dpiRafId = 0;
    if (dpiDirty) flushDpi();
    if (dpiArmed.value) scheduleDpiFlush();
  });
}

const dpiResult = computed(() =>
  computeTrueDpi(dpiDx.value, dpiDy.value, dpiDistanceMm.value, configuredDpi.value)
);

function handleDpiMove(event) {
  if (!dpiDragging.value || document.pointerLockElement !== dpiPadEl.value) return;
  const events = extractSubEvents(event);
  let sx = 0, sy = 0;
  for (let i = 0; i < events.length; i++) {
    sx += Number(events[i].movementX || 0);
    sy += Number(events[i].movementY || 0);
  }
  if (sx === 0 && sy === 0) {
    sx = Number(event.movementX || 0);
    sy = Number(event.movementY || 0);
  }
  if (sx !== 0 || sy !== 0) {
    dpiAccX += sx;
    dpiAccY += sy;
    dpiDirty = true;
  }
}

function handleDpiMouseDown(event) {
  if (!dpiArmed.value || document.pointerLockElement !== dpiPadEl.value) return;
  if (event.button !== 0) return;
  event.preventDefault();
  dpiAccX = 0;
  dpiAccY = 0;
  dpiDx.value = 0;
  dpiDy.value = 0;
  dpiDirty = false;
  dpiDragging.value = true;
}

function handleDpiMouseUp(event) {
  if (!dpiDragging.value || event.button !== 0) return;
  dpiDragging.value = false;
  if (dpiDirty) flushDpi();
}

function stopDpiCapture() {
  if (!dpiArmed.value && !dpiDragging.value) return;
  dpiArmed.value = false;
  dpiDragging.value = false;
  if (dpiRafId) {
    cancelAnimationFrame(dpiRafId);
    dpiRafId = 0;
  }
  if (dpiDirty) flushDpi();
  const el = dpiPadEl.value;
  if (el) {
    el.removeEventListener('pointermove', handleDpiMove);
    el.removeEventListener('mousemove', handleDpiMove);
  }
  document.removeEventListener('mousedown', handleDpiMouseDown);
  document.removeEventListener('mouseup', handleDpiMouseUp);
  releasePointerLock(el);
}

async function startDpiLock() {
  stopAngleCapture();
  stopPollingCapture();
  const el = dpiPadEl.value;
  const ok = await acquirePointerLock(el);
  if (!ok) {
    props.store.fail(Error('浏览器未锁定光标，请稍候 1 秒后重试'));
    return;
  }
  dpiArmed.value = true;
  dpiDragging.value = false;
  if ('onpointermove' in window) {
    el.addEventListener('pointermove', handleDpiMove, {passive: true});
  } else {
    el.addEventListener('mousemove', handleDpiMove, {passive: true});
  }
  document.addEventListener('mousedown', handleDpiMouseDown);
  document.addEventListener('mouseup', handleDpiMouseUp);
  scheduleDpiFlush();
}

function stageCompensatedDpi() {
  if (!dpiResult.value.ready) return;
  props.store.setActiveDpiValue(dpiResult.value.compensatedDpi);
  props.store.notify('已将补偿 DPI 暂存到当前档位，请在底部确认保存');
}

// ================= 4. Polling Rate & Jitter =================
const pollPadEl = ref(null);
const pollActive = ref(false);
const pollIntervals = ref([]);
const pollCounts = ref([]);
const pollSource = ref('');
const pollLocked = computed(() => pollActive.value && lockedEl.value === pollPadEl.value);

// Independent non-reactive trackers per browser event stream (no double-counting);
// flushes to Vue at rAF cadence so 4K/8K events never choke the main thread.
let pollRawTracker = createPollingTracker(1600);
let pollMoveTracker = createPollingTracker(1600);
let pollMouseTracker = createPollingTracker(1600);
let pollDirty = false;
let pollRafId = 0;

function pickBestPollTracker() {
  let best = {name: 'COALESCED', tr: pollMoveTracker};
  if (pollRawTracker.totalEvents > best.tr.totalEvents) {
    best = {name: 'RAW', tr: pollRawTracker};
  }
  if (pollMouseTracker.totalEvents > best.tr.totalEvents) {
    best = {name: 'MOUSE', tr: pollMouseTracker};
  }
  return best;
}

function flushPolling() {
  pollDirty = false;
  const {name, tr} = pickBestPollTracker();
  pollSource.value = tr.totalEvents > 0 ? name : '';
  pollIntervals.value = tr.intervals.slice();
  pollCounts.value = tr.counts.slice();
}

function schedulePollFlush() {
  if (pollRafId) return;
  pollRafId = requestAnimationFrame(() => {
    pollRafId = 0;
    if (pollDirty) flushPolling();
    if (pollActive.value) schedulePollFlush();
  });
}

function feedPollTracker(tracker, event) {
  if (!pollActive.value || document.pointerLockElement !== pollPadEl.value) return;
  if (pushPollingEvents(tracker, extractSubEvents(event)) > 0) {
    pollDirty = true;
  }
}

const handlePollRaw = event => feedPollTracker(pollRawTracker, event);
const handlePollPointer = event => feedPollTracker(pollMoveTracker, event);
const handlePollMouse = event => feedPollTracker(pollMouseTracker, event);

const pollStats = computed(() =>
  analyzePollingSamples(pollIntervals.value, pollCounts.value, configuredDpi.value)
);

function stopPollingCapture() {
  if (!pollActive.value) return;
  pollActive.value = false;
  if (pollRafId) {
    cancelAnimationFrame(pollRafId);
    pollRafId = 0;
  }
  if (pollDirty) flushPolling();
  const el = pollPadEl.value;
  if (el) {
    el.removeEventListener('pointerrawupdate', handlePollRaw);
    el.removeEventListener('pointermove', handlePollPointer);
    el.removeEventListener('mousemove', handlePollMouse);
  }
  releasePointerLock(el);
}

async function startPollingCapture() {
  stopAngleCapture();
  stopDpiCapture();
  const el = pollPadEl.value;
  const ok = await acquirePointerLock(el);
  if (!ok) {
    props.store.fail(Error('浏览器未锁定光标，请稍候 1 秒后重试'));
    return;
  }
  pollRawTracker = createPollingTracker(1600);
  pollMoveTracker = createPollingTracker(1600);
  pollMouseTracker = createPollingTracker(1600);
  pollIntervals.value = [];
  pollCounts.value = [];
  pollSource.value = '';
  pollDirty = false;
  pollActive.value = true;
  if ('onpointerrawupdate' in window) {
    el.addEventListener('pointerrawupdate', handlePollRaw, {passive: true});
  }
  el.addEventListener('pointermove', handlePollPointer, {passive: true});
  el.addEventListener('mousemove', handlePollMouse, {passive: true});
  schedulePollFlush();
}

function clearPolling() {
  pollRawTracker = createPollingTracker(1600);
  pollMoveTracker = createPollingTracker(1600);
  pollMouseTracker = createPollingTracker(1600);
  pollIntervals.value = [];
  pollCounts.value = [];
  pollSource.value = '';
  pollDirty = false;
}

function stopAllCaptures() {
  stopAngleCapture();
  stopDpiCapture();
  stopPollingCapture();
}

// ================= 5. Switch Chatter Bench =================
const SWITCH_BUTTONS = [
  {dom: 0, hw: 0, label: '左键'},
  {dom: 2, hw: 1, label: '右键'},
  {dom: 1, hw: 2, label: '中键'},
  {dom: 3, hw: 3, label: '后侧键'},
  {dom: 4, hw: 4, label: '前侧键'}
];

// Realistic contact-bounce thresholds (15 ms = rapid-click safe, 25 ms = standard bounce, 40 ms = worn switch)
const chatterThresholdMs = ref(25);
const switchEvents = ref([]);
const pressedDomButtons = ref(new Set());

const switchAnalysis = computed(() =>
  analyzeSwitchEvents(switchEvents.value, {chatterMs: chatterThresholdMs.value, minHoldMs: 8})
);

const switchTotals = computed(() => {
  let clicks = 0;
  let issues = 0;
  for (const s of Object.values(switchAnalysis.value.byButton)) {
    clicks += s.presses;
    issues += s.chatterCount + s.microHoldCount;
  }
  return {clicks, issues};
});

function onSwitchDown(event) {
  event.preventDefault();
  const b = event.button;
  if (!SWITCH_BUTTONS.some(s => s.dom === b)) return;
  const next = new Set(pressedDomButtons.value);
  next.add(b);
  pressedDomButtons.value = next;
  switchEvents.value = [...switchEvents.value, {button: b, type: 'down', t: performance.now()}].slice(-400);
}

function onSwitchUp(event) {
  event.preventDefault();
  const b = event.button;
  if (!SWITCH_BUTTONS.some(s => s.dom === b)) return;
  const next = new Set(pressedDomButtons.value);
  next.delete(b);
  pressedDomButtons.value = next;
  switchEvents.value = [...switchEvents.value, {button: b, type: 'up', t: performance.now()}].slice(-400);
}

function clearSwitchLog() {
  switchEvents.value = [];
  pressedDomButtons.value = new Set();
}

function buttonLabelByDom(dom) {
  const row = SWITCH_BUTTONS.find(s => s.dom === dom);
  return row ? props.store.t(row.label) : `#${dom}`;
}

function debounceSummaryForHw(hw) {
  const cfg = props.store.state.draft?.buttons?.[hw];
  if (!cfg) return '—';
  if (!cfg.enabled) return props.store.t('未启用');
  return `${cfg.pre} / ${cfg.post} ms`;
}

// Sidebar Tool Index with Live Summaries
const toolItems = computed(() => [
  {
    id: 'optical',
    num: '01',
    label: '表面光学',
    summary: opt.value ? `SQUAL ${opt.value.squal}` : '—',
    tone: opt.value ? (opt.value.squalGrade === 'poor' ? 'danger' : 'cobalt') : ''
  },
  {
    id: 'angle',
    num: '02',
    label: '握持偏角',
    summary: angleResult.value.ready
      ? `${angleResult.value.recommendedAngle > 0 ? '+' : ''}${angleResult.value.recommendedAngle}°`
      : `${currentAngle.value > 0 ? '+' : ''}${currentAngle.value}°`,
    tone: angleResult.value.ready ? 'cobalt' : ''
  },
  {
    id: 'dpi',
    num: '03',
    label: '尺距 DPI',
    summary: dpiResult.value.ready ? String(dpiResult.value.measuredDpi) : String(configuredDpi.value),
    tone: dpiResult.value.ready ? 'cobalt' : ''
  },
  {
    id: 'polling',
    num: '04',
    label: '回报率',
    summary: pollStats.value.ready ? `${pollStats.value.avgHz} Hz` : '—',
    tone: pollStats.value.ready ? 'cobalt' : ''
  },
  {
    id: 'switches',
    num: '05',
    label: '微动回弹',
    summary: switchTotals.value.issues > 0
      ? props.store.t('{count} 异常', {count: switchTotals.value.issues})
      : switchTotals.value.clicks > 0
        ? props.store.t('{count} 次', {count: switchTotals.value.clicks})
        : '—',
    tone: switchTotals.value.issues > 0 ? 'danger' : switchTotals.value.clicks > 0 ? 'ok' : ''
  }
]);

function onPointerLockChange() {
  const el = document.pointerLockElement;
  lockedEl.value = el;
  if (el !== anglePadEl.value && angleActive.value) stopAngleCapture();
  if (el !== dpiPadEl.value && dpiArmed.value) stopDpiCapture();
  if (el !== pollPadEl.value && pollActive.value) stopPollingCapture();
}

function onWindowBlur() {
  stopAllCaptures();
}

document.addEventListener('pointerlockchange', onPointerLockChange);
window.addEventListener('blur', onWindowBlur);
onBeforeUnmount(() => {
  document.removeEventListener('pointerlockchange', onPointerLockChange);
  window.removeEventListener('blur', onWindowBlur);
  stopAllCaptures();
});
</script>

<template>
  <div class="swiss-cal">
    <!-- Left 348px Swiss Instrument Selector Column -->
    <aside class="tool-col">
      <div class="col-head">
        <div class="idx-head">
          <span class="idx-label"><em>01</em>{{ store.t('诊断工具') }}</span>
          <span class="idx-label tabular">PAW3950</span>
        </div>
      </div>

      <div class="spec-table tabular">
        <div>
          <div class="spec-k">DPI</div>
          <div class="spec-v">{{ configuredDpi }}</div>
        </div>
        <div>
          <div class="spec-k">AXIS</div>
          <div class="spec-v">{{ currentAngle > 0 ? '+' : '' }}{{ currentAngle }}°</div>
        </div>
        <div>
          <div class="spec-k">POLLING</div>
          <div class="spec-v">{{ pollingHz }} Hz</div>
        </div>
        <div>
          <div class="spec-k">SLOT</div>
          <div class="spec-v">0{{ store.state.slot }}</div>
        </div>
      </div>

      <div class="tool-list">
        <button
          v-for="item in toolItems"
          :key="item.id"
          type="button"
          :class="['tool-row', {active: activeTool === item.id}]"
          @click="selectTool(item.id)"
        >
          <span class="tool-left">
            <span class="tool-idx tabular">{{ item.num }}</span>
            <span class="tool-name">{{ store.t(item.label) }}</span>
          </span>
          <span class="tool-right">
            <span class="tool-sum tabular">{{ item.summary }}</span>
            <span :class="['sq-mark', item.tone]"></span>
          </span>
        </button>
      </div>
    </aside>

    <!-- Right Single-Focus Precision Bench -->
    <section class="bench-col">
      <!-- ==================== 01. OPTICAL SURFACE ==================== -->
      <template v-if="activeTool === 'optical'">
        <div class="bench-head">
          <div>
            <span class="idx-label"><em>01</em>PAW3950 · 00:00 — 00:40</span>
            <h2 class="bench-hero">{{ store.t('表面光学') }}</h2>
          </div>

          <div class="head-acts">
            <span v-if="optTimeText && opt" class="head-time tabular">{{ optTimeText }}</span>
            <button
              class="sbtn sbtn-cobalt sbtn-sm"
              type="button"
              :disabled="store.state.busy || store.state.opticalDiagBusy"
              @click="store.readOpticalDiagnostics()"
            >{{ store.t('读取快照') }}</button>
            <button
              class="sbtn sbtn-sm"
              type="button"
              :disabled="!opt"
              @click="store.saveOpticalBaseline()"
            >{{ store.t('设为基线') }}</button>
            <button
              v-if="optBase"
              class="sbtn-rule"
              type="button"
              @click="store.clearOpticalBaseline()"
            >{{ store.t('清除基线') }}</button>
          </div>
        </div>

        <div v-if="!opt" class="bench-empty">
          <span class="sq-mark"></span>
          <span>{{ store.t('将鼠标平放于垫面，点击右上角读取 PAW3950 表面光学读数。') }}</span>
        </div>

        <template v-else>
          <div class="opt-hero-band">
            <div class="opt-squal-col">
              <div class="idx-head">
                <span class="idx-label">SQUAL</span>
                <span v-if="optBase" class="delta-tag tabular">{{ fmtDelta(opt.squal, optBase.squal) }}</span>
              </div>
              <div class="hero-num-row tabular">
                <span :class="['hero-num', 'brand', opt.squalGrade === 'poor' ? 'danger' : 'cobalt']">{{ opt.squal }}</span>
                <span class="hero-u">/ 255</span>
              </div>
              <div class="swiss-bar">
                <div class="swiss-bar-fill" :style="{width: `${Math.min(100, (opt.squal / 255) * 100)}%`}"></div>
              </div>
              <div class="hero-sub tabular">
                <span :class="['sq-mark', opt.squalGrade === 'poor' ? 'danger' : 'cobalt']"></span>
                <span>{{ squalLabel }} · {{ opt.featuresCount }} {{ store.t('光学特征点') }}</span>
              </div>
            </div>

            <div class="opt-state-col">
              <span class="idx-label">{{ store.t('表面状态') }}</span>
              <div :class="['state-big', opt.lifted ? 'danger' : 'ok']">
                {{ store.t(opt.lifted ? '已抬起' : '贴合垫面') }}
              </div>
              <div class="hero-sub tabular">{{ opt.isPaw3950 ? 'PAW3950' : 'SENSOR' }} · {{ modeLabel }}</div>
            </div>
          </div>

          <div class="matrix-2x2 tabular">
            <div class="m-cell">
              <div class="m-head">
                <span class="m-name">{{ store.t('对比度') }}</span>
                <span class="m-code">RAW RANGE</span>
              </div>
              <div class="m-val-row">
                <span :class="['m-val', 'brand', opt.contrastGrade === 'low' ? 'danger' : '']">{{ opt.contrast }}</span>
                <span class="m-u">/ 127</span>
                <span v-if="optBase" class="delta-tag">{{ fmtDelta(opt.contrast, optBase.contrast) }}</span>
              </div>
              <div class="m-sub m-sub-split">
                <span>{{ contrastLabel }}</span>
                <span class="m-kv">
                  <span class="m-k code">MIN</span><b class="m-n">{{ opt.rawMin }}</b><span class="m-sep">·</span><span class="m-k code">MAX</span><b class="m-n">{{ opt.rawMax }}</b>
                </span>
              </div>
            </div>

            <div class="m-cell">
              <div class="m-head">
                <span class="m-name">{{ store.t('快门曝光') }}</span>
                <span class="m-code">SHUTTER · AGC</span>
              </div>
              <div class="m-val-row">
                <span :class="['m-val', 'brand', opt.exposureState === 'dark' ? 'danger' : opt.exposureState === 'bright' ? 'cobalt' : '']">
                  {{ opt.shutter }}
                </span>
                <span class="m-u">ticks</span>
                <span v-if="optBase" class="delta-tag">{{ fmtDelta(opt.shutter, optBase.shutter) }}</span>
              </div>
              <div class="m-sub m-sub-split">
                <span>{{ exposureLabel }}</span>
                <span class="m-kv">
                  <span class="m-k">{{ store.t('亮度均值') }}</span><b class="m-n">{{ opt.rawMean }}</b>
                </span>
              </div>
            </div>

            <div class="m-cell">
              <div class="m-head">
                <span class="m-name">{{ store.t('传感器型号') }}</span>
                <span class="m-code">00:00 / 00:01</span>
              </div>
              <div class="m-val-row">
                <span class="m-val brand">0x{{ store.byte(opt.productId) }}</span>
                <span class="m-u">REV 0x{{ store.byte(opt.revisionId) }}</span>
              </div>
              <span class="m-sub">{{ opt.isPaw3950 ? 'PixArt PAW3950' : '—' }}</span>
            </div>

            <div class="m-cell">
              <div class="m-head">
                <span class="m-name">{{ store.t('状态寄存器') }}</span>
                <span class="m-code">00:02 / 00:40</span>
              </div>
              <div class="m-val-row">
                <span class="m-val brand">0x{{ store.byte(opt.motion) }}</span>
                <span class="m-u">MODE 0x{{ store.byte(opt.mode) }}</span>
              </div>
              <span class="m-sub">LIFT {{ opt.lifted ? 1 : 0 }} · AWAKE {{ opt.awake ? 1 : 0 }}</span>
            </div>
          </div>
        </template>
      </template>

      <!-- ==================== 02. GRIP ANGLE ==================== -->
      <template v-else-if="activeTool === 'angle'">
        <div class="bench-head">
          <div>
            <span class="idx-label"><em>02</em>AXIS · −30° — +30°</span>
            <h2 class="bench-hero">{{ store.t('握持偏角') }}</h2>
          </div>

          <div class="head-acts">
            <label class="chk-inline">
              <input v-model="angleInvert" type="checkbox" />
              <span>{{ store.t('反向补偿') }}</span>
            </label>
            <button
              v-if="!angleActive"
              class="sbtn sbtn-cobalt sbtn-sm"
              type="button"
              @click="startAngleCapture"
            >{{ store.t('开始校准') }}</button>
            <button
              v-else
              class="sbtn sbtn-inv sbtn-sm"
              type="button"
              @click="stopAngleCapture"
            >{{ store.t('结束计算') }}</button>
            <button
              class="sbtn sbtn-sm"
              type="button"
              :disabled="!angleResult.ready || store.state.angleTuneDraft === null"
              @click="stageRecommendedAngle"
            >{{ store.t('暂存偏角') }}</button>
          </div>
        </div>

        <div
          ref="anglePadEl"
          :class="['scope-surface', {active: angleLocked}]"
          @click="!angleActive && startAngleCapture()"
          @contextmenu.prevent
        >
          <div class="surface-bar tabular">
            <span class="idx-label">
              {{ store.t(angleLocked ? '左右水平扫动中 · ESC 结束' : '点击画布开始，按自然握姿左右水平扫动 3–5 次') }}
            </span>
            <span :class="['idx-label', {cobalt: angleLocked}]">
              {{ angleLocked ? '■ LOCKED · ' : '' }}N {{ angleResult.sampleCount }}
            </span>
          </div>

          <svg class="angle-svg" viewBox="0 0 600 208" aria-hidden="true">
            <line x1="28" y1="104" x2="572" y2="104" class="ref-axis" />
            <line x1="300" y1="20" x2="300" y2="188" class="ref-axis minor" />
            <circle cx="300" cy="104" r="72" class="ref-ring" />
            <path v-if="angleTrailPath" :d="angleTrailPath" class="swipe-trail" />
            <line
              v-if="angleAxisLine"
              :x1="angleAxisLine.x1"
              :y1="angleAxisLine.y1"
              :x2="angleAxisLine.x2"
              :y2="angleAxisLine.y2"
              class="fit-axis"
            />
            <rect x="297.5" y="101.5" width="5" height="5" class="origin-sq" />
          </svg>
        </div>

        <div class="spec-strip-3 tabular">
          <div class="s-cell">
            <span class="idx-label">{{ store.t('实测倾角') }}</span>
            <div class="s-val brand">
              {{ angleResult.ready ? `${angleResult.tiltDeg > 0 ? '+' : ''}${angleResult.tiltDeg}°` : '—' }}
            </div>
          </div>
          <div class="s-cell">
            <span class="idx-label">{{ store.t('线性度') }} · R²</span>
            <div class="s-val brand">
              {{ angleResult.ready ? `${Math.round(angleResult.linearity * 100)}%` : '—' }}
            </div>
          </div>
          <div class="s-cell">
            <span class="idx-label">{{ store.t('建议微调') }}</span>
            <div class="s-val brand cobalt">
              {{ angleResult.ready ? `${angleResult.recommendedAngle > 0 ? '+' : ''}${angleResult.recommendedAngle}°` : '—' }}
            </div>
          </div>
        </div>
      </template>

      <!-- ==================== 03. RULER DPI ==================== -->
      <template v-else-if="activeTool === 'dpi'">
        <div class="bench-head">
          <div>
            <span class="idx-label"><em>03</em>TRUE CPI · {{ configuredDpi }} DPI</span>
            <h2 class="bench-hero">{{ store.t('尺距 DPI') }}</h2>
          </div>

          <div class="head-acts">
            <div class="seg-inline tabular">
              <button
                v-for="mm in [50, 100, 150, 200]"
                :key="mm"
                type="button"
                :class="['gs-b', {active: dpiDistanceMm === mm}]"
                @click="dpiDistanceMm = mm"
              >{{ mm }} mm</button>
            </div>
            <button
              v-if="!dpiArmed"
              class="sbtn sbtn-cobalt sbtn-sm"
              type="button"
              @click="startDpiLock"
            >{{ store.t('锁定光标') }}</button>
            <button
              v-else
              class="sbtn sbtn-inv sbtn-sm"
              type="button"
              @click="stopDpiCapture"
            >{{ store.t('退出锁定') }}</button>
            <button
              class="sbtn sbtn-sm"
              type="button"
              :disabled="!dpiResult.ready || !store.state.dpiDraft?.stages?.length"
              @click="stageCompensatedDpi"
            >{{ store.t('暂存 DPI') }}</button>
          </div>
        </div>

        <div
          ref="dpiPadEl"
          :class="['scope-surface', 'dpi-surface', {active: dpiLocked, counting: dpiDragging}]"
          @click="!dpiArmed && startDpiLock()"
          @contextmenu.prevent
        >
          <div class="surface-bar tabular">
            <span class="idx-label">
              {{
                dpiDragging
                  ? store.t('累计计数中 · 到达 {mm} mm 后松开左键', {mm: dpiDistanceMm})
                  : dpiLocked
                    ? store.t('已锁定 · 对准 0 刻度后按住左键拖动 {mm} mm，ESC 退出', {mm: dpiDistanceMm})
                    : store.t('点击锁定光标，再按住左键沿直尺拖动 {mm} mm', {mm: dpiDistanceMm})
              }}
            </span>
            <span :class="['idx-label', {cobalt: dpiLocked}]">
              {{ dpiDragging ? '■ COUNTING' : dpiLocked ? '■ LOCKED' : `TARGET ${dpiDistanceMm} MM` }}
            </span>
          </div>

          <div class="dpi-center tabular">
            <span :class="['hero-num', 'brand', {cobalt: dpiDragging}]">{{ dpiResult.counts }}</span>
            <span class="hero-u">COUNTS</span>
          </div>

          <svg class="ruler-svg" viewBox="0 0 600 28" aria-hidden="true">
            <line x1="0" y1="26" x2="600" y2="26" class="axis-line" />
            <line
              v-for="n in 41"
              :key="n"
              :x1="(n - 1) * 15"
              :y1="(n - 1) % 10 === 0 ? 6 : (n - 1) % 5 === 0 ? 12 : 18"
              :x2="(n - 1) * 15"
              y2="26"
              :class="(n - 1) % 10 === 0 ? 'ruler-major' : 'ruler-minor'"
            />
          </svg>
        </div>

        <div class="spec-strip-3 tabular">
          <div class="s-cell">
            <span class="idx-label">{{ store.t('实测 DPI') }}</span>
            <div class="s-val brand">{{ dpiResult.ready ? dpiResult.measuredDpi : '—' }}</div>
          </div>
          <div class="s-cell">
            <span class="idx-label">{{ store.t('相对偏差') }}</span>
            <div :class="['s-val', 'brand', dpiResult.ready && Math.abs(dpiResult.deviationPct) > 4 ? 'danger' : '']">
              {{ dpiResult.ready ? `${dpiResult.deviationPct > 0 ? '+' : ''}${dpiResult.deviationPct}%` : '—' }}
            </div>
          </div>
          <div class="s-cell">
            <span class="idx-label">{{ store.t('补偿建议') }}</span>
            <div class="s-val brand cobalt">{{ dpiResult.ready ? dpiResult.compensatedDpi : '—' }}</div>
          </div>
        </div>
      </template>

      <!-- ==================== 04. POLLING & JITTER ==================== -->
      <template v-else-if="activeTool === 'polling'">
        <div class="bench-head">
          <div>
            <span class="idx-label"><em>04</em>INTERVAL · JITTER</span>
            <h2 class="bench-hero">{{ store.t('回报率') }}</h2>
          </div>

          <div class="head-acts">
            <button
              v-if="!pollActive"
              class="sbtn sbtn-cobalt sbtn-sm"
              type="button"
              @click="startPollingCapture"
            >{{ store.t('开始采样') }}</button>
            <button
              v-else
              class="sbtn sbtn-inv sbtn-sm"
              type="button"
              @click="stopPollingCapture"
            >{{ store.t('停止采样') }}</button>
            <button
              class="sbtn-rule"
              type="button"
              :disabled="!pollIntervals.length"
              @click="clearPolling"
            >{{ store.t('清空') }}</button>
          </div>
        </div>

        <div
          ref="pollPadEl"
          :class="['scope-surface', 'poll-surface', {active: pollLocked}]"
          @click="!pollActive && startPollingCapture()"
          @contextmenu.prevent
        >
          <div class="surface-bar tabular">
            <span class="idx-label">
              {{ store.t(pollLocked ? '采样中 · 匀速画圈移动 · ESC 停止' : '点击画布开始，匀速画圈移动采样 · ESC 停止') }}
            </span>
            <span :class="['idx-label', {cobalt: pollLocked}]">
              {{ pollLocked ? '■ LOCKED · ' : '' }}{{ pollSource ? `${pollSource} · ` : '' }}N {{ pollStats.count }}
            </span>
          </div>

          <div class="poll-lockup tabular">
            <div class="hero-num-row">
              <span class="hero-num brand cobalt">{{ pollStats.ready ? pollStats.avgHz : '—' }}</span>
              <span class="hero-u">Hz</span>
            </div>
            <div class="poll-side">
              <div class="poll-stat">
                <span>PEAK</span>
                <b>{{ pollStats.ready ? `${pollStats.peakHz} Hz` : '—' }}</b>
                <em class="swiss-tip" role="tooltip">{{ store.t('100 ms 窗口峰值回报率') }}</em>
              </div>
              <div class="poll-stat">
                <span>MAD</span>
                <b>{{ pollStats.ready ? `${pollStats.madUs} µs` : '—' }}</b>
                <em class="swiss-tip" role="tooltip">{{ store.t('回报间隔抖动（中位绝对偏差），越低越好') }}</em>
              </div>
            </div>
          </div>

          <div class="hist-strip tabular" aria-hidden="true">
            <template v-if="pollStats.ready">
              <div
                v-for="(b, idx) in pollStats.buckets"
                :key="idx"
                class="hist-col"
                :title="`${b.fromMs}–${b.toMs} ms: ${b.count}`"
              >
                <div class="hist-bar" :style="{height: `${Math.max(3, b.ratio * 84)}px`}"></div>
                <span class="hist-lbl">{{ b.fromMs }}</span>
              </div>
            </template>
            <div v-else class="hist-axis"></div>
          </div>
        </div>

        <div class="spec-strip-4 tabular">
          <div class="s-cell">
            <span class="idx-label">{{ store.t('中位间隔') }}</span>
            <div class="s-val brand">{{ pollStats.ready ? `${pollStats.medianMs} ms` : '—' }}</div>
          </div>
          <div class="s-cell">
            <span class="idx-label">P95</span>
            <div class="s-val brand">{{ pollStats.ready ? `${pollStats.p95Ms} ms` : '—' }}</div>
          </div>
          <div class="s-cell">
            <span class="idx-label">P99</span>
            <div class="s-val brand">{{ pollStats.ready ? `${pollStats.p99Ms} ms` : '—' }}</div>
          </div>
          <div class="s-cell">
            <span class="idx-label">{{ store.t('峰值速度') }}</span>
            <div class="s-val brand">{{ pollStats.ready ? `${pollStats.peakIps} IPS` : '—' }}</div>
          </div>
        </div>
      </template>

      <!-- ==================== 05. SWITCH CHATTER ==================== -->
      <template v-else>
        <div class="bench-head">
          <div>
            <span class="idx-label"><em>05</em>5-KEY SWITCH BENCH</span>
            <h2 class="bench-hero">{{ store.t('微动回弹') }}</h2>
          </div>

          <div class="head-acts">
            <div class="seg-inline tabular">
              <button
                v-for="ms in [15, 25, 40]"
                :key="ms"
                type="button"
                :class="['gs-b', {active: chatterThresholdMs === ms}]"
                @click="chatterThresholdMs = ms"
              >{{ ms }} ms</button>
            </div>
            <button
              class="sbtn-rule"
              type="button"
              :disabled="!switchEvents.length"
              @click="clearSwitchLog"
            >{{ store.t('清空') }}</button>
          </div>
        </div>

        <div
          class="switch-bench"
          @mousedown="onSwitchDown"
          @mouseup="onSwitchUp"
          @contextmenu.prevent
          @auxclick.prevent
        >
          <div class="bench-bar">
            <span class="idx-label">{{ store.t('在此区域点击任意按键检测回弹（右键与侧键默认操作已屏蔽）') }}</span>
          </div>

          <table class="sw-table tabular">
            <thead>
              <tr>
                <th>{{ store.t('按键') }}</th>
                <th>{{ store.t('消抖策略') }}</th>
                <th>{{ store.t('点击') }}</th>
                <th>{{ store.t('最短间隔') }}</th>
                <th>{{ store.t('最短按住') }}</th>
                <th class="col-right">{{ store.t('状态') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="sw in SWITCH_BUTTONS"
                :key="sw.dom"
                :class="{
                  pressed: pressedDomButtons.has(sw.dom),
                  warn: (switchAnalysis.byButton[sw.dom]?.chatterCount || 0) > 0
                }"
              >
                <td class="sw-name">{{ store.t(sw.label) }}</td>
                <td class="muted">{{ debounceSummaryForHw(sw.hw) }}</td>
                <td class="sw-num">{{ switchAnalysis.byButton[sw.dom]?.presses || 0 }}</td>
                <td>{{ switchAnalysis.byButton[sw.dom]?.minGapMs !== null && switchAnalysis.byButton[sw.dom]?.minGapMs !== undefined ? `${switchAnalysis.byButton[sw.dom].minGapMs} ms` : '—' }}</td>
                <td>{{ switchAnalysis.byButton[sw.dom]?.minHoldMs !== null && switchAnalysis.byButton[sw.dom]?.minHoldMs !== undefined ? `${switchAnalysis.byButton[sw.dom].minHoldMs} ms` : '—' }}</td>
                <td class="col-right">
                  <span class="status-inline">
                    <span
                      :class="[
                        'sq-mark',
                        (switchAnalysis.byButton[sw.dom]?.chatterCount || 0) > 0
                          ? 'danger'
                          : (switchAnalysis.byButton[sw.dom]?.presses || 0) > 0
                            ? 'ok'
                            : ''
                      ]"
                    ></span>
                    <span :class="(switchAnalysis.byButton[sw.dom]?.chatterCount || 0) > 0 ? 'danger' : ''">
                      {{
                        (switchAnalysis.byButton[sw.dom]?.chatterCount || 0) > 0
                          ? store.t('回弹 {count}', {count: switchAnalysis.byButton[sw.dom].chatterCount})
                          : (switchAnalysis.byButton[sw.dom]?.presses || 0) > 0
                            ? store.t('正常')
                            : store.t('等待点击')
                      }}
                    </span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-if="switchAnalysis.recent.length" class="event-tape tabular">
            <span
              v-for="(item, idx) in switchAnalysis.recent.slice(0, 7)"
              :key="idx"
              :class="['tape-item', {suspect: item.suspect}]"
            >
              <span :class="['sq-mark', item.suspect ? 'danger' : '']"></span>
              <b>{{ buttonLabelByDom(item.button) }}</b>
              <span v-if="item.reason === 'double'">{{ store.t('疑似双击') }} {{ item.gapMs }} ms</span>
              <span v-else-if="item.reason === 'micro'">{{ store.t('极短按住') }} {{ item.holdMs }} ms</span>
              <span v-else>{{ item.gapMs !== null ? `${item.gapMs} ms` : store.t('首次按下') }}</span>
            </span>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.swiss-cal {
  flex: 1;
  display: grid;
  grid-template-columns: 348px minmax(0, 1fr);
  min-height: calc(100vh - 52px);
}

/* Left 348px Instrument Index Column (Exact Parity with ButtonsTab) */
.tool-col {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rule);
  padding-bottom: 52px;
}

.col-head {
  padding: 20px 28px 14px;
  border-bottom: 1px solid var(--rule);
}

.spec-table {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px 16px;
  padding: 14px 28px;
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
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}

.tool-list {
  display: flex;
  flex-direction: column;
}

.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 28px;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  text-align: left;
  transition: background-color 0.1s ease;
}

.tool-row:hover { background: var(--paper-tint); }

.tool-row.active {
  background: var(--cobalt-soft);
  box-shadow: inset 3px 0 0 var(--cobalt);
}

.tool-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.tool-idx {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-4);
}

.tool-row.active .tool-idx { color: var(--cobalt); }

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.tool-right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.tool-sum {
  font-size: 11.5px;
  color: var(--ink-3);
}

/* Right Single-Focus Bench */
.bench-col {
  display: flex;
  flex-direction: column;
  padding-bottom: 52px;
  min-width: 0;
}

.bench-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 20px 32px 16px;
  border-bottom: 1px solid var(--rule);
}

.bench-hero {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--ink);
}

.head-acts {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.head-time {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-right: 4px;
}

.chk-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-2);
  cursor: pointer;
}

.seg-inline {
  display: inline-grid;
  grid-auto-flow: column;
  border-top: 1px solid var(--rule-strong);
  border-bottom: 1px solid var(--rule-strong);
}

.gs-b {
  height: 28px;
  padding: 0 11px;
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

.bench-empty {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 32px;
  font-size: 13px;
  color: var(--ink-2);
}

/* Tool 01: Optical Hero + 2x2 Co-edged Matrix */
.opt-hero-band {
  display: grid;
  grid-template-columns: 1.35fr 0.65fr;
  border-bottom: 1px solid var(--rule);
}

.opt-squal-col {
  padding: 24px 32px;
  border-right: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.opt-state-col {
  padding: 24px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}

.hero-num-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.hero-num {
  font-size: 52px;
  line-height: 0.88;
  letter-spacing: 0.015em;
  color: var(--ink);
}

.hero-u {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ink-3);
}

.state-big {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--ink);
}

.swiss-bar {
  height: 4px;
  width: 100%;
  background: var(--rule);
}

.swiss-bar-fill {
  height: 100%;
  background: var(--cobalt);
  transition: width 0.2s ease;
}

.hero-sub {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-2);
}

.delta-tag {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink-3);
  margin-left: auto;
}

.matrix-2x2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--rule);
}

.m-cell {
  padding: 20px 32px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.m-cell:nth-child(2n) { border-right: 0; }
.m-cell:nth-last-child(-n+2) { border-bottom: 0; }

.m-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.m-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}

.m-code {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-4);
}

.m-val-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.m-val {
  font-size: 26px;
  line-height: 1;
  color: var(--ink);
}

.m-u {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
}

.m-sub {
  font-size: 11.5px;
  color: var(--ink-3);
}

.m-sub-split {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.m-kv {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.m-k {
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-4);
}

.m-k.code {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.m-n {
  font-weight: 600;
  color: var(--ink-2);
}

.m-sep {
  margin: 0 3px;
  color: var(--ink-4);
}

/* Open Measurement Surface (Tools 02, 03, 04) */
.scope-surface {
  flex: 1;
  min-height: 290px;
  padding: 18px 32px 24px;
  border-bottom: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 16px;
  cursor: crosshair;
  user-select: none;
  transition: background-color 0.12s ease;
}

.scope-surface:hover {
  background: var(--paper-tint);
}

.scope-surface.active {
  background: var(--paper-tint);
  box-shadow: inset 0 3px 0 var(--cobalt);
}

.scope-surface.counting {
  background: var(--cobalt-soft);
}

.surface-bar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.angle-svg {
  width: 100%;
  max-height: 240px;
  display: block;
}

.ref-axis {
  stroke: var(--rule-strong);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.ref-axis.minor { stroke: var(--rule); }

.ref-ring {
  fill: none;
  stroke: var(--rule);
  stroke-width: 1;
}

.swipe-trail {
  fill: none;
  stroke: var(--ink-3);
  stroke-width: 1.4;
  opacity: 0.75;
}

.fit-axis {
  stroke: var(--cobalt);
  stroke-width: 2;
}

.origin-sq { fill: var(--cobalt); }

.dpi-center {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  padding: 28px 0;
}

.ruler-svg {
  width: 100%;
  height: 28px;
  display: block;
}

.axis-line {
  stroke: var(--rule-strong);
  stroke-width: 1;
}

.ruler-major { stroke: var(--ink-2); stroke-width: 1.2; }
.ruler-minor { stroke: var(--rule-strong); stroke-width: 1; }

.poll-lockup {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.poll-side {
  display: flex;
  gap: 24px;
}

.poll-side .poll-stat {
  position: relative;
  text-align: right;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
}

.poll-side span {
  display: block;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.poll-side .swiss-tip {
  position: absolute;
  right: 0;
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
  text-align: left;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.poll-side .poll-stat:hover .swiss-tip {
  opacity: 1;
  transform: translateY(0);
}

.hist-strip {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  align-items: end;
  gap: 8px;
  height: 108px;
  border-top: 1px solid var(--rule);
  padding-top: 10px;
}

.hist-axis {
  grid-column: 1 / -1;
  height: 1px;
  background: var(--rule-strong);
}

.hist-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.hist-bar {
  width: 100%;
  background: var(--cobalt);
  opacity: 0.85;
}

.hist-lbl {
  font-size: 9.5px;
  color: var(--ink-3);
}

/* Bottom Co-edged Spec Strips */
.spec-strip-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-bottom: 1px solid var(--rule);
}

.spec-strip-4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-bottom: 1px solid var(--rule);
}

.s-cell {
  padding: 18px 32px;
  border-right: 1px solid var(--rule);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.s-cell:last-child { border-right: 0; }

.s-val {
  font-size: 24px;
  line-height: 1;
  color: var(--ink);
}

/* Tool 05: Switch Table (Exact Parity with RegistersTab) */
.switch-bench {
  flex: 1;
  display: flex;
  flex-direction: column;
  user-select: none;
}

.bench-bar {
  padding: 12px 32px;
  border-bottom: 1px solid var(--rule);
  background: var(--paper-tint);
}

.sw-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.sw-table th {
  text-align: left;
  padding: 10px 32px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  border-bottom: 1.5px solid var(--rule-strong);
  white-space: nowrap;
}

.sw-table td {
  padding: 14px 32px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink);
  transition: background-color 0.08s ease;
}

.sw-table tbody tr.pressed td {
  background: var(--cobalt-soft);
}

.sw-table tbody tr.pressed td:first-child {
  box-shadow: inset 3px 0 0 var(--cobalt);
}

.sw-table tbody tr.warn td:first-child {
  box-shadow: inset 3px 0 0 var(--danger);
}

.sw-name { font-weight: 700; }
.sw-num { font-weight: 700; font-size: 14px; }
.muted { color: var(--ink-3); }
.col-right { text-align: right; white-space: nowrap; }

.status-inline {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
}

.event-tape {
  margin-top: auto;
  padding: 14px 32px;
  border-top: 1px solid var(--rule);
  display: flex;
  flex-wrap: wrap;
  gap: 14px 20px;
  font-size: 11.5px;
  color: var(--ink-2);
}

.tape-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tape-item.suspect { color: var(--danger); }

.cobalt { color: var(--cobalt); }
.ok { color: var(--ok); }
.danger { color: var(--danger); }

@media (max-width: 1100px) {
  .swiss-cal { grid-template-columns: 1fr; }
  .tool-col {
    border-right: 0;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 0;
  }
  .opt-hero-band,
  .matrix-2x2 {
    grid-template-columns: 1fr;
  }
  .opt-squal-col,
  .m-cell { border-right: 0; }
  .opt-squal-col { border-bottom: 1px solid var(--rule); }
  .spec-strip-3,
  .spec-strip-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
