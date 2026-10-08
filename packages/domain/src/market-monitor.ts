import {
  defaultMarketMonitorSettings, marketNumericBounds, defaultScoreWeights,
  type Candle, type FeatureResult, type LevelCluster, type MarketAlertState, type MarketMonitorSettings,
  type MarketObservation, type MarketPriority, type MarketScores, type MonitorLevel, type ScoreWeights,
} from '@trade/shared';

const mean = (a: number[]) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
const range = (c: Candle[]) => c.length ? Math.max(...c.map(x => x.high)) - Math.min(...c.map(x => x.low)) : 0;
export const priorityRank = (p: MarketPriority) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(p);
export const priorityForScore = (score: number): MarketPriority => score >= 11 ? 'CRITICAL' : score >= 8 ? 'HIGH' : score >= 5 ? 'MEDIUM' : 'LOW';

export function validateMarketSettings(input: unknown): MarketMonitorSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object');
  const s = input as MarketMonitorSettings;
  for (const key of Object.keys(s)) if (!Object.hasOwn(defaultMarketMonitorSettings, key)) throw new Error(`Unknown setting: ${key}`);
  for (const [key, [min, max, integer]] of Object.entries(marketNumericBounds)) {
    const value = s[key as keyof typeof marketNumericBounds];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${key}: expected ${min}..${max}${integer ? ' integer' : ''}`);
  }
  for (const key of ['enabled', 'alwaysMonitorManualLevels', 'telegramEnabled'] as const) if (typeof s[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  if (!['AUTO', 'WATCHLIST', 'HYBRID'].includes(s.universeMode) || !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s.minPriority) || s.scanTimeframe !== '5') throw new Error('Invalid mode, priority or timeframe');
  if (s.exitTurnover > s.minTurnover || s.nearRetestDays >= s.farRetestDays || s.resetDistanceAtr <= s.maxDistanceAtr || s.closeNearAtr >= s.closeFarAtr || s.smallBarAtr >= s.bigBarAtr) throw new Error('Invalid threshold order');
  if (!s.scoreWeights || Object.keys(s.scoreWeights).length !== 3) throw new Error('Expected approach, breakout and rejection weights');
  for (const group of ['approach', 'breakout', 'rejection'] as const) {
    const weights = s.scoreWeights[group];
    if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error(`Invalid ${group} weights`);
    if (Object.keys(weights).length !== Object.keys(defaultScoreWeights[group]).length) throw new Error(`Missing ${group} weights`);
    for (const [key, value] of Object.entries(weights)) if (!Object.hasOwn(defaultScoreWeights[group], key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 20) throw new Error(`Invalid weight: ${key}`);
  }
  return s;
}

/** SMA of true ranges, matching EdgeDesk's existing ATR endpoint. */
export function marketAtr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  return mean(candles.slice(-period).map((c, i) => {
    const previous = candles[candles.length - period + i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - previous), Math.abs(c.low - previous));
  }));
}
export function directionalMove(c: Candle[], bars: number, atr: number) {
  return c.length > bars && atr > 0 ? (c.at(-1)!.close - c.at(-bars - 1)!.close) / atr : 0;
}
export function directionalEfficiency(c: Candle[], bars = 6) {
  const window = c.slice(-bars - 1);
  const path = window.slice(1).reduce((sum, x, i) => sum + Math.abs(x.close - window[i]!.close), 0);
  return path ? Math.abs(window.at(-1)!.close - window[0]!.close) / path : 0;
}
export function levelDistance(price: number, previous: number, level: number, atr: number) {
  const distanceNowAtr = Math.abs(price - level) / atr;
  const distancePrevAtr = Math.abs(previous - level) / atr;
  return { distanceNowAtr, distancePrevAtr, distanceAtr: distanceNowAtr, distancePercent: Math.abs(price - level) / price * 100, approachVelocity: (distancePrevAtr - distanceNowAtr) / 3 };
}
export function detectAtrExpansion(c: Candle[], threshold: number): FeatureResult {
  const normal = marketAtr(c); const value = normal ? marketAtr(c, 3) / normal : 0;
  return { key: 'ATR_EXPANSION', detected: value >= threshold, value };
}
export function detectBarSizes(c: Candle[], atr: number, s: MarketMonitorSettings) {
  const value = mean(c.slice(-3).map(x => x.high - x.low)) / atr;
  return [{ key: 'SMALL_BARS', detected: value <= s.smallBarAtr, value }, { key: 'BIG_BARS', detected: value >= s.bigBarAtr, value }];
}
export function detectCompression(c: Candle[], s: MarketMonitorSettings): FeatureResult {
  const oldRange = range(c.slice(-12, -6)); const value = oldRange ? range(c.slice(-6)) / oldRange : 1;
  const sign = Math.sign(c.at(-1)!.close - c.at(-7)!.close);
  const first = c.slice(-6, -3), last = c.slice(-3);
  const pressing = sign > 0 ? Math.min(...last.map(x => x.low)) > Math.min(...first.map(x => x.low)) : sign < 0 && Math.max(...last.map(x => x.high)) < Math.max(...first.map(x => x.high));
  return { key: 'COMPRESSION', detected: c.length >= 12 && value <= s.compressionRatio && pressing, value, details: { pressing } };
}
export function detectNoPullback(c: Candle[], atr: number, s: MarketMonitorSettings): FeatureResult {
  const value = Math.abs(directionalMove(c, 6, atr));
  return { key: 'LONG_NO_PULLBACK_MOVE', detected: value >= s.noPullbackMoveAtr && directionalEfficiency(c) >= s.directionalEfficiencyThreshold, value };
}

/** Historical retests are wick intersections, with adjacent touches grouped into episodes. */
export function touchEpisodes(c: Candle[], price: number, tolerance: number, gapBars: number) {
  const episodes: { first: number; last: number; bars: number }[] = [];
  let lastIndex = -Infinity;
  c.forEach((bar, i) => {
    if (bar.low > price + tolerance || bar.high < price - tolerance) return;
    if (i - lastIndex > gapBars + 1) episodes.push({ first: bar.time, last: bar.time, bars: 1 });
    else { const episode = episodes.at(-1)!; episode.last = bar.time; episode.bars++; }
    lastIndex = i;
  });
  return episodes;
}
export function detectRetestAge(lastTouchAt: number | null, now: number, s: MarketMonitorSettings): FeatureResult[] {
  const days = lastTouchAt === null ? null : Math.max(0, (now - lastTouchAt) / 86400);
  return [
    { key: 'LAST_TOUCH', detected: days !== null, ...(days !== null ? { value: days } : {}) },
    { key: 'NEAR_RETEST', detected: days !== null && days <= s.nearRetestDays, ...(days !== null ? { value: days } : {}) },
    { key: 'FAR_RETEST', detected: days !== null && days > s.farRetestDays, ...(days !== null ? { value: days } : {}) },
  ];
}
export function clusterLevels(levels: MonitorLevel[], atr: number, radius: number, previous: LevelCluster[] = []): LevelCluster[] {
  const groups: MonitorLevel[][] = [];
  for (const l of levels.filter(x => x.price > 0).sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))) {
    const group = groups.at(-1);
    // Bound the entire cluster, preventing chains of adjacent levels from spanning many ATR.
    if (group && l.price - group[0]!.price <= atr * radius) group.push(l); else groups.push([l]);
  }
  const used = new Set<string>();
  return groups.map(members => {
    const price = mean(members.map(x => x.price));
    const match = previous.filter(x => !used.has(x.key) && Math.abs(x.price - price) <= atr * radius)
      .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
    const key = match?.key ?? members.map(x => x.id).sort().join('|'); used.add(key);
    return { key, price, members, types: [...new Set(members.map(x => x.type))], autoTouches: Math.max(0, ...members.filter(x => x.type !== 'manual').map(x => x.touches)), autoStrength: Math.max(0, ...members.filter(x => x.type !== 'manual').map(x => x.strength)) };
  });
}
export function detectRelativeStrength(coin: Candle[], btc: Candle[], threshold: number): FeatureResult[] {
  const a = marketAtr(coin), b = marketAtr(btc);
  const aligned = coin.at(-1)?.time === btc.at(-1)?.time && a > 0 && b > 0;
  if (!aligned) return ['BTC_RELATIVE_STRENGTH', 'FOLLOWS_MARKET', 'STRONGER_THAN_BTC', 'WEAKER_THAN_BTC', 'INDEPENDENT_MOVE'].map(key => ({ key, detected: false }));
  const values = [1, 3, 6].map(bars => aligned ? directionalMove(coin, bars, a) - directionalMove(btc, bars, b) : 0);
  const value = values[1]!;
  return [
    { key: 'BTC_RELATIVE_STRENGTH', detected: aligned, value, details: { m5: values[0], m15: values[1], m30: values[2] } },
    { key: 'FOLLOWS_MARKET', detected: aligned && values.every(x => Math.abs(x) < threshold), value },
    { key: 'STRONGER_THAN_BTC', detected: aligned && value >= threshold, value },
    { key: 'WEAKER_THAN_BTC', detected: aligned && value <= -threshold, value },
    { key: 'INDEPENDENT_MOVE', detected: aligned && Math.abs(value) >= threshold, value },
  ];
}

export function scoreMarketFeatures(features: FeatureResult[], s: MarketMonitorSettings): MarketScores {
  const contributions: ScoreWeights = { approach: {}, breakout: {}, rejection: {} };
  for (const group of ['approach', 'breakout', 'rejection'] as const) {
    for (const [key, weight] of Object.entries(s.scoreWeights[group])) if (features.some(f => f.key === key && f.detected)) contributions[group][key] = weight;
  }
  const total = (g: keyof ScoreWeights) => Object.values(contributions[g]).reduce((sum, v) => sum + v, 0);
  const approach = total('approach'), breakout = total('breakout'), rejection = total('rejection');
  return { approach, breakout, rejection, priority: priorityForScore(Math.max(approach, breakout, rejection)), conflict: Math.max(breakout, rejection) >= s.setupThreshold && Math.min(breakout, rejection) > 0 && Math.abs(breakout - rejection) < s.scoreDelta, contributions };
}

export function postBreak(c: Candle[], level: number, atr: number, s: MarketMonitorSettings) {
  // Require a closed bar AFTER the cross, then evaluate at most three subsequent bars.
  for (let age = 1; age <= s.postBreakBars; age++) {
    const index = c.length - 1 - age;
    if (index < 1) continue;
    const before = c[index - 1]!, cross = c[index]!;
    const direction = before.close <= level && cross.close > level ? 1 : before.close >= level && cross.close < level ? -1 : 0;
    if (!direction) continue;
    const after = c.slice(index + 1);
    const impulse = after.some(x => (x.close - cross.close) * direction >= atr * s.postBreakImpulseAtr);
    const returned = (c.at(-1)!.close - level) * direction < 0;
    return { crossed: true, impulse, noImpulse: !impulse && (age === s.postBreakBars || returned), returned, direction, age };
  }
  return { crossed: false, impulse: false, noImpulse: false, returned: false, direction: 0, age: 0 };
}

export function analyzeMarket(input: { symbol: string; m5: Candle[]; h1: Candle[]; h4: Candle[]; daily: Candle[]; btc: Candle[]; clusters: LevelCluster[]; settings: MarketMonitorSettings }): MarketObservation[] {
  const { symbol, m5: c, h1, h4, daily, btc, clusters, settings: s } = input;
  const atr = marketAtr(c);
  if (c.length < 30 || atr <= 0) return [];
  const now = c.at(-1)!; const move3 = directionalMove(c, 3, atr), move6 = directionalMove(c, 6, atr);
  const sign = Math.sign(move3 || move6);
  const efficiency = directionalEfficiency(c);
  const volumes = c.slice(-21, -1).map(x => x.volume ?? 0), baseline = mean(volumes);
  const volumeRatio = baseline ? (now.volume ?? 0) / baseline : 0;
  const expansion = detectAtrExpansion(c, s.atrExpansionThreshold), bars = detectBarSizes(c, atr, s);
  const compression = detectCompression(c, s), noPullback = detectNoPullback(c, atr, s);
  const dailyAtr = marketAtr(daily), accumulation = range(c.slice(-6)) <= atr * s.accumulationRangeAtr;
  const relative = detectRelativeStrength(c, btc, s.relativeStrengthThreshold);
  const ahead = clusters.filter(x => (x.price - now.close) * sign > 0).sort((a, b) => Math.abs(a.price - now.close) - Math.abs(b.price - now.close))[0];
  return clusters.filter(l => l === ahead || postBreak(c, l.price, atr, s).crossed).map(cluster => {
    const d = levelDistance(now.close, c.at(-4)!.close, cluster.price, atr);
    const post = postBreak(c, cluster.price, atr, s);
    const direction = post.crossed ? post.direction : sign;
    const levelAhead = (cluster.price - now.close) * direction > 0;
    // Exclude the active day/episode: touching the level now must not erase its historical age.
    const history = daily.filter(x => x.time + 86400 <= Math.floor(now.time / 86400) * 86400);
    const episodes = touchEpisodes(history, cluster.price, atr * s.touchToleranceAtr, s.touchEpisodeGapBars);
    const lastTouchAt = episodes.at(-1)?.last ?? null;
    const sticking = c.slice(-s.stickingBars).every(x => Math.abs(x.close - cluster.price) / atr <= s.closeNearAtr);
    const beyond = clusters.filter(x => (x.price - cluster.price) * direction > 0).sort((a, b) => Math.abs(a.price - cluster.price) - Math.abs(b.price - cluster.price))[0];
    const room = beyond ? Math.abs(beyond.price - cluster.price) / atr : null;
    const aligned = [h1, h4, daily].every(x => x.length >= 7 && Math.sign(directionalMove(x, 6, marketAtr(x))) === direction);
    const f: FeatureResult[] = [];
    const add = (key: string, detected: boolean, value?: number) => f.push({ key, detected, ...(value === undefined ? {} : { value }) });
    add('LEVEL_AHEAD', levelAhead); add('AUTO_LEVEL', cluster.types.some(x => x !== 'manual'));
    add('MANUAL_LEVEL', cluster.types.includes('manual')); add('MIRROR_LEVEL', cluster.types.includes('mirror')); add('LEVEL_CLUSTER', cluster.members.length > 1, cluster.members.length);
    f.push(...detectRetestAge(lastTouchAt, now.time, s), expansion, ...bars, compression, noPullback, ...relative);
    add('DIRECTIONAL_EFFICIENCY', efficiency >= s.directionalEfficiencyThreshold, efficiency);
    add('DIRECTIONAL_MOVE', Math.abs(move3) >= s.directionalMoveAtr && efficiency >= s.directionalEfficiencyThreshold, move3);
    add('DISTANCE_SHRINKING', levelAhead && d.approachVelocity > 0, d.approachVelocity);
    add('VOLUME_EXPANSION', volumeRatio > s.volumeExpansionThreshold, volumeRatio);
    add('SMALL_BARS_APPROACH', levelAhead && bars[0]!.detected && d.approachVelocity > 0);
    // Big bars alone are insufficient; a directional impulse must accompany them.
    add('BIG_BARS_APPROACH', levelAhead && bars[1]!.detected && Math.abs(move3) >= s.directionalMoveAtr && efficiency >= s.directionalEfficiencyThreshold && !compression.detected);
    add('STICKING_TO_LEVEL', sticking); add('SIMPLE_ACCUMULATION', accumulation); add('ACCUMULATION', accumulation);
    add('CLOSE_NEAR_LEVEL', d.distanceAtr <= s.closeNearAtr, d.distanceAtr);
    add('CLOSE_FAR_FROM_LEVEL', d.distanceAtr >= s.closeFarAtr, d.distanceAtr);
    add('NO_ACCUMULATION', !accumulation && !compression.detected);
    add('STRONG_LEVEL_AHEAD', levelAhead && (cluster.types.includes('mirror') || cluster.autoTouches >= s.strongLevelTouches || cluster.autoStrength >= s.strongLevelStrength));
    const dayBars = c.filter(x => Math.floor(x.time / 86400) === Math.floor(now.time / 86400));
    const dayComplete = dayBars[0]?.time === Math.floor(now.time / 86400) * 86400;
    const dailyUsed = dailyAtr > 0 && dayComplete ? range(dayBars) / dailyAtr : null;
    add('HIGH_DAILY_ATR_USED', dailyUsed !== null && dailyUsed >= s.dailyAtrUsedThreshold, dailyUsed ?? undefined);
    add('GLOBAL_LOCAL_TREND_ALIGNED', aligned);
    add('COUNTER_TREND_JERK', h4.length >= 7 && Math.sign(directionalMove(h4, 6, marketAtr(h4))) === -direction && Math.abs(move3) >= s.directionalMoveAtr);
    add('ROOM_TO_NEXT_LEVEL', room !== null && room >= s.roomToNextLevelAtr, room ?? undefined);
    // "Empty space" is limited to the observed level/history window, never inferred from missing data.
    add('EMPTY_SPACE_AFTER_LEVEL', room !== null && room >= s.roomToNextLevelAtr && daily.length >= 30);
    add('HTF_ACCUMULATION', [h1, h4].every(x => x.length >= 15 && range(x.slice(-6)) <= marketAtr(x) * s.accumulationRangeAtr));
    add('EXTREME', daily.length >= 30 && (direction > 0 ? cluster.price >= Math.max(...daily.slice(-30).map(x => x.high)) : cluster.price <= Math.min(...daily.slice(-30).map(x => x.low))));
    const wick = direction > 0 ? now.high - now.close : now.close - now.low;
    add('CLOSE_WITHOUT_WICK_TOWARD_LEVEL', d.distanceAtr <= s.closeNearAtr && wick <= atr * s.touchToleranceAtr, wick / atr);
    const strong = c.slice(-4, -1).find(x => (x.close - x.open) * direction >= atr * s.bigBarAtr);
    add('NO_PULLBACK_AFTER_STRONG_BAR', !!strong && c.filter(x => x.time > strong.time).every(x => (x.close - strong.close) * direction >= -atr * s.touchToleranceAtr));
    const falseBreak = c.slice(-4, -1).find(x => direction > 0 ? x.high > cluster.price && x.close < cluster.price : x.low < cluster.price && x.close > cluster.price);
    add('NO_PULLBACK_AFTER_FALSE_BREAK', !!falseBreak && sticking && c.filter(x => x.time > falseBreak.time).every(x => Math.abs(x.close - cluster.price) <= atr * s.closeNearAtr));
    add('BREAKOUT', post.crossed); add('POST_BREAK_IMPULSE', post.impulse); add('NO_IMPULSE_AFTER_BREAK', post.noImpulse); add('FALSE_BREAK_RETURN', post.returned);
    const fast = levelAhead && d.distanceAtr <= s.maxDistanceAtr && d.approachVelocity > 0 && Math.abs(move3) >= s.directionalMoveAtr && efficiency >= s.directionalEfficiencyThreshold && scoreMarketFeatures(f, s).approach >= s.fastApproachThreshold;
    add('FAST_APPROACH', fast);
    const scores = scoreMarketFeatures(f, s);
    for (const feature of f) {
      feature.scoreApproach = scores.contributions.approach[feature.key] ?? 0;
      feature.scoreBreakout = scores.contributions.breakout[feature.key] ?? 0;
      feature.scoreRejection = scores.contributions.rejection[feature.key] ?? 0;
    }
    const nearby = levelAhead && d.distanceAtr <= s.maxDistanceAtr;
    const scenario = post.returned && post.noImpulse ? 'FALSE_BREAKOUT' : post.impulse && !post.returned ? 'BREAKOUT_CONFIRMED'
      : nearby && !scores.conflict && scores.breakout >= s.setupThreshold && scores.breakout - scores.rejection >= s.scoreDelta ? 'BREAKOUT_SETUP'
      : nearby && !scores.conflict && scores.rejection >= s.setupThreshold && scores.rejection - scores.breakout >= s.scoreDelta ? 'REJECTION_SETUP'
      : fast ? 'FAST_APPROACH' : null;
    return { symbol, barTime: now.time, price: now.close, direction: direction > 0 ? 'UP' as const : 'DOWN' as const, cluster, features: f, scores, scenario,
      metrics: { atr, atrExpansion: expansion.value ?? 0, move3, move6, efficiency, volumeRatio, ...d, lastTouchAt, daysSinceLastTouch: lastTouchAt === null ? null : (now.time - lastTouchAt) / 86400, touchCount: episodes.length, touchHistoryDays: history.length, dailyAtrUsed: dailyUsed, roomToNextLevelAtr: room, relativeStrength: relative[0]!.value ?? null, postBreakAge: post.age } };
  });
}

export function advanceMarketState(previous: MarketAlertState | null, observation: MarketObservation, s: MarketMonitorSettings, now: number) {
  const scenario = observation.scenario ?? previous?.scenario ?? 'FAST_APPROACH';
  const distance = observation.metrics.distanceAtr ?? Infinity;
  const score = scenario === 'FAST_APPROACH' ? observation.scores.approach : scenario === 'REJECTION_SETUP' || scenario === 'FALSE_BREAKOUT' ? observation.scores.rejection : observation.scores.breakout;
  const freshBar = !previous || observation.barTime > previous.lastBarTime;
  const reset = distance > s.resetDistanceAtr;
  const cooldown = !previous?.lastAlertAt || now - previous.lastAlertAt >= s.cooldownMinutes * 60000;
  const changed = !previous || previous.lastAlertAt === null || previous.state === 'RESET' || score >= previous.lastScore + s.scoreIncrease;
  const alert = freshBar && !reset && !!observation.scenario && cooldown && changed;
  const state: MarketAlertState = { symbol: observation.symbol, levelKey: observation.cluster.key, scenario,
    state: reset ? 'RESET' : observation.features.some(x => x.key === 'BREAKOUT' && x.detected) ? 'BROKEN' : distance <= s.touchToleranceAtr ? 'TESTING' : alert ? 'ALERTED' : distance <= s.maxDistanceAtr ? 'APPROACHING' : 'IDLE',
    lastAlertAt: alert ? now : previous?.lastAlertAt ?? null, lastScore: alert ? score : previous?.lastScore ?? 0, lastDistanceAtr: distance, lastBarTime: observation.barTime };
  // A reset remains armed until a qualifying scenario actually consumes it.
  if (previous?.state === 'RESET' && !alert && !reset) state.state = 'RESET';
  return { state, alert };
}

export function selectMarketUniverse(tickers: { symbol: string; turnover24h: number }[], eligible: Set<string>, previousAuto: Set<string>, watchlist: string[], manual: string[], s: MarketMonitorSettings) {
  const result = new Map<string, { symbol: string; sources: string[]; turnover: number }>();
  const turnover = new Map(tickers.map(x => [x.symbol, x.turnover24h]));
  const add = (symbol: string, source: string) => {
    if (!eligible.has(symbol)) return;
    const row = result.get(symbol) ?? { symbol, sources: [], turnover: turnover.get(symbol) ?? 0 };
    if (!row.sources.includes(source)) row.sources.push(source); result.set(symbol, row);
  };
  if (s.universeMode !== 'WATCHLIST') tickers.filter(x => eligible.has(x.symbol) && x.turnover24h >= (previousAuto.has(x.symbol) ? s.exitTurnover : s.minTurnover))
    .sort((a, b) => b.turnover24h - a.turnover24h).slice(0, s.maxAutoSymbols).forEach(x => add(x.symbol, 'auto'));
  if (s.universeMode !== 'AUTO') watchlist.forEach(x => add(x, 'watchlist'));
  if (s.alwaysMonitorManualLevels) manual.forEach(x => add(x, 'manual'));
  return [...result.values()];
}

export function formatMarketNotification(o: MarketObservation) {
  const m = o.metrics; const n = (v: number | null | undefined) => v == null ? '—' : v.toFixed(2);
  const checklist = (group: 'breakout' | 'rejection') => Object.entries(o.scores.contributions[group]).map(([key, weight]) => `✓ ${key.replaceAll('_', ' ')} +${weight}`).join('\n') || 'Нет подтверждённых признаков';
  return `${o.symbol} · ${o.scenario ?? 'OBSERVATION'} · ${o.scores.priority}${o.scores.conflict ? ' · MIXED / CONFLICTING' : ''}\n\n${o.direction === 'UP' ? '↑' : '↓'} ${o.cluster.types.join(' + ')}\nLevel: ${o.cluster.price}\nPrice: ${o.price}\nDistance: ${n(m.distanceAtr)} ATR · ${n(m.distancePercent)}%\n15m move: ${n(m.move3)} ATR\nATR expansion: ${n(m.atrExpansion)}×\nVolume: ${n(m.volumeRatio)}×\n\nREJECTION / LP: ${o.scores.rejection}\n${checklist('rejection')}\n\nBREAKOUT: ${o.scores.breakout}\n${checklist('breakout')}\n\nTouches: ${m.touchCount}\nLast touch: ${n(m.daysSinceLastTouch)} days\nApproach: ${o.scores.approach}\nPriority: ${o.scores.priority}`;
}
