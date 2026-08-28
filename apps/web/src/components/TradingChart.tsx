import { useEffect, useRef, useState } from 'react';
import {
  BarSeries,
  ColorType,
  LineStyle,
  createChart,
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
} from '@trade/shared';
import RiskRewardOverlay from './RiskRewardOverlay';

interface Props {
  symbol: string;
  candles: Candle[];
  autoLevels: AutoLevel[];
  manualLevels: ManualLevel[];
  alerts: AlertRecord[];
  riskRewards: RiskReward[];
  tool: DrawingTool;
  selectedRiskReward: RiskReward | null;
  timeframe: string;
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
  onUsePriceLevel: (price: number) => void;
}

type RrDraft = { entry?: number; stop?: number; startTime?: number };
type RrHover = { price: number; time: number } | null;
type PriceDrag = {
  kind: 'level' | 'alert';
  id: number;
  originalPrice: number;
  price: number;
  startY: number;
  moved: boolean;
};

const timeframeSeconds = (timeframe: string) => {
  if (timeframe === 'D') return 86_400;
  const minutes = Number(timeframe);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 900;
};

export default function TradingChart(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [series, setSeries] = useState<ISeriesApi<'Bar'> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const manualLineMap = useRef(new Map<number, IPriceLine>());
  const alertLineMap = useRef(new Map<number, IPriceLine>());
  const toolRef = useRef(p.tool);
  const timeframeRef = useRef(p.timeframe);
  const onCreateLevelRef = useRef(p.onCreateLevel);
  const onCreateAlertRef = useRef(p.onCreateAlert);
  const onCreateRiskRewardRef = useRef(p.onCreateRiskReward);
  const [rrDraft, setRrDraft] = useState<RrDraft>({});
  const rrDraftRef = useRef<RrDraft>({});
  const [rrHover, setRrHover] = useState<RrHover>(null);
  const [priceDrag, setPriceDrag] = useState<PriceDrag | null>(null);
  const priceDragRef = useRef<PriceDrag | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);

  toolRef.current = p.tool;
  timeframeRef.current = p.timeframe;
  onCreateLevelRef.current = p.onCreateLevel;
  onCreateAlertRef.current = p.onCreateAlert;
  onCreateRiskRewardRef.current = p.onCreateRiskReward;
  rrDraftRef.current = rrDraft;
  priceDragRef.current = priceDrag;

  useEffect(() => {
    if (!hostRef.current) return;

    const c = createChart(hostRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#0a0f16' }, textColor: '#6f7f94' },
      grid: { vertLines: { color: '#111a25' }, horzLines: { color: '#111a25' } },
      rightPriceScale: { borderColor: '#202b3a' },
      timeScale: { borderColor: '#202b3a', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#60708755' }, horzLine: { color: '#60708755' } },
    });

    const s = c.addSeries(BarSeries, {
      upColor: '#31c48d',
      downColor: '#ef6675',
      openVisible: true,
      thinBars: false,
    });

    setChart(c);
    setSeries(s);

    const pointData = (param: any) => {
      if (!param?.point || !param?.time) return null;
      const price = s.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return null;
      const time = typeof param.time === 'number' ? param.time : Math.floor(Date.now() / 1000);
      return { price, time };
    };

    const click = (param: any) => {
      const point = pointData(param);
      if (!point) return;
      const { price, time } = point;

      // Level and Alert are deliberately one-shot tools: one chart click creates
      // the object; ChartPage switches the toolbar back to Select after success.
      if (toolRef.current === 'level') {
        onCreateLevelRef.current(price);
        return;
      }
      if (toolRef.current === 'alert') {
        onCreateAlertRef.current(price);
        return;
      }

      if (toolRef.current === 'risk-reward') {
        const draft = rrDraftRef.current;
        if (draft.entry === undefined) {
          const next = { entry: price, startTime: time };
          rrDraftRef.current = next;
          setRrDraft(next);
          return;
        }
        if (draft.stop === undefined) {
          const next = { ...draft, stop: price };
          rrDraftRef.current = next;
          setRrDraft(next);
          return;
        }

        const entry = Number(draft.entry);
        const stop = Number(draft.stop);
        const startTime = Number(draft.startTime);
        const minEnd = startTime + timeframeSeconds(timeframeRef.current);
        const endTime = Math.max(time, minEnd);
        onCreateRiskRewardRef.current({
          symbol: '',
          timeframe: timeframeRef.current,
          direction: price >= entry ? 'long' : 'short',
          entry,
          stop,
          target: price,
          startTime,
          endTime,
        });
        rrDraftRef.current = {};
        setRrDraft({});
        setRrHover(null);
      }
    };

    const crosshair = (param: any) => {
      if (toolRef.current !== 'risk-reward' || rrDraftRef.current.entry === undefined) {
        setRrHover(null);
        return;
      }
      const point = pointData(param);
      if (point) setRrHover(point);
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
    if (!chart || !hostRef.current) return;
    const refresh = () => setOverlayVersion((value) => value + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(refresh);
    chart.timeScale().subscribeVisibleLogicalRangeChange(refresh);
    const observer = new ResizeObserver(refresh);
    observer.observe(hostRef.current);
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(refresh);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(refresh);
      observer.disconnect();
    };
  }, [chart]);

  useEffect(() => {
    series?.setData(p.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
  }, [series, p.candles]);

  useEffect(() => {
    if (!series) return;
    for (const line of lines.current) series.removePriceLine(line);
    lines.current = [];
    manualLineMap.current.clear();
    alertLineMap.current.clear();

    for (const level of p.autoLevels) {
      lines.current.push(series.createPriceLine({
        price: level.price,
        color: level.type === 'mirror' ? '#7387ff' : level.type === 'support' ? '#3a9b79' : '#b85b6c',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.type} · ${level.touches}`,
      }));
    }

    for (const level of p.manualLevels) {
      const line = series.createPriceLine({
        price: level.price,
        color: '#d6dbe4',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: level.label || 'Manual',
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
  }, [series, p.autoLevels, p.manualLevels, p.alerts]);

  useEffect(() => {
    if (chart && p.candles.length) chart.timeScale().fitContent();
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
    if (!priceDrag || !series || !hostRef.current) return;
    const host = hostRef.current;

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

    const up = () => {
      const current = priceDragRef.current;
      if (current) {
        if (current.moved) {
          if (current.kind === 'level') p.onUpdateLevel(current.id, current.price);
          else p.onUpdateAlert(current.id, current.price);
        } else {
          p.onUsePriceLevel(current.originalPrice);
        }
      }
      priceDragRef.current = null;
      setPriceDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [priceDrag, series, p.onUpdateLevel, p.onUpdateAlert, p.onUsePriceLevel]);

  const startPriceDrag = (kind: 'level' | 'alert', id: number, price: number, event: any) => {
    if (p.tool !== 'select' || !hostRef.current) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = hostRef.current.getBoundingClientRect();
    const next: PriceDrag = {
      kind,
      id,
      originalPrice: price,
      price,
      startY: event.clientY - rect.top,
      moved: false,
    };
    priceDragRef.current = next;
    setPriceDrag(next);
  };

  const entryY = series && rrDraft.entry !== undefined ? series.priceToCoordinate(rrDraft.entry) : null;
  const stopY = series && rrDraft.stop !== undefined ? series.priceToCoordinate(rrDraft.stop) : null;
  const hoverY = series && rrHover ? series.priceToCoordinate(rrHover.price) : null;
  const draftX1 = chart && rrDraft.startTime !== undefined
    ? chart.timeScale().timeToCoordinate(rrDraft.startTime as UTCTimestamp)
    : null;
  const draftX2 = chart && rrHover
    ? chart.timeScale().timeToCoordinate(rrHover.time as UTCTimestamp)
    : null;

  return (
    <div className={priceDrag ? 'chart-card drawing-dragging' : 'chart-card'}>
      <div ref={hostRef} className="chart-host" />

      <RiskRewardOverlay
        chart={chart}
        series={series}
        host={hostRef.current}
        candles={p.candles}
        items={p.riskRewards}
        selectedId={p.selectedRiskReward?.id ?? null}
        onSelect={p.onSelectRiskReward}
        onUpdate={p.onUpdateRiskReward}
        onDelete={p.onDeleteRiskReward}
      />

      {series && hostRef.current && (
        <svg className="chart-overlay level-actions-overlay" width={hostRef.current.clientWidth} height={hostRef.current.clientHeight} data-version={overlayVersion}>
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
                className={p.tool === 'select' ? 'price-line-click-target active' : 'price-line-click-target'}
                onPointerDown={(event) => {
                  if (p.tool !== 'select') return;
                  event.stopPropagation();
                  p.onUsePriceLevel(level.price);
                }}
              />
            );
          })}

          {p.manualLevels.map((level) => {
            const shownPrice = priceDrag?.kind === 'level' && priceDrag.id === level.id ? priceDrag.price : level.price;
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
                  className={p.tool === 'select' ? 'price-line-click-target active draggable' : 'price-line-click-target'}
                  onPointerDown={(event) => startPriceDrag('level', level.id, level.price, event)}
                />
                <g className="drawing-delete" onPointerDown={(event) => { event.stopPropagation(); p.onDeleteLevel(level.id); }}>
                  <circle cx={x} cy={y} r="8" />
                  <text x={x} y={y + 3.5} textAnchor="middle">×</text>
                </g>
              </g>
            );
          })}

          {p.alerts.filter((alert) => alert.active).map((alert) => {
            const shownPrice = priceDrag?.kind === 'alert' && priceDrag.id === alert.id ? priceDrag.price : alert.price;
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
                  className={p.tool === 'select' ? 'price-line-click-target active draggable alert-hit' : 'price-line-click-target'}
                  onPointerDown={(event) => startPriceDrag('alert', alert.id, alert.price, event)}
                />
                <g className="drawing-delete alert-delete" onPointerDown={(event) => { event.stopPropagation(); p.onDeleteAlert(alert.id); }}>
                  <circle cx={x} cy={y} r="8" />
                  <text x={x} y={y + 3.5} textAnchor="middle">×</text>
                </g>
              </g>
            );
          })}
        </svg>
      )}

      {p.tool === 'risk-reward' && (
        <>
          <div className="rr-draft-help">
            Risk/Reward:{' '}
            {rrDraft.entry === undefined
              ? '1/3 — click Entry'
              : rrDraft.stop === undefined
                ? `2/3 — click Stop · Entry ${rrDraft.entry.toFixed(4)}`
                : `3/3 — click Target / width · Entry ${rrDraft.entry.toFixed(4)} · Stop ${rrDraft.stop.toFixed(4)}`}
            <span>Esc = cancel</span>
          </div>

          {entryY !== null && <div className="rr-draft-line entry" style={{ top: entryY }} />}
          {stopY !== null && <div className="rr-draft-line stop" style={{ top: stopY }} />}

          {rrDraft.stop !== undefined && rrHover && entryY !== null && stopY !== null && hoverY !== null && draftX1 !== null && draftX2 !== null && (
            <svg className="chart-overlay rr-draft-overlay" width={hostRef.current?.clientWidth || 0} height={hostRef.current?.clientHeight || 0}>
              {(() => {
                const left = Math.min(draftX1, draftX2);
                const right = Math.max(draftX1, draftX2);
                const width = Math.max(24, right - left);
                return (
                  <>
                    <rect className="rr-reward rr-draft-box" x={left} y={Math.min(entryY, hoverY)} width={width} height={Math.max(1, Math.abs(hoverY - entryY))} />
                    <rect className="rr-risk rr-draft-box" x={left} y={Math.min(entryY, stopY)} width={width} height={Math.max(1, Math.abs(stopY - entryY))} />
                  </>
                );
              })()}
            </svg>
          )}
        </>
      )}
    </div>
  );
}
