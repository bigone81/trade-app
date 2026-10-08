import { appendSystemEvent, markNotificationTelegram, type NotificationRecord, type SqliteDb } from './index.js';

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
