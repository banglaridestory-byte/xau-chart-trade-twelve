import WebSocket from 'ws';
import { KeyPool } from '../keys.js';
import { normalizeCandle, normalizeTick } from '../validate.js';

const REST_BASE = 'https://api.twelvedata.com';
const WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';

export class TwelveDataAdapter {
  constructor({ pool, apiKey, symbol, timeframeMap, heartbeatMs, reconnectBaseMs, reconnectMaxMs }) {
    this.name = 'twelvedata';
    this.capabilities = { history: true, stream: true, quote: true, indicators: true };
    this.pool = pool ?? new KeyPool(apiKey ? [apiKey] : []);
    this.symbol = symbol;
    this.timeframeMap = timeframeMap;
    this.heartbeatMs = heartbeatMs;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.streamLease = null;

    this.socket = null;
    this.heartbeat = null;
    this.reconnectTimer = null;
    this.attempt = 0;
    this.stopped = true;
    this.handlers = {};
  }

  get configured() {
    return this.pool.configured;
  }

  #restUrl(path, params, apiKey) {
    const url = new URL(`${REST_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('apikey', apiKey);
    return url;
  }

  async #get(path, params) {
    const lease = this.pool.acquireRest();
    try {
      const response = await fetch(this.#restUrl(path, params, lease.key), {
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload || payload.status === 'error') {
        const message = payload?.message || `HTTP ${response.status}`;
        const error = new Error(`Twelve Data ${path} failed: ${message}`);
        lease.fail(error);
        throw error;
      }
      return payload;
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  async fetchCandles(timeframe, limit) {
    if (!this.configured) throw new Error('Twelve Data API key is missing');
    const definition = this.timeframeMap[timeframe];
    if (!definition) throw new Error(`Unsupported timeframe: ${timeframe}`);

    const payload = await this.#get('/time_series', {
      symbol: this.symbol,
      interval: definition.interval,
      outputsize: limit,
      order: 'asc',
      timezone: 'UTC',
      format: 'JSON',
    });

    if (!Array.isArray(payload.values)) throw new Error('Twelve Data returned no time series');
    return payload.values.map((bar) => normalizeCandle(bar, definition.seconds));
  }

  async fetchPrice() {
    if (!this.configured) throw new Error('Twelve Data API key is missing');
    const payload = await this.#get('/price', { symbol: this.symbol });
    const price = Number(payload?.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Twelve Data returned an invalid price');
    }
    return price;
  }

  async fetchQuote(timeframe) {
    if (!this.configured) throw new Error('Twelve Data API key is missing');
    const definition = this.timeframeMap[timeframe];
    if (!definition) throw new Error(`Unsupported timeframe: ${timeframe}`);

    const payload = await this.#get('/quote', {
      symbol: this.symbol,
      interval: definition.interval,
      timezone: 'UTC',
    });

    return normalizeCandle(payload, definition.seconds);
  }

  connect({ onTick, onStatus, onError } = {}) {
    this.handlers = { onTick: onTick ?? (() => {}), onStatus: onStatus ?? (() => {}), onError: onError ?? (() => {}) };
    this.stopped = false;
    this.#open();
    return () => this.disconnect();
  }

  #open() {
    if (this.stopped || !this.configured) return;

    this.handlers.onStatus({ state: 'connecting', provider: this.name, at: Date.now() });

    let lease;
    try {
      lease = this.pool.acquireStream();
    } catch (error) {
      this.handlers.onStatus({
        state: 'unavailable',
        provider: this.name,
        reason: error.message,
        at: Date.now(),
      });
      this.#scheduleReconnect();
      return;
    }
    this.streamLease = lease;

    const socket = new WebSocket(WS_URL, {
      headers: { 'X-TD-APIKEY': lease.key },
      handshakeTimeout: 10_000,
    });
    this.socket = socket;

    socket.on('open', () => {
      this.attempt = 0;
      socket.send(JSON.stringify({ action: 'subscribe', params: { symbols: this.symbol } }));
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ action: 'heartbeat' }));
        }
      }, this.heartbeatMs);
    });

    socket.on('message', (raw) => this.#onMessage(raw.toString()));

    socket.on('error', (error) => {
      lease.fail(error);
      this.handlers.onError(error.message);
    });

    socket.on('close', () => {
      this.#clearHeartbeat();
      this.#releaseStream(lease);
      if (!this.stopped) this.#scheduleReconnect();
    });
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.event === 'subscribe-status') {
      const failures = Array.isArray(message.fails) ? message.fails : [];
      if (failures.length > 0 || message.status !== 'ok') {
        const reason = `subscription rejected for ${failures.map((item) => item.symbol).join(', ') || this.symbol}`;
        this.streamLease?.fail(new Error(reason));
        this.handlers.onStatus({
          state: 'unavailable',
          provider: this.name,
          reason,
          at: Date.now(),
        });
        this.socket?.close();
        return;
      }
      this.handlers.onStatus({ state: 'live', provider: this.name, at: Date.now() });
      return;
    }

    if (message.event === 'price') {
      const tick = normalizeTick(message, this.symbol);
      if (tick) this.handlers.onTick(tick);
    }
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || this.stopped) return;
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.attempt, this.reconnectMaxMs);
    this.attempt += 1;
    this.handlers.onStatus({ state: 'reconnecting', provider: this.name, at: Date.now(), delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#open();
    }, delay);
  }

  #clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  #releaseStream(lease) {
    if (this.streamLease === lease) this.streamLease = null;
    lease.release();
  }

  disconnect() {
    this.stopped = true;
    if (this.streamLease) this.#releaseStream(this.streamLease);
    this.#clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
      this.socket = null;
    }
  }
}
