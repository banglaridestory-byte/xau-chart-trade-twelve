import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'yahoo',
  { history: true, stream: false, quote: false, indicators: false },
  'Undocumented endpoint and futures/proxy data; enable explicitly if accepted',
);
