import type { AutoLevel, Candle } from '@trade/shared';

export interface DetectLevelOptions {
  lookbackDays?: number;
  tickSize?: string | number;
}

const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
};
const stddev = (values: number[]) => {
  if (values.length <= 1) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
};
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const DAY = 86_400;
const reactionCount = (times: number[]) => {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  let reactions = 1;
  let previous = sorted[0]!;
  for (const time of sorted.slice(1)) {
    // Consecutive daily candles around the same zone are one reaction, not many touches.
    if (time - previous > 2 * DAY) reactions += 1;
    previous = time;
  }
  return reactions;
};
const date = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

const tickDecimals = (tickSize: string | number | undefined) => {
  const raw = String(tickSize ?? '').trim().toLowerCase();
  if (!raw) return 8;
  if (raw.includes('e-')) {
    const exponent = Number(raw.split('e-')[1]);
    return Number.isFinite(exponent) ? Math.min(12, exponent) : 8;
  }
  const normalized = raw.replace(/0+$/, '');
  const dot = normalized.indexOf('.');
  return dot < 0 ? 0 : Math.min(12, normalized.length - dot - 1);
};

const makePriceRounder = (tickSize: string | number | undefined) => {
  const tick = Number(tickSize);
  const decimals = tickDecimals(tickSize);
  const round = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    if (Number.isFinite(tick) && tick > 0) {
      return Number((Math.round(value / tick) * tick).toFixed(decimals));
    }
    return Number(value.toPrecision(12));
  };
  const roundDeviation = (value: number) => Number(value.toFixed(Math.min(12, decimals + 2)));
  return { round, roundDeviation };
};

type PriceGroup = {
  center: number;
  prices: number[];
  times: number[];
  pairCount?: number;
};

const addToGroup = (groups: PriceGroup[], price: number, times: number[], tolerance: number, pairCount = 0) => {
  let best: PriceGroup | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const group of groups) {
    const distance = Math.abs(price - group.center) / Math.max(Math.abs(price), 1e-12);
    if (distance < tolerance && distance < bestDistance) {
      best = group;
      bestDistance = distance;
    }
  }
  if (best) {
    best.prices.push(price);
    best.times = [...new Set([...best.times, ...times])].sort((a, b) => a - b);
    best.pairCount = (best.pairCount || 0) + pairCount;
    // Updating the center removes the order-dependence of the old clustering.
    best.center = median(best.prices);
    return;
  }
  groups.push({ center: price, prices: [price], times: [...new Set(times)].sort((a, b) => a - b), pairCount });
};

const strengthScore = (
  group: PriceGroup,
  tolerance: number,
  windowStart: number,
  windowEnd: number,
  type: AutoLevel['type'],
) => {
  const uniqueTimes = [...new Set(group.times)].sort((a, b) => a - b);
  const touches = uniqueTimes.length;
  const reactions = reactionCount(uniqueTimes);
  const med = Math.abs(median(group.prices));
  const relativeDeviation = med > 0 ? stddev(group.prices) / med : 0;
  const compactness = clamp(1 - relativeDeviation / Math.max(tolerance, 1e-9));
  // Six distinct daily reactions are enough to max the touch component.
  const touchScore = clamp((reactions - 1) / 5);
  const windowSpan = Math.max(1, windowEnd - windowStart);
  const first = uniqueTimes[0] ?? windowStart;
  const last = uniqueTimes.at(-1) ?? windowEnd;
  const recency = clamp(1 - (windowEnd - last) / windowSpan);
  const persistence = clamp((last - first) / windowSpan);

  if (type === 'mirror') {
    // For a mirror, repeated high↔low role changes matter in addition to raw touches.
    const flips = clamp((group.pairCount || 1) / 4);
    return Math.round(100 * clamp(
      0.38 * touchScore + 0.22 * compactness + 0.15 * recency + 0.10 * persistence + 0.15 * flips,
    ));
  }
  return Math.round(100 * clamp(
    0.50 * touchScore + 0.25 * compactness + 0.15 * recency + 0.10 * persistence,
  ));
};

