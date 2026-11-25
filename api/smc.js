import {
  DEFAULT_TIMEFRAME,
  analyze,
  fetchHistory,
  isTimeframe,
} from '../backend/src/vercelData.js';
import { allowCors, fail, rejectMethod } from '../backend/src/vercelHttp.js';

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
    const history = await fetchHistory(timeframe, 500);
    response.status(200).json({
      type: 'smc',
      timeframe,
      smc: history.smc ?? analyze(timeframe, history.candles),
      cache: { cached: history.cached, stale: history.stale, source: history.source },
    });
  } catch (error) {
    fail(response, error);
  }
}
