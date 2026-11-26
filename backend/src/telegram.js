import { CONFIG } from './config.js';

const API_BASE = 'https://api.telegram.org';

export function telegramConfigured() {
  return Boolean(CONFIG.telegramBotToken && CONFIG.telegramChatId);
}

function formatMoney(value) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function alertMessage(alert, price) {
  const direction = alert.direction === 'above' ? 'rose to / above' : 'fell to / below';
  const lines = [
    `XAU/USD price alert`,
    '',
    `Price ${direction} ${formatMoney(alert.target)}`,
    `Current price: ${formatMoney(price)}`,
    `Time: ${alert.triggeredAt || new Date().toISOString()}`,
  ];
  if (alert.note) lines.push(`Note: ${alert.note}`);
  return lines.join('\n');
}

export async function sendTelegramAlert(alert, price) {
  if (!telegramConfigured()) {
    throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  }

  const url = `${API_BASE}/bot${encodeURIComponent(CONFIG.telegramBotToken)}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text: alertMessage(alert, price),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const reason = payload?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram send failed: ${reason}`);
  }
  return payload.result;
}
