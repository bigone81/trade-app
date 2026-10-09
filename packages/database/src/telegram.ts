import { appendSystemEvent, markNotificationTelegram, type NotificationRecord, type SqliteDb } from './index.js';

/** Optional HTML link; invalid configuration must not block notification delivery. */
export function telegramChartLink(publicAppUrl: string, language: 'en' | 'ru' | 'uk', symbol: string, level?: number) {
  if (!publicAppUrl.trim() || !symbol) return '';
  let url: URL;
  try { url = new URL(publicAppUrl); } catch { return ''; }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  const params = new URLSearchParams({ symbol });
  if (level !== undefined && Number.isFinite(level) && level > 0) params.set('level', String(level));
  url.search = params.toString();
  url.hash = '';
  const href = url.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const label = { en: 'Open chart', ru: 'Открыть график', uk: 'Відкрити графік' }[language];
  return `\n\n<a href="${href}">${label}</a>`;
}

/** Shared notification transport used by the trading worker and Market Monitor. */
export async function deliverNotificationTelegram(db: SqliteDb, notification: NotificationRecord | null, text: string, enabled: boolean, env = process.env) {
  if (!notification || !enabled) return;
  const token = env.TELEGRAM_BOT_TOKEN || '', chatId = env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) { markNotificationTelegram(db, notification.id, 'not_configured'); return; }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!response.ok) throw new Error(`Telegram HTTP ${response.status}: ${await response.text()}`);
    markNotificationTelegram(db, notification.id, 'sent');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markNotificationTelegram(db, notification.id, 'error', message);
    appendSystemEvent(db, { severity: 'error', eventType: 'telegram.error', accountId: notification.accountId, symbol: notification.symbol, message });
  }
}
