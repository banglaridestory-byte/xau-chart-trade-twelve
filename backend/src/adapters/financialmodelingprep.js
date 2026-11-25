import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'financialmodelingprep',
  { history: true, stream: false, quote: true, indicators: true },
  'Set FMP_API_KEY and verify a true spot XAUUSD symbol to enable',
);
