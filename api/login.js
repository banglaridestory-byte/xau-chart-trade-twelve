import { authConfigured, createToken, credentialsMatch } from '../backend/src/auth.js';
import { allowCors, rejectMethod, unauthorized } from '../backend/src/vercelHttp.js';

export default function handler(request, response) {
  allowCors(response, { methods: 'POST, OPTIONS' });
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  if (request.method !== 'POST') {
    rejectMethod(response);
    return;
  }
  if (!authConfigured() || !credentialsMatch(request.body?.username, request.body?.password)) {
    unauthorized(response);
    return;
  }

  const token = createToken({ user: process.env.AUTH_USERNAME });
  response.status(200).json({ token, expiresIn: 12 * 3_600 });
}
