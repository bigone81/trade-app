import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMarketMonitorSettings as defaults, type Candle, type MarketObservation, type MonitorLevel } from '@trade/shared';
import { analyzeMarket, advanceMarketState, clusterLevels, detectAtrExpansion, detectBarSizes, detectCompression, detectNoPullback, detectRelativeStrength, detectRetestAge, directionalEfficiency, directionalMove, levelDistance, marketAtr, postBreak, priorityForScore, scoreMarketFeatures, selectMarketUniverse, touchEpisodes, validateMarketSettings } from './market-monitor.js';
const s = structuredClone(defaults);
const candles = (closes: number[], width = 1, start = 1_700_000_000): Candle[] => closes.map((close, i) => ({ time: start + i * 300, open: closes[i - 1] ?? close, high: Math.max(close, closes[i - 1] ?? close) + width / 2, low: Math.min(close, closes[i - 1] ?? close) - width / 2, close, volume: 100 }));
const level = (id: string, price: number, type: MonitorLevel['type'] = 'support'): MonitorLevel => ({ id, price, type, touches: 4, strength: 4, dates: [] });
const observation = (): MarketObservation => ({ symbol: 'XLMUSDT', barTime: 1000, price: 101, direction: 'DOWN', cluster: clusterLevels([level('manual:1', 100, 'manual')], 2, .12)[0]!, features: [], metrics: { distanceAtr: .5 }, scores: { approach: 7, breakout: 3, rejection: 11, priority: 'CRITICAL', conflict: false, contributions: { approach: {}, breakout: {}, rejection: {} } }, scenario: 'REJECTION_SETUP' });

