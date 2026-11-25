import { allowCors } from '../backend/src/vercelHttp.js';

export default function handler(request, response) {
  allowCors(response);
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  const raw = (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '');
  const apiUrl = raw || null;
  const wsUrl = raw
    ? `${raw.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}/ws`
    : null;

  response.status(200).json({ apiUrl, wsUrl });
}
