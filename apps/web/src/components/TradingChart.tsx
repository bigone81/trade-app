import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BarSeries,
  ColorType,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type {
  AlertRecord,
  AutoLevel,
  Candle,
  DrawingTool,
  ManualLevel,
  RiskReward,
  TradeExecution,
  TradingOverlayLine,
} from '@trade/shared';
import RiskRewardOverlay from './RiskRewardOverlay';
import { readChartView, resolvedTheme, usePreferences, writeChartView } from '../preferences';
import { useI18n } from '../i18n';

interface Props {
  symbol: string;
  candles: Candle[];
  autoLevels: AutoLevel[];
  manualLevels: ManualLevel[];
  alerts: AlertRecord[];
  riskRewards: RiskReward[];
  tradingLines: TradingOverlayLine[];
  executions: TradeExecution[];
  liveTradingEnabled: boolean;
  tool: DrawingTool;
  selectedRiskReward: RiskReward | null;
  timeframe: string;
  tickSize: string | null;
  onCreateLevel: (price: number) => void;
  onCreateAlert: (price: number) => void;
  onCreateRiskReward: (r: Omit<RiskReward, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onSelectRiskReward: (r: RiskReward) => void;
  onUpdateRiskReward: (id: number, p: Partial<RiskReward>) => void;
  onUpdateLevel: (id: number, price: number) => void;
  onUpdateAlert: (id: number, price: number) => void;
  onDeleteLevel: (id: number) => void;
  onDeleteAlert: (id: number) => void;
  onDeleteRiskReward: (id: number) => void;
  onRequestTradingLineChange: (line: TradingOverlayLine, price: number) => void;
  onUsePriceLevel: (price: number) => void;
  onLivePrice?: (price: number) => void;
}

type RrDraft = { entry?: number; startTime?: number };
type RrHover = { price: number; time: number } | null;
type PriceDrag = {
  kind: 'level' | 'alert';
  id: number;
  originalPrice: number;
  price: number;
  startY: number;
  moved: boolean;
};
type TradingDrag = { line: TradingOverlayLine; originalPrice: number; price: number; startY: number; moved: boolean };
type WsState = 'connecting' | 'live' | 'reconnecting' | 'offline';

const DEFAULT_FUTURE_BARS = 24;

const decimalsFromTickSize = (tickSize: string) => {
  const text = String(tickSize || '').trim().toLowerCase();
  const scientific = text.match(/^([0-9]+(?:\.[0-9]+)?)e-([0-9]+)$/);
  if (scientific) {
    const coefficientDecimals = (scientific[1]!.split('.')[1] || '').replace(/0+$/, '').length;
    return Math.max(0, Number(scientific[2]) + coefficientDecimals);
  }
  const fraction = (text.split('.')[1] || '').replace(/0+$/, '');
  return fraction.length;
};

const chartPriceFormat = (tickSize: string | null, fallbackPrice = 0) => {
  const minMove = Number(tickSize);
  if (Number.isFinite(minMove) && minMove > 0) {
    return { type: 'price' as const, precision: decimalsFromTickSize(String(tickSize)), minMove };
  }

  // Temporary fallback while instrument metadata is loading. This prevents a
  // low-priced symbol from inheriting the previous symbol's 2-decimal format.
  const value = Math.abs(fallbackPrice);
  const precision = value > 0 && value < 0.01 ? 6 : value < 1 ? 4 : 2;
  return { type: 'price' as const, precision, minMove: 10 ** -precision };
};

const formatPriceByTick = (price: number, tickSize: string | null) => {
  const format = chartPriceFormat(tickSize, price);
  return Number(price).toFixed(format.precision);
};

type TradingLineGroup = {
  key: string;
  lines: TradingOverlayLine[];
  representative: TradingOverlayLine;
  price: number;
  qty: number;
  pnl: number;
  accountCount: number;
  linkKeys: string[];
};

type ExecutionGroup = {
  key: string;
  executions: TradeExecution[];
  side: TradeExecution['side'];
  time: number;
  price: number;
  qty: number;
  fee: number;
  accountCount: number;
  fillCount: number;
  orderCount: number;
};

type TradingLabelPlacement = {
  group: TradingLineGroup;
  lineY: number;
  labelY: number;
  text: string;
  color: string;
};

const compactNumber = (value: number) => String(Number(value.toFixed(8)));
const lineLinkKey = (line: TradingOverlayLine) => line.groupKey || line.id;
const tradingLineColor = (kind: TradingOverlayLine['kind'], theme: 'light' | 'dark') =>
  kind === 'order' ? '#4da3ff' : kind === 'position' ? (theme === 'light' ? '#263244' : '#e6edf7') : kind === 'sl' ? '#ef6675' : kind === 'tp' ? '#31c48d' : '#b783ff';

const shortOrderType = (value?: string) => {
  const type = String(value || '').toLowerCase();
  if (type.includes('limit')) return 'LMT';
  if (type.includes('market')) return 'MKT';
  if (type.includes('stop')) return 'STOP';
  return value ? String(value).slice(0, 6).toUpperCase() : 'ORD';
};

const buildTradingLineGroups = (
  lines: TradingOverlayLine[],
  mode: 'summary' | 'individual',
  tickSize: string | null,
): TradingLineGroup[] => {
  if (mode === 'individual') {
    return lines.map((line) => ({
      key: line.id,
      lines: [line],
      representative: line,
      price: line.price,
      qty: Number(line.qty || 0),
      pnl: Number(line.pnl || 0),
      accountCount: 1,
      linkKeys: [lineLinkKey(line)],
    }));
  }

  const grouped = new Map<string, TradingOverlayLine[]>();
  for (const line of lines) {
    const key = [
      line.kind,
      line.side || '',
      line.orderType || '',
      line.editTarget || '',
      formatPriceByTick(line.price, tickSize),
    ].join('|');
    const existing = grouped.get(key);
    if (existing) existing.push(line);
    else grouped.set(key, [line]);
  }

  return [...grouped.entries()].map(([key, groupLines]) => {
    const representative = groupLines[0]!;
    return {
      key,
      lines: groupLines,
      representative,
      price: representative.price,
      qty: groupLines.reduce((sum, line) => sum + (Number.isFinite(Number(line.qty)) ? Number(line.qty) : 0), 0),
      pnl: groupLines.reduce((sum, line) => sum + (Number.isFinite(Number(line.pnl)) ? Number(line.pnl) : 0), 0),
      accountCount: new Set(groupLines.map((line) => line.accountId)).size,
      linkKeys: [...new Set(groupLines.map(lineLinkKey))],
    };
  });
};


const executionCandleTime = (candles: Candle[], unixSeconds: number, timeframe: string) => {
  if (!candles.length) return null;
  if (unixSeconds < candles[0]!.time || unixSeconds > candles[candles.length - 1]!.time + timeframeSeconds(timeframe)) return null;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (candles[mid]!.time <= unixSeconds) lo = mid;
    else hi = mid - 1;
  }
  return candles[lo]!.time;
};

const mergeExecutionRows = (key: string, rows: TradeExecution[], time: number): ExecutionGroup => {
  const qty = rows.reduce((sum, row) => sum + Number(row.execQty || 0), 0);
  const weighted = rows.reduce((sum, row) => sum + Number(row.execPrice || 0) * Number(row.execQty || 0), 0);
  return {
    key,
    executions: rows,
    side: rows[0]!.side,
    time,
    price: qty > 0 ? weighted / qty : Number(rows[0]!.execPrice || 0),
    qty,
    fee: rows.reduce((sum, row) => sum + Number(row.execFee || 0), 0),
    accountCount: new Set(rows.map((row) => row.accountId)).size,
    fillCount: rows.length,
    orderCount: new Set(rows.map((row) => `${row.accountId}:${row.orderId}`)).size,
  };
};

