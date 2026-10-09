import { marketNumericBounds, type MarketMonitorSettings, type MarketNumericKey, type MarketSignal } from '@trade/shared';

type Language = 'en' | 'ru' | 'uk';
const labels: Record<string, readonly [string, string, string]> = {
  pressing: ['Directional pressure', 'Поджимает к уровню', 'Підтискає до рівня'],
  m5: ['5m', '5м', '5хв'], m15: ['15m', '15м', '15хв'], m30: ['30m', '30м', '30хв'],
  minTurnover: ['Minimum turnover, USD', 'Минимальный оборот, USD', 'Мінімальний оборот, USD'],
  exitTurnover: ['Exit turnover, USD', 'Оборот для исключения, USD', 'Оборот для виключення, USD'],
  maxAutoSymbols: ['Maximum auto symbols', 'Максимум автоматических монет', 'Максимум автоматичних монет'],
  universeRefreshMinutes: ['Universe refresh, minutes', 'Обновление списка монет, минут', 'Оновлення списку монет, хвилин'],
  cooldownMinutes: ['Repeat cooldown, minutes', 'Пауза повторов, минут', 'Пауза повторів, хвилин'],
  nearRetestDays: ['Near retest, days', 'Ближний ретест, дней', 'Ближній ретест, днів'],
  farRetestDays: ['Far retest, days', 'Дальний ретест, дней', 'Дальній ретест, днів'],
  levelClusterAtr: ['Cluster radius, ATR', 'Радиус кластера, ATR', 'Радіус кластера, ATR'],
  touchToleranceAtr: ['Touch tolerance, ATR', 'Допуск касания, ATR', 'Допуск дотику, ATR'],
  touchEpisodeGapBars: ['Touch episode gap, bars', 'Интервал между касаниями, свечей', 'Інтервал між дотиками, свічок'],
  atrExpansionThreshold: ['ATR expansion threshold, ×', 'Порог расширения ATR, ×', 'Поріг розширення ATR, ×'],
  directionalEfficiencyThreshold: ['Directional efficiency, 0–1', 'Эффективность движения, 0–1', 'Ефективність руху, 0–1'],
  directionalMoveAtr: ['Directional impulse, ATR', 'Направленный импульс, ATR', 'Спрямований імпульс, ATR'],
  fastApproachThreshold: ['Minimum approach score', 'Минимальная оценка подхода', 'Мінімальна оцінка підходу'],
  setupThreshold: ['Minimum setup score', 'Минимальная оценка сценария', 'Мінімальна оцінка сценарію'],
  scoreDelta: ['Minimum score difference', 'Минимальная разница оценок', 'Мінімальна різниця оцінок'],
  scoreIncrease: ['Score increase for repeat alert', 'Рост оценки для повтора', 'Зростання оцінки для повтору'],
  maxDistanceAtr: ['Maximum approach distance, ATR', 'Дистанция подхода, ATR', 'Дистанція підходу, ATR'],
  resetDistanceAtr: ['Reset distance, ATR', 'Дистанция сброса, ATR', 'Дистанція скидання, ATR'],
  closeNearAtr: ['Close near level, ATR', 'Близкое закрытие, ATR', 'Близьке закриття, ATR'],
  closeFarAtr: ['Close far from level, ATR', 'Далёкое закрытие, ATR', 'Далеке закриття, ATR'],
  volumeExpansionThreshold: ['Volume expansion, ×', 'Увеличение объёма, ×', 'Збільшення обсягу, ×'],
  smallBarAtr: ['Small bar threshold, ATR', 'Порог малого бара, ATR', 'Поріг малого бара, ATR'],
  bigBarAtr: ['Big bar threshold, ATR', 'Порог большого бара, ATR', 'Поріг великого бара, ATR'],
  compressionRatio: ['Compression ratio, 0–1', 'Коэффициент сжатия, 0–1', 'Коефіцієнт стиснення, 0–1'],
  accumulationRangeAtr: ['Accumulation range, ATR', 'Диапазон накопления, ATR', 'Діапазон накопичення, ATR'],
  stickingBars: ['Sticking window, bars', 'Окно прилипания, свечей', 'Вікно прилипання, свічок'],
  relativeStrengthThreshold: ['BTC relative strength threshold, ATR', 'Порог относительной силы к BTC, ATR', 'Поріг відносної сили до BTC, ATR'],
  noPullbackMoveAtr: ['No-pullback move, ATR', 'Безоткатное движение, ATR', 'Безвідкатний рух, ATR'],
  dailyAtrUsedThreshold: ['Daily ATR used, ratio', 'Использованный дневной ATR, доля', 'Використаний денний ATR, частка'],
  roomToNextLevelAtr: ['Room to next level, ATR', 'Запас до следующего уровня, ATR', 'Запас до наступного рівня, ATR'],
  postBreakBars: ['Post-break window, M5 bars', 'Окно после пробоя, свечей M5', 'Вікно після пробою, свічок M5'],
  postBreakImpulseAtr: ['Post-break impulse, ATR', 'Импульс после пробоя, ATR', 'Імпульс після пробою, ATR'],
  strongLevelTouches: ['Strong level: minimum touches', 'Сильный уровень: минимум касаний', 'Сильний рівень: мінімум дотиків'],
  strongLevelStrength: ['Strong level: minimum strength', 'Сильный уровень: минимум силы', 'Сильний рівень: мінімум сили'],
  scanDelaySeconds: ['Scan delay after close, seconds', 'Задержка после закрытия, секунд', 'Затримка після закриття, секунд'],
  concurrency: ['Concurrent requests', 'Параллельные запросы', 'Паралельні запити'],
  LEVEL_AHEAD: ['Level ahead', 'Уровень впереди', 'Рівень попереду'],
  AUTO_LEVEL: ['Automatic level', 'Автоматический уровень', 'Автоматичний рівень'],
  MANUAL_LEVEL: ['Manual level', 'Ручной уровень', 'Ручний рівень'],
  MIRROR_LEVEL: ['Mirror level', 'Зеркальный уровень', 'Дзеркальний рівень'],
  LEVEL_CLUSTER: ['Level cluster', 'Кластер уровней', 'Кластер рівнів'],
  LAST_TOUCH: ['Last touch age, days', 'Возраст последнего касания, дней', 'Вік останнього дотику, днів'],
  NEAR_RETEST: ['Near retest', 'Ближний ретест', 'Ближній ретест'],
  FAR_RETEST: ['Far retest', 'Дальний ретест', 'Дальній ретест'],
  ATR_EXPANSION: ['ATR expansion', 'Расширение ATR', 'Розширення ATR'],
  BIG_BARS: ['Big bars', 'Большие бары', 'Великі бари'],
  SMALL_BARS: ['Small bars', 'Маленькие бары', 'Малі бари'],
  BIG_BARS_APPROACH: ['Big bars approach', 'Подход большими барами', 'Підхід великими барами'],
  SMALL_BARS_APPROACH: ['Small bars approach', 'Подход маленькими барами', 'Підхід малими барами'],
  DIRECTIONAL_MOVE: ['Directional impulse', 'Направленный импульс', 'Спрямований імпульс'],
  DIRECTIONAL_EFFICIENCY: ['Directional efficiency', 'Эффективность движения', 'Ефективність руху'],
  DISTANCE_SHRINKING: ['Distance shrinking', 'Расстояние сокращается', 'Відстань скорочується'],
  FAST_APPROACH: ['Fast approach', 'Быстрый подход', 'Швидкий підхід'],
  LONG_NO_PULLBACK_MOVE: ['Long no-pullback move', 'Длинное безоткатное движение', 'Тривалий безвідкатний рух'],
  CLOSE_NEAR_LEVEL: ['Close near level', 'Закрытие возле уровня', 'Закриття біля рівня'],
  CLOSE_FAR_FROM_LEVEL: ['Close far from level', 'Закрытие далеко от уровня', 'Закриття далеко від рівня'],
  COMPRESSION: ['Compression', 'Поджатие', 'Підтиснення'],
  STICKING_TO_LEVEL: ['Sticking to level', 'Прилипание к уровню', 'Прилипання до рівня'],
  SIMPLE_ACCUMULATION: ['Simple accumulation', 'Простое накопление', 'Просте накопичення'],
  ACCUMULATION: ['Accumulation', 'Накопление', 'Накопичення'],
  NO_ACCUMULATION: ['No accumulation', 'Нет накопления', 'Немає накопичення'],
  VOLUME_EXPANSION: ['Volume expansion', 'Увеличение объёма', 'Збільшення обсягу'],
  BTC_RELATIVE_STRENGTH: ['Relative strength vs BTC', 'Относительная сила к BTC', 'Відносна сила до BTC'],
  FOLLOWS_MARKET: ['Follows market', 'Следует за рынком', 'Рухається за ринком'],
  STRONGER_THAN_BTC: ['Stronger than BTC', 'Сильнее BTC', 'Сильніше за BTC'],
  WEAKER_THAN_BTC: ['Weaker than BTC', 'Слабее BTC', 'Слабше за BTC'],
  INDEPENDENT_MOVE: ['Independent move', 'Независимое движение', 'Незалежний рух'],
  BREAKOUT: ['Breakout', 'Пробой', 'Пробій'],
  POST_BREAK_IMPULSE: ['Post-break impulse', 'Импульс после пробоя', 'Імпульс після пробою'],
  NO_IMPULSE_AFTER_BREAK: ['No impulse after break', 'Нет импульса после пробоя', 'Немає імпульсу після пробою'],
  FALSE_BREAK_RETURN: ['False break return', 'Возврат за уровень', 'Повернення за рівень'],
  HIGH_DAILY_ATR_USED: ['High daily ATR used', 'Большая часть дневного ATR пройдена', 'Більшу частину денного ATR пройдено'],
  GLOBAL_LOCAL_TREND_ALIGNED: ['Global and local trends aligned', 'Глобальный и локальный тренды совпадают', 'Глобальний і локальний тренди збігаються'],
  COUNTER_TREND_JERK: ['Counter-trend impulse', 'Импульс против тренда', 'Імпульс проти тренду'],
  ROOM_TO_NEXT_LEVEL: ['Room to next level', 'Запас до следующего уровня', 'Запас до наступного рівня'],
  EMPTY_SPACE_AFTER_LEVEL: ['Empty space after level', 'Свободное пространство за уровнем', 'Вільний простір за рівнем'],
  HTF_ACCUMULATION: ['Higher-timeframe accumulation', 'Накопление на старшем ТФ', 'Накопичення на старшому ТФ'],
  EXTREME: ['Price extreme', 'Ценовой экстремум', 'Ціновий екстремум'],
  STRONG_LEVEL_AHEAD: ['Strong level ahead', 'Сильный уровень впереди', 'Сильний рівень попереду'],
  CLOSE_WITHOUT_WICK_TOWARD_LEVEL: ['Close without wick toward level', 'Закрытие без тени к уровню', 'Закриття без тіні до рівня'],
  NO_PULLBACK_AFTER_STRONG_BAR: ['No pullback after strong bar', 'Нет отката после сильного бара', 'Немає відкату після сильного бара'],
  NO_PULLBACK_AFTER_FALSE_BREAK: ['No pullback after false break', 'Нет отката после ложного пробоя', 'Немає відкату після хибного пробою'],
  BREAKOUT_SETUP: ['Breakout setup', 'Сценарий пробоя', 'Сценарій пробою'],
  REJECTION_SETUP: ['Rejection / false break setup', 'Сценарий отбоя / ЛП', 'Сценарій відбою / ХП'],
  FALSE_BREAKOUT: ['False breakout', 'Ложный пробой', 'Хибний пробій'],
  BREAKOUT_CONFIRMED: ['Breakout confirmed', 'Пробой подтверждён', 'Пробій підтверджено'],
  manual: ['Manual', 'Ручной', 'Ручний'], mirror: ['Mirror', 'Зеркальный', 'Дзеркальний'],
  support: ['Support', 'Поддержка', 'Підтримка'], resistance: ['Resistance', 'Сопротивление', 'Опір'],
  atr: ['M5 ATR', 'ATR на M5', 'ATR на M5'], atrExpansion: ['ATR expansion, ×', 'Расширение ATR, ×', 'Розширення ATR, ×'],
  move3: ['15m move, ATR', 'Движение за 15м, ATR', 'Рух за 15хв, ATR'], move6: ['30m move, ATR', 'Движение за 30м, ATR', 'Рух за 30хв, ATR'],
  efficiency: ['Directional efficiency', 'Эффективность движения', 'Ефективність руху'],
  volumeRatio: ['Volume, ×', 'Объём, ×', 'Обсяг, ×'], distanceAtr: ['Distance, ATR', 'Расстояние, ATR', 'Відстань, ATR'],
  distanceNowAtr: ['Current distance, ATR', 'Текущая дистанция, ATR', 'Поточна дистанція, ATR'], distancePrevAtr: ['Distance 15m ago, ATR', 'Дистанция 15м назад, ATR', 'Дистанція 15хв тому, ATR'],
  distancePercent: ['Distance, %', 'Расстояние, %', 'Відстань, %'], approachVelocity: ['Approach speed, ATR/bar', 'Скорость подхода, ATR/бар', 'Швидкість підходу, ATR/бар'],
  daysSinceLastTouch: ['Days since last touch', 'Дней с последнего касания', 'Днів від останнього дотику'], lastTouchAt: ['Last historical touch', 'Последнее историческое касание', 'Останній історичний дотик'],
  touchCount: ['Touch episodes', 'Эпизодов касания', 'Епізодів дотику'], touchHistoryDays: ['Touch history, days', 'История касаний, дней', 'Історія дотиків, днів'],
  dailyAtrUsed: ['Daily ATR used, ratio', 'Использованный дневной ATR, доля', 'Використаний денний ATR, частка'], relativeStrength: ['Relative strength vs BTC, ATR', 'Относительная сила к BTC, ATR', 'Відносна сила до BTC, ATR'], postBreakAge: ['Bars after breakout', 'Свечей после пробоя', 'Свічок після пробою'],
};
export function marketLabel(key: string, language: Language) {
  return labels[key]?.[language === 'ru' ? 1 : language === 'uk' ? 2 : 0] ?? key.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}
