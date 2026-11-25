import { CONFIG } from './config.js';
import { floorTime } from './validate.js';

export class CandleStore {
  constructor(maxBars = CONFIG.maxCachedBars) {
    this.maxBars = maxBars;
    this.buckets = new Map();
  }

  #bucket(timeframe) {
    if (!this.buckets.has(timeframe)) this.buckets.set(timeframe, new Map());
    return this.buckets.get(timeframe);
  }

  setHistory(timeframe, candles) {
    const bucket = new Map();
    for (const candle of candles) bucket.set(candle.time, candle);
    const ordered = [...bucket.values()].sort((a, b) => a.time - b.time).slice(-this.maxBars);
    this.buckets.set(timeframe, new Map(ordered.map((candle) => [candle.time, candle])));
  }

  upsert(timeframe, candle) {
    const bucket = this.#bucket(timeframe);
    const existing = bucket.get(candle.time);
    bucket.set(candle.time, { ...existing, ...candle });

    while (bucket.size > this.maxBars) {
      bucket.delete(bucket.keys().next().value);
    }
    return !existing;
  }

  last(timeframe) {
    const bucket = this.#bucket(timeframe);
    return bucket.size ? [...bucket.values()].at(-1) : null;
  }

  get(timeframe, limit = CONFIG.timeframeLimit) {
    const bucket = this.#bucket(timeframe);
    return [...bucket.values()].sort((a, b) => a.time - b.time).slice(-Math.max(1, limit));
  }

  size(timeframe) {
    return this.#bucket(timeframe).size;
  }
}

export class TickAggregator {
  constructor(store, timeframeMap, { onCandle, onGap } = {}) {
    this.store = store;
    this.timeframeMap = timeframeMap;
    this.onCandle = onCandle ?? (() => {});
    this.onGap = onGap ?? (() => {});
  }

  ingest(timeframe, tick) {
    const definition = this.timeframeMap[timeframe];
    if (!definition) return null;

    const bucketTime = floorTime(tick.time, definition.seconds);
    const last = this.store.last(timeframe);

    if (last && bucketTime < last.time) return null;
    if (last && bucketTime > last.time + definition.seconds) {
      this.onGap(timeframe, last.time, bucketTime);
    }

    let candle;
    if (last && bucketTime === last.time) {
      candle = {
        ...last,
        high: Math.max(last.high, tick.price),
        low: Math.min(last.low, tick.price),
        close: tick.price,
      };
    } else {
      candle = {
        time: bucketTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
      };
    }

    this.store.upsert(timeframe, candle);
    this.onCandle(timeframe, candle);
    return candle;
  }
}
