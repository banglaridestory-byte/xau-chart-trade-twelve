import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'goldapi',
  { history: false, stream: true, quote: true, indicators: false },
  'Set GOLDAPI_KEY; history is daily price only, not intraday OHLC',
);
