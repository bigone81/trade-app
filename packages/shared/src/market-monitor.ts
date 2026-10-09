export type MarketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type MarketScenario = 'FAST_APPROACH' | 'BREAKOUT_SETUP' | 'REJECTION_SETUP' | 'FALSE_BREAKOUT' | 'BREAKOUT_CONFIRMED';
export type MarketPhase = 'IDLE' | 'APPROACHING' | 'ALERTED' | 'TESTING' | 'BROKEN' | 'RESET';
export type ScoreWeights = Record<'approach' | 'breakout' | 'rejection', Record<string, number>>;

export const defaultScoreWeights: ScoreWeights = {
  approach: { DIRECTIONAL_MOVE: 2, ATR_EXPANSION: 2, VOLUME_EXPANSION: 1, DISTANCE_SHRINKING: 2, LEVEL_AHEAD: 2, MANUAL_LEVEL: 2, STRONG_LEVEL_AHEAD: 1, INDEPENDENT_MOVE: 1 },
  breakout: { SMALL_BARS_APPROACH: 3, STICKING_TO_LEVEL: 3, COMPRESSION: 3, ACCUMULATION: 2, CLOSE_NEAR_LEVEL: 2, NEAR_RETEST: 2, NO_PULLBACK_AFTER_FALSE_BREAK: 3, NO_PULLBACK_AFTER_STRONG_BAR: 3, CLOSE_WITHOUT_WICK_TOWARD_LEVEL: 2, EMPTY_SPACE_AFTER_LEVEL: 2, GLOBAL_LOCAL_TREND_ALIGNED: 2, ROOM_TO_NEXT_LEVEL: 2, HTF_ACCUMULATION: 2 },
  rejection: { LONG_NO_PULLBACK_MOVE: 3, BIG_BARS_APPROACH: 3, ATR_EXPANSION: 2, HIGH_DAILY_ATR_USED: 2, CLOSE_FAR_FROM_LEVEL: 2, FAR_RETEST: 3, NO_ACCUMULATION: 2, EXTREME: 2, FAST_APPROACH: 2, COUNTER_TREND_JERK: 1, NO_IMPULSE_AFTER_BREAK: 4, STRONG_LEVEL_AHEAD: 2 },
};

export const marketNumericDefaults = {
  minTurnover: 50_000_000, exitTurnover: 40_000_000, maxAutoSymbols: 100,
  universeRefreshMinutes: 15, cooldownMinutes: 30, nearRetestDays: 10, farRetestDays: 30,
  levelClusterAtr: 0.12, touchToleranceAtr: 0.10, touchEpisodeGapBars: 1,
  atrExpansionThreshold: 1.4, directionalEfficiencyThreshold: 0.7, directionalMoveAtr: 0.8,
  fastApproachThreshold: 5, setupThreshold: 5, scoreDelta: 3, scoreIncrease: 3,
  maxDistanceAtr: 1, resetDistanceAtr: 1.5, closeNearAtr: 0.25, closeFarAtr: 0.75,
  volumeExpansionThreshold: 1.5, smallBarAtr: 0.8, bigBarAtr: 1.4,
  compressionRatio: 0.7, accumulationRangeAtr: 1, stickingBars: 3,
  relativeStrengthThreshold: 0.8, noPullbackMoveAtr: 1.5, dailyAtrUsedThreshold: 0.8,
  roomToNextLevelAtr: 2, postBreakBars: 3, postBreakImpulseAtr: 0.5,
  strongLevelTouches: 3, strongLevelStrength: 3,
  scanDelaySeconds: 5, concurrency: 2,
};
export type MarketNumericKey = keyof typeof marketNumericDefaults;
export type MarketMonitorSettings = typeof marketNumericDefaults & {
  enabled: boolean; universeMode: 'AUTO' | 'WATCHLIST' | 'HYBRID';
  alwaysMonitorManualLevels: boolean; telegramEnabled: boolean; minPriority: MarketPriority;
  scanTimeframe: '5'; scoreWeights: ScoreWeights;
};
export const defaultMarketMonitorSettings: MarketMonitorSettings = {
  ...marketNumericDefaults, enabled: false, universeMode: 'HYBRID', alwaysMonitorManualLevels: true,
  telegramEnabled: false, minPriority: 'HIGH', scanTimeframe: '5', scoreWeights: defaultScoreWeights,
};