export function marketNumber(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
export function marketDate(value: string | number | null | undefined, language: Language) {
  if (value == null) return '—';
  const date = new Date(typeof value === 'number' ? value * 1000 : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(language === 'en' ? 'en-GB' : language === 'uk' ? 'uk-UA' : 'ru-RU') : '—';
}
export const marketChartUrl = (symbol: string, level?: number) => `/?symbol=${encodeURIComponent(symbol)}${level == null ? '' : `&level=${level}`}`;
export const marketFeedPageSize = 50;
export const marketFeedPageSizes = [25, 50, 100] as const;
export function marketLocalDateUtcIso(value: string, endExclusive = false) {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || !parts.every(Number.isInteger)) return '';
  const year = parts[0]!, month = parts[1]!, day = parts[2]!;
  const date = new Date(year, month - 1, day + (endExclusive ? 1 : 0));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}
export function marketPageNumbers(current: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1) as (number | 'ellipsis')[];
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const result: (number | 'ellipsis')[] = [];
  [...pages].filter(page => page >= 1 && page <= totalPages).sort((a, b) => a - b).forEach((page, index, sorted) => {
    if (index > 0 && page - sorted[index - 1]! > 1) result.push('ellipsis');
    result.push(page);
  });
  return result;
}
export function marketFeedPage(rows: MarketSignal[]) {
  return { rows: rows.slice(0, marketFeedPageSize), hasMore: rows.length > marketFeedPageSize, nextCursor: rows[marketFeedPageSize - 1]?.id };
}
export function marketSettingsIssue(settings: MarketMonitorSettings): { key: MarketNumericKey; message: string; min?: number; max?: number } | null {
  for (const [key, [min, max, integer]] of Object.entries(marketNumericBounds)) {
    const value = settings[key as MarketNumericKey];
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return { key: key as MarketNumericKey, message: integer ? 'Enter a whole number from {min} to {max}.' : 'Enter a number from {min} to {max}.', min, max };
  }
  if (settings.exitTurnover > settings.minTurnover) return { key: 'exitTurnover', message: 'Exit turnover must not exceed minimum turnover.' };
  if (settings.nearRetestDays >= settings.farRetestDays) return { key: 'farRetestDays', message: 'Far retest must be greater than near retest.' };
  if (settings.resetDistanceAtr <= settings.maxDistanceAtr) return { key: 'resetDistanceAtr', message: 'Reset distance must exceed approach distance.' };
  if (settings.closeNearAtr >= settings.closeFarAtr) return { key: 'closeFarAtr', message: 'Far close distance must exceed near close distance.' };
  if (settings.smallBarAtr >= settings.bigBarAtr) return { key: 'bigBarAtr', message: 'Big bar threshold must exceed small bar threshold.' };
  return null;
}
