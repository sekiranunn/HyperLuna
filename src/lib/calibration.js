// Pure math & decoding helpers for PAW3950 surface diagnostics, grip angle calibration,
// physical-distance DPI verification, polling-rate jitter analysis, and switch chatter tests.

import {ANGLE_TUNE_MIN, ANGLE_TUNE_MAX, DPI_MIN, DPI_MAX, DPI_STEP} from '../../advanced/protocol.js';

export const OPTICAL_DIAG_REGS = Object.freeze([
  {key: 'productId', page: 0, reg: 0x00},
  {key: 'revisionId', page: 0, reg: 0x01},
  {key: 'motion', page: 0, reg: 0x02},
  {key: 'squal', page: 0, reg: 0x07},
  {key: 'rawMean', page: 0, reg: 0x08},
  {key: 'rawMax', page: 0, reg: 0x09},
  {key: 'rawMin', page: 0, reg: 0x0a},
  {key: 'shutterLow', page: 0, reg: 0x0b},
  {key: 'shutterHigh', page: 0, reg: 0x0c},
  {key: 'mode', page: 0, reg: 0x40}
]);

export function decodeOpticalDiagnostics(values) {
  const get = key => Number(values?.[key] ?? 0) & 0xff;
  const productId = get('productId');
  const revisionId = get('revisionId');
  const motion = get('motion');
  const squal = get('squal');
  const rawMean = get('rawMean');
  const rawMax = get('rawMax');
  const rawMin = get('rawMin');
  const shutterLow = get('shutterLow');
  const shutterHigh = get('shutterHigh');
  const mode = get('mode');

  const shutter = (shutterHigh << 8) | shutterLow;
  const contrast = Math.max(0, rawMax - rawMin);
  const lifted = Boolean(motion & 0x10);
  const awake = Boolean(mode & 0x80);
  const perfCode = mode & 0x03;

  let squalGrade = 'poor';
  if (squal >= 110) squalGrade = 'excellent';
  else if (squal >= 75) squalGrade = 'good';
  else if (squal >= 45) squalGrade = 'fair';

  // PAW3950 Maximum/Minimum_Raw_Data (00:09, 00:0A) are 7-bit (0..127).
  let contrastGrade = 'low';
  if (contrast >= 55) contrastGrade = 'high';
  else if (contrast >= 28) contrastGrade = 'normal';

  // PAW3950 hardware AGC keeps rawMean near ~90..130 by adapting shutter ticks:
  // reflective/glass pads collapse shutter (<=300), dark/lifted surfaces widen shutter (>=1500).
  let exposureState = 'balanced';
  if (shutter <= 300 || (rawMax >= 127 && rawMean >= 150)) exposureState = 'bright';
  else if (shutter >= 1500 || rawMean < 45) exposureState = 'dark';

  return {
    productId,
    isPaw3950: productId === 0x53,
    revisionId,
    motion,
    lifted,
    squal,
    featuresCount: squal * 4,
    squalGrade,
    rawMean,
    rawMax,
    rawMin,
    contrast,
    contrastGrade,
    shutter,
    exposureState,
    mode,
    awake,
    perfCode
  };
}

/**
 * Compute natural grip tilt from horizontal left<->right mouse swipes.
 * Each point is `{dx, dy}` raw movement delta in screen coordinates (+X right, +Y down).
 * Leftward samples (`dx < 0`) are flipped so both left and right passes reinforce the same axis.
 */
