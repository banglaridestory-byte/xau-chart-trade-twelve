const MAX_RECONNECT_MS = 30_000;

export class DataFeed {
  constructor({ onSnapshot, onHistory, onCandle, onSMC, onStatus, onError, endpoints = {}, token = '' } = {}) {
    this.endpoints = endpoints;
    this.token = token;
    this.handlers = {
      onSnapshot: onSnapshot ?? (() => {}),
      onHistory: onHistory ?? (() => {}),
      onCandle: onCandle ?? (() => {}),
      onSMC: onSMC ?? (() => {}),
      onStatus: onStatus ?? (() => {}),
      onError: onError ?? (() => {}),
    };
    this.socket = null;
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.pollInFlight = false;
    this.polling = false;
    this.attempt = 0;
    this.timeframe = '5m';
    this.closed = false;
  }

  #isLocalHost() {
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  #apiBase() {
    return (this.endpoints.apiUrl || '').trim().replace(/\/$/, '');
  }

  #socketUrl() {
    if (this.endpoints.wsUrl) return this.endpoints.wsUrl;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  #send(payload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  #headers() {
    return {
      Accept: 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case 'snapshot':
        this.handlers.onSnapshot(message);
        break;
      case 'history':
        this.handlers.onHistory(message);
        break;
      case 'candle':
        this.handlers.onCandle(message);
        break;
      case 'smc':
        this.handlers.onSMC(message);
        break;
      case 'status':
        this.handlers.onStatus(message);
        break;
      case 'error':
        this.handlers.onError(message.message);
        break;
      default:
        break;
    }
  }

  #startPolling() {
    if (this.polling || this.closed) return;
    this.polling = true;
    this.socket?.close();
    this.socket = null;
    this.handlers.onStatus({
      status: {
        state: 'delayed',
        provider: 'twelvedata',
        stream: 'rest',
        reason: 'WebSocket unavailable here; polling real REST snapshots',
      },
    });
    this.#pollOnce();
    this.pollTimer = setInterval(() => this.#pollOnce(), 180_000);
  }

  async #pollOnce() {
    if (this.pollInFlight || this.closed) return;
    this.pollInFlight = true;
    try {
      const payload = await this.fetchCandles(this.timeframe);
      this.handlers.onSnapshot(payload);
      if (payload.smc) this.handlers.onSMC({ timeframe: this.timeframe, smc: payload.smc });
    } catch (error) {
      this.handlers.onStatus({ status: { state: 'unavailable', reason: error.message } });
      this.handlers.onError(error.message);
    } finally {
      this.pollInFlight = false;
    }
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || this.closed || this.polling) return;
    if (this.attempt >= 3) {
      this.#startPolling();
      return;
    }
    const delay = Math.min(1_000 * 2 ** this.attempt, MAX_RECONNECT_MS);
    this.attempt += 1;
    this.handlers.onStatus({
      status: { state: 'reconnecting', reason: `Reconnecting in ${delay / 1000}s` },
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  connect() {
    if (this.closed || this.polling) return;
    if (!this.endpoints.wsUrl && !this.#isLocalHost()) {
      this.#startPolling();
      return;
    }
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(this.#socketUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.#send({ type: 'auth', token: this.token });
      this.#send({ type: 'subscribe', timeframe: this.timeframe });
    });

    socket.addEventListener('message', (event) => this.#onMessage(event.data));

    socket.addEventListener('close', () => {
      if (!this.closed) this.#scheduleReconnect();
    });

    socket.addEventListener('error', () => socket.close());
  }

  setTimeframe(timeframe) {
    this.timeframe = timeframe;
    if (this.polling) {
      this.#pollOnce();
      return;
    }
    this.#send({ type: 'subscribe', timeframe });
  }

  async fetchCandles(timeframe, limit = 500) {
    const base = this.#apiBase();
    const path = `/api/candles?timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`;
    const response = await fetch(`${base}${path}`, { headers: this.#headers() });
    if (response.status === 401) throw new Error('Session expired — sign in again');
    if (!response.ok) throw new Error(`History request failed: ${response.status}`);
    return response.json();
  }

  async fetchSMC(timeframe) {
    const base = this.#apiBase();
    const path = `/api/smc?timeframe=${encodeURIComponent(timeframe)}`;
    const response = await fetch(`${base}${path}`, { headers: this.#headers() });
    if (response.status === 401) throw new Error('Session expired — sign in again');
    if (!response.ok) throw new Error(`SMC request failed: ${response.status}`);
    return response.json();
  }

  disconnect() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}
