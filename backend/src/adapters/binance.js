import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'binance',
  { history: true, stream: true, quote: true, indicators: false },
  'PAXG/USDT is a tokenized-gold proxy, not spot XAUUSD; enable explicitly if accepted',
);
