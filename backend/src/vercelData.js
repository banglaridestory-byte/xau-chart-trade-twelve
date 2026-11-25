import { TIMEFRAMES, isTimeframe } from './vercelTimeframes.js';
import { keyPool } from './keys.js';
import { deduplicateCandles, normalizeCandle } from './validate.js';
import { detectSMC } from './smc.js';

const REST_BASE = 'https://api.twelvedata.com';
export const DEFAULT_TIMEFRAME = '5m';
const memory = new Map();

export { isTimeframe };

export function parseLimit(value, fallback = 500) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(5000, Math.max(1, parsed)) : fallback;
}

function freshnessWindow(timeframe) {
  const seconds = TIMEFRAMES[timeframe]?.seconds ?? 300;
  return Math.min(6 * 3_600_000, Math.max(180_000, seconds * 3_000));
}

function remember(timeframe, candles, smc) {
  memory.set(timeframe, { candles, smc, updatedAt: Date.now() });
}

function fromMemory(timeframe, limit) {
  const entry = memory.get(timeframe);
  if (!entry?.candles?.length) return null;
  if (Date.now() - entry.updatedAt >= freshnessWindow(timeframe)) return null;
  return {
    candles: entry.candles.slice(-limit),
    smc: entry.smc,
    cached: true,
    stale: false,
    source: 'memory',
  };
}

async function fetchBackend(timeframe, limit) {
  const base = (process.env.PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
  if (!base) return null;

  try {
    const url = new URL('/api/candles', base);
    url.searchParams.set('timeframe', timeframe);
    url.searchParams.set('limit', String(Math.min(limit, 500)));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const payload = await response.json();
    if (!Array.isArray(payload.candles) || payload.candles.length === 0) return null;
    const candles = deduplicateCandles(
      payload.candles.map((bar) => normalizeCandle(bar, TIMEFRAMES[timeframe].seconds)),
    );
    if (candles.length === 0) return null;

    remember(timeframe, candles, payload.smc);
    return {
      candles: candles.slice(-limit),
      smc: payload.smc,
      cached: true,
      stale: false,
      source: 'render',
    };
  } catch {
    return null;
  }
}

export async function fetchHistory(timeframe, limit = 500) {
  const definition = TIMEFRAMES[timeframe];
  if (!definition) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const backend = await fetchBackend(timeframe, limit);
  if (backend) return backend;

  const cached = fromMemory(timeframe, limit);
  if (cached) return cached;

  let lease = null;
  try {
    lease = keyPool.acquireRest();
    const url = new URL(`${REST_BASE}/time_series`);
    url.searchParams.set('symbol', 'XAU/USD');
    url.searchParams.set('interval', definition.interval);
    url.searchParams.set('outputsize', '500');
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

    const candles = deduplicateCandles(
      payload.values.map((bar) => normalizeCandle(bar, definition.seconds)),
    );
    remember(timeframe, candles, null);
    return { candles: candles.slice(-limit), smc: null, cached: false, stale: false, source: 'upstream' };
  } catch (error) {
    lease?.fail(error);
    lease?.release();
    const entry = memory.get(timeframe);
    if (entry?.candles?.length) {
      return {
        candles: entry.candles.slice(-limit),
        smc: entry.smc,
        cached: true,
        stale: true,
        warning: error.message,
        source: 'memory',
      };
    }
    throw error;
  } finally {
    lease?.release();
  }
}

export function analyze(timeframe, candles) {
  return detectSMC(candles, { timeframe });
}
