const DEFAULTS = {
  swingLeft: 3,
  swingRight: 3,
  avgBodyPeriod: 20,
  impulseMultiplier: 1.35,
  impulseBodyRatio: 0.45,
  zoneLookback: 60,
  structureLookback: 60,
  sweepLookback: 24,
  maxZones: 80,
  maxSignals: 40,
  atrPeriod: 14,
  minBars: 40,
};

const bodyOf = (candle) => Math.abs(candle.close - candle.open);
const rangeOf = (candle) => Math.max(candle.high - candle.low, 1e-9);

function averageBody(candles, index, period) {
  const start = Math.max(0, index - period + 1);
  let total = 0;
  for (let i = start; i <= index; i += 1) total += bodyOf(candles[i]);
  return total / (index - start + 1);
}

function computeATR(candles, period) {
  const values = [];
  for (let i = 0; i < candles.length; i += 1) {
    const previous = i > 0 ? candles[i - 1].close : candles[i].open;
    const trueRange = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - previous),
      Math.abs(candles[i].low - previous),
    );
    const start = Math.max(0, i - period + 1);
    let total = 0;
    for (let j = start; j <= i; j += 1) {
      const prior = j > 0 ? candles[j - 1].close : candles[j].open;
      total += Math.max(
        candles[j].high - candles[j].low,
        Math.abs(candles[j].high - prior),
        Math.abs(candles[j].low - prior),
      );
    }
    values.push(total / (i - start + 1) || trueRange);
  }
  return values;
}

function findSwings(candles, options) {
  const swings = [];
  const { swingLeft, swingRight } = options;

  for (let i = swingLeft; i < candles.length - swingRight; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - swingLeft; j <= i + swingRight; j += 1) {
      if (j === i) continue;
      if (candles[i].high <= candles[j].high) isHigh = false;
      if (candles[i].low >= candles[j].low) isLow = false;
    }
    if (isHigh) {
      swings.push({ time: candles[i].time, index: i, kind: 'high', price: candles[i].high });
    }
    if (isLow) {
      swings.push({ time: candles[i].time, index: i, kind: 'low', price: candles[i].low });
    }
  }
  return swings;
}

function findFVGs(candles, options) {
  const gaps = [];
  for (let i = 2; i < candles.length; i += 1) {
    const left = candles[i - 2];
    const middle = candles[i - 1];
    const right = candles[i];
    let type = null;
    let top;
    let bottom;

    if (right.low > left.high && middle.low >= left.high - 1e-9) {
      type = 'bull';
      bottom = left.high;
      top = right.low;
    } else if (right.high < left.low && middle.high <= left.low + 1e-9) {
      type = 'bear';
      top = left.low;
      bottom = right.high;
    }
    if (!type) continue;

    const mitigated = candles.slice(i + 1).some((candle) =>
      type === 'bull' ? candle.low <= bottom : candle.high >= top,
    );

    gaps.push({
      id: `fvg-${type}-${left.time}`,
      type,
      startTime: left.time,
      endTime: right.time,
      createdIndex: i,
      top,
      bottom,
      mitigated,
    });
  }
  return gaps.slice(-options.maxZones);
}

