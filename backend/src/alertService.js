import crypto from 'node:crypto';
import { CONFIG } from './config.js';
import { createAdapter } from './adapters/index.js';
import { AlertStore } from './alertStore.js';
import { sendTelegramAlert, telegramConfigured } from './telegram.js';

const PRICE_BOUND = 10_000_000;

export class AlertService {
  constructor({ adapter, store } = {}) {
    this.store = store ?? new AlertStore();
    this.adapter = adapter ?? createAdapter();
    this.price = {
      price: null,
      at: null,
      source: null,
      state: this.adapter.configured ? 'connecting' : 'unavailable',
      provider: this.adapter.name,
      stream: 'idle',
      reason: this.adapter.configured ? null : 'No API key configured for the price provider',
    };
    this.stopAdapter = null;
    this.pollTimer = null;
    this.polling = false;
    this.checking = false;
    this.notifying = new Set();
    this.running = false;
  }

  async start() {
    await this.store.load();
    this.running = true;

    if (!this.adapter.configured) {
      this.#setState('unavailable', 'No API key configured for the price provider');
      return;
    }

    try {
      await this.#refreshPrice();
    } catch (error) {
      this.#setState(this.price.price === null ? 'unavailable' : 'delayed', error.message);
    }

    if (this.adapter.capabilities.stream) {
      this.stopAdapter = this.adapter.connect({
        onTick: (tick) => this.#onPrice(tick.price, 'stream'),
        onStatus: (update) => this.#onStreamStatus(update),
        onError: (message) => {
          this.price.reason = message;
        },
      });
    } else {
      this.#startPolling();
    }
  }

  stop() {
    this.running = false;
    this.#stopPolling();
    if (this.stopAdapter) this.stopAdapter();
    this.stopAdapter = null;
    return this.store.close();
  }

  priceState() {
    return { ...this.price };
  }

  list() {
    return this.store.list();
  }

  async create({ target, direction, note = '' }) {
    const price = Number(target);
    if (!Number.isFinite(price) || price <= 0 || price > PRICE_BOUND) {
      throw new Error('Enter a valid target price');
    }
    if (direction !== 'above' && direction !== 'below') {
      throw new Error('Choose whether price should go above or below the target');
    }

    const current = this.price.price;
    if (current !== null) {
      if (direction === 'above' && price <= current) {
        throw new Error(`Target must be above the current price (${current.toFixed(2)})`);
      }
      if (direction === 'below' && price >= current) {
        throw new Error(`Target must be below the current price (${current.toFixed(2)})`);
      }
    }

    const alert = {
      id: crypto.randomUUID(),
      target: price,
      direction,
      note: String(note).trim().slice(0, 120),
      startPrice: current,
      createdAt: new Date().toISOString(),
      status: 'active',
      triggeredAt: null,
      triggeredPrice: null,
      notified: false,
      notificationError: null,
      lastAttemptAt: null,
    };

    await this.store.put(alert);
    return alert;
  }

  async cancel(id) {
    const alert = this.store.get(id);
    if (!alert) return null;
    if (alert.status !== 'active') return alert;
    const updated = { ...alert, status: 'cancelled' };
    await this.store.put(updated);
    return updated;
  }

  async remove(id) {
    await this.store.delete(id);
  }

  async retry(id) {
    const alert = this.store.get(id);
    if (!alert || alert.status !== 'triggered' || alert.notified) return alert ?? null;
    const updated = { ...alert, lastAttemptAt: null };
    await this.store.put(updated);
    this.#queueNotification(updated.id);
    return updated;
  }

  health() {
    const alerts = this.store.list();
    return {
      ok: this.adapter.configured && telegramConfigured(),
      price: this.priceState(),
      telegram: { configured: telegramConfigured() },
      alerts: {
        total: alerts.length,
        active: alerts.filter((item) => item.status === 'active').length,
        triggered: alerts.filter((item) => item.status === 'triggered').length,
      },
    };
  }

