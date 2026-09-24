import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle, RulerMeasurement } from '@trade/shared';
import { useI18n } from '../i18n';

type DraftMeasurement = {
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  active: boolean;
  finalized: boolean;
};

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<'Bar'> | null;
  host: HTMLDivElement | null;
  candles: Candle[];
  items: RulerMeasurement[];
  tool: string;
  symbol: string;
  timeframe: string;
  tickSize: string | null;
  onCreate: (input: Omit<RulerMeasurement, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onDelete: (id: number) => void;
  onFinishDraft: () => void;
}

function candleStep(candles: Candle[], timeframe: string) {
  if (candles.length < 2) {
    if (timeframe === 'D') return 86400;
    if (timeframe === 'W') return 604800;
    const minutes = Number(timeframe);
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 60;
  }
  const diffs: number[] = [];
  for (let i = 1; i < candles.length && diffs.length < 40; i += 1) {
    const d = candles[i]!.time - candles[i - 1]!.time;
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 60;
}

function pricePrecisionFromTickSize(tickSize: string | null, fallbackPrice: number) {
  const text = String(tickSize || '').trim().toLowerCase();
  const scientific = text.match(/^([0-9]+(?:\.[0-9]+)?)e-([0-9]+)$/);
  if (scientific) {
    const coefficientDecimals = (scientific[1]!.split('.')[1] || '').replace(/0+$/, '').length;
    return Math.max(0, Number(scientific[2]) + coefficientDecimals);
  }
  const fraction = (text.split('.')[1] || '').replace(/0+$/, '');
  if (fraction) return fraction.length;
  const value = Math.abs(fallbackPrice);
  return value > 0 && value < 0.01 ? 6 : value < 1 ? 4 : 2;
}

function formatPrice(price: number, tickSize: string | null) {
  return price.toFixed(pricePrecisionFromTickSize(tickSize, price));
}

function formatDuration(seconds: number) {
  const abs = Math.max(0, Math.round(seconds));
  const days = Math.floor(abs / 86400);
  const hours = Math.floor((abs % 86400) / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function measurementStats(input: { startTime: number; endTime: number; startPrice: number; endPrice: number }, step: number) {
  const delta = input.endPrice - input.startPrice;
  const percent = input.startPrice > 0 ? (delta / input.startPrice) * 100 : 0;
  const bars = Math.max(1, Math.round(Math.abs(input.endTime - input.startTime) / Math.max(1, step)));
  return {
    delta,
    percent,
    bars,
    seconds: Math.abs(input.endTime - input.startTime),
  };
}

export default function RulerOverlay({
  chart,
  series,
  host,
  candles,
  items,
  tool,
  symbol,
  timeframe,
  tickSize,
  onCreate,
  onDelete,
  onFinishDraft,
}: Props) {
  const { language } = useI18n();
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<DraftMeasurement | null>(null);
  const draftRef = useRef<DraftMeasurement | null>(null);
  const [creating, setCreating] = useState(false);
  const finishDraftRef = useRef(onFinishDraft);
  finishDraftRef.current = onFinishDraft;
  const step = useMemo(() => candleStep(candles, timeframe), [candles, timeframe]);

  const timeToX = (time: number) => {
    if (!chart) return null;
    const direct = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (direct !== null) return direct;
    if (candles.length < 2) return null;

    let logical: number;
    if (time <= candles[0]!.time) logical = (time - candles[0]!.time) / step;
    else if (time >= candles[candles.length - 1]!.time) logical = candles.length - 1 + (time - candles[candles.length - 1]!.time) / step;
    else {
      let lo = 0;
      let hi = candles.length - 1;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (candles[mid]!.time <= time) lo = mid;
        else hi = mid;
      }
      const a = candles[lo]!;
      const b = candles[hi]!;
      logical = lo + (time - a.time) / Math.max(1, b.time - a.time);
    }
    return (chart.timeScale() as any).logicalToCoordinate(logical) as number | null;
  };

  const xToTime = (x: number) => {
    if (!chart || candles.length < 2) return null;
    const logical = (chart.timeScale() as any).coordinateToLogical(x) as number | null;
    if (logical === null || !Number.isFinite(logical)) return null;
    const base = Math.floor(logical);
    const fraction = logical - base;

    if (base < 0) return Math.round(candles[0]!.time + logical * step);
    if (base >= candles.length - 1) return Math.round(candles[candles.length - 1]!.time + (logical - (candles.length - 1)) * step);

    const a = candles[base]!;
    const b = candles[base + 1]!;
    return Math.round(a.time + (b.time - a.time) * fraction);
  };

  useEffect(() => {
    if (!chart) return;
    const cb = () => setVersion((v) => v + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(cb);
    chart.timeScale().subscribeVisibleLogicalRangeChange(cb);
    chart.subscribeCrosshairMove(cb);
    const ro = host ? new ResizeObserver(cb) : null;
    if (host) ro?.observe(host);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(cb);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      chart.unsubscribeCrosshairMove(cb);
      ro?.disconnect();
    };
  }, [chart, host]);

  useEffect(() => {
    setDraft(null);
    draftRef.current = null;
    setCreating(false);
  }, [symbol]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraft(null);
        draftRef.current = null;
        setCreating(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!creating || !chart || !series || !host) return;
    chart.applyOptions({ handleScroll: false, handleScale: false });

    const move = (event: PointerEvent) => {
      const current = draftRef.current;
      if (!current) return;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const nextTime = xToTime(x);
      const nextPrice = series.coordinateToPrice(y);
      if (typeof nextTime !== 'number' || !nextPrice || nextPrice <= 0) return;
      const next: DraftMeasurement = { ...current, endTime: nextTime, endPrice: nextPrice, active: true, finalized: false };
      draftRef.current = next;
      setDraft(next);
    };

    const finish = () => {
      const current = draftRef.current;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      setCreating(false);
      if (current) {
        const finalized: DraftMeasurement = { ...current, active: false, finalized: true };
        draftRef.current = finalized;
        setDraft(finalized);
        finishDraftRef.current();
      }
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
  }, [creating, chart, host, series]);

  const beginDraw = (event: ReactPointerEvent<SVGRectElement>) => {
    if (tool !== 'measure' || !series || !host || !chart) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const time = xToTime(x);
    const price = series.coordinateToPrice(y);
    if (typeof time !== 'number' || !price || price <= 0) return;
    const next: DraftMeasurement = { startTime: time, endTime: time, startPrice: price, endPrice: price, active: true, finalized: false };
    draftRef.current = next;
    setDraft(next);
    setCreating(true);
  };

  const pinDraft = () => {
    if (!draft) return;
    onCreate({
      symbol,
      startTime: draft.startTime,
      endTime: draft.endTime,
      startPrice: draft.startPrice,
      endPrice: draft.endPrice,
      displayMode: 'line',
    });
    setDraft(null);
    draftRef.current = null;
  };

  const clearDraft = () => {
    setDraft(null);
    draftRef.current = null;
    setCreating(false);
  };

  if (!chart || !series || !host) return null;

  const renderMeasurement = (key: string | number, item: { startTime: number; endTime: number; startPrice: number; endPrice: number }, persisted = false, id?: number) => {
    const x1 = timeToX(item.startTime);
    const x2 = timeToX(item.endTime);
    const y1 = series.priceToCoordinate(item.startPrice);
    const y2 = series.priceToCoordinate(item.endPrice);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return null;

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const midX = left + width / 2;
    const midY = top + height / 2;
    const stats = measurementStats(item, step);
    const sign = stats.delta >= 0 ? '+' : '';
    const label = `${sign}${stats.percent.toFixed(2)}% · ${sign}${formatPrice(stats.delta, tickSize)} · ${stats.bars}b`;

    return (
      <g key={key} className={persisted ? 'measure-object persisted' : 'measure-object draft'}>
        {!persisted && <rect className={stats.delta >= 0 ? 'measure-box positive' : 'measure-box negative'} x={left} y={top} width={width} height={height} rx="3" />}
        <line className={persisted ? 'measure-line persisted' : 'measure-line draft'} x1={x1} y1={y1} x2={x2} y2={y2} />
        <circle className="measure-point" cx={x1} cy={y1} r="3.5" />
        <circle className="measure-point" cx={x2} cy={y2} r="3.5" />
        <g className="measure-label" transform={`translate(${Math.max(8, Math.min(host.clientWidth - 150, midX - 70))}, ${Math.max(12, top - 26)})`}>
          <rect width="140" height="22" rx="6" />
          <text x="8" y="14">{label}</text>
        </g>
        {persisted && typeof id === 'number' && (
          <g className="measure-delete" transform={`translate(${Math.max(8, Math.min(host.clientWidth - 16, midX + 78))}, ${Math.max(12, top - 15)})`} onPointerDown={(event) => { event.stopPropagation(); onDelete(id); }}>
            <circle r="8" />
            <text textAnchor="middle" y="4">×</text>
          </g>
        )}
      </g>
    );
  };

  const draftStats = draft ? measurementStats(draft, step) : null;
  const draftSign = draftStats && draftStats.delta >= 0 ? '+' : '';

  return (
    <>
      <svg className="chart-overlay measure-overlay" width={host.clientWidth} height={host.clientHeight} data-version={version}>
        {items.map((item) => renderMeasurement(item.id, item, true, item.id))}
        {draft ? renderMeasurement('draft', draft, false) : null}
        {tool === 'measure' && <rect className="measure-capture" x="0" y="0" width={host.clientWidth} height={host.clientHeight} onPointerDown={beginDraw} />}
      </svg>

      {draft && draft.finalized && draftStats && (
        <div className="measure-draft-panel">
          <div className="measure-draft-main">
            <strong>{language === 'uk' ? 'Лінійка' : language === 'ru' ? 'Линейка' : 'Ruler'}</strong>
            <span>{draftSign}{draftStats.percent.toFixed(2)}% · {draftSign}{formatPrice(draftStats.delta, tickSize)} · {draftStats.bars}b · {formatDuration(draftStats.seconds)}</span>
          </div>
          <div className="measure-draft-actions">
            <button type="button" className="mini-btn" onClick={clearDraft}>{language === 'uk' ? 'Очистити' : language === 'ru' ? 'Очистить' : 'Clear'}</button>
            <button type="button" className="mini-btn" onClick={pinDraft}>{language === 'uk' ? 'Закріпити' : language === 'ru' ? 'Закрепить' : 'Pin'}</button>
          </div>
        </div>
      )}
    </>
  );
}
