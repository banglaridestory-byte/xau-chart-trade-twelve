import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'finnhub',
  { history: true, stream: true, quote: true, indicators: true },
  'Set FINNHUB_TOKEN and confirm XAUUSD entitlement to enable',
);