const buildExecutionGroups = (
  executions: TradeExecution[],
  symbol: string,
  timeframe: string,
  candles: Candle[],
  mode: 'summary' | 'individual',
  accountIds: number[],
): ExecutionGroup[] => {
  if (!candles.length) return [];
  const allowed = (accountId: number) => !accountIds.length || accountIds.includes(accountId);
  const normalized = executions
    .filter((execution) => execution.symbol === symbol && allowed(execution.accountId))
    .map((execution) => ({ execution, time: executionCandleTime(candles, Math.floor(execution.execTime / 1000), timeframe) }))
    .filter((row): row is { execution: TradeExecution; time: number } => row.time !== null);

  const grouped = new Map<string, { rows: TradeExecution[]; time: number }>();
  for (const { execution, time } of normalized) {
    const key = mode === 'summary'
      ? `${execution.side}|${time}`
      : `${execution.accountId}|${execution.orderId}|${execution.side}|${time}`;
    const current = grouped.get(key);
    if (current) current.rows.push(execution);
    else grouped.set(key, { rows: [execution], time });
  }

  return [...grouped.entries()]
    .map(([key, value]) => mergeExecutionRows(key, value.rows, value.time))
    .sort((a, b) => a.time - b.time || a.price - b.price);
};

const formatCrosshairTime = (time: number, language: 'en' | 'uk' | 'ru', timeframe: string) => {
  const locale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'en-US';
  const date = new Date(time * 1000);
  const datePart = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).format(date);
  if (timeframe === 'D' || timeframe === 'W') return datePart;
  const timePart = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${datePart}  ${timePart}`;
};

const rgba = (hex: string, opacity: number) => {
  const clean = hex.replace('#', '');
  const value = clean.length === 3 ? clean.split('').map((x) => x + x).join('') : clean;
  const n = Number.parseInt(value, 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, opacity))})`;
};

const toLineStyle = (style: 'solid' | 'dashed' | 'dotted') => style === 'dashed' ? LineStyle.Dashed : style === 'dotted' ? LineStyle.Dotted : LineStyle.Solid;

const timeframeSeconds = (timeframe: string) => {
  if (timeframe === 'D') return 86_400;
  if (timeframe === 'W') return 604_800;
  const minutes = Number(timeframe);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 900;
};

const intervalBucket = (unixSeconds: number, timeframe: string) => {
  const step = timeframeSeconds(timeframe);
  return Math.floor(unixSeconds / step) * step;
};

function candleTimeAtLogical(candles: Candle[], logical: number, fallbackStep: number) {
  if (!candles.length) return intervalBucket(Date.now() / 1000, String(fallbackStep / 60));
  if (candles.length === 1) return Math.round(candles[0]!.time + logical * fallbackStep);

  if (logical <= 0) {
    return Math.round(candles[0]!.time + logical * fallbackStep);
  }

  const lastIndex = candles.length - 1;
  if (logical >= lastIndex) {
    return Math.round(candles[lastIndex]!.time + (logical - lastIndex) * fallbackStep);
  }

  const base = Math.floor(logical);
  const fraction = logical - base;
  const a = candles[base]!;
  const b = candles[Math.min(lastIndex, base + 1)]!;
  const span = Math.max(1, b.time - a.time);
  return Math.round(a.time + span * fraction);
}

function logicalAtTime(candles: Candle[], time: number, fallbackStep: number) {
  if (!candles.length) return 0;
  if (candles.length === 1) return (time - candles[0]!.time) / fallbackStep;

  if (time <= candles[0]!.time) return (time - candles[0]!.time) / fallbackStep;

  const lastIndex = candles.length - 1;
  if (time >= candles[lastIndex]!.time) {
    return lastIndex + (time - candles[lastIndex]!.time) / fallbackStep;
  }

  let lo = 0;
  let hi = lastIndex;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = candles[lo]!;
  const b = candles[hi]!;
  return lo + (time - a.time) / Math.max(1, b.time - a.time);
}

