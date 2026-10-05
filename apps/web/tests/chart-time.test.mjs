import assert from 'node:assert/strict';
import test from 'node:test';
import { candleStep, candleTimeAtLogical, logicalAtTime, timeframeSeconds } from '../src/chartTime.ts';

const candles = [0, 3600, 7200, 14400, 18000].map(time => ({ time }));

test('timestamp/logical conversion interpolates within actual adjacent candles', () => {
  assert.equal(logicalAtTime(candles, 1800, 60), 0.5);
  assert.equal(logicalAtTime(candles, 10800, 60), 2.5);
  assert.equal(candleTimeAtLogical(candles, 2.5, 60), 10800);
  assert.equal(candleTimeAtLogical(candles, 0.0003, 60), 1);
});

test('extrapolation uses the median loaded interval in both directions', () => {
  assert.equal(candleStep(candles, 60), 3600);
  assert.equal(logicalAtTime(candles, -1800, 60), -0.5);
  assert.equal(logicalAtTime(candles, 23400, 60), 5.5);
  for (const time of [-7200, -1, 0, 1800, 3600, 10800, 18000, 23400]) {
    assert.equal(candleTimeAtLogical(candles, logicalAtTime(candles, time, 60), 60), time);
  }
});

test('single candle uses current timeframe; empty timelines have no coordinates', () => {
  assert.equal(logicalAtTime([{ time: 3600 }], 5400, 3600), 0.5);
  assert.equal(candleTimeAtLogical([{ time: 3600 }], -0.5, 3600), 1800);
  assert.equal(logicalAtTime([], 123, 60), null);
  assert.equal(candleTimeAtLogical([], 1, 60), null);
  assert.equal(logicalAtTime(candles, NaN, 60), null);
  assert.equal(candleTimeAtLogical(candles, Infinity, 60), null);
});

test('all supported timeframes preserve second-precision endpoints on round trips', () => {
  for (const tf of ['1', '3', '5', '15', '30', '60', '240', 'D', 'W']) {
    const step = timeframeSeconds(tf);
    const bars = Array.from({ length: 12 }, (_, i) => ({ time: 1_800_000_000 + i * step }));
    for (const delta of [-3599, -1, 0, 1, 1799, 9000, 18000, step * 20 + 17]) {
      const time = bars[0].time + delta;
      assert.equal(candleTimeAtLogical(bars, logicalAtTime(bars, time, step), step), time);
    }
  }
});
