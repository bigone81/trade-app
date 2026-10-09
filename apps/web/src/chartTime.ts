import type { ITimeScaleApi, Logical, Time, UTCTimestamp } from 'lightweight-charts';

type TimedCandle = { time: number };

export const timeframeSeconds = (timeframe: string) => {
  if (timeframe === 'D') return 86_400;
  if (timeframe === 'W') return 604_800;
  const minutes = Number(timeframe);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 900;
};

// Use the loaded timeline for extrapolation; the current TF is only a fallback
// when there are too few candles to measure an interval.
export function candleStep(candles: readonly TimedCandle[], fallbackStep: number) {
  const diffs: number[] = [];
  for (let i = 1; i < candles.length && diffs.length < 40; i += 1) {
    const delta = candles[i]!.time - candles[i - 1]!.time;
    if (delta > 0) diffs.push(delta);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] ?? fallbackStep;
}

export function candleTimeAtLogical(candles: readonly TimedCandle[], logical: number, fallbackStep: number) {
  if (!candles.length || !Number.isFinite(logical)) return null;
  const lastIndex = candles.length - 1;
  if (logical <= 0) {
    return Math.round(candles[0]!.time + logical * candleStep(candles, fallbackStep));
  }
  if (logical >= lastIndex) {
    return Math.round(candles[lastIndex]!.time + (logical - lastIndex) * candleStep(candles, fallbackStep));
  }
  const base = Math.floor(logical);
  const a = candles[base]!;
  const b = candles[base + 1]!;
  // Round to Unix seconds, never to a candle boundary.
  return Math.round(a.time + (b.time - a.time) * (logical - base));
}

export function logicalAtTime(candles: readonly TimedCandle[], time: number, fallbackStep: number) {
  if (!candles.length || !Number.isFinite(time)) return null;
  if (time <= candles[0]!.time) {
    return (time - candles[0]!.time) / candleStep(candles, fallbackStep);
  }
  const lastIndex = candles.length - 1;
  if (time >= candles[lastIndex]!.time) {
    return lastIndex + (time - candles[lastIndex]!.time) / candleStep(candles, fallbackStep);
  }
  let lo = 0;
  let hi = lastIndex;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = candles[lo]!;
  const b = candles[hi]!;
  return lo + (time - a.time) / (b.time - a.time);
}

// Lightweight Charts 5.2 returns 0 for fractional logical indices. Interpolate
// integer bar centres ourselves, including outside the loaded/visible range.
export function coordinateAtLogical(scale: ITimeScaleApi<Time>, logical: number): number | null {
  if (!Number.isFinite(logical)) return null;
  const base = Math.floor(logical);
  const left = scale.logicalToCoordinate(base as Logical);
  if (left === null || !Number.isFinite(left)) return null;
  if (logical === base) return left;
  const right = scale.logicalToCoordinate((base + 1) as Logical);
  if (right === null || !Number.isFinite(right)) return null;
  return left + (right - left) * (logical - base);
}

// coordinateToLogical snaps to bars too. Recover the fractional position from
// neighbouring centres so dragging retains second-precision time anchors.
export function logicalAtCoordinate(scale: ITimeScaleApi<Time>, x: number): number | null {
  if (!Number.isFinite(x)) return null;
  const nearest = scale.coordinateToLogical(x);
  if (nearest === null || !Number.isFinite(nearest)) return null;
  const base = Math.floor(nearest);
  const left = coordinateAtLogical(scale, base);
  const right = coordinateAtLogical(scale, base + 1);
  if (left === null || right === null || right <= left) return null;
  return base + (x - left) / (right - left);
}

function timelineOrigin(scale: ITimeScaleApi<Time>, candles: readonly TimedCandle[]) {
  if (!candles.length) return null;
  // The rolling candle cache can start later than the chart's series after live
  // updates. Its array index 0 is not necessarily chart logical index 0.
  const origin = scale.timeToIndex(candles[0]!.time as UTCTimestamp, false);
  return origin !== null && Number.isFinite(origin) ? origin : null;
}

export function timeToChartCoordinate(scale: ITimeScaleApi<Time>, candles: readonly TimedCandle[], time: number, step: number) {
  const origin = timelineOrigin(scale, candles);
  const logical = logicalAtTime(candles, time, step);
  return origin === null || logical === null ? null : coordinateAtLogical(scale, origin + logical);
}

export function chartCoordinateToTime(scale: ITimeScaleApi<Time>, candles: readonly TimedCandle[], x: number, step: number) {
  const origin = timelineOrigin(scale, candles);
  const logical = logicalAtCoordinate(scale, x);
  return origin === null || logical === null ? null : candleTimeAtLogical(candles, logical - origin, step);
}
