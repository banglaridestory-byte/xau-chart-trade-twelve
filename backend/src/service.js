import { CONFIG, TIMEFRAMES, DEFAULT_TIMEFRAME, isTimeframe } from './config.js';
import { createAdapter, listAdapters } from './adapters/index.js';
import { CandleStore, TickAggregator } from './store.js';
import { deduplicateCandles } from './validate.js';
import { detectSMC } from './smc.js';
import { keyPool } from './keys.js';
import { isFresh, readHistory, writeHistory } from './historyCache.js';

export class DataService {
  constructor() {
    this.adapter = createAdapter();
    this.store = new CandleStore();
    this.aggregator = new TickAggregator(this.store, TIMEFRAMES, {
      onCandle: (timeframe, candle) => this.#broadcastCandle(timeframe, candle),
      onGap: (timeframe, from, to) => {
        const lastRefresh = this.gapRefreshAt.get(timeframe) ?? 0;
        if (Date.now() - lastRefresh < CONFIG.gapCooldownMs) return;
        this.gapRefreshAt.set(timeframe, Date.now());
        this.status.reason = `Detected data gap on ${timeframe}: ${from} -> ${to}; refreshing history`;
        this.ensureHistory(timeframe, { force: true }).catch(() => {});
      },
    });

    this.clients = new Map();
    this.active = new Set([DEFAULT_TIMEFRAME]);
    this.inFlight = new Map();
    this.pollTimer = null;
    this.stopAdapter = null;
    this.smcByTimeframe = new Map();
    this.smcTimers = new Map();
    this.historyFetchedAt = new Map();
    this.gapRefreshAt = new Map();
    this.cacheTimers = new Map();
    this.pollCursor = 0;

    this.status = {
      state: 'connecting',
      provider: this.adapter.name,
      configured: this.adapter.configured,
      stream: 'idle',
      lastTickAt: null,
      lastHistoryAt: null,
      reason: null,
    };
  }

  async start() {
    if (!this.adapter.configured) {
      this.#setState('unavailable', 'No API key configured for the selected provider');
      return;
    }

    try {
      await this.ensureHistory(DEFAULT_TIMEFRAME);
    } catch (error) {
      this.#setState('unavailable', error.message);
    }

    if (this.adapter.capabilities.stream) {
      this.stopAdapter = this.adapter.connect({
        onTick: (tick) => this.#onTick(tick),
        onStatus: (update) => this.#onStreamStatus(update),
        onError: (message) => {
          this.status.reason = message;
          this.#broadcastStatus();
        },
      });
    }

  }

