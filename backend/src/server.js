import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';
import {
  authConfigured,
  createToken,
  credentialsMatch,
  tokenFromHeader,
  verifyToken,
} from './auth.js';
import { AlertService } from './alertService.js';

const app = express();
const alerts = new AlertService();

const allowedOrigins = CONFIG.clientOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins }));
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json(alerts.health());
});

app.post('/api/login', (request, response) => {
  if (!authConfigured() || !credentialsMatch(request.body?.username, request.body?.password)) {
    response.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  response.json({ token: createToken({ user: process.env.AUTH_USERNAME }), expiresIn: 12 * 3_600 });
});

app.use('/api', (request, response, next) => {
  const token = tokenFromHeader(request.headers.authorization) || request.query.token || '';
  if (!verifyToken(token)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

app.get('/api/config', (_request, response) => {
  response.json({ apiUrl: null, wsUrl: null });
});

app.get('/api/price', (_request, response) => {
  response.json({ price: alerts.priceState() });
});

app.get('/api/alerts', (_request, response) => {
  response.json({
    alerts: alerts.list(),
    price: alerts.priceState(),
    telegram: { configured: Boolean(CONFIG.telegramBotToken && CONFIG.telegramChatId) },
  });
});

app.post('/api/alerts', async (request, response) => {
  const alert = await alerts.create(request.body ?? {});
  response.status(201).json({ alert });
});

app.post('/api/alerts/:id/cancel', async (request, response) => {
  const alert = await alerts.cancel(request.params.id);
  if (!alert) {
    response.status(404).json({ error: 'Alert not found' });
    return;
  }
  response.json({ alert });
});

app.post('/api/alerts/:id/retry', async (request, response) => {
  const alert = await alerts.retry(request.params.id);
  if (!alert) {
    response.status(404).json({ error: 'Alert not found' });
    return;
  }
  response.json({ alert });
});

app.delete('/api/alerts/:id', async (request, response) => {
  await alerts.remove(request.params.id);
  response.status(204).end();
});

app.use((error, _request, response, _next) => {
  const message = error?.message || 'Request failed';
  const status = /valid target|choose whether|must be above|must be below/i.test(message) ? 400 : 500;
  response.status(status).json({ error: message });
});

await alerts.start();

const server = app.listen(CONFIG.port, () => {
  console.log(`XAUUSD notification backend listening on http://localhost:${CONFIG.port}`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await alerts.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
