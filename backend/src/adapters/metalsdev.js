import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'metalsdev',
  { history: false, stream: false, quote: true, indicators: false },
  'Set METALS_DEV_KEY; only daily values are available, not OHLC bars',
);