test('ATR uses true ranges including gaps and requires a full warmup', () => {
  const c = candles(Array(16).fill(100), 2); c.at(-1)!.high = 111; c.at(-1)!.low = 109; c.at(-1)!.close = 110;
  assert.equal(marketAtr(c), (13 * 2 + 11) / 14);
  assert.equal(marketAtr(c.slice(0, 10)), 0);
});
test('ATR expansion and bar sizes distinguish the final impulse', () => {
  const c = candles([...Array(20).fill(100), 102, 104, 106]);
  assert.equal(detectAtrExpansion(c, 1.4).detected, true);
  assert.equal(detectBarSizes(c, 1, s)[1]!.detected, true);
  assert.equal(detectBarSizes(candles(Array(20).fill(100), .5), 1, s)[0]!.detected, true);
});
test('directional efficiency distinguishes trends, chop and flat candles', () => {
  assert.equal(directionalEfficiency(candles([1, 2, 3, 4, 5, 6, 7])), 1);
  assert.equal(directionalEfficiency(candles([1, 2, 1, 2, 1, 2, 1])), 0);
  assert.equal(directionalEfficiency(candles(Array(7).fill(100))), 0);
  assert.equal(directionalMove(candles([10, 9, 8, 7]), 3, 2), -1.5);
});
test('distance and velocity use the same ATR denominator', () => {
  const d = levelDistance(101, 104, 100, 2);
  assert.equal(d.distanceAtr, .5); assert.equal(d.distancePrevAtr, 2); assert.equal(d.approachVelocity, .5);
  assert.equal(d.distancePercent, 100 / 101);
});
test('no-pullback requires both sufficient movement and efficiency', () => {
  assert.equal(detectNoPullback(candles([10, 11, 12, 13, 14, 15, 16]), 2, s).detected, true);
  assert.equal(detectNoPullback(candles([10, 13, 10, 13, 10, 13, 10]), 2, s).detected, false);
});
test('compression needs contraction and directional pressure', () => {
  const c = candles([100, 106, 100, 106, 100, 106, 102, 102.2, 102.4, 102.6, 102.8, 103], .2);
  assert.equal(detectCompression(c, s).detected, true);
  assert.equal(detectCompression(candles(Array(12).fill(100)), s).detected, false);
});
test('wick touches and adjacent candles form a single episode', () => {
  const c = candles([102, 102, 110, 110, 102], 4);
  const episodes = touchEpisodes(c, 100, .1, 0);
  assert.equal(episodes.length, 2); assert.equal(episodes[0]!.bars, 3);
  assert.equal(touchEpisodes(c, 100, .1, 1).length, 1);
});
test('retest age has near, neutral, far and unknown states', () => {
  const now = 100 * 86400;
  assert.equal(detectRetestAge(now - 10 * 86400, now, s)[1]!.detected, true);
  assert.equal(detectRetestAge(now - 20 * 86400, now, s)[2]!.detected, false);
  assert.equal(detectRetestAge(now - 31 * 86400, now, s)[2]!.detected, true);
  assert.ok(detectRetestAge(null, now, s).every(x => !x.detected));
});
test('clusters combine manual/mirror/support without chain merging and preserve keys', () => {
  const levels = [level('manual:1', .19670, 'manual'), level('mirror:1', .19675, 'mirror'), level('support:1', .19668)];
  const groups = clusterLevels(levels, .001, .12);
  assert.equal(groups.length, 1); assert.equal(groups[0]!.types.length, 3);
  assert.equal(groups[0]!.autoTouches, 4);
  assert.equal(clusterLevels([level('auto:new', .19672)], .001, .12, groups)[0]!.key, groups[0]!.key);
  assert.equal(clusterLevels([level('a', 1), level('b', 1.1), level('c', 1.2)], 1, .15).length, 2);
});
test('BTC relative strength compares normalized movement on aligned windows', () => {
  const a = candles([...Array(20).fill(100), 101, 102, 103]);
  const scaled = a.map(x => ({ ...x, open: x.open * 100, close: x.close * 100, high: x.high * 100, low: x.low * 100 }));
  assert.equal(detectRelativeStrength(a, scaled, .8)[0]!.value, 0);
  assert.equal(detectRelativeStrength(a, candles(Array(23).fill(100)), .8).at(-1)!.detected, true);
  assert.equal(detectRelativeStrength(a, scaled.slice(0, -1), .8)[0]!.detected, false);
  assert.equal(detectRelativeStrength(a, scaled.slice(0, -1), .8)[0]!.value, undefined);
});
test('scores are absolute, deduplicated, explainable and conflict-aware', () => {
  const f = ['SMALL_BARS_APPROACH', 'STICKING_TO_LEVEL', 'COMPRESSION', 'LONG_NO_PULLBACK_MOVE', 'BIG_BARS_APPROACH', 'ATR_EXPANSION'].map(key => ({ key, detected: true }));
  const scores = scoreMarketFeatures([...f, f[0]!], s);
  assert.equal(scores.breakout, 9); assert.equal(scores.rejection, 8); assert.equal(scores.conflict, true);
  assert.equal(Object.values(scores.contributions.breakout).reduce((a, b) => a + b), 9);
  assert.deepEqual([4, 5, 8, 11].map(priorityForScore), ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
});
test('anti-spam survives cooldown, re-arms after reset, and suppresses the same bar', () => {
  const o = observation(), now = 1_000_000;
  const first = advanceMarketState(null, o, s, now); assert.equal(first.alert, true);
  assert.equal(advanceMarketState(first.state, o, s, now + 2e6).alert, false);
  o.barTime += 300;
  assert.equal(advanceMarketState(first.state, o, s, now + 2e6).alert, false);
  o.scores.rejection += 3;
  assert.equal(advanceMarketState(first.state, o, s, now + 1000).alert, false);
  assert.equal(advanceMarketState(first.state, o, s, now + 2e6).alert, true);
  o.metrics.distanceAtr = 2;
  const reset = advanceMarketState(first.state, o, s, now + 1000); assert.equal(reset.state.state, 'RESET');
  o.barTime += 300; o.metrics.distanceAtr = .5;
  const waiting = advanceMarketState(reset.state, o, s, now + 2000); assert.equal(waiting.state.state, 'RESET');
  o.barTime += 300;
  assert.equal(advanceMarketState(waiting.state, o, s, now + 2e6).alert, true);
});
test('post-break requires a subsequent closed bar, detects impulse and failed continuation', () => {
  assert.equal(postBreak(candles([98, 99, 101]), 100, 1, s).crossed, false);
  const confirmed = postBreak(candles([98, 99, 101, 102]), 100, 1, s);
  assert.equal(confirmed.impulse, true);
  const falseBreak = postBreak(candles([98, 99, 101, 99]), 100, 1, s);
  assert.equal(falseBreak.returned && falseBreak.noImpulse, true);
});
test('universe uses hysteresis, active instruments, dedupe and manual override', () => {
  const ticker = [{ symbol: 'AUSDT', turnover24h: 45e6 }, { symbol: 'BUSDT', turnover24h: 45e6 }, { symbol: 'CUSDT', turnover24h: 1 }, { symbol: 'DUSDT', turnover24h: 90e6 }];
  const selected = selectMarketUniverse(ticker, new Set(['AUSDT', 'BUSDT', 'CUSDT']), new Set(['AUSDT']), ['CUSDT'], ['CUSDT'], s);
  assert.deepEqual(selected.map(x => x.symbol), ['AUSDT', 'CUSDT']); assert.deepEqual(selected[1]!.sources, ['watchlist', 'manual']);
  assert.equal(selectMarketUniverse(ticker, new Set(['CUSDT']), new Set(), [], ['CUSDT'], { ...s, universeMode: 'AUTO' }).length, 1);
  assert.equal(selectMarketUniverse(ticker, new Set(['CUSDT']), new Set(), [], ['CUSDT'], { ...s, universeMode: 'WATCHLIST', alwaysMonitorManualLevels: false }).length, 0);
});
test('settings reject non-finite, unknown and contradictory values', () => {
  assert.equal(validateMarketSettings(s), s);
  for (const patch of [{ maxAutoSymbols: NaN }, { nearRetestDays: 31 }, { exitTurnover: 1e10 }, { enabled: 'true' }, { surprise: 1 }, { resetDistanceAtr: .5 }, { scoreWeights: { ...s.scoreWeights, approach: { INJECTED: 20 } } }]) assert.throws(() => validateMarketSettings({ ...s, ...patch }));
});

test('settings reject prototype names as setting and weight keys', () => {
  assert.throws(() => validateMarketSettings({ ...s, constructor: 1 }), /Unknown setting/);
  const weights = { ...s.scoreWeights.approach };
  delete weights[Object.keys(weights)[0]!];
  weights['toString'] = 2;
  assert.throws(() => validateMarketSettings({ ...s, scoreWeights: { ...s.scoreWeights, approach: weights } }), /Invalid weight/);
});

test('a false breakout is still observed when net movement is zero', () => {
  const c = candles([...Array(30).fill(99), 101, 99]);
  const clusters = clusterLevels([level('manual:1', 100, 'manual')], marketAtr(c), s.levelClusterAtr);
  const result = analyzeMarket({ symbol: 'XLMUSDT', m5: c, h1: [], h4: [], daily: [], btc: [], clusters, settings: s });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.scenario, 'FALSE_BREAKOUT');
  assert.equal(result[0]!.metrics.relativeStrength, null);
});
test('fast downward approach to support favors rejection before touching', () => {
  const c = candles([...Array(30).fill(110), 109, 108, 106, 104, 102, 101], .3);
  const cluster = clusterLevels([level('manual:1', 100.4, 'manual'), level('auto:1', 100.45, 'mirror')], marketAtr(c), s.levelClusterAtr);
  const behind = clusterLevels([level('behind', 120)], marketAtr(c), s.levelClusterAtr);
  const result = analyzeMarket({ symbol: 'XLMUSDT', m5: c, h1: c, h4: c, daily: [], btc: candles(Array(c.length).fill(100), 1), clusters: [...cluster, ...behind], settings: s });
  assert.equal(result.length, 1); const o = result[0]!;
  assert.equal(o.direction, 'DOWN'); assert.ok(o.price > o.cluster.price); assert.ok(o.scores.approach >= 5);
  assert.ok(o.scores.rejection > o.scores.breakout); assert.equal(o.scenario, 'REJECTION_SETUP');
  assert.ok(o.features.some(x => x.key === 'FAST_APPROACH' && x.detected));
  assert.ok(o.features.some(x => x.key === 'MANUAL_LEVEL' && x.detected));
});
