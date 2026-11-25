import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'tiingo',
  { history: true, stream: true, quote: true, indicators: false },
  'Set TIINGO_TOKEN and verify XAUUSD coverage to enable',
);
