import {
  DEFAULT_TIMEFRAME,
  analyze,
  fetchHistory,
  isTimeframe,
  parseLimit,
} from '../backend/src/vercelData.js';
import { allowCors, fail, rejectMethod, restStatus } from '../backend/src/vercelHttp.js';

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

  const timeframe = request.query.timeframe || DEFAULT_TIMEFRAME;
  if (!isTimeframe(timeframe)) {
    response.status(400).json({ error: `Unsupported timeframe: ${timeframe}` });
    return;
  }

  try {
    const history = await fetchHistory(timeframe, parseLimit(request.query.limit));
    const status = {
      ...restStatus(),
      ...(history.stale
        ? { reason: `Using cached history: ${history.warning}` }
        : history.cached
          ? { reason: `History served from ${history.source} cache` }
          : {}),
    };
    response.status(200).json({
      symbol: 'XAU/USD',
      symbolLabel: 'XAUUSD',
      timeframe,
      candles: history.candles,
      smc: history.smc ?? analyze(timeframe, history.candles),
      status,
      cache: { cached: history.cached, stale: history.stale, source: history.source },
    });
  } catch (error) {
    fail(response, error);
  }
}
