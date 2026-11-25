import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
} from 'lightweight-charts';
import { createSMCOverlay } from './smcOverlay.js';

const UP = '#26a69a';
const DOWN = '#ef5350';

const toCandlePoint = (candle) => ({
  time: candle.time,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});

const toVolumePoint = (candle) => ({
  time: candle.time,
  value: candle.volume,
  color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.35)' : 'rgba(239, 83, 80, 0.35)',
});

export function createChartController(container) {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#0b0e11' },
      textColor: '#8b949e',
      fontSize: 11,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    },
    grid: {
      vertLines: { color: '#171c23' },
      horzLines: { color: '#171c23' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#484f58', labelBackgroundColor: '#30363d' },
      horzLine: { color: '#484f58', labelBackgroundColor: '#30363d' },
    },
    rightPriceScale: { borderColor: '#252c35', scaleMargins: { top: 0.08, bottom: 0.24 } },
    timeScale: {
      borderColor: '#252c35',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
    },
    localization: { locale: 'en-US' },
  });

  const candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: UP,
    downColor: DOWN,
    borderVisible: false,
    wickUpColor: UP,
    wickDownColor: DOWN,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });

  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    lastValueVisible: false,
    priceLineVisible: false,
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  const smcOverlay = createSMCOverlay(candleSeries);

  return {
    chart,
    candleSeries,
    volumeSeries,

    setHistory(candles, { fit = false } = {}) {
      const timeScale = chart.timeScale();
      const visibleRange = fit ? null : timeScale.getVisibleRange();

      candleSeries.setData(candles.map(toCandlePoint));
      volumeSeries.setData(candles.map(toVolumePoint));
      smcOverlay.clear();

      if (fit && candles.length) {
        timeScale.fitContent();
      } else if (visibleRange && candles.length) {
        timeScale.setVisibleRange(visibleRange);
      }
    },

    updateCandle(candle) {
      candleSeries.update(toCandlePoint(candle));
      volumeSeries.update(toVolumePoint(candle));
    },

    resize() {
      chart.resize(container.clientWidth, container.clientHeight);
    },

    fitContent() {
      chart.timeScale().fitContent();
    },

    setSMC(smc) {
      smcOverlay.update(smc);
    },
  };
}
