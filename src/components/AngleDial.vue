<script setup>
import {computed, ref} from 'vue';

const props = defineProps({
  modelValue: {type: Number, default: 0},
  min: {type: Number, default: -30},
  max: {type: Number, default: 30},
  disabled: {type: Boolean, default: false},
  ariaLabel: {type: String, default: 'Angle tuning'}
});

const emit = defineEmits(['update:modelValue']);

const svgEl = ref(null);
const dragging = ref(false);

const CX = 80;
const CY = 78;
const R = 52;
const SPAN_HALF = 120;

const clamped = computed(() => {
  const n = Math.round(Number(props.modelValue) || 0);
  return Math.max(props.min, Math.min(props.max, n));
});

function valueToRingDeg(val) {
  const maxAbs = Math.max(Math.abs(props.min), Math.abs(props.max));
  return (val / maxAbs) * SPAN_HALF;
}

function polar(degFromTop, radius) {
  const rad = ((degFromTop - 90) * Math.PI) / 180;
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad)
  };
}

const handleDeg = computed(() => valueToRingDeg(clamped.value));
const handlePos = computed(() => polar(handleDeg.value, R));

const activeArcPath = computed(() => {
  const d = handleDeg.value;
  if (Math.abs(d) < 0.5) return '';
  const start = polar(0, R);
  const end = polar(d, R);
  const sweep = d > 0 ? 1 : 0;
  const largeArc = Math.abs(d) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
});

const ticks = computed(() => {
  const out = [];
  for (let v = props.min; v <= props.max; v += 3) {
    const major = v % 15 === 0;
    const deg = valueToRingDeg(v);
    const p1 = polar(deg, major ? 56 : 57);
    const p2 = polar(deg, major ? 65 : 61);
    out.push({
      v,
      major,
      zero: v === 0,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y
    });
  }
  return out;
});

function setAngle(next) {
  if (props.disabled) return;
  const v = Math.max(props.min, Math.min(props.max, Math.round(next)));
  if (v !== clamped.value) emit('update:modelValue', v);
}

function step(delta) {
  setAngle(clamped.value + delta);
}

function angleFromPointer(event) {
  const el = svgEl.value;
  if (!el) return clamped.value;
  const rect = el.getBoundingClientRect();
  const sx = ((event.clientX - rect.left) / rect.width) * 160;
  const sy = ((event.clientY - rect.top) / rect.height) * 150;
  const dx = sx - CX;
  const dy = sy - CY;
  if (Math.hypot(dx, dy) < 10) return clamped.value;
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  deg = Math.max(-SPAN_HALF, Math.min(SPAN_HALF, deg));
  const maxAbs = Math.max(Math.abs(props.min), Math.abs(props.max));
  return Math.round((deg / SPAN_HALF) * maxAbs);
}

function onPointerDown(event) {
  if (props.disabled) return;
  dragging.value = true;
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  setAngle(angleFromPointer(event));
}

function onPointerMove(event) {
  if (!dragging.value || props.disabled) return;
  setAngle(angleFromPointer(event));
}

function onPointerUp(event) {
  if (!dragging.value) return;
  dragging.value = false;
  event.currentTarget?.releasePointerCapture?.(event.pointerId);
}

function onKeyDown(event) {
  if (props.disabled) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault();
    step(-1);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault();
    step(1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    setAngle(props.min);
  } else if (event.key === 'End') {
    event.preventDefault();
    setAngle(props.max);
  } else if (event.key === '0') {
    event.preventDefault();
    setAngle(0);
  }
}
</script>

<template>
  <div class="compass-stage">
    <button
      class="sq-jog"
      type="button"
      :disabled="disabled || clamped <= min"
      aria-label="-1°"
      @click="step(-1)"
    >−</button>

    <div class="comp-wrap">
      <svg
        ref="svgEl"
        class="comp-svg"
        :class="{dragging, disabled}"
        viewBox="0 0 160 150"
        role="slider"
        tabindex="0"
        :aria-label="ariaLabel"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="clamped"
        :aria-valuetext="`${clamped > 0 ? '+' : ''}${clamped}°`"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="setAngle(0)"
        @keydown="onKeyDown"
      >
        <line
          v-for="t in ticks"
          :key="t.v"
          :x1="t.x1"
          :y1="t.y1"
          :x2="t.x2"
          :y2="t.y2"
          :class="['comp-tick', {major: t.major, zero: t.zero}]"
        />

        <circle :cx="CX" :cy="CY" :r="R" class="comp-ring" />
        <path v-if="activeArcPath" :d="activeArcPath" class="comp-arc" />

        <g :transform="`translate(${handlePos.x.toFixed(1)} ${handlePos.y.toFixed(1)})`">
          <rect x="-12" y="-12" width="24" height="24" fill="transparent" />
          <rect x="-4.5" y="-4.5" width="9" height="9" class="comp-knob" />
        </g>
      </svg>

      <span class="comp-val brand tabular" aria-hidden="true">{{ clamped > 0 ? '+' : '' }}{{ clamped }}°</span>
    </div>

    <button
      class="sq-jog"
      type="button"
      :disabled="disabled || clamped >= max"
      aria-label="+1°"
      @click="step(1)"
    >+</button>
  </div>
</template>

<style scoped>
.compass-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.sq-jog {
  width: 26px;
  height: 26px;
  border: 0;
  border-bottom: 1.5px solid var(--rule-strong);
  background: transparent;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease;
}

.sq-jog:hover:not(:disabled) {
  background: var(--inv-bg);
  color: var(--inv-ink);
  border-color: var(--inv-bg);
}

.comp-wrap {
  position: relative;
  width: 158px;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.comp-svg {
  width: 158px;
  height: 150px;
  display: block;
  user-select: none;
  touch-action: none;
  cursor: ew-resize;
  outline: none;
}

.comp-svg.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.comp-ring {
  fill: none;
  stroke: var(--rule-strong);
  stroke-width: 1;
}

.comp-arc {
  fill: none;
  stroke: var(--cobalt);
  stroke-width: 2.8;
}

.comp-tick {
  stroke: var(--rule);
  stroke-width: 1;
}

.comp-tick.major {
  stroke: var(--rule-strong);
  stroke-width: 1.2;
}

.comp-tick.zero {
  stroke: var(--cobalt);
  stroke-width: 2;
}

.comp-knob {
  fill: var(--cobalt);
}

.comp-val {
  position: absolute;
  padding-top: 6px;
  font-size: 22px;
  color: var(--ink);
  pointer-events: none;
}
</style>
