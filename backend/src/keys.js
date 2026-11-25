import { CONFIG } from './config.js';
import { CreditBudget } from './credit.js';

function collectKeys() {
  const keys = [];
  const push = (value) => {
    if (typeof value !== 'string') return;
    const key = value.trim();
    if (key && !keys.includes(key)) keys.push(key);
  };

  const explicit = process.env.TWELVE_DATA_API_KEYS;
  if (explicit) explicit.split(/[,;\s]+/).forEach(push);

  push(process.env.TWELVE_DATA_API_KEY);
  for (let index = 2; index <= 10; index += 1) {
    push(process.env[`TWELVE_DATA_API_KEY_${index}`]);
  }

  return keys;
}

export const API_KEYS = collectKeys();

export class KeyPool {
  constructor(keys = API_KEYS, limits = {}) {
    this.entries = keys.map((key, index) => ({
      key,
      index,
      budget: new CreditBudget(limits),
      cooldownUntil: 0,
      streamCooldownUntil: 0,
      streamActive: false,
    }));
    this.cursor = 0;
    this.streamCursor = 0;
  }

  get configured() {
    return this.entries.length > 0;
  }

  get size() {
    return this.entries.length;
  }

  #restAvailable(entry, now) {
    return now >= entry.cooldownUntil && entry.budget.canSpend(1);
  }

  #streamAvailable(entry, now) {
    return now >= entry.streamCooldownUntil && !entry.streamActive;
  }

  canSpendRest() {
    const now = Date.now();
    return this.entries.some((entry) => this.#restAvailable(entry, now));
  }

  acquireRest() {
    if (!this.configured) throw new Error('No Twelve Data API key configured');

    const now = Date.now();
    for (let offset = 0; offset < this.entries.length; offset += 1) {
      const position = (this.cursor + offset) % this.entries.length;
      const entry = this.entries[position];
      if (!this.#restAvailable(entry, now)) continue;

      this.cursor = (position + 1) % this.entries.length;
      entry.budget.spend(1);
      return {
        key: entry.key,
        index: entry.index,
        release: () => this.#releaseRest(entry),
        fail: (error) => this.#failRest(entry, error),
      };
    }

    throw new Error('All Twelve Data keys are cooling down or out of REST credits');
  }

  acquireStream() {
    if (!this.configured) throw new Error('No Twelve Data API key configured');

    const now = Date.now();
    for (let offset = 0; offset < this.entries.length; offset += 1) {
      const position = (this.streamCursor + offset) % this.entries.length;
      const entry = this.entries[position];
      if (!this.#streamAvailable(entry, now)) continue;

      this.streamCursor = (position + 1) % this.entries.length;
      entry.streamActive = true;
      return {
        key: entry.key,
        index: entry.index,
        release: () => this.#releaseStream(entry),
        fail: (error) => this.#failStream(entry, error),
      };
    }

    throw new Error('All Twelve Data keys are cooling down or out of WebSocket credits');
  }

  #releaseRest(entry) {
    entry.budget.refund(1);
  }

  #releaseStream(entry) {
    entry.streamActive = false;
  }

  #failRest(entry, error) {
    const message = String(error?.message || error || '').toLowerCase();
    const isLimit = /credit|quota|limit|rate|plan|429|too many/.test(message);
    const isAuth = /api key|invalid|unauthorized|forbidden|401|403/.test(message);
    if (isLimit || isAuth) {
      entry.cooldownUntil = Date.now() + (isAuth ? 300_000 : 60_000);
    }
  }

  #failStream(entry, error) {
    const message = String(error?.message || error || '').toLowerCase();
    const isAuth = /api key|invalid|unauthorized|forbidden|401|403/.test(message);
    const isSubscription = /subscription|reject|symbol|permission|plan/.test(message);
    const delay = isAuth || isSubscription ? 600_000 : 30_000;
    entry.streamCooldownUntil = Date.now() + delay;
    entry.streamActive = false;
  }

  snapshot() {
    const now = Date.now();
    return {
      keys: this.entries.length,
      limits: {
        restPerMinutePerKey: CONFIG.maxCreditsPerMinute,
        restPerDayPerKey: CONFIG.maxCreditsPerDay,
        webSocketsPerKey: 1,
      },
      rest: this.entries.map((entry) => ({
        key: `key-${entry.index + 1}`,
        ...entry.budget.snapshot(),
        cooldownMs: Math.max(0, entry.cooldownUntil - now),
      })),
      stream: this.entries.map((entry) => ({
        key: `key-${entry.index + 1}`,
        active: entry.streamActive,
        cooldownMs: Math.max(0, entry.streamCooldownUntil - now),
      })),
    };
  }
}

export const keyPool = new KeyPool();
