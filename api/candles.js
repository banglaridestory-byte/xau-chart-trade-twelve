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
    const history = await fetchHistory(timeframe, 500);
    response.status(200).json({
      symbol: 'XAU/USD',
      symbolLabel: 'XAUUSD',
      timeframe,
      candles: history.slice(-parseLimit(request.query.limit)),
      smc: analyze(timeframe, history),
      status: restStatus(),
    });
  } catch (error) {
    fail(response, error);
  }
}
