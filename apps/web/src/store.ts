import { create } from 'zustand';
import type { DrawingTool, RiskReward } from '@trade/shared';

const storage = {
  getString(key: string, fallback: string) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  },
  getNumber(key: string, fallback: number) {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch { return fallback; }
  },
  set(key: string, value: string | number) {
    try { localStorage.setItem(key, String(value)); } catch { /* localStorage may be unavailable */ }
  },
};

const urlSymbol = new URLSearchParams(location.search).get('symbol');

interface UiState {
  symbol: string;
  timeframe: string;
  tool: DrawingTool;
  drawerOpen: boolean;
  selectedRiskReward: RiskReward | null;
  selectedAccountId: number;
  calculatorPriceLevel: number | null;
  calculatorPriceLevelSeq: number;
  minTurnoverMillions: number;
  levelTolerancePercent: number;
  setSymbol: (v: string) => void;
  setTimeframe: (v: string) => void;
  setTool: (v: DrawingTool) => void;
  selectRiskReward: (v: RiskReward | null) => void;
  openCalculatorAtPrice: (price: number) => void;
  setDrawerOpen: (v: boolean) => void;
  setAccountId: (v: number) => void;
  setMinTurnoverMillions: (v: number) => void;
  setLevelTolerancePercent: (v: number) => void;
}

export const useUi = create<UiState>((set) => ({
  symbol: (urlSymbol || storage.getString('trade.chart.symbol', 'BTCUSDT')).toUpperCase(),
  timeframe: storage.getString('trade.chart.timeframe', '15'),
  tool: 'select',
  drawerOpen: false,
  selectedRiskReward: null,
  selectedAccountId: 2,
  calculatorPriceLevel: null,
  calculatorPriceLevelSeq: 0,
  minTurnoverMillions: storage.getNumber('trade.chart.minTurnoverMillions', 50),
  levelTolerancePercent: storage.getNumber('trade.chart.levelTolerancePercent', 10),

  setSymbol: (symbol) => {
    const normalized = symbol.toUpperCase();
    storage.set('trade.chart.symbol', normalized);
    set({
      symbol: normalized,
      selectedRiskReward: null,
      calculatorPriceLevel: null,
    });
  },

  setTimeframe: (timeframe) => {
    storage.set('trade.chart.timeframe', timeframe);
    set({ timeframe, selectedRiskReward: null });
  },

  setTool: (tool) => set({ tool }),

  selectRiskReward: (selectedRiskReward) => set({
    selectedRiskReward,
    calculatorPriceLevel: selectedRiskReward?.entry ?? null,
    drawerOpen: Boolean(selectedRiskReward),
  }),

  openCalculatorAtPrice: (price) => set((state) => ({
    selectedRiskReward: null,
    calculatorPriceLevel: price,
    calculatorPriceLevelSeq: state.calculatorPriceLevelSeq + 1,
    drawerOpen: true,
    tool: 'select',
  })),

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setAccountId: (selectedAccountId) => set({ selectedAccountId }),

  setMinTurnoverMillions: (minTurnoverMillions) => {
    storage.set('trade.chart.minTurnoverMillions', minTurnoverMillions);
    set({ minTurnoverMillions });
  },

  setLevelTolerancePercent: (levelTolerancePercent) => {
    storage.set('trade.chart.levelTolerancePercent', levelTolerancePercent);
    set({ levelTolerancePercent });
  },
}));