  #setState(state, reason = null) {
    const changed = this.price.state !== state || this.price.reason !== reason;
    this.price.state = state;
    if (reason !== null) this.price.reason = reason;
    if (!changed) return;
  }

  #startPolling() {
    if (this.pollTimer || !this.adapter.capabilities.quote) return;
    this.pollTimer = setInterval(() => {
      this.#refreshPrice().catch((error) => {
        this.#setState(this.price.price === null ? 'unavailable' : 'delayed', error.message);
      });
    }, CONFIG.alertPollIntervalMs);
  }

  #stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async #refreshPrice() {
    if (this.polling || !this.running) return;
    this.polling = true;
    try {
      let price;
      if (typeof this.adapter.fetchPrice === 'function') {
        price = await this.adapter.fetchPrice();
      } else {
        const quote = await this.adapter.fetchQuote('1m');
        price = Number(quote?.close);
      }
      this.#onPrice(price, 'api');
    } finally {
      this.polling = false;
    }
  }

  #onStreamStatus(update) {
    this.price.stream = update.state || 'idle';
    if (update.state === 'live') {
      this.#stopPolling();
      this.#setState('live', null);
      return;
    }

    this.#startPolling();
    if (update.state === 'unavailable') {
      this.#setState(
        this.adapter.capabilities.quote ? 'delayed' : 'unavailable',
        update.reason || 'Live price stream unavailable',
      );
    } else {
      this.#setState('delayed', update.reason || `Price stream ${update.state}`);
    }
  }

  #onPrice(rawPrice, source) {
    const price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0) return;

    this.price.price = price;
    this.price.at = Date.now();
    this.price.source = source;
    if (source === 'stream') this.#setState('live', null);
    else if (this.price.state !== 'live') this.#setState('delayed', null);

    this.#checkAlerts(price).catch((error) => {
      this.price.reason = `Alert check failed: ${error.message}`;
    });
  }

  async #checkAlerts(price) {
    if (this.checking) return;
    this.checking = true;

    try {
      const candidates = new Map();

      for (const alert of this.store.list()) {
        if (alert.status !== 'active') continue;
        const crossed =
          alert.direction === 'above' ? price >= alert.target : price <= alert.target;
        if (!crossed) continue;

        const triggered = {
          ...alert,
          status: 'triggered',
          triggeredAt: new Date().toISOString(),
          triggeredPrice: price,
          notified: false,
          notificationError: null,
          lastAttemptAt: null,
        };
        await this.store.put(triggered);
        candidates.set(triggered.id, triggered);
      }

      const now = Date.now();
      for (const alert of this.store.list()) {
        if (alert.status !== 'triggered' || alert.notified) continue;
        const lastAttempt = Date.parse(alert.lastAttemptAt || '') || 0;
        if (now - lastAttempt >= CONFIG.alertRetryIntervalMs) {
          candidates.set(alert.id, alert);
        }
      }

      for (const id of candidates.keys()) this.#queueNotification(id);
    } finally {
      this.checking = false;
    }
  }

  #queueNotification(id) {
    if (this.notifying.has(id)) return;
    this.notifying.add(id);
    this.#notify(id)
      .catch((error) => {
        const alert = this.store.get(id);
        if (!alert) return;
        this.store.put({
          ...alert,
          notificationError: error.message,
          lastAttemptAt: new Date().toISOString(),
        }).catch(() => {});
      })
      .finally(() => this.notifying.delete(id));
  }

  async #notify(id) {
    const alert = this.store.get(id);
    if (!alert || alert.status !== 'triggered' || alert.notified) return;

    const price = alert.triggeredPrice ?? this.price.price;
    if (price === null || price === undefined) {
      throw new Error('Price unavailable for notification');
    }

    await sendTelegramAlert(alert, price);
    await this.store.put({
      ...alert,
      notified: true,
      notificationError: null,
      lastAttemptAt: new Date().toISOString(),
    });
  }
}
