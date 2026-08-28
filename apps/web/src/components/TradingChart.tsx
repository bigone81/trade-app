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
  onCreateRiskReward: (
    r: Omit<RiskReward, 'id' | 'createdAt' | 'updatedAt'>,
  ) => void;
  onSelectRiskReward: (r: RiskReward) => void;
  onUpdateRiskReward: (id: number, p: Partial<RiskReward>) => void;
}

type RrDraft = {
  entry?: number;
  stop?: number;
  startTime?: number;
};

export default function TradingChart(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [series, setSeries] = useState<ISeriesApi<'Bar'> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const toolRef = useRef(p.tool);
  const timeframeRef = useRef(p.timeframe);
  const onCreateLevelRef = useRef(p.onCreateLevel);
  const onCreateAlertRef = useRef(p.onCreateAlert);
  const onCreateRiskRewardRef = useRef(p.onCreateRiskReward);
  const [rrDraft, setRrDraft] = useState<RrDraft>({});

  toolRef.current = p.tool;
  timeframeRef.current = p.timeframe;
  onCreateLevelRef.current = p.onCreateLevel;
  onCreateAlertRef.current = p.onCreateAlert;
  onCreateRiskRewardRef.current = p.onCreateRiskReward;

  useEffect(() => {
    if (!hostRef.current) return;

    const c = createChart(hostRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0f16' },
        textColor: '#6f7f94',
      },
      grid: {
        vertLines: { color: '#111a25' },
        horzLines: { color: '#111a25' },
      },
      rightPriceScale: { borderColor: '#202b3a' },
      timeScale: {
        borderColor: '#202b3a',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#60708755' },
        horzLine: { color: '#60708755' },
      },
    });

    // Bars are the default chart style in v2. They show OHLC without candle bodies.
    const s = c.addSeries(BarSeries, {
      upColor: '#31c48d',
      downColor: '#ef6675',
      openVisible: true,
      thinBars: false,
    });

    setChart(c);
    setSeries(s);

    const click = (param: any) => {
      if (!param?.point || !param?.time) return;

      const price = s.coordinateToPrice(param.point.y);
      if (!price || price <= 0) return;

      const time =
        typeof param.time === 'number'
          ? param.time
          : Math.floor(Date.now() / 1000);

      if (toolRef.current === 'level') {
        onCreateLevelRef.current(price);
        return;
      }

      if (toolRef.current === 'alert') {
        onCreateAlertRef.current(price);
        return;
      }

      if (toolRef.current === 'risk-reward') {
        setRrDraft((draft) => {
          if (draft.entry === undefined) {
            return { entry: price, startTime: time };
          }

          if (draft.stop === undefined) {
            return { ...draft, stop: price };
          }

          const entry = Number(draft.entry);
          const stop = Number(draft.stop);
          const startTime = Number(draft.startTime);

          // Keep endTime on an existing bar. The old implementation projected
          // into future timestamps, and Lightweight Charts can return null for
          // timeToCoordinate() when that timestamp is not present in the series.
          // A same-bar R/R is still visible because the overlay enforces a
          // minimum pixel width and can later be stretched with the time handle.
          const endTime = time;

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

          return {};
        });
      }
    };

    c.subscribeClick(click);

    return () => {
      c.unsubscribeClick(click);
      c.remove();
    };
  }, []);

  useEffect(() => {
    series?.setData(
      p.candles.map((c) => ({
        ...c,
        time: c.time as UTCTimestamp,
      })),
    );
  }, [series, p.candles]);

  useEffect(() => {
    if (!series) return;

    for (const line of lines.current) series.removePriceLine(line);
    lines.current = [];

    for (const level of p.autoLevels) {
      lines.current.push(
        series.createPriceLine({
          price: level.price,
          color:
            level.type === 'mirror'
              ? '#7387ff'
              : level.type === 'support'
                ? '#3a9b79'
                : '#b85b6c',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${level.type} · ${level.touches}`,
        }),
      );
    }

    for (const level of p.manualLevels) {
      lines.current.push(
        series.createPriceLine({
          price: level.price,
          color: '#d6dbe4',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: level.label || 'Manual',
        }),
      );
    }

    for (const alert of p.alerts.filter((a) => a.active)) {
      lines.current.push(
        series.createPriceLine({
          price: alert.price,
          color: '#e1b84e',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '🔔',
        }),
      );
    }
  }, [series, p.autoLevels, p.manualLevels, p.alerts]);

  useEffect(() => {
    if (chart && p.candles.length) chart.timeScale().fitContent();
  }, [chart, p.candles.length]);

  useEffect(() => {
    if (p.tool !== 'risk-reward') setRrDraft({});
  }, [p.tool]);

  useEffect(() => {
    setRrDraft({});
  }, [p.timeframe]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRrDraft({});
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const entryY =
    series && rrDraft.entry !== undefined
      ? series.priceToCoordinate(rrDraft.entry)
      : null;
  const stopY =
    series && rrDraft.stop !== undefined
      ? series.priceToCoordinate(rrDraft.stop)
      : null;

  return (
    <div className="chart-card">
      <div ref={hostRef} className="chart-host" />

      <RiskRewardOverlay
        chart={chart}
        series={series}
        host={hostRef.current}
        items={p.riskRewards}
        selectedId={p.selectedRiskReward?.id ?? null}
        onSelect={p.onSelectRiskReward}
        onUpdate={p.onUpdateRiskReward}
      />

      {p.tool === 'risk-reward' && (
        <>
          <div
            style={{
              position: 'absolute',
              left: 12,
              top: 12,
              zIndex: 8,
              padding: '7px 9px',
              background: '#111a26ee',
              border: '1px solid #293548',
              borderRadius: 8,
              fontSize: 11,
              color: '#c2ccda',
              pointerEvents: 'none',
            }}
          >
            Risk/Reward:{' '}
            {rrDraft.entry === undefined
              ? '1/3 — click Entry'
              : rrDraft.stop === undefined
                ? `2/3 — click Stop · Entry ${rrDraft.entry.toFixed(4)}`
                : `3/3 — click Target · Entry ${rrDraft.entry.toFixed(4)} · Stop ${rrDraft.stop.toFixed(4)}`}
            <span style={{ color: '#718096', marginLeft: 8 }}>Esc = cancel</span>
          </div>

          {entryY !== null && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: entryY,
                borderTop: '1px dashed #d9e0ea',
                zIndex: 7,
                pointerEvents: 'none',
              }}
            />
          )}

          {stopY !== null && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: stopY,
                borderTop: '1px dashed #ef6675',
                zIndex: 7,
                pointerEvents: 'none',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