function findOrderBlocks(candles, options) {
  const blocks = [];
  const seen = new Set();

  for (let i = 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const body = bodyOf(candle);
    const average = averageBody(candles, i, options.avgBodyPeriod);
    const impulse =
      body >= average * options.impulseMultiplier && body / rangeOf(candle) >= options.impulseBodyRatio;
    if (!impulse) continue;

    const bullish = candle.close > candle.open;
    let origin = -1;
    for (let j = i - 1; j >= Math.max(0, i - 6); j -= 1) {
      const opposite = bullish ? candles[j].close < candles[j].open : candles[j].close > candles[j].open;
      if (opposite) {
        origin = j;
        break;
      }
    }
    if (origin < 0) continue;

    const type = bullish ? 'bull' : 'bear';
    const id = `ob-${type}-${candles[origin].time}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const top = candles[origin].high;
    const bottom = candles[origin].low;
    const mitigated = candles.slice(i + 1).some((later) =>
      type === 'bull' ? later.low <= bottom : later.high >= top,
    );

    blocks.push({
      id,
      type,
      startTime: candles[origin].time,
      endTime: candle.time,
      createdIndex: i,
      top,
      bottom,
      mitigated,
    });
  }
  return blocks.slice(-options.maxZones);
}

function findStructure(candles, swings, options) {
  const events = [];
  const highSwings = swings.filter((swing) => swing.kind === 'high');
  const lowSwings = swings.filter((swing) => swing.kind === 'low');
  let trend = null;
  let lastBrokenHigh = 0;
  let lastBrokenLow = 0;
  let highPointer = 0;
  let lowPointer = 0;

  for (let i = 1; i < candles.length; i += 1) {
    while (
      highPointer < highSwings.length &&
      highSwings[highPointer].index + options.swingRight < i
    ) highPointer += 1;
    while (
      lowPointer < lowSwings.length &&
      lowSwings[lowPointer].index + options.swingRight < i
    ) lowPointer += 1;

    const high = highSwings[highPointer - 1];
    const low = lowSwings[lowPointer - 1];

    if (high && high.time > lastBrokenHigh && candles[i].close > high.price) {
      events.push({
        id: `bos-${high.time}-${candles[i].time}`,
        type: trend === 'down' ? 'CHoCH' : 'BOS',
        direction: 'bull',
        time: candles[i].time,
        index: i,
        price: high.price,
        brokenTime: high.time,
      });
      trend = 'up';
      lastBrokenHigh = high.time;
    }

    if (low && low.time > lastBrokenLow && candles[i].close < low.price) {
      events.push({
        id: `bos-${low.time}-${candles[i].time}`,
        type: trend === 'up' ? 'CHoCH' : 'BOS',
        direction: 'bear',
        time: candles[i].time,
        index: i,
        price: low.price,
        brokenTime: low.time,
      });
      trend = 'down';
      lastBrokenLow = low.time;
    }
  }
  return events.slice(-options.maxZones);
}

function findSweeps(candles, swings, options) {
  const sweeps = [];
  const seen = new Set();

  for (let i = 1; i < candles.length; i += 1) {
    for (const swing of swings) {
      if (swing.index + options.swingRight >= i || i - swing.index > options.sweepLookback) continue;
      const key = `${swing.kind}-${swing.time}`;
      if (seen.has(key)) continue;

      if (swing.kind === 'high' && candles[i].high > swing.price && candles[i].close < swing.price) {
        sweeps.push({
          id: `sweep-${key}`,
          type: 'bear',
          time: candles[i].time,
          index: i,
          level: swing.price,
          price: candles[i].high,
        });
        seen.add(key);
      }
      if (swing.kind === 'low' && candles[i].low < swing.price && candles[i].close > swing.price) {
        sweeps.push({
          id: `sweep-${key}`,
          type: 'bull',
          time: candles[i].time,
          index: i,
          level: swing.price,
          price: candles[i].low,
        });
        seen.add(key);
      }
    }
  }
  return sweeps.slice(-options.maxZones);
}

function zoneUntouchedBefore(zone, candles, index) {
  for (let i = zone.createdIndex + 1; i < index; i += 1) {
    if (zone.type === 'bull' && candles[i].low <= zone.bottom) return false;
    if (zone.type === 'bear' && candles[i].high >= zone.top) return false;
  }
  return true;
}

function nearestSwing(swings, index, side, options) {
  let best = null;
  for (const swing of swings) {
    if (swing.index + options.swingRight >= index) continue;
    const aligned = side === 'long' ? swing.kind === 'high' : swing.kind === 'low';
    if (!aligned) continue;
    if (!best || index - swing.index < index - best.index) best = swing;
  }
  return best;
}

function findSignals(candles, swings, fvgs, blocks, structure, sweeps, atr, options) {
  const signals = [];
  const usedZones = new Set();

  for (let i = options.minBars; i < candles.length; i += 1) {
    const candle = candles[i];
    const side = candle.close >= candle.open ? 'long' : 'short';
    const wantedType = side === 'long' ? 'bull' : 'bear';
    const zones = [
      ...fvgs.map((zone) => ({ ...zone, source: 'FVG' })),
      ...blocks.map((zone) => ({ ...zone, source: 'Order Block' })),
    ].filter(
      (zone) =>
        zone.type === wantedType &&
        zone.createdIndex < i &&
        i - zone.createdIndex <= options.zoneLookback &&
        !usedZones.has(zone.id) &&
        zoneUntouchedBefore(zone, candles, i),
    );

    const zone = zones.find((candidate) => {
      const height = Math.max(candidate.top - candidate.bottom, 1e-9);
      if (side === 'long') {
        return (
          candle.low <= candidate.top &&
          candle.high >= candidate.bottom &&
          candle.close >= candidate.bottom + height * 0.15
        );
      }
      return (
        candle.high >= candidate.bottom &&
        candle.low <= candidate.top &&
        candle.close <= candidate.top - height * 0.15
      );
    });
    if (!zone) continue;

    const confirmation = structure.findLast(
      (event) =>
        event.direction === (side === 'long' ? 'bull' : 'bear') &&
        event.index < i &&
        i - event.index <= options.structureLookback,
    );
    if (!confirmation) continue;

    const reasons = [`${zone.source} retest`, `${confirmation.type} ${confirmation.direction}`];
    const sweep = sweeps.findLast(
      (event) =>
        event.type === (side === 'long' ? 'bull' : 'bear') &&
        event.index < i &&
        i - event.index <= options.sweepLookback,
    );
    if (sweep) reasons.push('Liquidity sweep');

    const riskUnit = Math.max(atr[i] * 0.8, (zone.top - zone.bottom) * 0.4, 1e-6);
    const opposing = nearestSwing(swings, i, side, options);
    let stopLoss;
    let takeProfit;

    if (side === 'long') {
      stopLoss = zone.bottom - riskUnit * 0.5;
      takeProfit = opposing && opposing.price > candle.close ? opposing.price : candle.close + riskUnit * 4;
    } else {
      stopLoss = zone.top + riskUnit * 0.5;
      takeProfit = opposing && opposing.price < candle.close ? opposing.price : candle.close - riskUnit * 4;
    }

    signals.push({
      id: `signal-${side}-${zone.id}`,
      side,
      time: candle.time,
      entry: candle.close,
      stopLoss,
      takeProfit,
      confidence: reasons.length >= 3 ? 'high' : reasons.length === 2 ? 'medium' : 'low',
      reasons,
      zoneId: zone.id,
      status: 'active',
    });
    usedZones.add(zone.id);
  }

  for (const signal of signals) {
    const entryIndex = candles.findIndex((candle) => candle.time === signal.time);
    for (let i = entryIndex + 1; i < candles.length; i += 1) {
      const hitStop =
        signal.side === 'long' ? candles[i].low <= signal.stopLoss : candles[i].high >= signal.stopLoss;
      const hitTarget =
        signal.side === 'long'
          ? candles[i].high >= signal.takeProfit
          : candles[i].low <= signal.takeProfit;
      if (hitStop || hitTarget) {
        signal.status = 'closed';
        signal.result = hitStop ? 'stopped' : 'target';
        signal.closedAt = candles[i].time;
        break;
      }
    }
  }

  return signals.slice(-options.maxSignals);
}

export function detectSMC(candles, overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  const empty = {
    generatedAt: Date.now(),
    timeframe: null,
    counts: { swings: 0, fvgs: 0, orderBlocks: 0, structure: 0, sweeps: 0, signals: 0 },
    swings: [],
    fvgs: [],
    orderBlocks: [],
    structure: [],
    sweeps: [],
    signals: [],
  };
  if (!Array.isArray(candles) || candles.length < options.minBars) return empty;

  const swings = findSwings(candles, options);
  const fvgs = findFVGs(candles, options);
  const orderBlocks = findOrderBlocks(candles, options);
  const structure = findStructure(candles, swings, options);
  const sweeps = findSweeps(candles, swings, options);
  const signals = findSignals(candles, swings, fvgs, orderBlocks, structure, sweeps, computeATR(candles, options.atrPeriod), options);

  return {
    generatedAt: Date.now(),
    timeframe: options.timeframe ?? null,
    counts: {
      swings: swings.length,
      fvgs: fvgs.length,
      orderBlocks: orderBlocks.length,
      structure: structure.length,
      sweeps: sweeps.length,
      signals: signals.length,
    },
    swings,
    fvgs,
    orderBlocks,
    structure,
    sweeps,
    signals,
  };
}
