import './style.css';
import {
  cancelAlert,
  createAlert,
  deleteAlert,
  discoverApiBase,
  getAlerts,
  getToken,
  login,
  retryAlert,
  setToken,
  tokenAlive,
} from './api.js';

const element = (id) => document.getElementById(id);
const REFRESH_MS = 5_000;

let locked = true;
let started = false;
let refreshing = false;
let refreshTimer = null;
let latestAlerts = [];

const money = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) : '—';

const time = (value) =>
  value ? new Date(value).toLocaleString([], { hour12: false, dateStyle: 'medium', timeStyle: 'medium' }) : '—';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

function showLogin(message = '') {
  setToken('');
  locked = true;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  element('login-error').textContent = message;
  element('app').classList.add('locked');
  element('login').classList.remove('hidden');
}

function renderPrice(price) {
  element('current-price').textContent = money(price?.price);
  element('price-updated').textContent = time(price?.at);
  element('price-source').textContent = price?.source
    ? `${price.provider || 'api'} · ${price.source}`
    : (price?.provider || '—');

  const status = element('price-status');
  const state = price?.state || 'connecting';
  status.dataset.state = state;
  status.textContent = state.toUpperCase();

  element('price-detail').textContent = price?.reason
    ? price.reason
    : price?.price == null
      ? 'Waiting for the first price from the API…'
      : `Watching XAU/USD for target crossings`;
}

function renderTelegram(configured) {
  element('telegram-hint').textContent = configured
    ? 'Connected: triggered alerts are sent to the configured Telegram chat.'
    : 'Telegram is not configured on the server. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.';
  element('telegram-hint').classList.toggle('warning', !configured);
}

function activeCard(alert, current) {
  const distance = Number.isFinite(Number(current)) && Number.isFinite(Number(alert.target))
    ? money(Math.abs(Number(alert.target) - Number(current)))
    : '—';
  return `
    <article class="alert-card">
      <div class="alert-main">
        <span class="badge ${alert.direction}">${alert.direction === 'above' ? 'ABOVE' : 'BELOW'}</span>
        <strong>${money(alert.target)}</strong>
        <span class="muted">${money(current)} now · ${distance} away</span>
      </div>
      <div class="alert-meta">
        <span>Created ${time(alert.createdAt)}</span>
        ${alert.note ? `<span>${escapeHtml(alert.note)}</span>` : ''}
      </div>
      <button type="button" class="ghost-button" data-action="cancel" data-id="${escapeHtml(alert.id)}">Cancel</button>
    </article>`;
}

function historyCard(alert) {
  const sent = alert.status === 'triggered' && alert.notified;
  const failed = alert.status === 'triggered' && !alert.notified;
  const badge = alert.status === 'cancelled'
    ? '<span class="badge cancelled">CANCELLED</span>'
    : sent
      ? '<span class="badge sent">SENT</span>'
      : '<span class="badge failed">SEND FAILED</span>';

  return `
    <article class="alert-card">
      <div class="alert-main">
        ${badge}
        <strong>${money(alert.target)}</strong>
        <span class="muted">${alert.direction === 'above' ? 'crossed above' : 'crossed below'} at ${money(alert.triggeredPrice)}</span>
      </div>
      <div class="alert-meta">
        <span>${time(alert.triggeredAt || alert.createdAt)}</span>
        ${alert.note ? `<span>${escapeHtml(alert.note)}</span>` : ''}
        ${alert.notificationError ? `<span class="error-text">${escapeHtml(alert.notificationError)}</span>` : ''}
      </div>
      <div class="alert-actions">
        ${failed ? `<button type="button" class="ghost-button" data-action="retry" data-id="${escapeHtml(alert.id)}">Retry</button>` : ''}
        <button type="button" class="ghost-button" data-action="delete" data-id="${escapeHtml(alert.id)}">Delete</button>
      </div>
    </article>`;
}

function renderAlerts(payload) {
  latestAlerts = payload?.alerts || [];
  const current = payload?.price?.price;
  const active = latestAlerts.filter((alert) => alert.status === 'active');
  const history = latestAlerts.filter((alert) => alert.status !== 'active');

  element('active-alerts').innerHTML = active.length
    ? active.map((alert) => activeCard(alert, current)).join('')
    : '<p class="empty">No active alerts. Enter a target price above.</p>';

  element('alert-history').innerHTML = history.length
    ? history.map(historyCard).join('')
    : '<p class="empty">Triggered and cancelled alerts will appear here.</p>';

  element('active-count').textContent = String(active.length);
}

async function refresh() {
  if (locked || refreshing) return;
  refreshing = true;
  try {
    const payload = await getAlerts();
    renderPrice(payload.price);
    renderTelegram(payload.telegram?.configured);
    renderAlerts(payload);
    element('footer-status').textContent = 'Watching live price · alerts checked automatically';
  } catch (error) {
    if (error.status === 401) {
      showLogin('Session expired — sign in again.');
      return;
    }
    element('footer-status').textContent = `Connection error: ${error.message}`;
  } finally {
    refreshing = false;
  }
}

async function handleAlertAction(button) {
  const { action, id } = button.dataset;
  button.disabled = true;
  try {
    if (action === 'cancel') await cancelAlert(id);
    if (action === 'retry') await retryAlert(id);
    if (action === 'delete') await deleteAlert(id);
    await refresh();
  } catch (error) {
    if (error.status === 401) showLogin('Session expired — sign in again.');
    else element('footer-status').textContent = `Action failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

function setupPortal() {
  const form = element('alert-form');
  const message = element('form-message');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    message.textContent = '';
    message.className = 'form-message';
    submit.disabled = true;

    try {
      await createAlert({
        target: element('alert-target').value,
        direction: element('alert-direction').value,
        note: element('alert-note').value,
      });
      form.reset();
      message.textContent = 'Alert created. We will notify you when the price crosses your target.';
      message.className = 'form-message success';
      await refresh();
    } catch (error) {
      if (error.status === 401) showLogin('Session expired — sign in again.');
      else {
        message.textContent = error.message;
        message.className = 'form-message error';
      }
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleAlertAction(button);
  });

  element('logout').addEventListener('click', () => {
    setToken('');
    showLogin();
  });
}

function startApp() {
  if (started) return;
  started = true;
  element('login').classList.add('hidden');
  element('app').classList.remove('locked');
  locked = false;
  setupPortal();
  refresh();
  refreshTimer = setInterval(refresh, REFRESH_MS);
}

async function setupLogin() {
  const form = element('login-form');
  const password = element('login-password');
  const submit = form.querySelector('button[type="submit"]');
  const token = getToken();

  if (token && tokenAlive(token)) {
    await discoverApiBase();
    startApp();
    return;
  }
  if (token) setToken('');
  showLogin();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    element('login-error').textContent = '';
    submit.disabled = true;
    try {
      await login(element('login-username').value.trim(), password.value);
      password.value = '';
      startApp();
    } catch (error) {
      element('login-error').textContent = error.message;
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  });
}

setInterval(() => {
  element('clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
}, 1_000);

setupLogin();
