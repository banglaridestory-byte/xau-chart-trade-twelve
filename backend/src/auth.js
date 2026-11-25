import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 12 * 3_600_000;

function secret() {
  return process.env.AUTH_SECRET || '';
}

function signature(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function authConfigured() {
  return Boolean(secret());
}

export function createToken({ user = 'admin', ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!authConfigured()) throw new Error('AUTH_SECRET is not configured');
  const payload = Buffer.from(
    JSON.stringify({ u: user, exp: Date.now() + ttlMs }),
  ).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function verifyToken(token) {
  if (!authConfigured() || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;

  const expected = Buffer.from(signature(parts[0]));
  const received = Buffer.from(parts[1]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return (
      typeof data.u === 'string' &&
      data.u.length > 0 &&
      Number.isFinite(data.exp) &&
      data.exp > Date.now()
    );
  } catch {
    return false;
  }
}

export function tokenFromHeader(value) {
  if (typeof value !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : '';
}

export function credentialsMatch(username, password) {
  const expectedUser = process.env.AUTH_USERNAME || '';
  const expectedPassword = process.env.AUTH_PASSWORD || '';
  if (!expectedUser || !expectedPassword) return false;
  return (
    safeEqual(String(username ?? ''), expectedUser) &&
    safeEqual(String(password ?? ''), expectedPassword)
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
