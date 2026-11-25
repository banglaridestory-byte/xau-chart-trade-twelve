import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { CONFIG, DEFAULT_TIMEFRAME, isTimeframe } from './config.js';
import { DataService } from './service.js';
import { tokenFromHeader, verifyToken } from './auth.js';

const app = express();
const service = new DataService();

const allowedOrigins = CONFIG.clientOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins }));
app.use(express.json());

app.use('/api', (request, response, next) => {
  if (request.path === '/health') return next();
  const token = tokenFromHeader(request.headers.authorization) || request.query.token || '';
  if (!verifyToken(token)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

app.get('/api/health', (_request, response) => {
  response.json(service.health());
});

app.get('/api/status', (_request, response) => {
  response.json({ status: service.health().status, adapters: service.health().adapters });
});

app.get('/api/adapters', (_request, response) => {
  response.json({ adapters: service.health().adapters });
});

app.get('/api/config', (_request, response) => {
  response.json({ apiUrl: null, wsUrl: null });
});

app.get('/api/candles', async (request, response) => {
  const timeframe = request.query.timeframe || DEFAULT_TIMEFRAME;
  if (!isTimeframe(timeframe)) {
    response.status(400).json({ error: `Unsupported timeframe: ${timeframe}` });
    return;
  }

  const requested = Number.parseInt(request.query.limit ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(CONFIG.maxCachedBars, Math.max(1, requested))
    : CONFIG.timeframeLimit;

  try {
    await service.ensureHistory(timeframe);
    const snapshot = service.snapshot(timeframe, limit);
    response.json({
      symbol: CONFIG.symbol,
      symbolLabel: CONFIG.symbolLabel,
      timeframe,
      candles: snapshot.candles,
      smc: snapshot.smc,
      status: snapshot.status,
    });
  } catch (error) {
    const cached = service.snapshot(timeframe, limit);
    if (cached.candles.length > 0) {
      response.json({
        symbol: CONFIG.symbol,
        symbolLabel: CONFIG.symbolLabel,
        timeframe,
        candles: cached.candles,
        smc: cached.smc,
        status: { ...cached.status, reason: error.message },
      });
      return;
    }
    response.status(502).json({ error: error.message });
  }
});

app.get('/api/smc', async (request, response) => {
  const timeframe = request.query.timeframe || DEFAULT_TIMEFRAME;
  if (!isTimeframe(timeframe)) {
    response.status(400).json({ error: `Unsupported timeframe: ${timeframe}` });
    return;
  }
  try {
    await service.ensureHistory(timeframe);
    response.json(service.smcSnapshot(timeframe));
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket) => {
  const reject = () => {
    socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
    setTimeout(() => socket.close(1008, 'Unauthorized'), 150);
  };
  const timer = setTimeout(reject, 10_000);
  socket.once('message', (raw) => {
    clearTimeout(timer);
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      reject();
      return;
    }
    if (message?.type !== 'auth' || !verifyToken(message.token)) {
      reject();
      return;
    }
    service.addClient(socket);
    socket.send(JSON.stringify({ type: 'authorized' }));
  });
});

await service.start();

server.listen(CONFIG.port, () => {
  console.log(`XAUUSD backend listening on http://localhost:${CONFIG.port}`);
});

const shutdown = () => {
  service.stop();
  wss.close();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