/** Bounds are shared by the API and form; all settings have finite, explicit limits. */
export const marketNumericBounds: Record<MarketNumericKey, readonly [number, number, boolean?]> = {
  minTurnover: [0, 1e12], exitTurnover: [0, 1e12], maxAutoSymbols: [1, 500, true],
  universeRefreshMinutes: [10, 15, true], cooldownMinutes: [1, 1440], nearRetestDays: [0, 365], farRetestDays: [1, 365],
  levelClusterAtr: [0.01, 1], touchToleranceAtr: [0.01, 1], touchEpisodeGapBars: [0, 20, true],
  atrExpansionThreshold: [1, 10], directionalEfficiencyThreshold: [0, 1], directionalMoveAtr: [0.1, 20],
  fastApproachThreshold: [1, 100], setupThreshold: [1, 100], scoreDelta: [1, 100], scoreIncrease: [1, 100],
  maxDistanceAtr: [0.1, 10], resetDistanceAtr: [0.2, 20], closeNearAtr: [0.01, 3], closeFarAtr: [0.1, 10],
  volumeExpansionThreshold: [1, 20], smallBarAtr: [0.1, 3], bigBarAtr: [0.2, 10],
  compressionRatio: [0.1, 0.99], accumulationRangeAtr: [0.1, 5], stickingBars: [2, 10, true],
  relativeStrengthThreshold: [0.1, 10], noPullbackMoveAtr: [0.1, 20], dailyAtrUsedThreshold: [0.1, 3],
  roomToNextLevelAtr: [0.1, 20], postBreakBars: [1, 3, true], postBreakImpulseAtr: [0.1, 5],
  strongLevelTouches: [2, 50, true], strongLevelStrength: [1, 100], scanDelaySeconds: [3, 10, true], concurrency: [1, 5, true],
};

export interface FeatureResult {
  key: string; detected: boolean; value?: number; details?: Record<string, unknown>;
  scoreApproach?: number; scoreBreakout?: number; scoreRejection?: number;
}
export interface MonitorLevel {
  id: string; price: number; type: 'manual' | 'support' | 'resistance' | 'mirror';
  touches: number; strength: number; dates: string[];
}
export interface LevelCluster {
  key: string; price: number; types: MonitorLevel['type'][]; members: MonitorLevel[];
  autoTouches: number; autoStrength: number;
}
export interface MarketScores {
  approach: number; breakout: number; rejection: number; priority: MarketPriority;
  conflict: boolean; contributions: ScoreWeights;
}
export interface MarketObservation {
  symbol: string; barTime: number; price: number; direction: 'UP' | 'DOWN'; cluster: LevelCluster;
  features: FeatureResult[]; metrics: Record<string, number | null>; scores: MarketScores;
  scenario: MarketScenario | null;
  /** Reserved extension point for Phase 2 entry formations. */
  formation?: { kind: 'TVH1' | 'TVH2' | 'TVH3'; stage: string };
}
export interface MarketSignal extends MarketObservation { id: number; notified: boolean; notificationId: number | null; createdAt: string; }
export interface MarketAlertState {
  symbol: string; levelKey: string; scenario: MarketScenario; state: MarketPhase;
  lastAlertAt: number | null; lastScore: number; lastDistanceAtr: number; lastBarTime: number;
}
export interface MarketSymbol {
  symbol: string; sources: string[]; turnover: number; observation: MarketObservation | null;
  lastSignal: { scenario: MarketScenario; at: string } | null; error: string | null; scannedAt: string | null;
}
export interface MarketMonitorStatus {
  workerStatus: 'OFFLINE' | 'DISABLED' | 'STARTING' | 'SCANNING' | 'LIVE' | 'DEGRADED';
  heartbeatAt: string | null; lastScan: string | null; nextScan: string | null;
  monitoring: number; auto: number; watchlist: number; manual: number;
  symbolsScanned: number; requestsMade: number; cycleDurationMs: number; errors: number; signalsDetected: number; alertsSent: number;
  rateLimitHits?: number; retryCount?: number; backoffMs?: number; effectiveRps?: number;
  requestsSucceeded?: number; requestsFailed?: number;
  error: string | null;
}
