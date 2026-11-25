import { createUnconfiguredAdapter } from './base.js';

export default createUnconfiguredAdapter(
  'metalpriceapi',
  { history: false, stream: false, quote: true, indicators: false },
  'Set METALPRICEAPI_KEY; only daily OHLC and hourly/minutely rates are available',
);