export default function TradingChart(p: Props) {
  const { preferences } = usePreferences();
  const { t, language } = useI18n();
  const theme = resolvedTheme(preferences.theme);
  const futureBars = preferences.chart.futureBars || DEFAULT_FUTURE_BARS;
  const hostRef = useRef<HTMLDivElement>(null);
  const crosshairBarInfoRef = useRef<HTMLDivElement>(null);
  const tickSizeRef = useRef<string | null>(p.tickSize);
  const languageRef = useRef(language);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [series, setSeries] = useState<ISeriesApi<'Bar'> | null>(null);
  const [timelineCandles, setTimelineCandles] = useState<Candle[]>(p.candles);
  const timelineCandlesRef = useRef<Candle[]>(p.candles);
  const lastLiveCandleRef = useRef<Candle | null>(p.candles.at(-1) || null);
  const lines = useRef<IPriceLine[]>([]);
  const manualLineMap = useRef(new Map<number, IPriceLine>());
  const alertLineMap = useRef(new Map<number, IPriceLine>());
  const tradingLineMap = useRef(new Map<string, IPriceLine>());
  const executionMarkersRef = useRef<any>(null);
  const toolRef = useRef(p.tool);
  const timeframeRef = useRef(p.timeframe);
  const onCreateLevelRef = useRef(p.onCreateLevel);
  const onCreateAlertRef = useRef(p.onCreateAlert);
  const onCreateRiskRewardRef = useRef(p.onCreateRiskReward);
  const onLivePriceRef = useRef(p.onLivePrice);
  const [rrDraft, setRrDraft] = useState<RrDraft>({});
  const rrDraftRef = useRef<RrDraft>({});
  const [rrHover, setRrHover] = useState<RrHover>(null);
  const [priceDrag, setPriceDrag] = useState<PriceDrag | null>(null);
  const priceDragRef = useRef<PriceDrag | null>(null);
  const [tradingDrag, setTradingDrag] = useState<TradingDrag | null>(null);
  const tradingDragRef = useRef<TradingDrag | null>(null);
  const [hoveredTradingGroupKey, setHoveredTradingGroupKey] = useState<string | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [wsState, setWsState] = useState<WsState>('connecting');
  const [isAtLiveEdge, setIsAtLiveEdge] = useState(true);
  const followLiveRef = useRef(true);
  const latestLogicalRef = useRef(Math.max(0, p.candles.length - 1));
  const lastPriceReportAtRef = useRef(0);
  const restoringViewRef = useRef(false);
  const saveViewTimerRef = useRef<number | null>(null);
  const snapPricesRef = useRef<number[]>([]);
  const rrPreferencesRef = useRef(preferences.riskReward);

  toolRef.current = p.tool;
  timeframeRef.current = p.timeframe;
  onCreateLevelRef.current = p.onCreateLevel;
  onCreateAlertRef.current = p.onCreateAlert;
  onCreateRiskRewardRef.current = p.onCreateRiskReward;
  onLivePriceRef.current = p.onLivePrice;
  rrDraftRef.current = rrDraft;
  priceDragRef.current = priceDrag;
  tradingDragRef.current = tradingDrag;
  timelineCandlesRef.current = timelineCandles;
  snapPricesRef.current = [...p.autoLevels.map((level) => level.price), ...p.manualLevels.map((level) => level.price)];
  rrPreferencesRef.current = preferences.riskReward;

  const executionGroups = useMemo(
    () => buildExecutionGroups(
      p.executions,
      p.symbol,
      p.timeframe,
      timelineCandles,
      preferences.tradingOverlays.accountDisplayMode,
      preferences.tradingOverlays.accountIds,
    ),
    [
      p.executions,
      p.symbol,
      p.timeframe,
      timelineCandles,
      preferences.tradingOverlays.accountDisplayMode,
      preferences.tradingOverlays.accountIds,
    ],
  );

  useEffect(() => {
    const next = p.candles;
    setTimelineCandles(next);
    timelineCandlesRef.current = next;
    lastLiveCandleRef.current = next.at(-1) || null;
    latestLogicalRef.current = Math.max(0, next.length - 1);
  }, [p.candles, p.symbol, p.timeframe]);

  useEffect(() => { tickSizeRef.current = p.tickSize; }, [p.tickSize]);
  useEffect(() => { languageRef.current = language; }, [language]);

  useEffect(() => {
    if (!hostRef.current) return;

    const c = createChart(hostRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme === 'light' ? '#ffffff' : '#0a0f16' },
        textColor: theme === 'light' ? '#526071' : '#6f7f94',
      },
      grid: { vertLines: { color: preferences.chart.showGrid ? (theme === 'light' ? '#e8edf3' : '#111a25') : 'transparent' }, horzLines: { color: preferences.chart.showGrid ? (theme === 'light' ? '#e8edf3' : '#111a25') : 'transparent' } },
      rightPriceScale: { borderColor: theme === 'light' ? '#d7dee7' : '#202b3a' },
      timeScale: {
        borderColor: theme === 'light' ? '#d7dee7' : '#202b3a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: futureBars,
        shiftVisibleRangeOnNewBar: false,
      },
      crosshair: {
        vertLine: { color: theme === 'light' ? '#52607144' : '#60708755', labelVisible: false },
        horzLine: { color: theme === 'light' ? '#52607144' : '#60708755' },
      },
    });

    const s = c.addSeries(BarSeries, {
      upColor: '#31c48d',
      downColor: '#ef6675',
      openVisible: true,
      thinBars: false,
      priceFormat: chartPriceFormat(p.tickSize, p.candles.at(-1)?.close || 0),
    });

    setChart(c);
    setSeries(s);

    const xToTime = (x: number) => {
      const logical = (c.timeScale() as any).coordinateToLogical(x) as number | null;
      if (logical === null || !Number.isFinite(logical)) return null;
      return candleTimeAtLogical(
        timelineCandlesRef.current,
        logical,
        timeframeSeconds(timeframeRef.current),
      );
    };

    const pointData = (param: any) => {
      if (!param?.point) return null;
      const price = s.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return null;
      const time =
        typeof param.time === 'number'
          ? param.time
          : xToTime(param.point.x) ?? intervalBucket(Date.now() / 1000, timeframeRef.current);
      return { price, time };
    };

    const click = (param: any) => {
      const point = pointData(param);
      if (!point) return;
      const { price, time } = point;

      if (toolRef.current === 'level') {
        onCreateLevelRef.current(price);
        return;
      }
      if (toolRef.current === 'alert') {
        onCreateAlertRef.current(price);
        return;
      }

      if (toolRef.current === 'risk-reward') {
        const snapPrice = (rawPrice: number) => {
          const prefs = rrPreferencesRef.current;
          if (!prefs.snapToLevels) return rawPrice;
          const rawY = s.priceToCoordinate(rawPrice);
          if (rawY === null) return rawPrice;
          let best = rawPrice;
          let bestDistance = prefs.snapPixels + 1;
          for (const candidate of snapPricesRef.current) {
            const y = s.priceToCoordinate(candidate);
            if (y === null) continue;
            const distance = Math.abs(y - rawY);
            if (distance <= prefs.snapPixels && distance < bestDistance) { best = candidate; bestDistance = distance; }
          }
          return best;
        };
        const snappedPrice = snapPrice(price);
        const draft = rrDraftRef.current;
        if (draft.entry === undefined) {
          const next = { entry: snappedPrice, startTime: time };
          rrDraftRef.current = next;
          setRrDraft(next);
          return;
        }

        const entry = Number(draft.entry);
        const stop = snappedPrice;
        const startTime = Number(draft.startTime);
        const risk = Math.abs(entry - stop);
        if (!Number.isFinite(risk) || risk <= 0) return;
        const direction = stop < entry ? 'long' : 'short';
        const ratio = Math.max(0.5, Number(rrPreferencesRef.current.defaultRatio) || 3);
        const target = direction === 'long' ? entry + risk * ratio : entry - risk * ratio;
        const widthBars = Math.max(5, Number(rrPreferencesRef.current.defaultWidthBars) || 30);
        const endTime = startTime + timeframeSeconds(timeframeRef.current) * widthBars;
        onCreateRiskRewardRef.current({
          symbol: '',
          timeframe: timeframeRef.current,
          direction,
          entry,
          stop,
          target,
          startTime,
          endTime,
        });
        rrDraftRef.current = {};
        setRrDraft({});
        setRrHover(null);
      }
    };

    const crosshair = (param: any) => {
      const info = crosshairBarInfoRef.current;
      const bar = param?.seriesData?.get?.(s) as { low?: number; high?: number; close?: number } | undefined;
      const pointX = Number(param?.point?.x);

      if (info && bar && Number.isFinite(bar.low) && Number.isFinite(bar.high) && Number.isFinite(pointX)) {
        const low = Number(bar.low);
        const high = Number(bar.high);
        const rawTime = typeof param?.time === 'number'
          ? Number(param.time)
          : xToTime(pointX);
        if (rawTime !== null && Number.isFinite(rawTime)) {
          const dateText = formatCrosshairTime(rawTime, languageRef.current, timeframeRef.current);
          info.textContent = `${dateText}  |  Low ${formatPriceByTick(low, tickSizeRef.current)}  High ${formatPriceByTick(high, tickSizeRef.current)}`;
          info.style.display = 'block';
          const hostWidth = hostRef.current?.clientWidth || 0;
          const width = info.offsetWidth || 300;
          const half = width / 2;
          const left = Math.max(half + 2, Math.min(hostWidth - half - 2, pointX));
          info.style.left = `${left}px`;
        } else {
          info.style.display = 'none';
        }
      } else if (info) {
        info.style.display = 'none';
      }

      if (toolRef.current !== 'risk-reward' || rrDraftRef.current.entry === undefined) {
        setRrHover(null);
        return;
      }
      const point = pointData(param);
      if (point) {
        const prefs = rrPreferencesRef.current;
        if (prefs.snapToLevels) {
          const rawY = s.priceToCoordinate(point.price);
          let snapped: number = Number(point.price);
          let bestDistance = prefs.snapPixels + 1;
          if (rawY !== null) for (const candidate of snapPricesRef.current) {
            const y = s.priceToCoordinate(candidate);
            if (y === null) continue;
            const distance = Math.abs(y - rawY);
            if (distance <= prefs.snapPixels && distance < bestDistance) { snapped = candidate; bestDistance = distance; }
          }
          setRrHover({ ...point, price: snapped });
        } else setRrHover(point);
      }
    };

    c.subscribeClick(click);
    c.subscribeCrosshairMove(crosshair);
    return () => {
      c.unsubscribeClick(click);
      c.unsubscribeCrosshairMove(crosshair);
      c.remove();
    };
  }, []);

  useEffect(() => {
    if (!chart || !series) return;
    const light = theme === 'light';
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: light ? '#ffffff' : '#0a0f16' }, textColor: light ? '#526071' : '#6f7f94' },
      grid: {
        vertLines: { color: preferences.chart.showGrid ? (light ? '#e8edf3' : '#111a25') : 'transparent' },
        horzLines: { color: preferences.chart.showGrid ? (light ? '#e8edf3' : '#111a25') : 'transparent' },
      },
      rightPriceScale: { borderColor: light ? '#d7dee7' : '#202b3a' },
      timeScale: { borderColor: light ? '#d7dee7' : '#202b3a', rightOffset: futureBars },
      crosshair: { vertLine: { color: light ? '#52607144' : '#60708755', labelVisible: false }, horzLine: { color: light ? '#52607144' : '#60708755' } },
    });
    series.applyOptions({ priceLineVisible: preferences.chart.showCurrentPriceLine });
  }, [chart, series, theme, preferences.chart.showGrid, preferences.chart.showCurrentPriceLine, futureBars]);

  useEffect(() => {
    if (!series) return;
    const fallbackPrice = p.candles.at(-1)?.close || 0;
    series.applyOptions({ priceFormat: chartPriceFormat(p.tickSize, fallbackPrice) });
  }, [series, p.symbol, p.tickSize, p.candles]);

  useEffect(() => {
    if (!series) return;
    const plugin = createSeriesMarkers(series, [], { autoScale: false });
    executionMarkersRef.current = plugin;
    return () => {
      if (executionMarkersRef.current === plugin) executionMarkersRef.current = null;
      try { plugin.detach(); } catch { /* chart teardown can detach it first */ }
    };
  }, [series]);

  useEffect(() => {
    const plugin = executionMarkersRef.current;
    if (!plugin) return;
    const overlay = preferences.tradingOverlays;
    if (!overlay.showExecutions || !executionGroups.length) {
      plugin.setMarkers([]);
      return;
    }

    const markers = executionGroups.map((group) => {
      const buy = group.side === 'Buy';
      const qty = overlay.showOrderSize && group.qty > 0 ? compactNumber(group.qty) : '';
      const accounts = overlay.accountDisplayMode === 'summary' && group.accountCount > 1 ? ` · ×${group.accountCount}` : '';
      const fills = !qty && !accounts && group.fillCount > 1 ? `×${group.fillCount}` : '';
      return {
        id: `execution-group-${group.key}`,
        time: group.time as UTCTimestamp,
        position: buy ? 'atPriceBottom' : 'atPriceTop',
        price: group.price,
        color: buy ? '#31c48d' : '#ef6675',
        shape: buy ? 'arrowUp' : 'arrowDown',
        text: `${qty}${accounts}${fills}`.trim(),
        size: 0.55,
      };
    });

    plugin.setMarkers(markers);
  }, [series, executionGroups, preferences.tradingOverlays.showExecutions, preferences.tradingOverlays.showOrderSize, preferences.tradingOverlays.accountDisplayMode]);

  useEffect(() => {
    if (!chart || !hostRef.current) return;
    const refresh = () => {
      setOverlayVersion((value) => value + 1);
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const atEdge = range.to >= latestLogicalRef.current - 0.5;
      followLiveRef.current = atEdge;
      setIsAtLiveEdge(atEdge);
      if (!restoringViewRef.current) {
        if (saveViewTimerRef.current) window.clearTimeout(saveViewTimerRef.current);
        saveViewTimerRef.current = window.setTimeout(() => {
          const step = timeframeSeconds(p.timeframe);
          writeChartView(p.symbol, p.timeframe, {
            fromTime: candleTimeAtLogical(timelineCandlesRef.current, range.from, step),
            toTime: candleTimeAtLogical(timelineCandlesRef.current, range.to, step),
          });
        }, 250);
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(refresh);
    chart.timeScale().subscribeVisibleLogicalRangeChange(refresh);
    const observer = new ResizeObserver(refresh);
    observer.observe(hostRef.current);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(refresh);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(refresh);
      observer.disconnect();
    };
  }, [chart, p.symbol, p.timeframe]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const redraw = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setOverlayVersion((value) => value + 1);
      });
    };
    const pointerMove = (event: PointerEvent) => { if (event.buttons) redraw(); };
    host.addEventListener('pointermove', pointerMove);
    host.addEventListener('pointerup', redraw);
    host.addEventListener('wheel', redraw, { passive: true });
    host.addEventListener('dblclick', redraw);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      host.removeEventListener('pointermove', pointerMove);
      host.removeEventListener('pointerup', redraw);
      host.removeEventListener('wheel', redraw);
      host.removeEventListener('dblclick', redraw);
    };
  }, [chart, series]);

  useEffect(() => {
    if (!series) return;
    // A manually stretched BTC price scale must never leak into SOL (or another timeframe).
    // Lightweight Charts does not expose the exact manual price range, so symbol/timeframe
    // changes deliberately start from a fresh autoscale instead of reusing another market's scale.
    series.priceScale().applyOptions({ autoScale: true });
    series.setData(p.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    const last = p.candles.at(-1) || null;
    lastLiveCandleRef.current = last;
    latestLogicalRef.current = Math.max(0, p.candles.length - 1);
    window.requestAnimationFrame(() => series.priceScale().applyOptions({ autoScale: true }));
  }, [series, p.candles, p.symbol, p.timeframe]);

  useEffect(() => {
    if (!series || !chart || !p.symbol || !p.timeframe) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 1_000;
    const topicKline = `kline.${p.timeframe}.${p.symbol}`;
    const topicTicker = `tickers.${p.symbol}`;

    const reportLivePrice = (price: number, force = false) => {
      const now = Date.now();
      // Keep the visible price feeling real-time without forcing React to render
      // on every websocket packet. Bybit ticker updates can arrive around 10x/sec.
      if (force || now - lastPriceReportAtRef.current >= 80) {
        lastPriceReportAtRef.current = now;
        onLivePriceRef.current?.(price);
      }
    };

    const updateTimelineForNewBar = (bar: Candle) => {
      const current = timelineCandlesRef.current;
      const last = current.at(-1);
      if (!last || bar.time > last.time) {
        const next = [...current, bar].slice(-1000);
        timelineCandlesRef.current = next;
        setTimelineCandles(next);
        latestLogicalRef.current = Math.max(0, next.length - 1);
      }
    };

    const applyBar = (bar: Candle, newBar = false) => {
      lastLiveCandleRef.current = bar;
      series.update({ ...bar, time: bar.time as UTCTimestamp });
      reportLivePrice(bar.close, lastPriceReportAtRef.current === 0);
      if (newBar) updateTimelineForNewBar(bar);
      if (newBar && followLiveRef.current && preferences.chart.autoFollowLive) {
        chart.timeScale().applyOptions({ rightOffset: futureBars });
        chart.timeScale().scrollToRealTime();
      }
    };

    const applyTicker = (price: number, timestampMs?: number) => {
      if (!Number.isFinite(price) || price <= 0) return;
      reportLivePrice(price, lastPriceReportAtRef.current === 0);
      const nowSeconds = Math.floor((timestampMs || Date.now()) / 1000);
      const bucket = intervalBucket(nowSeconds, p.timeframe);
      const previous = lastLiveCandleRef.current;

      if (!previous || bucket > previous.time) {
        const open = previous?.close || price;
        applyBar(
          {
            time: bucket,
            open,
            high: Math.max(open, price),
            low: Math.min(open, price),
            close: price,
            volume: 0,
          },
          true,
        );
        return;
      }

      if (bucket === previous.time) {
        applyBar({
          ...previous,
          high: Math.max(previous.high, price),
          low: Math.min(previous.low, price),
          close: price,
        });
      }
    };

    const connect = () => {
      if (stopped) return;
      setWsState(reconnectDelay > 1_000 ? 'reconnecting' : 'connecting');
      socket = new WebSocket('wss://stream.bybit.com/v5/public/linear');

      socket.onopen = () => {
        if (stopped || !socket) return;
        reconnectDelay = 1_000;
        setWsState('live');
        socket.send(JSON.stringify({ op: 'subscribe', args: [topicKline, topicTicker] }));
        if (pingTimer) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20_000);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.topic === topicKline && Array.isArray(message.data)) {
            const raw = message.data[0];
            if (!raw) return;
            const bar: Candle = {
              time: Math.floor(Number(raw.start) / 1000),
              open: Number(raw.open),
              high: Number(raw.high),
              low: Number(raw.low),
              close: Number(raw.close),
              volume: Number(raw.volume || 0),
            };
            const previous = lastLiveCandleRef.current;
            applyBar(bar, !previous || bar.time > previous.time);
            return;
          }

          if (message.topic === topicTicker && message.data) {
            const raw = Array.isArray(message.data) ? message.data[0] : message.data;
            const price = Number(raw?.lastPrice);
            if (Number.isFinite(price) && price > 0) {
              applyTicker(price, Number(message.ts || Date.now()));
            }
          }
        } catch {
          // Ignore malformed public WS packets; the next packet will repair state.
        }
      };

      const scheduleReconnect = () => {
        if (stopped) return;
        setWsState('reconnecting');
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(15_000, reconnectDelay * 2);
      };

      socket.onerror = () => socket?.close();
      socket.onclose = scheduleReconnect;
    };

    connect();

    return () => {
      stopped = true;
      setWsState('offline');
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [series, chart, p.symbol, p.timeframe]);

  useEffect(() => {
    if (!series) return;
    for (const line of lines.current) series.removePriceLine(line);
    lines.current = [];
    manualLineMap.current.clear();
    alertLineMap.current.clear();
    tradingLineMap.current.clear();

    for (const level of p.autoLevels) {
      lines.current.push(
        series.createPriceLine({
          price: level.price,
          color: level.type === 'mirror' ? '#7387ff' : level.type === 'support' ? '#3a9b79' : '#b85b6c',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${level.type} · ${level.touches}`,
        }),
      );
    }

    for (const level of p.manualLevels) {
      const autoColor = theme === 'light' ? '#1f2937' : '#e5e7eb';
      const selectedColor = preferences.manualLevel.colorMode === 'auto' ? autoColor : preferences.manualLevel.color;
      const line = series.createPriceLine({
        price: level.price,
        color: rgba(selectedColor, preferences.manualLevel.opacity),
        lineWidth: preferences.manualLevel.width,
        lineStyle: toLineStyle(preferences.manualLevel.style),
        axisLabelVisible: preferences.manualLevel.showPriceLabel,
        title: level.label || t('Manual'),
      });
      lines.current.push(line);
      manualLineMap.current.set(level.id, line);
    }

    for (const alert of p.alerts.filter((a) => a.active)) {
      const line = series.createPriceLine({
        price: alert.price,
        color: '#e1b84e',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '🔔',
      });
      lines.current.push(line);
      alertLineMap.current.set(alert.id, line);
    }

    const overlay = preferences.tradingOverlays;
    const accountAllowed = (accountId: number) => overlay.accountIds.length === 0 || overlay.accountIds.includes(accountId);
    const kindVisible = (kind: TradingOverlayLine['kind']) => kind === 'order' ? overlay.showOrders : kind === 'position' ? overlay.showPositions : kind === 'sl' ? overlay.showStopLoss : kind === 'tp' ? overlay.showTakeProfit : overlay.showLiquidation;
    const styleFor = (kind: TradingOverlayLine['kind']) => kind === 'order' ? overlay.orderStyle : kind === 'position' ? overlay.positionStyle : kind === 'sl' ? overlay.stopStyle : kind === 'tp' ? overlay.targetStyle : 'dotted';
    const visibleLines = p.tradingLines.filter((line) => accountAllowed(line.accountId) && kindVisible(line.kind));
    const groups = buildTradingLineGroups(visibleLines, overlay.accountDisplayMode, p.tickSize);
    for (const group of groups) {
      const tradingLine = group.representative;
      const priceLine = series.createPriceLine({
        price: group.price,
        color: rgba(tradingLineColor(tradingLine.kind, theme), overlay.opacity),
        lineWidth: overlay.lineWidth,
        lineStyle: toLineStyle(styleFor(tradingLine.kind) as any),
        axisLabelVisible: true,
        title: '',
      });
      lines.current.push(priceLine);
      for (const groupedLine of group.lines) tradingLineMap.current.set(groupedLine.id, priceLine);
    }
  }, [series, p.autoLevels, p.manualLevels, p.alerts, p.tradingLines, theme, preferences.manualLevel, preferences.tradingOverlays, language, t]);


  useEffect(() => {
    if (!chart || !p.candles.length) return;
    restoringViewRef.current = true;
    const stored = readChartView(p.symbol, p.timeframe);
    if (stored) {
      const step = timeframeSeconds(p.timeframe);
      const restoredRange = {
        from: logicalAtTime(p.candles, stored.fromTime, step),
        to: logicalAtTime(p.candles, stored.toTime, step),
      };
      (chart.timeScale() as any).setVisibleLogicalRange(restoredRange);
      const atEdge = restoredRange.to >= p.candles.length - 1 - 0.5;
      followLiveRef.current = atEdge;
      setIsAtLiveEdge(atEdge);
    } else {
      chart.timeScale().fitContent();
      chart.timeScale().applyOptions({ rightOffset: futureBars });
      chart.timeScale().scrollToRealTime();
      followLiveRef.current = true;
      setIsAtLiveEdge(true);
    }
    window.setTimeout(() => { restoringViewRef.current = false; }, 100);
  }, [chart, p.symbol, p.timeframe, p.candles.length]);

  useEffect(() => {
    if (p.tool !== 'risk-reward') {
      rrDraftRef.current = {};
      setRrDraft({});
      setRrHover(null);
    }
  }, [p.tool]);

  useEffect(() => {
    rrDraftRef.current = {};
    setRrDraft({});
    setRrHover(null);
  }, [p.timeframe, p.symbol]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        rrDraftRef.current = {};
        setRrDraft({});
        setRrHover(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (!priceDrag || !series || !hostRef.current || !chart) return;
    const host = hostRef.current;
    chart.applyOptions({ handleScroll: false, handleScale: false });

    const move = (event: PointerEvent) => {
      const current = priceDragRef.current;
      if (!current) return;
      const rect = host.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const price = series.coordinateToPrice(y);
      if (!price || price <= 0) return;
      const next = { ...current, price, moved: current.moved || Math.abs(y - current.startY) > 2 };
      priceDragRef.current = next;
      setPriceDrag(next);
      const line = next.kind === 'level' ? manualLineMap.current.get(next.id) : alertLineMap.current.get(next.id);
      line?.applyOptions({ price });
    };

    const finish = () => {
      const current = priceDragRef.current;
      if (current) {
        if (current.moved) {
          if (current.kind === 'level') p.onUpdateLevel(current.id, current.price);
          else p.onUpdateAlert(current.id, current.price);
        } else if (p.tool === 'select') {
          p.onUsePriceLevel(current.originalPrice);
        }
      }
      chart.applyOptions({ handleScroll: true, handleScale: true });
      priceDragRef.current = null;
      setPriceDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      chart.applyOptions({ handleScroll: true, handleScale: true });
    };
  }, [priceDrag, series, chart, p.tool, p.onUpdateLevel, p.onUpdateAlert, p.onUsePriceLevel]);

  const startPriceDrag = (kind: 'level' | 'alert', id: number, price: number, event: any) => {
    if (!hostRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = hostRef.current.getBoundingClientRect();
    const next: PriceDrag = { kind, id, originalPrice: price, price, startY: event.clientY - rect.top, moved: false };
    priceDragRef.current = next;
    setPriceDrag(next);
  };

  useEffect(() => {
    if (!tradingDrag || !series || !hostRef.current || !chart) return;
    const host = hostRef.current;
    chart.applyOptions({ handleScroll: false, handleScale: false });

    const move = (event: PointerEvent) => {
      const current = tradingDragRef.current;
      if (!current) return;
      const rect = host.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const price = series.coordinateToPrice(y);
      if (!price || price <= 0) return;
      const next = { ...current, price, moved: current.moved || Math.abs(y - current.startY) > 2 };
      tradingDragRef.current = next;
      setTradingDrag(next);
      tradingLineMap.current.get(next.line.id)?.applyOptions({ price });
    };

    const finish = () => {
      const current = tradingDragRef.current;
      if (current) {
        tradingLineMap.current.get(current.line.id)?.applyOptions({ price: current.originalPrice });
        if (current.moved) p.onRequestTradingLineChange(current.line, current.price);
      }
      chart.applyOptions({ handleScroll: true, handleScale: true });
      tradingDragRef.current = null;
      setTradingDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      chart.applyOptions({ handleScroll: true, handleScale: true });
    };
  }, [tradingDrag, series, chart, p.onRequestTradingLineChange]);

  const canDragTradingLine = (line: TradingOverlayLine) => {
    if (!p.liveTradingEnabled || !line.editTarget) return false;
    if (line.kind === 'order') return preferences.tradingOverlays.allowDragOrders;
    if (line.kind === 'sl') return preferences.tradingOverlays.allowDragStops;
    if (line.kind === 'tp') return preferences.tradingOverlays.allowDragTargets;
    return false;
  };

  const startTradingDrag = (line: TradingOverlayLine, event: any) => {
    if (!canDragTradingLine(line) || !hostRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = hostRef.current.getBoundingClientRect();
    const next: TradingDrag = { line, originalPrice: line.price, price: line.price, startY: event.clientY - rect.top, moved: false };
    tradingDragRef.current = next;
    setTradingDrag(next);
  };

  const visibleTradingLines = useMemo(() => p.tradingLines.filter((line) => {
    const overlay = preferences.tradingOverlays;
    if (overlay.accountIds.length && !overlay.accountIds.includes(line.accountId)) return false;
    if (line.kind === 'order') return overlay.showOrders;
    if (line.kind === 'position') return overlay.showPositions;
    if (line.kind === 'sl') return overlay.showStopLoss;
    if (line.kind === 'tp') return overlay.showTakeProfit;
    return overlay.showLiquidation;
  }), [p.tradingLines, preferences.tradingOverlays]);

  const visibleTradingGroups = useMemo(() => buildTradingLineGroups(
    visibleTradingLines,
    preferences.tradingOverlays.accountDisplayMode,
    p.tickSize,
  ), [visibleTradingLines, preferences.tradingOverlays.accountDisplayMode, p.tickSize]);

  const hoveredTradingLinks = useMemo(() => {
    const group = visibleTradingGroups.find((item) => item.key === hoveredTradingGroupKey);
    return new Set(group?.linkKeys || []);
  }, [visibleTradingGroups, hoveredTradingGroupKey]);

  useEffect(() => {
    const overlay = preferences.tradingOverlays;
    const highlightedWidth = Math.min(3, overlay.lineWidth + 1) as 1 | 2 | 3;
    for (const group of visibleTradingGroups) {
      const priceLine = tradingLineMap.current.get(group.representative.id);
      if (!priceLine) continue;
      const linked = hoveredTradingLinks.size > 0 && group.linkKeys.some((key) => hoveredTradingLinks.has(key));
      priceLine.applyOptions({
        color: rgba(tradingLineColor(group.representative.kind, theme), linked ? 1 : overlay.opacity),
        lineWidth: linked ? highlightedWidth : overlay.lineWidth,
      });
    }
  }, [visibleTradingGroups, hoveredTradingLinks, preferences.tradingOverlays.lineWidth, preferences.tradingOverlays.opacity, theme]);

  const sideTitle = (side?: TradeExecution['side']) => side === 'Buy'
    ? (language === 'uk' ? 'КУПІВЛЯ' : language === 'ru' ? 'ПОКУПКА' : 'BUY')
    : (language === 'uk' ? 'ПРОДАЖ' : language === 'ru' ? 'ПРОДАЖА' : 'SELL');

  const tradingGroupLabel = (group: TradingLineGroup) => {
    const overlay = preferences.tradingOverlays;
    if (overlay.labelMode === 'price') return '';
    const line = group.representative;
    let head = '';
    if (line.kind === 'order') head = `${sideTitle(line.side)} ${shortOrderType(line.orderType)}`;
    else if (line.kind === 'position') head = line.side === 'Buy' ? 'LONG' : 'SHORT';
    else if (line.kind === 'liq') head = 'LIQ';
    else head = line.kind.toUpperCase();

    const parts = [head];
    if (overlay.labelMode === 'full' && overlay.showOrderSize && group.qty > 0) parts.push(compactNumber(group.qty));
    if (overlay.accountDisplayMode === 'summary' && group.accountCount > 1) parts.push(`×${group.accountCount}`);
    if (overlay.accountDisplayMode === 'individual' && overlay.showAccountName) parts.push(line.accountName);
    if (overlay.labelMode === 'full' && overlay.showPnl && line.kind === 'position' && Number.isFinite(group.pnl)) {
      parts.push(`${group.pnl >= 0 ? '+' : ''}${group.pnl.toFixed(2)}`);
    }
    return parts.join(' · ');
  };

  const tradingGroupTooltip = (group: TradingLineGroup) => {
    const accountHeader = language === 'uk' ? 'Акаунти' : language === 'ru' ? 'Аккаунты' : 'Accounts';
    const line = group.representative;
    const title = line.kind === 'order'
      ? `${sideTitle(line.side)} ${shortOrderType(line.orderType)}`
      : line.kind === 'position'
        ? (line.side === 'Buy' ? 'LONG' : 'SHORT')
        : line.kind.toUpperCase();
    return [
      `${title} @ ${formatPriceByTick(group.price, p.tickSize)}`,
      `${accountHeader}:`,
      ...group.lines.map((item) => `${item.accountName}${item.qty ? ` · ${compactNumber(Number(item.qty))}` : ''}`),
    ].join('\n');
  };

  const executionTooltip = (group: ExecutionGroup) => {
    const locale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'en-US';
    const accountRows = new Map<string, { qty: number; fee: number; fills: number }>();
    for (const execution of group.executions) {
      const current = accountRows.get(execution.accountName) || { qty: 0, fee: 0, fills: 0 };
      current.qty += Number(execution.execQty || 0);
      current.fee += Number(execution.execFee || 0);
      current.fills += 1;
      accountRows.set(execution.accountName, current);
    }
    const execTime = Math.min(...group.executions.map((execution) => execution.execTime));
    const time = new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(execTime));
    return [
      `${sideTitle(group.side)} · ${group.accountCount > 1 ? `×${group.accountCount}` : group.executions[0]?.accountName || ''}`,
      `${t('Price')}: ${formatPriceByTick(group.price, p.tickSize)}`,
      `${t('Qty')}: ${compactNumber(group.qty)}`,
      `${t('Fee')}: ${compactNumber(group.fee)}`,
      `${t('Executions')}: ${group.fillCount}`,
      `${t('Time')}: ${time}`,
      '',
      ...[...accountRows.entries()].map(([name, row]) => `${name} · ${compactNumber(row.qty)}${row.fills > 1 ? ` · ×${row.fills}` : ''}`),
    ].join('\n');
  };


  const timeToCoordinate = (time: number) => {
    if (!chart) return null;
    const direct = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (direct !== null) return direct;
    const logical = logicalAtTime(
      timelineCandlesRef.current,
      time,
      timeframeSeconds(p.timeframe),
    );
    return (chart.timeScale() as any).logicalToCoordinate(logical) as number | null;
  };

  const priceScaleWidth = chart ? Number((chart.priceScale('right') as any).width?.() || 64) : 64;

  const tradingLabelPlacements: TradingLabelPlacement[] = (() => {
    if (!series || !hostRef.current || preferences.tradingOverlays.labelMode === 'price') return [];
    const height = hostRef.current.clientHeight;
    if (!height) return [];
    const occupied: number[] = [];
    const reservePrice = (price: number) => {
      const y = series.priceToCoordinate(price);
      if (y !== null && y >= 0 && y <= height) occupied.push(y);
    };
    p.autoLevels.forEach((level) => reservePrice(level.price));
    p.manualLevels.forEach((level) => reservePrice(level.price));
    p.alerts.filter((alert) => alert.active).forEach((alert) => reservePrice(alert.price));

    const minY = 13;
    const maxY = Math.max(minY, height - 13);
    const minGap = 22;
    const clampY = (value: number) => Math.max(minY, Math.min(maxY, value));
    const isFree = (candidate: number) => occupied.every((taken) => Math.abs(candidate - taken) >= minGap);

    const candidates: Array<{ group: TradingLineGroup; lineY: number; text: string; color: string }> = [];
    for (const group of visibleTradingGroups) {
      const line = group.representative;
      const shownPrice = group.lines.length === 1 && tradingDrag?.line.id === line.id ? tradingDrag.price : group.price;
      const coordinate = series.priceToCoordinate(shownPrice);
      const text = tradingGroupLabel(group);
      if (coordinate === null || !text) continue;
      const lineY = Number(coordinate);
      if (lineY < -20 || lineY > height + 20) continue;
      candidates.push({ group, lineY, text, color: tradingLineColor(line.kind, theme) });
    }
    candidates.sort((a, b) => a.lineY - b.lineY);

    const placements: TradingLabelPlacement[] = [];
    for (const candidate of candidates) {
      const nearest = occupied.length
        ? occupied.reduce((best, y) => Math.abs(y - candidate.lineY) < Math.abs(best - candidate.lineY) ? y : best, occupied[0]!)
        : null;
      const away = nearest === null ? 1 : (candidate.lineY >= nearest ? 1 : -1);
      const offsets = [0];
      for (let step = 1; step <= 10; step += 1) {
        offsets.push(away * step * minGap, -away * step * minGap);
      }
      let labelY = clampY(candidate.lineY);
      for (const offset of offsets) {
        const attempt = clampY(candidate.lineY + offset);
        if (isFree(attempt)) { labelY = attempt; break; }
      }
      occupied.push(labelY);
      placements.push({ ...candidate, labelY });
    }
    return placements;
  })();

  const entryY = series && rrDraft.entry !== undefined ? series.priceToCoordinate(rrDraft.entry) : null;
  const previewStop = rrDraft.entry !== undefined && rrHover ? rrHover.price : null;
  const previewDirection = rrDraft.entry !== undefined && previewStop !== null ? (previewStop < rrDraft.entry ? 'long' : 'short') : null;
  const previewRisk = rrDraft.entry !== undefined && previewStop !== null ? Math.abs(rrDraft.entry - previewStop) : 0;
  const previewTarget = rrDraft.entry !== undefined && previewDirection
    ? (previewDirection === 'long' ? rrDraft.entry + previewRisk * preferences.riskReward.defaultRatio : rrDraft.entry - previewRisk * preferences.riskReward.defaultRatio)
    : null;
  const stopY = series && previewStop !== null ? series.priceToCoordinate(previewStop) : null;
  const targetY = series && previewTarget !== null ? series.priceToCoordinate(previewTarget) : null;
  const draftX1 = rrDraft.startTime !== undefined ? timeToCoordinate(rrDraft.startTime) : null;
  const draftX2 = rrDraft.startTime !== undefined
    ? timeToCoordinate(rrDraft.startTime + timeframeSeconds(p.timeframe) * preferences.riskReward.defaultWidthBars)
    : null;

  const returnToLive = () => {
    if (!chart) return;
    chart.timeScale().applyOptions({ rightOffset: futureBars });
    chart.timeScale().scrollToRealTime();
    followLiveRef.current = true;
    setIsAtLiveEdge(true);
  };

  const liveLabel = useMemo(() => {
    if (wsState === 'live') return isAtLiveEdge ? '● LIVE' : '↪ LIVE';
    if (wsState === 'reconnecting') return '● RECONNECTING';
    if (wsState === 'connecting') return '● CONNECTING';
    return '● OFFLINE';
  }, [wsState, isAtLiveEdge]);

  return (
    <div className={priceDrag || tradingDrag ? 'chart-card drawing-dragging' : 'chart-card'}>
      <div ref={hostRef} className="chart-host" />
      <div ref={crosshairBarInfoRef} className="chart-crosshair-bar-info" aria-hidden="true" />

      <button
        type="button"
        className={`chart-live-control ${wsState === 'live' ? 'connected' : ''} ${isAtLiveEdge ? '' : 'away'}`}
        onClick={returnToLive}
        title={isAtLiveEdge ? 'Live Bybit market data' : 'Return to current market'}
      >
        {liveLabel}
      </button>

      <RiskRewardOverlay
        chart={chart}
        series={series}
        host={hostRef.current}
        candles={timelineCandles}
        items={p.riskRewards}
        selectedId={p.selectedRiskReward?.id ?? null}
        onSelect={p.onSelectRiskReward}
        onUpdate={p.onUpdateRiskReward}
        onDelete={p.onDeleteRiskReward}
      />

      {series && hostRef.current && (
        <svg
          className="chart-overlay level-actions-overlay"
          width={hostRef.current.clientWidth}
          height={hostRef.current.clientHeight}
          data-version={overlayVersion}
        >
          {p.autoLevels.map((level, index) => {
            const y = series.priceToCoordinate(level.price);
            if (y === null) return null;
            return (
              <rect
                key={`auto-hit-${index}`}
                x="0"
                y={y - 5}
                width={hostRef.current!.clientWidth}
                height="10"
                fill="transparent"
                className={
                  p.tool === 'select'
                    ? 'price-line-click-target active'
                    : 'price-line-click-target'
                }
                onPointerDown={(event) => {
                  if (p.tool !== 'select') return;
                  event.stopPropagation();
                  p.onUsePriceLevel(level.price);
                }}
              />
            );
          })}

          {p.manualLevels.map((level) => {
            const shownPrice =
              priceDrag?.kind === 'level' && priceDrag.id === level.id
                ? priceDrag.price
                : level.price;
            const y = series.priceToCoordinate(shownPrice);
            if (y === null) return null;
            const x = Math.max(20, hostRef.current!.clientWidth - 82);
            return (
              <g key={`manual-hit-${level.id}`}>
                <rect
                  x="0"
                  y={y - 7}
                  width={hostRef.current!.clientWidth}
                  height="14"
                  fill="transparent"
                  className="price-line-click-target active draggable"
                  onPointerDown={(event) =>
                    startPriceDrag('level', level.id, level.price, event)
                  }
                />
                <g
                  className="drawing-delete"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    p.onDeleteLevel(level.id);
                  }}
                >
                  <circle cx={x} cy={y} r="8" />
                  <text x={x} y={y + 3.5} textAnchor="middle">
                    ×
                  </text>
                </g>
              </g>
            );
          })}

          {p.alerts
            .filter((alert) => alert.active)
            .map((alert) => {
              const shownPrice =
                priceDrag?.kind === 'alert' && priceDrag.id === alert.id
                  ? priceDrag.price
                  : alert.price;
              const y = series.priceToCoordinate(shownPrice);
              if (y === null) return null;
              const x = Math.max(20, hostRef.current!.clientWidth - 104);
              return (
                <g key={`alert-hit-${alert.id}`}>
                  <rect
                    x="0"
                    y={y - 7}
                    width={hostRef.current!.clientWidth}
                    height="14"
                    fill="transparent"
                    className="price-line-click-target active draggable alert-hit"
                    onPointerDown={(event) =>
                      startPriceDrag('alert', alert.id, alert.price, event)
                    }
                  />
                  <g
                    className="drawing-delete alert-delete"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      p.onDeleteAlert(alert.id);
                    }}
                  >
                    <circle cx={x} cy={y} r="8" />
                    <text x={x} y={y + 3.5} textAnchor="middle">
                      ×
                    </text>
                  </g>
                </g>
              );
            })}

          {visibleTradingGroups.map((group) => {
            const line = group.representative;
            const isSingle = group.lines.length === 1;
            const shownPrice = isSingle && tradingDrag?.line.id === line.id ? tradingDrag.price : group.price;
            const y = series.priceToCoordinate(shownPrice);
            if (y === null) return null;
            const draggable = isSingle && canDragTradingLine(line);
            return (
              <g key={`trading-hit-${group.key}`}>
                {group.lines.length > 1 && <title>{tradingGroupTooltip(group)}</title>}
                <rect
                  x="0"
                  y={y - 8}
                  width={hostRef.current!.clientWidth}
                  height="16"
                  fill="transparent"
                  className={draggable ? 'trading-line-hit draggable' : 'trading-line-hit'}
                  onPointerEnter={() => { if (draggable) setHoveredTradingGroupKey(group.key); }}
                  onPointerLeave={() => { if (draggable) setHoveredTradingGroupKey((current) => current === group.key ? null : current); }}
                  onPointerDown={(event) => { if (draggable) startTradingDrag(line, event); }}
                />
              </g>
            );
          })}
        </svg>
      )}

      {series && hostRef.current && tradingLabelPlacements.length > 0 && (
        <>
          <svg
            className="chart-overlay trading-label-connectors"
            width={hostRef.current.clientWidth}
            height={hostRef.current.clientHeight}
            data-version={overlayVersion}
          >
            {tradingLabelPlacements.map((placement) => {
              if (Math.abs(placement.labelY - placement.lineY) < 2) return null;
              const x = Math.max(12, hostRef.current!.clientWidth - priceScaleWidth - 8);
              return (
                <polyline
                  key={`trade-connector-${placement.group.key}`}
                  points={`${x + 8},${placement.lineY} ${x},${placement.lineY} ${x},${placement.labelY}`}
                  fill="none"
                  stroke={placement.color}
                  strokeWidth="1"
                  opacity="0.8"
                />
              );
            })}
          </svg>
          <div className="trading-edge-label-layer" data-version={overlayVersion}>
            {tradingLabelPlacements.map((placement) => {
              const group = placement.group;
              const line = group.representative;
              const draggable = group.lines.length === 1 && canDragTradingLine(line);
              const linked = hoveredTradingLinks.size > 0 && group.linkKeys.some((key) => hoveredTradingLinks.has(key));
              const muted = hoveredTradingLinks.size > 0 && !linked;
              const tooltipUp = placement.labelY > hostRef.current!.clientHeight * 0.62;
              const style = {
                top: placement.labelY,
                right: priceScaleWidth + 8,
                backgroundColor: rgba(placement.color, 0.96),
                borderColor: placement.color,
              } as CSSProperties;
              return (
                <div
                  key={`trade-label-${group.key}`}
                  className={`trading-edge-label kind-${line.kind}${draggable ? ' draggable' : ''}${linked ? ' linked' : ''}${muted ? ' muted-link' : ''}${tooltipUp ? ' tooltip-up' : ''}`}
                  style={style}
                  data-tooltip={tradingGroupTooltip(group)}
                  onMouseEnter={() => setHoveredTradingGroupKey(group.key)}
                  onMouseLeave={() => setHoveredTradingGroupKey((current) => current === group.key ? null : current)}
                  onPointerDown={(event) => { if (draggable) startTradingDrag(line, event); }}
                >
                  {placement.text}
                </div>
              );
            })}
          </div>
        </>
      )}

      {series && hostRef.current && preferences.tradingOverlays.showExecutions && executionGroups.length > 0 && (
        <div className="execution-hover-layer" data-version={overlayVersion}>
          {executionGroups.map((group) => {
            const x = timeToCoordinate(group.time);
            const priceY = series.priceToCoordinate(group.price);
            if (x === null || priceY === null || x < -20 || x > hostRef.current!.clientWidth + 20) return null;
            const y = priceY + (group.side === 'Buy' ? 9 : -9);
            const tooltipUp = y > hostRef.current!.clientHeight * 0.62;
            const tooltipLeft = x > hostRef.current!.clientWidth * 0.68;
            return (
              <div
                key={`execution-hit-${group.key}`}
                className={`execution-hover-target${group.side === 'Buy' ? ' buy' : ' sell'}${tooltipUp ? ' tooltip-up' : ''}${tooltipLeft ? ' tooltip-left' : ''}`}
                style={{ left: x, top: y }}
                data-tooltip={executionTooltip(group)}
                aria-label={executionTooltip(group)}
              />
            );
          })}
        </div>
      )}

      {p.tool === 'risk-reward' && (
        <>
          <div className="rr-draft-help">
            Risk/Reward:{' '}
            {rrDraft.entry === undefined
              ? (language==='uk'?'1/2 — клік Entry':language==='ru'?'1/2 — клик Entry':'1/2 — click Entry')
              : (language==='uk'?`2/2 — клік Stop · Target ${preferences.riskReward.defaultRatio}R автоматично`:language==='ru'?`2/2 — клик Stop · Target ${preferences.riskReward.defaultRatio}R автоматически`:`2/2 — click Stop · Target ${preferences.riskReward.defaultRatio}R is automatic`)}
            <span>{language==='uk'?'Esc = скасувати':language==='ru'?'Esc = отменить':'Esc = cancel'}</span>
          </div>

          {entryY !== null && <div className="rr-draft-line entry" style={{ top: entryY }} />}
          {stopY !== null && <div className="rr-draft-line stop" style={{ top: stopY }} />}
          {targetY !== null && <div className="rr-draft-line target" style={{ top: targetY }} />}

          {rrHover && entryY !== null && stopY !== null && targetY !== null && draftX1 !== null && draftX2 !== null && (
            <svg className="chart-overlay rr-draft-overlay" width={hostRef.current?.clientWidth || 0} height={hostRef.current?.clientHeight || 0}>
              {(() => {
                const left = Math.min(draftX1, draftX2);
                const right = Math.max(draftX1, draftX2);
                const width = Math.max(24, right - left);
                return <>
                  <rect className="rr-reward rr-draft-box" x={left} y={Math.min(entryY, targetY)} width={width} height={Math.max(1, Math.abs(targetY - entryY))} />
                  <rect className="rr-risk rr-draft-box" x={left} y={Math.min(entryY, stopY)} width={width} height={Math.max(1, Math.abs(stopY - entryY))} />
                </>;
              })()}
            </svg>
          )}
        </>
      )}
    </div>
  );
}
