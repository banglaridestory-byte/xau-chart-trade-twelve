import { createSeriesMarkers } from 'lightweight-charts';

const BULL = '#26a69a';
const BEAR = '#ef5350';
const NEUTRAL = '#6e7681';

const rgba = (hex, alpha) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

class ZoneRenderer {
  constructor(source) {
    this.source = source;
  }

  #drawZones(scope) {
    const { chart, series, zones } = this.source;
    const timeScale = chart.timeScale();
    const ctx = scope.context;
    const hRatio = scope.horizontalPixelRatio;
    const vRatio = scope.verticalPixelRatio;
    const chartWidth = chart.paneSize().width;

    for (const zone of zones) {
      const x1 = timeScale.timeToCoordinate(zone.startTime);
      const x2 = zone.extendRight ? chartWidth : timeScale.timeToCoordinate(zone.endTime);
      const topPrice = Math.max(zone.top, zone.bottom);
      const bottomPrice = Math.min(zone.top, zone.bottom);
      const y1 = series.priceToCoordinate(topPrice);
      const y2 = series.priceToCoordinate(bottomPrice);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;

      const left = x1 * hRatio;
      const right = x2 * hRatio;
      const top = y1 * vRatio;
      const bottom = y2 * vRatio;
      const color = zone.type === 'bull' ? BULL : BEAR;

      ctx.fillStyle = rgba(color, 0.13);
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = rgba(color, 0.6);
      ctx.lineWidth = Math.max(1, hRatio);
      ctx.strokeRect(left, top, right - left, bottom - top);
    }
  }

  #drawSignals(scope) {
    const { chart, series, signals } = this.source;
    const timeScale = chart.timeScale();
    const ctx = scope.context;
    const hRatio = scope.horizontalPixelRatio;
    const vRatio = scope.verticalPixelRatio;
    const chartWidth = chart.paneSize().width * hRatio;
    const labelWidth = 140 * hRatio;
    const labelHeight = 16 * vRatio;

    const drawTag = (text, x, y, bg) => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y - labelHeight, labelWidth, labelHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x + 6 * hRatio, y - 4 * vRatio);
    };

    for (const signal of signals) {
      const x = timeScale.timeToCoordinate(signal.time);
      const entryY = series.priceToCoordinate(signal.entry);
      if (x === null || entryY === null) continue;

      const isBuy = signal.side === 'long';
      const directionColor = isBuy ? BULL : BEAR;
      const pixelX = x * hRatio;
      const pixelY = entryY * vRatio;

      ctx.save();
      ctx.font = `bold ${11 * hRatio}px Inter, sans-serif`;
      ctx.lineWidth = Math.max(1, hRatio);

      const lines = [
        { price: signal.entry, color: '#f5a623', label: `${isBuy ? 'BUY' : 'SELL'} ENTRY` },
        { price: signal.stopLoss, color: BEAR, label: 'STOP LOSS' },
        { price: signal.takeProfit, color: BULL, label: 'TAKE PROFIT' },
      ].map((line) => ({ ...line, y: series.priceToCoordinate(line.price) }));

      const [, stop, target] = lines;
      if (stop.y !== null && target.y !== null) {
        ctx.setLineDash([3 * hRatio, 4 * hRatio]);
        ctx.strokeStyle = rgba(directionColor, 0.4);
        ctx.beginPath();
        ctx.moveTo(pixelX, stop.y * vRatio);
        ctx.lineTo(pixelX, target.y * vRatio);
        ctx.stroke();
      }

      ctx.setLineDash([5 * hRatio, 4 * hRatio]);
      for (const line of lines) {
        if (line.y === null) continue;
        const y = line.y * vRatio;
        ctx.strokeStyle = rgba(line.color, 0.75);
        ctx.beginPath();
        ctx.moveTo(pixelX, y);
        ctx.lineTo(chartWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawTag(`${line.label} ${Number(line.price).toFixed(2)}`, chartWidth - labelWidth, y - 2 * vRatio, rgba(line.color, 0.9));
        ctx.setLineDash([5 * hRatio, 4 * hRatio]);
      }

      ctx.setLineDash([]);
      const badgeWidth = 58 * hRatio;
      const badgeHeight = 22 * vRatio;
      const badgeX = pixelX + 8 * hRatio;
      const badgeY = pixelY - badgeHeight - 6 * vRatio;
      ctx.fillStyle = rgba(directionColor, 0.95);
      ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${13 * hRatio}px Inter, sans-serif`;
      ctx.fillText(isBuy ? 'BUY' : 'SELL', badgeX + 10 * hRatio, badgeY + 15 * vRatio);

      ctx.restore();
    }
  }

  draw(target) {
    target.useBitmapCoordinateSpace((scope) => {
      this.#drawZones(scope);
      this.#drawSignals(scope);
    });
  }
}

class ZonePaneView {
  constructor(source) {
    this.source = source;
  }

  zOrder() {
    return 'bottom';
  }

  renderer() {
    return new ZoneRenderer(this.source);
  }
}

class SMCOverlayPrimitive {
  constructor() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
    this.zones = [];
    this.signals = [];
    this.views = [];
  }

  attached({ chart, series, requestUpdate }) {
    this.chart = chart;
    this.series = series;
    this.requestUpdate = requestUpdate;
    this.views = [new ZonePaneView(this)];
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  updateAllViews() {
    this.views = [new ZonePaneView(this)];
  }

  setData(zones, signals) {
    this.zones = zones;
    this.signals = signals;
    this.views = [new ZonePaneView(this)];
    this.requestUpdate?.();
  }
}

function buildMarkers(smc) {
  const markers = [];

  for (const swing of smc.swings.slice(-24)) {
    markers.push({
      time: swing.time,
      position: swing.kind === 'high' ? 'aboveBar' : 'belowBar',
      shape: swing.kind === 'high' ? 'triangleDown' : 'triangleUp',
      color: NEUTRAL,
      size: 0,
    });
  }

  for (const event of smc.sweeps.slice(-24)) {
    markers.push({
      time: event.time,
      position: event.type === 'bull' ? 'belowBar' : 'aboveBar',
      shape: 'circle',
      color: event.type === 'bull' ? BULL : BEAR,
      text: 'Sweep',
      size: 1,
    });
  }

  for (const event of smc.structure.slice(-32)) {
    markers.push({
      time: event.time,
      position: event.direction === 'bull' ? 'belowBar' : 'aboveBar',
      shape: event.direction === 'bull' ? 'arrowUp' : 'arrowDown',
      color: event.direction === 'bull' ? BULL : BEAR,
      text: event.type,
      size: 1,
    });
  }

  for (const signal of smc.signals.slice(-12)) {
    const isBuy = signal.side === 'long';
    const outcome =
      signal.status === 'closed'
        ? signal.result === 'target'
          ? ' · TP HIT'
          : ' · SL HIT'
        : '';
    markers.push({
      time: signal.time,
      position: isBuy ? 'belowBar' : 'aboveBar',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      color: isBuy ? BULL : BEAR,
      text: `${isBuy ? 'BUY' : 'SELL'}${outcome}`,
      size: 2,
    });
  }

  return markers.sort((a, b) => a.time - b.time).slice(-100);
}

export function createSMCOverlay(candleSeries) {
  const markers = createSeriesMarkers(candleSeries, []);
  const primitive = new SMCOverlayPrimitive();
  candleSeries.attachPrimitive(primitive);

  return {
    update(smc) {
      if (!smc) return;
      const zones = [...smc.fvgs, ...smc.orderBlocks]
        .filter((zone) => !zone.mitigated)
        .slice(-24)
        .map((zone) => ({ ...zone, extendRight: true }));
      const signals = smc.signals.filter((signal) => signal.status === 'active').slice(-4);
      primitive.setData(zones, signals);
      markers.setMarkers(buildMarkers(smc));
    },

    clear() {
      primitive.setData([], []);
      markers.setMarkers([]);
    },

    destroy() {
      candleSeries.detachPrimitive(primitive);
      markers.setMarkers([]);
    },
  };
}
