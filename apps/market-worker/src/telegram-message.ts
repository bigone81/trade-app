import { formatMarketNotification } from '@trade/domain';
import type { MarketObservation } from '@trade/shared';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function formatTelegramMarketNotification(observation: MarketObservation, language: 'en' | 'ru' | 'uk', publicAppUrl: string) {
  const message = escapeHtml(formatMarketNotification(observation, language));
  if (!publicAppUrl.trim()) return message;
  const url = new URL(publicAppUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_APP_URL must use HTTP or HTTPS');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  url.search = new URLSearchParams({ symbol: observation.symbol, level: String(observation.cluster.price) }).toString();
  url.hash = '';
  const label = { en: 'Open chart', ru: 'Открыть график', uk: 'Відкрити графік' }[language];
  return `${message}\n\n<a href="${escapeHtml(url.toString())}">${label}</a>`;
}