  #startPolling() {
    if (this.pollTimer || !this.adapter.capabilities.quote) return;
    this.pollTimer = setInterval(() => {
      this.#poll().catch((error) => {
        this.status.reason = error.message;
        this.#broadcastStatus();
      });
    }, CONFIG.pollIntervalMs);
  }

  #stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  stop() {
    this.#stopPolling();
    for (const timer of this.smcTimers.values()) clearTimeout(timer);
    for (const timer of this.cacheTimers.values()) clearTimeout(timer);
    this.smcTimers.clear();
    this.cacheTimers.clear();
    if (this.stopAdapter) this.stopAdapter();
    this.stopAdapter = null;
    for (const client of this.clients.keys()) client.close();
    this.clients.clear();
  }

  #publicStatus() {
    return {
      ...this.status,
      symbol: CONFIG.symbol,
      symbolLabel: CONFIG.symbolLabel,
      timeframes: Object.keys(TIMEFRAMES),
    };
  }

  #setState(state, reason = null) {
    const changed = this.status.state !== state || this.status.reason !== reason;
    this.status.state = state;
    if (reason !== null) this.status.reason = reason;
    if (changed) this.#broadcastStatus();
  }

  #send(client, payload) {
    if (client.readyState === 1) client.send(JSON.stringify(payload));
  }

  #broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const client of this.clients.keys()) {
      if (client.readyState === 1) client.send(encoded);
    }
  }

  #broadcastStatus() {
    this.#broadcast({ type: 'status', status: this.#publicStatus(), adapters: listAdapters() });
  }

  #broadcastCandle(timeframe, candle) {
    const encoded = JSON.stringify({
      type: 'candle',
      timeframe,
      candle,
      status: this.#publicStatus(),
    });
    for (const [client, subscribed] of this.clients) {
      if (subscribed === timeframe && client.readyState === 1) client.send(encoded);
    }
    this.#scheduleAnalysis(timeframe);
    this.#scheduleCacheWrite(timeframe);
  }

  #analyze(timeframe) {
    const smc = detectSMC(this.store.get(timeframe, CONFIG.timeframeLimit), {
      timeframe,
    });
    this.smcByTimeframe.set(timeframe, smc);
    return smc;
  }

  #scheduleAnalysis(timeframe) {
    if (this.smcTimers.has(timeframe)) return;
    const timer = setTimeout(() => {
      this.smcTimers.delete(timeframe);
      try {
        this.#analyze(timeframe);
        this.#publishSMC(timeframe);
      } catch (error) {
        this.status.reason = `SMC analysis failed: ${error.message}`;
        this.#broadcastStatus();
      }
    }, CONFIG.smcDebounceMs);
    this.smcTimers.set(timeframe, timer);
  }

  #scheduleCacheWrite(timeframe) {
    if (this.cacheTimers.has(timeframe)) return;
    const timer = setTimeout(() => {
      this.cacheTimers.delete(timeframe);
      writeHistory(timeframe, this.store.get(timeframe, CONFIG.maxCachedBars), { merge: true })
        .catch((error) => {
          this.status.reason = `History cache write failed: ${error.message}`;
        });
    }, 5_000);
    this.cacheTimers.set(timeframe, timer);
  }

  #publishSMC(timeframe) {
    const smc = this.smcByTimeframe.get(timeframe);
    if (!smc) return;
    const encoded = JSON.stringify({ type: 'smc', timeframe, smc });
    for (const [client, subscribed] of this.clients) {
      if (subscribed === timeframe && client.readyState === 1) client.send(encoded);
    }
  }

  smcSnapshot(timeframe) {
    if (!isTimeframe(timeframe)) throw new Error(`Unsupported timeframe: ${timeframe}`);
    const smc = this.smcByTimeframe.get(timeframe) ?? this.#analyze(timeframe);
    return { type: 'smc', timeframe, smc };
  }

  #onTick(tick) {
    this.status.lastTickAt = Date.now();
    this.status.stream = 'live';
    this.status.reason = null;
    this.#setState('live');
    for (const timeframe of this.active) this.aggregator.ingest(timeframe, tick);
  }

  #onStreamStatus(update) {
    this.status.stream = update.state;
    if (update.state === 'live') {
      this.status.reason = null;
      this.#stopPolling();
      this.#setState('live');
    } else if (update.state === 'unavailable') {
      const fallback = this.adapter.capabilities.quote ? 'delayed' : 'unavailable';
      if (fallback === 'delayed') this.#startPolling();
      this.#setState(fallback, update.reason || 'Live stream unavailable');
    } else if (update.state === 'reconnecting' || update.state === 'connecting') {
      this.#startPolling();
      this.#setState('delayed', update.reason || `Stream ${update.state}`);
    }
    this.#broadcastStatus();
  }

  async #poll() {
    if (!this.adapter.capabilities.quote || this.status.state === 'live') return;
    if (!keyPool.canSpendRest()) {
      this.status.reason = 'Credit budget exhausted for this minute/day';
      this.#setState('delayed', this.status.reason);
      return;
    }

    const timeframes = [...this.active];
    if (timeframes.length === 0) return;
    const batch = [];
    for (let i = 0; i < Math.min(CONFIG.maxPollPerCycle, timeframes.length); i += 1) {
      batch.push(timeframes[(this.pollCursor + i) % timeframes.length]);
    }
    this.pollCursor = (this.pollCursor + batch.length) % timeframes.length;

    for (const timeframe of batch) {
      try {
        const candle = await this.adapter.fetchQuote(timeframe);
        const latest = this.store.last(timeframe);
        if (latest && candle.time < latest.time) continue;
        this.store.upsert(timeframe, candle);
        this.status.lastHistoryAt = Date.now();
        this.#broadcastCandle(timeframe, candle);
      } catch (error) {
        this.status.reason = error.message;
      }
    }

    const lastTick = this.status.lastTickAt ?? 0;
    if (Date.now() - lastTick > CONFIG.staleAfterMs) {
      this.#setState('delayed', this.status.reason || 'Using REST snapshots; no recent ticks');
    }
    this.#broadcastStatus();
  }

  async ensureHistory(timeframe, { force = false } = {}) {
    if (!isTimeframe(timeframe)) throw new Error(`Unsupported timeframe: ${timeframe}`);
    if (this.inFlight.has(timeframe)) return this.inFlight.get(timeframe);

    const fetchedAt = this.historyFetchedAt.get(timeframe) ?? 0;
    if (
      !force &&
      this.store.size(timeframe) > 0 &&
      Date.now() - fetchedAt < CONFIG.historyTtlMs
    ) {
      this.active.add(timeframe);
      return this.store.get(timeframe, CONFIG.timeframeLimit);
    }

    const task = (async () => {
      const cached = await readHistory(timeframe);
      let candles;
      let source = 'upstream';

      if (!force && isFresh(cached, timeframe)) {
        candles = deduplicateCandles(cached.candles);
        source = 'cache';
      } else {
        try {
          candles = deduplicateCandles(
            await this.adapter.fetchCandles(timeframe, CONFIG.timeframeLimit),
          );
        } catch (error) {
          if (cached.candles.length === 0) throw error;
          candles = deduplicateCandles(cached.candles);
          source = 'stale-cache';
          if (this.status.state !== 'live') {
            this.#setState('delayed', `Using cached history: ${error.message}`);
          }
        }
      }

      if (candles.length === 0) throw new Error('No historical candles returned');

      this.store.setHistory(timeframe, candles);
      this.active.add(timeframe);
      this.historyFetchedAt.set(timeframe, source === 'cache' ? cached.updatedAt : Date.now());
      this.status.lastHistoryAt = this.historyFetchedAt.get(timeframe);
      if (source === 'upstream') {
        await writeHistory(timeframe, candles);
      }
      this.#analyze(timeframe);
      this.#broadcast({
        type: 'history',
        timeframe,
        candles: this.store.get(timeframe, CONFIG.timeframeLimit),
        smc: this.smcByTimeframe.get(timeframe),
        status: this.#publicStatus(),
      });
      return candles;
    })().finally(() => this.inFlight.delete(timeframe));

    this.inFlight.set(timeframe, task);
    return task;
  }

  snapshot(timeframe, limit = CONFIG.timeframeLimit) {
    if (!isTimeframe(timeframe)) throw new Error(`Unsupported timeframe: ${timeframe}`);
    return {
      type: 'snapshot',
      timeframe,
      candles: this.store.get(timeframe, limit),
      smc: this.smcByTimeframe.get(timeframe) ?? this.#analyze(timeframe),
      status: this.#publicStatus(),
    };
  }

  health() {
    const cached = Object.fromEntries(
      Object.keys(TIMEFRAMES).map((timeframe) => [timeframe, this.store.size(timeframe)]),
    );
    const smcCounts = Object.fromEntries(
      [...this.smcByTimeframe].map(([timeframe, smc]) => [timeframe, smc.counts]),
    );
    return {
      ok: this.store.size(DEFAULT_TIMEFRAME) > 0,
      status: this.#publicStatus(),
      adapters: listAdapters(),
      cachedBars: cached,
      smcCounts,
      credits: keyPool.snapshot(),
      cache: { backend: process.env.REDIS_URL ? 'redis+file' : 'file' },
    };
  }

  addClient(client) {
    this.clients.set(client, DEFAULT_TIMEFRAME);
    this.#send(client, {
      type: 'status',
      status: this.#publicStatus(),
      adapters: listAdapters(),
    });
    this.#send(client, this.snapshot(DEFAULT_TIMEFRAME));

    client.on('message', (raw) => this.#onClientMessage(client, raw.toString()));
    client.on('close', () => this.clients.delete(client));
    client.on('error', () => this.clients.delete(client));
  }

  async #onClientMessage(client, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.#send(client, { type: 'error', message: 'Invalid JSON message' });
      return;
    }

    if (message.type === 'status') {
      this.#send(client, { type: 'status', status: this.#publicStatus(), adapters: listAdapters() });
      return;
    }

    if (message.type !== 'subscribe') {
      this.#send(client, { type: 'error', message: `Unknown message type: ${message.type}` });
      return;
    }

    const timeframe = message.timeframe;
    if (!isTimeframe(timeframe)) {
      this.#send(client, { type: 'error', message: `Unsupported timeframe: ${timeframe}` });
      return;
    }

    this.clients.set(client, timeframe);
    this.active.add(timeframe);

    try {
      await this.ensureHistory(timeframe);
    } catch (error) {
      this.#send(client, { type: 'error', message: error.message });
    }

    this.#send(client, this.snapshot(timeframe));
  }
}
