import { TIMEFRAMES, isTimeframe } from './vercelTimeframes.js';
import { keyPool } from './keys.js';
import { deduplicateCandles, normalizeCandle } from './validate.js';
import { detectSMC } from './smc.js';

const REST_BASE = 'https://api.twelvedata.com';
export const DEFAULT_TIMEFRAME = '5m';

export { isTimeframe };

export function parseLimit(value, fallback = 500) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(5000, Math.max(1, parsed)) : fallback;
}

export async function fetchHistory(timeframe, limit = 500) {
  const definition = TIMEFRAMES[timeframe];
  if (!definition) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const lease = keyPool.acquireRest();
  try {
    const url = new URL(`${REST_BASE}/time_series`);
    url.searchParams.set('symbol', 'XAU/USD');
    url.searchParams.set('interval', definition.interval);
    url.searchParams.set('outputsize', String(limit));
    url.searchParams.set('order', 'asc');
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('format', 'JSON');
    url.searchParams.set('apikey', lease.key);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.status === 'error') {
      const error = new Error(payload?.message || `Twelve Data responded with HTTP ${response.status}`);
      lease.fail(error);
      throw error;
    }
    if (!Array.isArray(payload.values) || payload.values.length === 0) {
      throw new Error('Twelve Data returned no historical candles');
    }

    return deduplicateCandles(
      payload.values.map((bar) => normalizeCandle(bar, definition.seconds)),
    ).slice(-limit);
  } catch (error) {
    lease.release();
    throw error;
  }
}

export function analyze(timeframe, candles) {
  return detectSMC(candles, { timeframe });
}
