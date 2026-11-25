import Redis from 'ioredis';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG, TIMEFRAMES } from './config.js';

const REDIS_PREFIX = 'xauusd:history:v1:';
const CACHE_FILE =
  process.env.HISTORY_CACHE_FILE || path.join(process.cwd(), '.cache', 'history.json');
const DAY_SECONDS = 86_400;

let redisClient = null;
let lastRedisError = null;
let fileQueue = Promise.resolve();

function createRedis(url) {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
  });
  client.on('error', (error) => {
    lastRedisError = error.message;
  });
  return client;
}

function emptyEntry() {
  return { candles: [], updatedAt: 0 };
}

function normalizeEntry(value) {
  if (!value || !Array.isArray(value.candles)) return emptyEntry();
  return {
    candles: value.candles.filter(
      (candle) =>
        candle &&
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    ),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

async function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!redisClient || redisClient.status === 'end' || redisClient.status === 'close') {
    redisClient?.disconnect();
    lastRedisError = null;
    redisClient = createRedis(url);
  }

  if (redisClient.status === 'wait') await redisClient.connect();

  if (redisClient.status !== 'ready') {
    const client = redisClient;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Redis not ready (${client.status}): ${lastRedisError || 'timeout'}`));
      }, 10_000);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        client.off('ready', onReady);
      };
      client.once('ready', onReady);
    });
  }

  return redisClient;
}

async function readRedis(timeframe) {
  try {
    const redis = await getRedis();
    const raw = redis && (await redis.get(`${REDIS_PREFIX}${timeframe}`));
    return raw ? normalizeEntry(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function writeRedis(timeframe, entry) {
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.set(
        `${REDIS_PREFIX}${timeframe}`,
        JSON.stringify(entry),
        'EX',
        DAY_SECONDS,
      );
    }
  } catch {
    // File cache below remains authoritative when Redis is unavailable.
  }
}

async function readFile() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeFile(all) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const temporary = `${CACHE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(all));
  await fs.rename(temporary, CACHE_FILE);
}

function mergeCandles(existing, incoming) {
  const byTime = new Map();
  for (const candle of [...existing, ...incoming]) byTime.set(candle.time, candle);
  return [...byTime.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-CONFIG.maxCachedBars);
}

export function cacheMaxAge(timeframe) {
  const seconds = TIMEFRAMES[timeframe]?.seconds ?? 300;
  return Math.min(6 * 3_600_000, Math.max(180_000, seconds * 3_000));
}

export function isFresh(entry, timeframe) {
  const age = Date.now() - (entry?.updatedAt ?? 0);
  return entry?.candles?.length > 0 && age >= 0 && age < cacheMaxAge(timeframe);
}

export async function readHistory(timeframe) {
  const fromRedis = await readRedis(timeframe);
  if (fromRedis?.candles.length) return fromRedis;

  const all = await readFile();
  return normalizeEntry(all[timeframe]);
}

export async function writeHistory(timeframe, candles, { merge = false } = {}) {
  const existing = merge ? (await readHistory(timeframe)).candles : [];
  const entry = {
    candles: merge
      ? mergeCandles(existing, candles)
      : [...candles].sort((left, right) => left.time - right.time).slice(-CONFIG.maxCachedBars),
    updatedAt: Date.now(),
  };

  await writeRedis(timeframe, entry);
  fileQueue = fileQueue
    .then(async () => {
      const all = await readFile();
      all[timeframe] = entry;
      await writeFile(all);
    })
    .catch(() => {});
  await fileQueue;
  return entry;
}

export async function cacheStats() {
  const all = await readFile();
  const file = {
    timeframes: Object.keys(all).length,
    bars: Object.values(all).reduce((total, entry) => total + (entry?.candles?.length ?? 0), 0),
  };
  const result = {
    backend: process.env.REDIS_URL ? 'redis+file' : 'file',
    file,
    redis: { reachable: false, error: null, timeframes: 0, bars: 0 },
    timeframes: file.timeframes,
    bars: file.bars,
  };

  if (!process.env.REDIS_URL) return result;

  try {
    const redis = await getRedis();
    const keys = await redis.keys(`${REDIS_PREFIX}*`);
    const entries = await Promise.all(
      keys.map(async (key) => {
        const raw = await redis.get(key);
        return raw ? normalizeEntry(JSON.parse(raw)) : null;
      }),
    );
    result.redis = {
      reachable: true,
      error: null,
      timeframes: entries.filter(Boolean).length,
      bars: entries.reduce((total, entry) => total + (entry?.candles?.length ?? 0), 0),
    };
    result.timeframes = result.redis.timeframes;
    result.bars = result.redis.bars;
  } catch (error) {
    result.redis.error = lastRedisError || error.message;
  }

  return result;
}

export async function closeCache() {
  if (!process.env.VERCEL || !redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  }
  redisClient = null;
}
