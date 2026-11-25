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
    const candles = await fetchHistory(timeframe, 500);
    response.status(200).json({ type: 'smc', timeframe, smc: analyze(timeframe, candles) });
  } catch (error) {
    fail(response, error);
  }
}
