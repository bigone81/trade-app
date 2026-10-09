import { formatMarketNotification } from '@trade/domain';
import { telegramChartLink } from '@trade/database';
import type { MarketObservation } from '@trade/shared';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function formatTelegramMarketNotification(observation: MarketObservation, language: 'en' | 'ru' | 'uk', publicAppUrl: string) {
  const message = escapeHtml(formatMarketNotification(observation, language));
  return message + telegramChartLink(publicAppUrl, language, observation.symbol, observation.cluster.price);
}
