import { CONFIG, TIMEFRAMES } from '../config.js';
import { keyPool } from '../keys.js';
import { TwelveDataAdapter } from './twelvedata.js';
import oanda from './oanda.js';
import finnhub from './finnhub.js';
import polygon from './polygon.js';
import alphavantage from './alphavantage.js';
import goldapi from './goldapi.js';
import metalpriceapi from './metalpriceapi.js';
import metalsdev from './metalsdev.js';
import financialmodelingprep from './financialmodelingprep.js';
import tiingo from './tiingo.js';
import binance from './binance.js';
import yahoo from './yahoo.js';

const twelvedata = new TwelveDataAdapter({
  pool: keyPool,
  symbol: CONFIG.symbol,
  timeframeMap: TIMEFRAMES,
  heartbeatMs: CONFIG.heartbeatMs,
  reconnectBaseMs: CONFIG.reconnectBaseMs,
  reconnectMaxMs: CONFIG.reconnectMaxMs,
});

const adapters = {
  twelvedata,
  oanda,
  finnhub,
  polygon,
  alphavantage,
  goldapi,
  metalpriceapi,
  metalsdev,
  financialmodelingprep,
  tiingo,
  binance,
  yahoo,
};

export const ADAPTER_NAMES = Object.keys(adapters);

export function createAdapter(name = CONFIG.provider) {
  if (!Object.hasOwn(adapters, name)) throw new Error(`Unknown adapter: ${name}`);
  return adapters[name];
}

export function listAdapters() {
  return ADAPTER_NAMES.map((name) => ({
    name,
    configured: adapters[name].configured,
    capabilities: adapters[name].capabilities,
  }));
}
