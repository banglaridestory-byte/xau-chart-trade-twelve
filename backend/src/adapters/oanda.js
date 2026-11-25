import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'oanda',
  { history: true, stream: true, quote: true, indicators: false },
  'Set OANDA_TOKEN and OANDA_ACCOUNT_ID to enable',
);
