import assert from 'node:assert/strict';
import test from 'node:test';
import { candleStep, candleTimeAtLogical, logicalAtTime, timeframeSeconds, coordinateAtLogical, logicalAtCoordinate, timeToChartCoordinate, chartCoordinateToTime } from '../src/chartTime.ts';
import { chartScaleCoordinates } from './helpers/chart-scale.mjs';

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

test('fractional positions interpolate actual Lightweight Charts integer centres in both directions', () => {
  const state = { spacing: 3, offset: 127, count: 1000 };
  const scale = chartScaleCoordinates(state);
  assert.equal(scale.logicalToCoordinate(1.5), 0, 'reproduce the library behaviour that collapsed RR');
  for (const spacing of [0.5, 3, 17]) {
    state.spacing = spacing;
    for (const logical of [-2500.7, -0.5, 0, 1.5, 345.123, 999, 1500.7]) {
      const x = coordinateAtLogical(scale, logical);
      assert.ok(Math.abs(x - (state.offset + logical * spacing)) < 1e-8);
      assert.ok(Math.abs(logicalAtCoordinate(scale, x) - logical) < 1e-8);
    }
  }
});

test('missing/invalid coordinates never become a left-edge coordinate; zero is valid', () => {
  for (const invalid of [null, undefined, NaN, Infinity]) {
    const scale = { logicalToCoordinate: () => invalid, coordinateToLogical: () => invalid, timeToIndex: () => invalid };
    assert.equal(coordinateAtLogical(scale, 1.5), null);
    assert.equal(logicalAtCoordinate(scale, 100), null);
    assert.equal(timeToChartCoordinate(scale, candles, 1800, 3600), null);
    assert.equal(chartCoordinateToTime(scale, candles, 100, 3600), null);
  }
  const scale = chartScaleCoordinates({ spacing: 10, offset: 0, count: 5 });
  scale.timeToIndex = () => 0;
  assert.equal(timeToChartCoordinate(scale, candles, 0, 3600), 0);
  assert.equal(timeToChartCoordinate(scale, [], 0, 3600), null);
  assert.equal(chartCoordinateToTime(scale, [], 0, 3600), null);
  assert.equal(timeToChartCoordinate(scale, candles, NaN, 3600), null);
  assert.equal(chartCoordinateToTime(scale, candles, Infinity, 3600), null);
});
