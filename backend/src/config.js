const integer = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const CONFIG = {
  port: integer(process.env.PORT, 3001, 1, 65535),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  provider: (process.env.DATA_PROVIDER || 'twelvedata').toLowerCase(),
  symbol: 'XAU/USD',
  symbolLabel: 'XAUUSD',
  timeframeLimit: integer(process.env.TIMEFRAME_LIMIT, 500, 50, 5000),
  maxCachedBars: 5000,
  pollIntervalMs: integer(process.env.POLL_INTERVAL_MS, 240_000, 120_000, 900_000),
  maxPollPerCycle: integer(process.env.MAX_POLL_PER_CYCLE, 2, 1, 7),
  staleAfterMs: 300_000,
  heartbeatMs: 10_000,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
  smcDebounceMs: 400,
  historyTtlMs: integer(process.env.HISTORY_TTL_MS, 900_000, 60_000, 86_400_000),
  gapCooldownMs: 600_000,
  maxCreditsPerMinute: integer(process.env.MAX_CREDITS_PER_MINUTE, 8, 1, 8),
  maxCreditsPerDay: integer(process.env.MAX_CREDITS_PER_DAY, 800, 1, 800),
};

export const TIMEFRAMES = Object.freeze({
  '1m': { interval: '1min', seconds: 60 },
  '5m': { interval: '5min', seconds: 300 },
  '15m': { interval: '15min', seconds: 900 },
  '30m': { interval: '30min', seconds: 1800 },
  '1H': { interval: '1h', seconds: 3600 },
  '4H': { interval: '4h', seconds: 14400 },
  '1D': { interval: '1day', seconds: 86400 },
});

export const DEFAULT_TIMEFRAME = '5m';

export function isTimeframe(value) {
  return typeof value === 'string' && Object.hasOwn(TIMEFRAMES, value);
}
