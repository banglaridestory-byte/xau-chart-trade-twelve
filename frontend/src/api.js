const TOKEN_KEY = 'xauusd-token';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let apiBase = '';

export function getToken() {
  return token;
}

export function setToken(value) {
  token = value || '';
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function tokenAlive(value) {
  try {
    const payload = JSON.parse(atob(value.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return Number.isFinite(payload.exp) && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response) {
  try {
    const body = await response.json();
    return body?.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function discoverApiBase() {
  try {
    const response = await fetch('/api/config', { headers: authHeaders() });
    if (response.ok) {
      const config = await response.json();
      apiBase = String(config.apiUrl || '').trim().replace(/\/$/, '');
    }
  } catch {
    // Same-origin API remains available (local development).
  }
  return apiBase;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 401) {
    const error = new Error('Session expired');
    error.status = 401;
    throw error;
  }
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return null;
  return response.json();
}

export async function login(username, password) {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const payload = await response.json();
  setToken(payload.token);
  await discoverApiBase();
  return payload;
}

export const getAlerts = () => request('/api/alerts');
export const createAlert = (alert) => request('/api/alerts', { method: 'POST', body: alert });
export const cancelAlert = (id) => request(`/api/alerts/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
export const retryAlert = (id) => request(`/api/alerts/${encodeURIComponent(id)}/retry`, { method: 'POST' });
export const deleteAlert = (id) => request(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
