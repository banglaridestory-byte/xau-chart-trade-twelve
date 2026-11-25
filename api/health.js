import { keyPool } from '../backend/src/keys.js';
import { cacheStats } from '../backend/src/historyCache.js';
import { allowCors, rejectMethod, restStatus } from '../backend/src/vercelHttp.js';

export default async function handler(request, response) {
  allowCors(response);
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  if (request.method !== 'GET') {
    rejectMethod(response);
    return;
  }

  response.status(200).json({
    ok: keyPool.configured,
    status: restStatus(),
    adapters: [{ name: 'twelvedata', configured: keyPool.configured }],
    credits: keyPool.snapshot(),
    cache: await cacheStats(),
  });
}
