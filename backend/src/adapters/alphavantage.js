import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'alphavantage',
  { history: false, stream: false, quote: true, indicators: true },
  'Gold endpoints have no XAUUSD OHLC; set ALPHA_VANTAGE_KEY for quote/indicators only',
);
