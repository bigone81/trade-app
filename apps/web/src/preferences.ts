import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AppLanguage = 'en' | 'uk' | 'ru';
export type LevelLineStyle = 'solid' | 'dashed' | 'dotted';
export type TradingOverlayLabelMode = 'full' | 'compact' | 'price';

export interface AppPreferences {
  theme: ThemeMode;
  language: AppLanguage;
  defaultRiskPercent: number;
  defaultAccountId: number;
  accountRiskPercent: Record<string, number | null>;
  manualLevel: {
    colorMode: 'auto' | 'custom';
    color: string;
    width: 1 | 2 | 3;
    style: LevelLineStyle;
    opacity: number;
    showPriceLabel: boolean;
  };
  riskReward: {
    defaultRatio: number;
    defaultWidthBars: number;
    snapToLevels: boolean;
    snapPixels: number;
  };
  chart: {
    futureBars: number;
    showGrid: boolean;
    showCurrentPriceLine: boolean;
    autoFollowLive: boolean;
  };
  tradingOverlays: {
    showOrders: boolean;
    showPositions: boolean;
    showStopLoss: boolean;
    showTakeProfit: boolean;
    showLiquidation: boolean;
    showAccountName: boolean;
    showOrderSize: boolean;
    showPnl: boolean;
    labelMode: TradingOverlayLabelMode;
    lineWidth: 1 | 2 | 3;
    opacity: number;
    orderStyle: LevelLineStyle;
    positionStyle: LevelLineStyle;
    stopStyle: LevelLineStyle;
    targetStyle: LevelLineStyle;
    accountIds: number[];
    allowDragOrders: boolean;
    allowDragStops: boolean;
    allowDragTargets: boolean;
    confirmChanges: boolean;
  };
}

const KEY = 'trade.settings.v1';
const EVENT = 'trade-settings-changed';

export const defaultPreferences: AppPreferences = {
  theme: 'dark',
  language: 'en',
  defaultRiskPercent: 0.5,
  defaultAccountId: 0,
  accountRiskPercent: {},
  manualLevel: {
    colorMode: 'auto',
    color: '#64748b',
    width: 1,
    style: 'solid',
    opacity: 0.9,
    showPriceLabel: true,
  },
  riskReward: {
    defaultRatio: 3,
    defaultWidthBars: 30,
    snapToLevels: true,
    snapPixels: 8,
  },
  chart: {
    futureBars: 24,
    showGrid: true,
    showCurrentPriceLine: true,
    autoFollowLive: true,
  },
  tradingOverlays: {
    showOrders: true,
    showPositions: true,
    showStopLoss: true,
    showTakeProfit: true,
    showLiquidation: false,
    showAccountName: true,
    showOrderSize: true,
    showPnl: false,
    labelMode: 'full',
    lineWidth: 1,
    opacity: 0.95,
    orderStyle: 'solid',
    positionStyle: 'solid',
    stopStyle: 'dashed',
    targetStyle: 'dashed',
    accountIds: [],
    allowDragOrders: true,
    allowDragStops: true,
    allowDragTargets: true,
    confirmChanges: true,
  },
};

function mergePreferences(raw: Partial<AppPreferences> | null): AppPreferences {
  return {
    ...defaultPreferences,
    ...(raw || {}),
    accountRiskPercent: { ...defaultPreferences.accountRiskPercent, ...(raw?.accountRiskPercent || {}) },
    manualLevel: { ...defaultPreferences.manualLevel, ...(raw?.manualLevel || {}) },
    riskReward: { ...defaultPreferences.riskReward, ...(raw?.riskReward || {}) },
    chart: { ...defaultPreferences.chart, ...(raw?.chart || {}) },
    tradingOverlays: { ...defaultPreferences.tradingOverlays, ...(raw?.tradingOverlays || {}) },
  };
}

export function readPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(KEY);
    return mergePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultPreferences;
  }
}

export function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(preferences = readPreferences()) {
  const theme = resolvedTheme(preferences.theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.lang = preferences.language;
}

export function writePreferences(next: AppPreferences) {
  localStorage.setItem(KEY, JSON.stringify(next));
  applyTheme(next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function patchPreferences(patch: Partial<AppPreferences>) {
  const current = readPreferences();
  writePreferences(mergePreferences({ ...current, ...patch }));
}

export function effectiveRiskPercent(preferences: AppPreferences, accountId: number) {
  const override = preferences.accountRiskPercent[String(accountId)];
  return typeof override === 'number' && Number.isFinite(override)
    ? override
    : preferences.defaultRiskPercent;
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<AppPreferences>(() => readPreferences());

  useEffect(() => {
    applyTheme(preferences);
    const listener = (event: Event) => {
      const custom = event as CustomEvent<AppPreferences>;
      setPreferences(custom.detail || readPreferences());
    };
    const storage = (event: StorageEvent) => {
      if (event.key === KEY) setPreferences(readPreferences());
    };
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const mediaChange = () => { if (readPreferences().theme === 'system') applyTheme(readPreferences()); };
    window.addEventListener(EVENT, listener);
    window.addEventListener('storage', storage);
    media?.addEventListener?.('change', mediaChange);
    return () => {
      window.removeEventListener(EVENT, listener);
      window.removeEventListener('storage', storage);
      media?.removeEventListener?.('change', mediaChange);
    };
  }, []);

  const save = (next: AppPreferences) => {
    setPreferences(next);
    writePreferences(next);
  };

  return { preferences, save };
}

export interface StoredChartView {
  fromTime: number;
  toTime: number;
}

export function chartViewKey(symbol: string, timeframe: string) {
  return `trade.chart-view.v1.${symbol.toUpperCase()}.${timeframe}`;
}

export function readChartView(symbol: string, timeframe: string): StoredChartView | null {
  try {
    const raw = localStorage.getItem(chartViewKey(symbol, timeframe));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.fromTime) || !Number.isFinite(parsed?.toTime) || parsed.toTime <= parsed.fromTime) return null;
    return { fromTime: Number(parsed.fromTime), toTime: Number(parsed.toTime) };
  } catch {
    return null;
  }
}

export function writeChartView(symbol: string, timeframe: string, view: StoredChartView) {
  try {
    localStorage.setItem(chartViewKey(symbol, timeframe), JSON.stringify(view));
  } catch {
    // Browser privacy/storage restrictions should not break the chart.
  }
}

export function clearChartViews() {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith('trade.chart-view.v1.')) localStorage.removeItem(key);
  }
}