export function computeGripAngle(samples, {currentAngle = 0, minTravel = 120, invertCompensation = false} = {}) {
  let sumX = 0;
  let sumY = 0;
  let sumAbsX = 0;
  let sumAbsY = 0;
  let validCount = 0;

  // For R^2 / linearity using aligned increments
  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  // Build normalized SVG trail points around origin (0, 0)
  const trail = [{x: 0, y: 0}];
  let cx = 0;
  let cy = 0;

  for (const pt of samples || []) {
    const dx = Number(pt?.dx || 0);
    const dy = Number(pt?.dy || 0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    if (dx === 0 && dy === 0) continue;

    cx += dx;
    cy += dy;
    if (trail.length < 360) trail.push({x: cx, y: cy});

    // Ignore near-vertical micro-noise when estimating horizontal swipe axis
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax < 1 || ay > ax * 2.5) continue;

    const sign = dx >= 0 ? 1 : -1;
    const ux = dx * sign;
    const uy = dy * sign;
    sumX += ux;
    sumY += uy;
    sumAbsX += ax;
    sumAbsY += ay;
    sxx += ux * ux;
    syy += uy * uy;
    sxy += ux * uy;
    validCount++;
  }

  const totalTravel = Math.hypot(sumX, sumY);
  const ready = validCount >= 6 && totalTravel >= minTravel && sumX > 0;
  const tiltDeg = ready ? (Math.atan2(sumY, sumX) * 180) / Math.PI : 0;

  // Linearity: ratio of projection along principal vector vs total energy (0..1)
  let linearity = 0;
  if (ready) {
    const len2 = sumX * sumX + sumY * sumY;
    const denom = sxx + syy;
    if (denom > 0 && len2 > 0) {
      const cosT = sumX / Math.sqrt(len2);
      const sinT = sumY / Math.sqrt(len2);
      const parallel = sxx * cosT * cosT + 2 * sxy * cosT * sinT + syy * sinT * sinT;
      linearity = Math.max(0, Math.min(1, parallel / denom));
    }
  }

  // Screen +Y is down; if swiping right drifts down-right (tiltDeg > 0), rotating output CCW
  // lifts the right side back to horizontal. Users can flip sign if desired and verify live.
  const baseDelta = invertCompensation ? -tiltDeg : tiltDeg;
  const deltaDeg = Math.round(baseDelta);
  const clampedRecommended = Math.max(
    ANGLE_TUNE_MIN,
    Math.min(ANGLE_TUNE_MAX, Math.round((Number(currentAngle) || 0) + deltaDeg))
  );

  return {
    ready,
    sampleCount: validCount,
    totalTravel: Math.round(totalTravel),
    sumAbsX: Math.round(sumAbsX),
    sumAbsY: Math.round(sumAbsY),
    tiltDeg: Number(tiltDeg.toFixed(2)),
    linearity: Number(linearity.toFixed(3)),
    deltaDeg,
    recommendedAngle: clampedRecommended,
    trail
  };
}

/**
 * Physical-distance DPI verification.
 * Compares accumulated raw counts over a known ruler drag distance (mm) against configured DPI.
 */
export function computeTrueDpi(dx, dy, distanceMm, configuredDpi) {
  const counts = Math.hypot(Number(dx) || 0, Number(dy) || 0);
  const mm = Number(distanceMm);
  const cfg = Number(configuredDpi);
  if (!Number.isFinite(mm) || mm <= 0 || !Number.isFinite(cfg) || cfg <= 0 || counts < 20) {
    return {
      ready: false,
      counts: Math.round(counts),
      distanceMm: mm,
      measuredDpi: null,
      deviationPct: null,
      compensatedDpi: null
    };
  }
  const inches = mm / 25.4;
  const measuredDpi = counts / inches;
  const deviationPct = ((measuredDpi - cfg) / cfg) * 100;
  // To achieve target effective DPI = cfg when physical sensor reports measuredDpi,
  // set configured DPI to cfg * (cfg / measuredDpi), quantized to 50 DPI step.
  const rawComp = (cfg * cfg) / measuredDpi;
  const compensatedDpi = Math.max(
    DPI_MIN,
    Math.min(DPI_MAX, Math.round(rawComp / DPI_STEP) * DPI_STEP)
  );
  return {
    ready: true,
    counts: Math.round(counts),
    distanceMm: mm,
    measuredDpi: Math.round(measuredDpi),
    deviationPct: Number(deviationPct.toFixed(2)),
    compensatedDpi
  };
}

