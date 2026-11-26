import fs from 'node:fs/promises';
import path from 'node:path';
import Redis from 'ioredis';

const STORE_FILE = process.env.ALERT_STORE_FILE || path.join(process.cwd(), '.cache', 'alerts.json');
const REDIS_KEY = 'xauusd:alerts:v1';

let redisClient = null;

function createRedis(url) {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
  });
  client.on('error', () => {});
  return client;
}

async function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!redisClient || redisClient.status === 'end' || redisClient.status === 'close') {
    redisClient?.disconnect();
    redisClient = createRedis(url);
  }
  if (redisClient.status === 'wait') await redisClient.connect();
  return redisClient.status === 'ready' ? redisClient : null;
}

async function readFile() {
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFile(alerts) {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  const temporary = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(alerts, null, 2));
  await fs.rename(temporary, STORE_FILE);
}

function normalizeAlert(value) {
  if (!value || typeof value !== 'object') return null;
  const target = Number(value.target);
  if (!Number.isFinite(target) || target <= 0) return null;
  if (value.direction !== 'above' && value.direction !== 'below') return null;
  if (typeof value.id !== 'string' || !value.id) return null;

  return {
    id: value.id,
    target,
    direction: value.direction,
    note: typeof value.note === 'string' ? value.note.slice(0, 120) : '',
    startPrice: Number.isFinite(Number(value.startPrice)) ? Number(value.startPrice) : null,
    createdAt: value.createdAt || new Date().toISOString(),
    status: ['active', 'triggered', 'cancelled'].includes(value.status) ? value.status : 'active',
    triggeredAt: value.triggeredAt || null,
    triggeredPrice: Number.isFinite(Number(value.triggeredPrice))
      ? Number(value.triggeredPrice)
      : null,
    notified: Boolean(value.notified),
    notificationError: value.notificationError || null,
    lastAttemptAt: value.lastAttemptAt || null,
  };
}

export class AlertStore {
  constructor() {
    this.alerts = new Map();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    let stored = await readFile();
    try {
      const redis = await getRedis();
      if (redis) {
        const raw = await redis.get(REDIS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) stored = parsed;
        }
      }
    } catch {
      // Fall back to the file store when Redis is unavailable.
    }

    for (const item of stored) {
      const alert = normalizeAlert(item);
      if (alert) this.alerts.set(alert.id, alert);
    }
    return this.list();
  }

  list() {
    return [...this.alerts.values()].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
  }

  get(id) {
    return this.alerts.get(id) ?? null;
  }

  put(alert) {
    this.alerts.set(alert.id, alert);
    return this.#persist();
  }

  delete(id) {
    const removed = this.alerts.delete(id);
    return removed ? this.#persist() : Promise.resolve(false);
  }

  #persist() {
    const snapshot = this.list();
    this.writeQueue = this.writeQueue
      .then(async () => {
        await writeFile(snapshot);
        try {
          const redis = await getRedis();
          if (redis) await redis.set(REDIS_KEY, JSON.stringify(snapshot));
        } catch {
          // File storage remains authoritative if Redis is unavailable.
        }
      })
      .catch(() => {});
    return this.writeQueue.then(() => true);
  }

  async close() {
    await this.writeQueue;
    if (process.env.VERCEL && redisClient) {
      try {
        await redisClient.quit();
      } catch {
        redisClient.disconnect();
      }
      redisClient = null;
    }
  }
}
