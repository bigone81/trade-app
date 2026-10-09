import { formatMarketNotification } from '@trade/domain';
import type { MarketObservation } from '@trade/shared';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function formatTelegramMarketNotification(observation: MarketObservation, language: 'en' | 'ru' | 'uk', publicAppUrl: string) {
  const message = escapeHtml(formatMarketNotification(observation, language));
  if (!publicAppUrl.trim()) return message;
  // A broken optional link must not discard an otherwise valid market alert.
  let url: URL;
  try { url = new URL(publicAppUrl); } catch { return message; }
  if (!['http:', 'https:'].includes(url.protocol)) return message;
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  url.search = new URLSearchParams({ symbol: observation.symbol, level: String(observation.cluster.price) }).toString();
  url.hash = '';
  const label = { en: 'Open chart', ru: 'Открыть график', uk: 'Відкрити графік' }[language];
  return `${message}\n\n<a href="${escapeHtml(url.toString())}">${label}</a>`;
}