export function detectLevels(candles: Candle[], options: DetectLevelOptions = {}) {
  const requested = Number(options.lookbackDays ?? 90);
  const lookbackDays = [30, 60, 90, 180].includes(requested) ? requested : 90;
  const data = candles.slice(-lookbackDays);
  if (!data.length) return { tolerance: 0.01, lookbackDays, limitLevels: [] as AutoLevel[], mirrorLevels: [] as AutoLevel[] };

  const { round, roundDeviation } = makePriceRounder(options.tickSize);
  let volatility = 0;
  for (let i = 1; i < data.length; i++) {
    const previous = data[i - 1]!.close;
    if (previous !== 0) volatility += Math.abs(data[i]!.close - previous) / previous;
  }
  volatility = data.length > 1 ? volatility / (data.length - 1) : 0.01;
  // Preserve the original idea: at least a 1% zone, wider when the asset is more volatile.
  const tolerance = Math.max(0.01, volatility * 0.3);
  const windowStart = data[0]!.time;
  const windowEnd = data.at(-1)!.time;

  const limitLevels: AutoLevel[] = [];
  for (const [field, type] of [['high', 'resistance'], ['low', 'support']] as const) {
    const groups: PriceGroup[] = [];
    for (const candle of data) addToGroup(groups, candle[field], [candle.time], tolerance);

    for (const group of groups) {
      const uniqueTimes = [...new Set(group.times)].sort((a, b) => a - b);
      const reactions = reactionCount(uniqueTimes);
      if (reactions < 2) continue;
      const med = median(group.prices);
      const avg = mean(group.prices);
      const dev = stddev(group.prices);
      limitLevels.push({
        type,
        price: round(med),
        priceMean: round(avg),
        priceStddev: roundDeviation(dev),
        dates: uniqueTimes.map(date),
        touches: reactions,
        strength: strengthScore(group, tolerance, windowStart, windowEnd, type),
      });
    }
  }

  const mirrorGroups: PriceGroup[] = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i]!;
      const b = data[j]!;
      if (a.high !== 0 && Math.abs(a.high - b.low) / Math.abs(a.high) < tolerance) {
        addToGroup(mirrorGroups, (a.high + b.low) / 2, [a.time, b.time], tolerance, 1);
      }
      if (a.low !== 0 && Math.abs(a.low - b.high) / Math.abs(a.low) < tolerance) {
        addToGroup(mirrorGroups, (a.low + b.high) / 2, [a.time, b.time], tolerance, 1);
      }
    }
  }

  const mirrorLevels: AutoLevel[] = mirrorGroups
    .filter((group) => reactionCount(group.times) >= 2)
    .map((group) => {
      const uniqueTimes = [...new Set(group.times)].sort((a, b) => a - b);
      const reactions = reactionCount(uniqueTimes);
      const med = median(group.prices);
      const avg = mean(group.prices);
      const dev = stddev(group.prices);
      return {
        type: 'mirror' as const,
        price: round(med),
        priceMean: round(avg),
        priceStddev: roundDeviation(dev),
        dates: uniqueTimes.map(date),
        touches: reactions,
        strength: strengthScore(group, tolerance, windowStart, windowEnd, 'mirror'),
      };
    });

  // Keep mirror priority from the legacy algorithm, but use the strongest result first.
  mirrorLevels.sort((a, b) => b.strength - a.strength || b.touches - a.touches);
  const filtered = limitLevels
    .filter((level) => !mirrorLevels.some((mirror) => Math.abs(level.price - mirror.price) / Math.max(Math.abs(level.price), 1e-12) < 0.01))
    .sort((a, b) => b.strength - a.strength || b.touches - a.touches);

  return { tolerance, lookbackDays, limitLevels: filtered, mirrorLevels };
}
