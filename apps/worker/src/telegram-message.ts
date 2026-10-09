import { telegramChartLink, type NotificationRecord } from '@trade/database';

export function withWorkerChartLink(notification: Pick<NotificationRecord, 'symbol' | 'eventType' | 'payload'> | null, text: string, language: 'en' | 'ru' | 'uk', publicAppUrl: string) {
  if (!notification?.symbol || !['alert.pre', 'alert.triggered', 'order.filled'].includes(notification.eventType)) return text;
  const payload = notification.payload && typeof notification.payload === 'object' ? notification.payload as Record<string, unknown> : {};
  const candidates = notification.eventType === 'order.filled'
    ? [payload.avgPrice, payload.price, payload.triggerPrice]
    : [payload.level];
  const level = candidates.map(Number).find(value => Number.isFinite(value) && value > 0);
  return text + telegramChartLink(publicAppUrl, language, notification.symbol, level);
}
