const MIN_TIME = Date.UTC(2000, 0, 1) / 1000;
const MAX_TIME = Date.UTC(2100, 0, 1) / 1000;

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTimestamp(value) {
  if (value instanceof Date) {
    const seconds = Math.floor(value.getTime() / 1000);
    return seconds >= MIN_TIME && seconds <= MAX_TIME ? seconds : null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const seconds = Math.floor(value > 1e12 ? value / 1000 : value);
    return seconds >= MIN_TIME && seconds <= MAX_TIME ? seconds : null;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  let iso = text;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    iso = `${text.replace(' ', 'T')}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    iso = `${text}T00:00:00Z`;
  }

  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= MIN_TIME && seconds <= MAX_TIME ? seconds : null;
}

export function floorTime(seconds, timeframeSeconds) {
  return Math.floor(seconds / timeframeSeconds) * timeframeSeconds;
}

export function normalizeCandle(raw, timeframeSeconds) {
  if (!raw || typeof raw !== 'object') throw new Error('Candle payload is not an object');

  const time = parseTimestamp(raw.time ?? raw.datetime ?? raw.timestamp);
  const open = finiteNumber(raw.open);
  const high = finiteNumber(raw.high);
  const low = finiteNumber(raw.low);
  const close = finiteNumber(raw.close);
  const volume = finiteNumber(raw.volume) ?? 0;

  if (time === null) throw new Error('Candle has an invalid timestamp');
  if ([open, high, low, close].some((price) => price === null || price <= 0)) {
    throw new Error('Candle has an invalid OHLC value');
  }
  if (!Number.isFinite(volume) || volume < 0) throw new Error('Candle has an invalid volume');
  if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) {
    throw new Error('Candle violates high >= max(open, close) and low <= min(open, close)');
  }

  return {
    time: floorTime(time, timeframeSeconds),
    open,
    high,
    low,
    close,
    volume,
  };
}

export function normalizeTick(raw, symbol) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.event && raw.event !== 'price') return null;
  if (raw.symbol && raw.symbol !== symbol) return null;

  const price = finiteNumber(raw.price);
  const time = parseTimestamp(raw.timestamp);
  if (price === null || price <= 0 || time === null) return null;

  const bid = finiteNumber(raw.bid);
  const ask = finiteNumber(raw.ask);
  if ((bid !== null && bid <= 0) || (ask !== null && ask <= 0)) return null;

  return { time, price, bid, ask };
}

export function deduplicateCandles(candles) {
  const byTime = new Map();
  for (const candle of candles) {
    if (!candle || !Number.isFinite(candle.time)) continue;
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
