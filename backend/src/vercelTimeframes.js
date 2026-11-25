export const TIMEFRAMES = Object.freeze({
  '1m': { interval: '1min', seconds: 60 },
  '5m': { interval: '5min', seconds: 300 },
  '15m': { interval: '15min', seconds: 900 },
  '30m': { interval: '30min', seconds: 1800 },
  '1H': { interval: '1h', seconds: 3600 },
  '4H': { interval: '4h', seconds: 14400 },
  '1D': { interval: '1day', seconds: 86400 },
});

export function isTimeframe(timeframe) {
  return Object.hasOwn(TIMEFRAMES, timeframe);
}
