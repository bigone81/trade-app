import { create } from 'zustand';
import type { DrawingTool, RiskReward } from '@trade/shared';

const readNumber = (key: string, fallback: number) => {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
};

const readText = (key: string, fallback: string) =>
  localStorage.getItem(key) || fallback;

interface UiState {
  symbol: string;
  timeframe: string;
  tool: DrawingTool;
  drawerOpen: boolean;
  selectedRiskReward: RiskReward | null;
  selectedAccountId: number;

  // Price explicitly sent from a chart level to the calculator.
  calculatorPriceLevel: number | null;
  // Increments even when the same price is clicked twice so CalculatorDrawer
  // can react to every explicit chart -> calculator action.
  calculatorPriceLevelSeq: number;

  minTurnoverMillions: number;
  levelTolerancePercent: number;

  setSymbol: (v: string) => void;
  setTimeframe: (v: string) => void;
  setTool: (v: DrawingTool) => void;
  selectRiskReward: (v: RiskReward | null) => void;
  setDrawerOpen: (v: boolean) => void;
  setAccountId: (v: number) => void;
  openCalculatorAtPrice: (price: number) => void;
  setMinTurnoverMillions: (v: number) => void;
  setLevelTolerancePercent: (v: number) => void;
}

export const useUi = create<UiState>((set) => ({
  symbol: (
    new URLSearchParams(location.search).get('symbol') ||
    readText('trade.lastSymbol', 'BTCUSDT')
  ).toUpperCase(),
  timeframe: readText('trade.lastTimeframe', '15'),
  tool: 'select',
  drawerOpen: false,
  selectedRiskReward: null,
  selectedAccountId: 0,

  calculatorPriceLevel: null,
  calculatorPriceLevelSeq: 0,

  minTurnoverMillions: readNumber('trade.scanner.minTurnoverMillions', 50),
  levelTolerancePercent: readNumber('trade.scanner.levelTolerancePercent', 10),

  setSymbol: (symbol) => {
    const value = symbol.toUpperCase();
    localStorage.setItem('trade.lastSymbol', value);
    set((state) => ({
      symbol: value,
      selectedRiskReward: null,
      calculatorPriceLevel: null,
      calculatorPriceLevelSeq: state.calculatorPriceLevelSeq + 1,
    }));
  },

  setTimeframe: (timeframe) => {
    localStorage.setItem('trade.lastTimeframe', timeframe);
    set({ timeframe });
  },

  setTool: (tool) => set({ tool }),

  selectRiskReward: (selectedRiskReward) =>
    set({ selectedRiskReward }),

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),

  setAccountId: (selectedAccountId) => set({ selectedAccountId }),

  openCalculatorAtPrice: (price) => {
    if (!Number.isFinite(price) || price <= 0) return;
    set((state) => ({
      calculatorPriceLevel: price,
      calculatorPriceLevelSeq: state.calculatorPriceLevelSeq + 1,
      selectedRiskReward: null,
      drawerOpen: true,
    }));
  },

  setMinTurnoverMillions: (minTurnoverMillions) => {
    localStorage.setItem(
      'trade.scanner.minTurnoverMillions',
      String(minTurnoverMillions),
    );
    set({ minTurnoverMillions });
  },

  setLevelTolerancePercent: (levelTolerancePercent) => {
    localStorage.setItem(
      'trade.scanner.levelTolerancePercent',
      String(levelTolerancePercent),
    );
    set({ levelTolerancePercent });
  },
}));
