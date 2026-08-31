import type { AutoLevel, Candle } from '@trade/shared';

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
const date = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

export function detectLevels(candles: Candle[]) {
  const data = candles.slice(-30);
  if (!data.length) return { tolerance: 0.01, limitLevels: [] as AutoLevel[], mirrorLevels: [] as AutoLevel[] };

  let volatility = 0;
  for (let i = 1; i < data.length; i++) {
    const previous = data[i - 1]!.close;
    if (previous !== 0) volatility += Math.abs(data[i]!.close - previous) / previous;
  }
  volatility = data.length > 1 ? volatility / (data.length - 1) : 0.01;
  const tolerance = Math.max(0.01, volatility * 0.3);

  const limitLevels: AutoLevel[] = [];
  for (const [field, type] of [['high', 'resistance'], ['low', 'support']] as const) {
    const groups: { center: number; prices: number[]; dates: string[] }[] = [];
    data.forEach((candle) => {
      const price = candle[field];
      const existing = groups.find((g) => Math.abs(price - g.center) / Math.max(price, 1e-12) < tolerance);
      if (existing) {
        existing.prices.push(price);
        existing.dates.push(date(candle.time));
      } else {
        groups.push({ center: price, prices: [price], dates: [date(candle.time)] });
      }
    });
    for (const group of groups) {
      if (group.prices.length < 2) continue;
      const med = median(group.prices);
      const avg = mean(group.prices);
      const dev = stddev(group.prices);
      limitLevels.push({
        type, price: Number(med.toFixed(4)), priceMean: Number(avg.toFixed(4)),
        priceStddev: Number(dev.toFixed(6)), dates: [...new Set(group.dates)],
        touches: group.prices.length, strength: Number((group.prices.length / (1 + dev)).toFixed(4)),
      });
    }
  }

  const pairs: { price: number; dates: string[] }[] = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i]!; const b = data[j]!;
      if (a.high !== 0 && Math.abs(a.high - b.low) / a.high < tolerance) {
        pairs.push({ price: (a.high + b.low) / 2, dates: [date(a.time), date(b.time)] });
      }
      if (a.low !== 0 && Math.abs(a.low - b.high) / a.low < tolerance) {
        pairs.push({ price: (a.low + b.high) / 2, dates: [date(a.time), date(b.time)] });
      }
    }
  }
  const mirrorGroups: { center: number; prices: number[]; dates: string[] }[] = [];
  for (const pair of pairs) {
    const existing = mirrorGroups.find((g) => Math.abs(pair.price - g.center) / Math.max(pair.price, 1e-12) < tolerance);
    if (existing) {
      existing.prices.push(pair.price);
      existing.dates = [...new Set([...existing.dates, ...pair.dates])];
    } else {
      mirrorGroups.push({ center: pair.price, prices: [pair.price], dates: pair.dates });
    }
  }
  const mirrorLevels: AutoLevel[] = mirrorGroups.filter((g) => g.dates.length >= 2).map((g) => {
    const med = median(g.prices); const avg = mean(g.prices); const dev = stddev(g.prices);
    return {
      type: 'mirror', price: Number(avg.toFixed(4)), priceMean: Number(med.toFixed(4)),
      priceStddev: Number(dev.toFixed(6)), dates: g.dates, touches: g.dates.length,
      strength: Number((g.dates.length / (1 + dev)).toFixed(4)),
    };
  });

  const filtered = limitLevels.filter((l) => !mirrorLevels.some((m) => Math.abs(l.price - m.price) / Math.max(l.price, 1e-12) < 0.01));
  return { tolerance, limitLevels: filtered, mirrorLevels };
}