/**
 * Create a lightweight non-reactive tracker for high-rate browser pointer events.
 * Preserves coalesced sub-events even when browser timer coarsening (0.1 ms / 1 ms)
 * assigns identical timestamps to consecutive hardware packets in the same batch.
 */
export function createPollingTracker(maxSamples = 1600) {
  return {
    maxSamples,
    lastTs: 0,
    sameCount: 0,
    sameCounts: [],
    intervals: [],
    counts: [],
    totalEvents: 0
  };
}

export function pushPollingEvents(tracker, events) {
  let added = 0;
  for (const ev of events || []) {
    const ts = Number(ev?.timeStamp ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const c = Math.hypot(Number(ev?.movementX || 0), Number(ev?.movementY || 0));
    tracker.totalEvents++;
    added++;

    if (tracker.lastTs === 0) {
      tracker.lastTs = ts;
      tracker.sameCount = 0;
      tracker.sameCounts.length = 0;
      continue;
    }

    const dt = ts - tracker.lastTs;
    if (dt < -1) {
      tracker.lastTs = ts;
      tracker.sameCount = 0;
      tracker.sameCounts.length = 0;
      continue;
    }
    if (dt <= 0.001) {
      if (tracker.sameCount < 64) {
        tracker.sameCount++;
        tracker.sameCounts.push(c);
      }
      continue;
    }
    if (dt > 25) {
      tracker.lastTs = ts;
      tracker.sameCount = 0;
      tracker.sameCounts.length = 0;
      continue;
    }

    const n = tracker.sameCount + 1;
    const stepDt = dt / n;
    if (stepDt > 0.04 && stepDt <= 25) {
      for (let i = 0; i < tracker.sameCount; i++) {
        tracker.intervals.push(stepDt);
        tracker.counts.push(tracker.sameCounts[i]);
      }
      tracker.intervals.push(stepDt);
      tracker.counts.push(c);
      if (tracker.intervals.length > tracker.maxSamples) {
        const drop = tracker.intervals.length - tracker.maxSamples;
        tracker.intervals.splice(0, drop);
        tracker.counts.splice(0, drop);
      }
    }
    tracker.lastTs = ts;
    tracker.sameCount = 0;
    tracker.sameCounts.length = 0;
  }
  return added;
}

/**
 * Polling rate & inter-event jitter analysis from high-resolution inter-event intervals (ms).
 */
export function analyzePollingSamples(intervalsMs, countsPerEvent = [], configuredDpi = 1600) {
  const valid = (intervalsMs || []).filter(dt => Number.isFinite(dt) && dt > 0.04 && dt <= 25);
  if (valid.length < 4) {
    return {
      ready: false,
      count: valid.length,
      avgHz: 0,
      peakHz: 0,
      medianMs: 0,
      p95Ms: 0,
      p99Ms: 0,
      madUs: 0,
      peakIps: 0,
      buckets: []
    };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avgMs = sum / n;
  const medianMs = n % 2 ? sorted[(n - 1) >> 1] : (sorted[(n >> 1) - 1] + sorted[n >> 1]) / 2;
  const p95Ms = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  const p99Ms = sorted[Math.min(n - 1, Math.floor(n * 0.99))];

  const absDevs = sorted.map(v => Math.abs(v - medianMs)).sort((a, b) => a - b);
  const madMs = n % 2 ? absDevs[(n - 1) >> 1] : (absDevs[(n >> 1) - 1] + absDevs[n >> 1]) / 2;

  // Estimate peak sustained Hz from fastest >=100 ms sliding window (filters 1-2 ms OS HID flush bursts)
  const minWinMs = 100;
  const minWinEvents = 10;
  let bestWinAvg = avgMs;
  let run = 0;
  let left = 0;
  for (let right = 0; right < valid.length; right++) {
    run += valid[right];
    while (left < right && (run - valid[left] >= minWinMs) && (right - left >= minWinEvents)) {
      run -= valid[left++];
    }
    const count = right - left + 1;
    if (run >= minWinMs && count >= minWinEvents) {
      const wAvg = run / count;
      if (wAvg > 0.08 && wAvg < bestWinAvg) bestWinAvg = wAvg;
    }
  }

  let peakIps = 0;
  const dpi = Math.max(50, Number(configuredDpi) || 1600);
  for (let i = 0; i < Math.min(intervalsMs.length, countsPerEvent.length); i++) {
    const dt = intervalsMs[i];
    const c = Number(countsPerEvent[i] || 0);
    if (dt >= 0.1 && dt <= 25 && c > 0) {
      const ips = (c / dpi) / (dt / 1000);
      if (ips < 900 && ips > peakIps) peakIps = ips;
    }
  }

  // 12-bin histogram centered around 0..max(2ms, p99*1.25)
  const maxAxis = Math.max(2, Math.min(12, p99Ms * 1.25));
  const binCount = 12;
  const step = maxAxis / binCount;
  const counts = new Array(binCount).fill(0);
  for (const dt of valid) {
    const idx = Math.min(binCount - 1, Math.floor(dt / step));
    counts[idx]++;
  }
  const maxBin = Math.max(1, ...counts);
  const buckets = counts.map((c, idx) => ({
    fromMs: Number((idx * step).toFixed(2)),
    toMs: Number(((idx + 1) * step).toFixed(2)),
    count: c,
    ratio: c / maxBin
  }));

  return {
    ready: true,
    count: n,
    avgHz: Math.round(1000 / avgMs),
    peakHz: Math.round(1000 / bestWinAvg),
    medianMs: Number(medianMs.toFixed(3)),
    p95Ms: Number(p95Ms.toFixed(3)),
    p99Ms: Number(p99Ms.toFixed(3)),
    madUs: Math.round(madMs * 1000),
    peakIps: Number(peakIps.toFixed(1)),
    buckets
  };
}

/**
 * Switch health & double-click / chatter analyzer.
 * Input events: `[{button, type: 'down'|'up', t}]` where `t` is ms timestamp (`performance.now()`).
 */
export function analyzeSwitchEvents(events, {chatterMs = 25, minHoldMs = 8} = {}) {
  const stats = {};
  const log = [];
  const lastDown = {};
  const lastUp = {};

  for (const ev of events || []) {
    const b = ev.button;
    if (!stats[b]) {
      stats[b] = {
        button: b,
        presses: 0,
        chatterCount: 0,
        microHoldCount: 0,
        minGapMs: null,
        lastGapMs: null,
        minHoldMs: null,
        lastHoldMs: null
      };
    }
    const s = stats[b];
    if (ev.type === 'down') {
      s.presses++;
      let gapMs = null;
      let isChatter = false;
      if (lastUp[b] !== undefined) {
        gapMs = Math.max(0, ev.t - lastUp[b]);
        s.lastGapMs = Number(gapMs.toFixed(1));
        if (s.minGapMs === null || gapMs < s.minGapMs) s.minGapMs = Number(gapMs.toFixed(1));
        if (gapMs < chatterMs) {
          s.chatterCount++;
          isChatter = true;
        }
      }
      lastDown[b] = ev.t;
      log.push({button: b, type: 'down', t: ev.t, gapMs: s.lastGapMs, holdMs: null, suspect: isChatter, reason: isChatter ? 'double' : 'ok'});
    } else if (ev.type === 'up') {
      let holdMs = null;
      let isMicro = false;
      if (lastDown[b] !== undefined) {
        holdMs = Math.max(0, ev.t - lastDown[b]);
        s.lastHoldMs = Number(holdMs.toFixed(1));
        if (s.minHoldMs === null || holdMs < s.minHoldMs) s.minHoldMs = Number(holdMs.toFixed(1));
        if (holdMs < minHoldMs) {
          s.microHoldCount++;
          isMicro = true;
        }
      }
      lastUp[b] = ev.t;
      if (isMicro) {
        log.push({button: b, type: 'up', t: ev.t, gapMs: null, holdMs: s.lastHoldMs, suspect: true, reason: 'micro'});
      }
    }
  }

  return {
    byButton: stats,
    recent: log.slice(-18).reverse()
  };
}
