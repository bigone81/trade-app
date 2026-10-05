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
