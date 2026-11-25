import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'polygon',
  { history: true, stream: true, quote: true, indicators: true },
  'Set POLYGON_API_KEY and confirm XAUUSD ticker to enable',
);
