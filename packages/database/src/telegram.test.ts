import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotification, deliverNotificationTelegram, listNotifications, openDatabase } from './index.js';

test('shared Telegram transport preserves disabled and unconfigured delivery states', async t => {
  const db = openDatabase(':memory:');
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
  try {
    const notification = createNotification(db, { category: 'market', eventType: 'test', title: 'Test', message: 'Test' });
    await deliverNotificationTelegram(db, notification, 'Test', false, {});
    assert.equal(listNotifications(db)[0]!.telegramStatus, 'not_requested');
    await deliverNotificationTelegram(db, notification, 'Test', true, {});
    assert.equal(listNotifications(db)[0]!.telegramStatus, 'not_configured');
    assert.equal(request.mock.callCount(), 0);
  } finally { db.close(); }
});

test('shared Telegram transport records success and failure without losing notifications', async t => {
  const db = openDatabase(':memory:');
  const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' };
  const request = t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'POST');
    assert.ok(init?.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), { chat_id: 'test-chat', text: 'Test', parse_mode: 'HTML', disable_web_page_preview: true });
    return new Response('{}', { status: 200 });
  });
  try {
    const first = createNotification(db, { category: 'market', eventType: 'test', title: 'Test', message: 'Test' });
    await deliverNotificationTelegram(db, first, 'Test', true, env);
    assert.equal(listNotifications(db)[0]!.telegramStatus, 'sent');
    request.mock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
    const second = createNotification(db, { category: 'market', eventType: 'test', title: 'Test', message: 'Test' });
    await deliverNotificationTelegram(db, second, 'Test', true, env);
    const notifications = listNotifications(db);
    assert.equal(notifications.length, 2);
    assert.equal(notifications[0]!.telegramStatus, 'error');
    assert.match(notifications[0]!.telegramError!, /Telegram HTTP 503/);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM system_events WHERE event_type='telegram.error'").get()!.total, 1);
  } finally { db.close(); }
});
