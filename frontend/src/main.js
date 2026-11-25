import './style.css';
import { createChartController } from './chart.js';
import { DataFeed } from './dataFeed.js';
import { DEFAULT_TIMEFRAME, TIMEFRAMES } from './timeframes.js';

const element = (id) => document.getElementById(id);
const chart = createChartController(element('chart'));

let currentTimeframe = DEFAULT_TIMEFRAME;
let loadedTimeframe = null;
let candles = [];
let currentSMC = null;
let currentStatus = { state: 'connecting' };
let feed = null;

function formatPrice(value) {
  return Number(value).toFixed(2);
}

function updateLegend(candle) {
  if (!candle) return;
  element('legend-ohlc').textContent =
    `O ${formatPrice(candle.open)}  H ${formatPrice(candle.high)}  ` +
    `L ${formatPrice(candle.low)}  C ${formatPrice(candle.close)}`;
}

function updatePrice() {
  const last = candles.at(-1);
  if (!last) return;

  element('last-price').textContent = formatPrice(last.close);
  const previous = candles.length > 1 ? candles.at(-2).close : last.open;
  const change = last.close - previous;
  const percent = previous ? (change / previous) * 100 : 0;
  const changeElement = element('price-change');
  changeElement.textContent = `${change >= 0 ? '+' : ''}${formatPrice(change)} (${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%)`;
  changeElement.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
  updateLegend(last);
}

function updateStatus(payload) {
  const status = payload?.status ?? currentStatus;
  currentStatus = status;

  const state = status.state ?? 'connecting';
  element('status').dataset.state = state;
  element('status-text').textContent = state.toUpperCase();
  element('source').textContent = status.provider
    ? `${status.provider} · ${status.stream || 'idle'}`
    : '—';
  element('last-tick').textContent = status.lastTickAt
    ? new Date(status.lastTickAt).toLocaleTimeString()
    : '—';
  element('bar-count').textContent = String(candles.length);
  element('footer-status').textContent = status.reason
    ? `${state}: ${status.reason}`
    : `Data ${state} · provider ${status.provider || 'unknown'}`;
}

const formatSignalTime = (seconds) =>
  new Date(seconds * 1000).toLocaleTimeString([], { hour12: false });

function renderSMC() {
  const counts = currentSMC?.counts;
  element('smc-counts').innerHTML = counts
    ? [
        ['FVG', counts.fvgs],
        ['OB', counts.orderBlocks],
        ['BOS/CHoCH', counts.structure],
        ['SWEEP', counts.sweeps],
        ['ENTRY', counts.signals],
      ]
        .map(
          ([label, value]) =>
            `<div class="smc-count"><strong>${value}</strong><span>${label}</span></div>`,
        )
        .join('')
    : '<span class="muted">Waiting for analysis…</span>';

  const signals = currentSMC?.signals?.slice(-5).reverse() ?? [];
  element('signal-list').innerHTML = signals.length
    ? signals
        .map(
          (signal) => `
          <div class="signal-card ${signal.side}">
            <div class="signal-head">
              <span>${signal.side === 'long' ? 'BUY' : 'SELL'} · ${signal.confidence}</span>
              <span>${formatSignalTime(signal.time)}</span>
            </div>
            <div class="quote-row"><span>Entry</span><strong>${formatPrice(signal.entry)}</strong></div>
            <div class="quote-row"><span>Stop</span><strong>${formatPrice(signal.stopLoss)}</strong></div>
            <div class="quote-row"><span>Target</span><strong>${formatPrice(signal.takeProfit)}</strong></div>
            <div class="muted">${signal.status === 'closed' ? `${signal.result} · ` : ''}${signal.reasons.join(' · ')}</div>
          </div>`,
        )
        .join('')
    : '<p class="muted">No SMC entry setup detected on this timeframe yet.</p>';
}

function applySMC(payload) {
  if (payload.timeframe !== currentTimeframe || !payload.smc) return;
  currentSMC = payload.smc;
  chart.setSMC(currentSMC);
  renderSMC();
}

function sameCandles(incoming, existing) {
  const lastIncoming = incoming.at(-1);
  const lastExisting = existing.at(-1);
  return (
    existing.length > 0 &&
    incoming.length === existing.length &&
    lastIncoming?.time === lastExisting?.time &&
    lastIncoming?.close === lastExisting?.close
  );
}

function applySnapshot(payload) {
  if (payload.timeframe !== currentTimeframe || !Array.isArray(payload.candles)) return;

  const freshLoad = loadedTimeframe !== currentTimeframe;
  if (!freshLoad && sameCandles(payload.candles, candles)) {
    if (payload.smc) applySMC(payload);
    updateStatus(payload);
    return;
  }

  candles = payload.candles;
  chart.setHistory(candles, { fit: freshLoad });
  loadedTimeframe = currentTimeframe;
  if (payload.smc) applySMC(payload);
  else renderSMC();
  updatePrice();
  updateStatus(payload);
}

function applyCandle(payload) {
  if (payload.timeframe !== currentTimeframe || !payload.candle) return;
  const candle = payload.candle;
  const last = candles.at(-1);
  if (last && candle.time < last.time) return;
  if (last && last.time === candle.time) candles[candles.length - 1] = candle;
  else candles.push(candle);

  chart.updateCandle(candle);
  updatePrice();
  if (payload.status) updateStatus(payload);
}

const timeframeNav = element('timeframes');
for (const timeframe of TIMEFRAMES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = timeframe.label;
  button.dataset.timeframe = timeframe.key;
  button.className = timeframe.key === currentTimeframe ? 'active' : '';
  button.addEventListener('click', () => {
    if (currentTimeframe === timeframe.key) return;
    currentTimeframe = timeframe.key;
    loadedTimeframe = null;
    candles = [];
    currentSMC = null;
    chart.setHistory([]);
    renderSMC();
    for (const item of timeframeNav.children) {
      item.classList.toggle('active', item.dataset.timeframe === currentTimeframe);
    }
    element('legend-ohlc').textContent = `Loading ${timeframe.label}…`;
    feed?.setTimeframe(currentTimeframe);
  });
  timeframeNav.appendChild(button);
}

async function bootstrap() {
  let endpoints = {};
  try {
    const response = await fetch('/api/config');
    if (response.ok) endpoints = await response.json();
  } catch {
    // The same-origin REST endpoints remain available without config discovery.
  }

  feed = new DataFeed({
    endpoints,
    onSnapshot: applySnapshot,
    onHistory: applySnapshot,
    onCandle: applyCandle,
    onSMC: applySMC,
    onStatus: updateStatus,
    onError: (message) => {
      element('footer-status').textContent = `Error: ${message}`;
    },
  });

  renderSMC();
  feed.connect();

  setTimeout(() => {
    if (candles.length === 0) {
      feed
        .fetchCandles(currentTimeframe)
        .then(applySnapshot)
        .catch((error) => {
          element('footer-status').textContent = `History unavailable: ${error.message}`;
        });
    }
  }, 2_500);
}

bootstrap();

setInterval(() => {
  element('clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
}, 1_000);

window.addEventListener('beforeunload', () => feed.disconnect());
