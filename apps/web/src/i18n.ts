import { useMemo } from 'react';
import { usePreferences } from './preferences';
import type { AppLanguage } from './preferences';
type Vars = Record<string, string | number>;
type Dict = Record<string, string>;

const ru: Dict = {
  'Market scenarios at your chart levels':'Рыночные сценарии возле уровней графика',
  'Live monitor':'Текущий рынок','Signal feed':'Лента сигналов','symbols':'монет',
  'Source counts can overlap; total is deduplicated.':'Источники могут пересекаться; итог — уникальные монеты.',
  'Last scan':'Последний анализ','Next scan':'Следующий анализ','Scanned':'Проверено','Requests':'Запросов','Errors':'Ошибок','Worker':'Процесс',
  'Feature':'Признак','Value':'Значение','Measurements and level cluster':'Метрики и кластер уровней','Auto touches':'Автокасания','Strength':'Сила',
  'Score difference is too small for a directional alert.':'Разница оценок недостаточна для направленного сигнала.',
  'Market Monitor enabled':'Market Monitor включён','Always monitor manual levels':'Всегда включать ручные уровни','Telegram enabled':'Telegram включён',
  'Universe mode':'Режим выбора монет','Min Telegram priority':'Минимальный приоритет Telegram',
  'Min turnover, USD':'Минимальный оборот, USD','Exit turnover, USD':'Оборот для исключения, USD','Max auto symbols':'Максимум автоматических монет','Cooldown, minutes':'Пауза повторов, минут',
  'Near retest, days':'Ближний ретест, дней','Far retest, days':'Дальний ретест, дней','Level cluster radius, ATR':'Радиус кластера, ATR','Touch tolerance, ATR':'Допуск касания, ATR',
  'Scan delay, seconds':'Задержка анализа, секунд','Max approach distance, ATR':'Дистанция подхода, ATR','Reset distance, ATR':'Дистанция сброса, ATR',
  'Telegram also follows the global market notification setting. Analysis runs after each closed M5 bar.':'Telegram также учитывает общие настройки рыночных уведомлений. Анализ выполняется после закрытия каждой свечи M5.',
  'Advanced settings':'Расширенные настройки','Score weights':'Веса признаков','Save settings':'Сохранить настройки','Saved':'Сохранено',
  'Only active Bybit USDT perpetual contracts enter the universe. Changes apply on the next scan.':'Анализируются только действующие бессрочные USDT-контракты Bybit. Изменения применятся при следующем анализе.',
  'Enable Market Monitor in Settings to start collecting observations.':'Включите Market Monitor в настройках, чтобы начать сбор наблюдений.',
  'Signals only':'Только сигналы','Latest':'Последние','Observation':'Наблюдение','Open chart':'Открыть график','No observations yet.':'Наблюдений пока нет.','Older observations':'Более ранние наблюдения',
  'Direction':'Направление','Move':'Движение','Level type':'Тип уровня','Distance':'Расстояние','Approach':'Подход','Breakout':'Пробой','Rejection':'Отбой','Priority':'Приоритет','Last signal':'Последний сигнал',
  'Chart fullscreen':'Только график','Exit fullscreen':'Выйти из полноэкранного режима','Previous coin':'Предыдущая монета','Next coin':'Следующая монета','Timeframe':'Таймфрейм',
  'Chart':'График','Trade':'Торговля','Alerts':'Оповещения','Journal':'Дневник','Settings':'Настройки','private terminal':'личный терминал',
  'English':'English','Українська':'Українська','Русский':'Русский','Language':'Язык','Interface language':'Язык интерфейса','General':'Общие',
  'System':'Системная','Light':'Светлая','Dark':'Тёмная','Theme':'Тема','Appearance':'Оформление',
  'Market scanner · bars · automatic levels · persistent drawings':'Сканер рынка · бары · автоматические уровни · сохранённые объекты',
  'Calculator':'Калькулятор','Select':'Выбор','Level':'Уровень','Risk/Reward':'Риск/Прибыль','Alert':'Оповещение',
  'Click repeatedly to save levels · Esc to finish':'Кликайте, чтобы добавлять уровни · Esc — закончить',
  'Click repeatedly to create alerts · Esc to finish':'Кликайте, чтобы добавлять оповещения · Esc — закончить',
  'Click Entry → Stop · Target is created automatically':'Клик Entry → Stop · Target создаётся автоматически',
  'Click a level to send its price to Calculator':'Кликните по уровню, чтобы отправить цену в калькулятор',
  'Visible levels':'Видимые уровни','Mirror':'Зеркальные','Min 24h turnover':'Мин. оборот за 24ч','Show auto levels':'Показывать автоуровни',
  'Search ticker…':'Поиск тикера…','Ticker':'Тикер','Turnover':'Оборот','No tickers match this filter.':'Нет тикеров по этому фильтру.',
  'Modify exchange order':'Изменить биржевой ордер','Send change':'Отправить изменение',
  'Trade calculator':'Торговый калькулятор','Invalid SL/TP geometry for {side}. Check Entry, Stop and Target.':'Неверная геометрия SL/TP для {side}. Проверьте Entry, Stop и Target.',
  'Account':'Аккаунт','Side':'Сторона','Order':'Ордер','Buy':'Покупка','Sell':'Продажа','Stop Limit':'Stop Limit','Market':'Market','Limit':'Limit',
  'Trigger':'Триггер','Entry':'Вход','Stop Loss':'Stop Loss','Take Profit':'Take Profit','Stop model':'Модель стопа','ATR calculated':'По ATR','Technical stop':'Технический стоп',
  'Price level':'Уровень цены','Market calculations use the current market price; the selected level is kept here for reference.':'Для Market расчёт идёт по текущей цене; выбранный уровень остаётся для справки.',
  'Levels':'Уровни','No visible levels':'Нет видимых уровней','Trigger % ATR':'Trigger % ATR','Slip % ATR':'Slip % ATR','SL % ATR':'SL % ATR','Technical SL':'Технический SL',
  'Target R:R':'Целевой R:R','Legacy strategy pointType: {value}':'Legacy pointType стратегии: {value}','Risk %':'Риск %','ATR (D,14)':'ATR (D,14)',
  'Equity':'Equity','Risk amount':'Сумма риска','Stop':'Stop','Target':'Target','Position qty':'Размер позиции','Notional':'Номинал',
  'Prices and quantity are aligned to Bybit tickSize / qtyStep on the server before submission.':'Перед отправкой сервер округляет цену и количество по Bybit tickSize / qtyStep.',
  'Confirm order':'Подтвердить ордер','Confirm':'Подтвердить','Cancel':'Отмена','Close':'Закрыть','Open on chart':'Открыть на графике',
  'Persistent price alerts watched by the Telegram worker':'Сохранённые ценовые оповещения, которые отслеживает Telegram worker',
  'New alert':'Новое оповещение','Symbol':'Тикер','Price':'Цена','Condition':'Условие','Touch / cross':'Касание / пересечение','Cross up':'Пересечение вверх','Cross down':'Пересечение вниз',
  'Pre-alert distance %':'Предупреждать заранее, %','Create alert':'Создать оповещение','Telegram':'Telegram','No alerts yet. Add one here or click Alert on the chart.':'Оповещений пока нет. Добавьте здесь или нажмите Alert на графике.','triggered':'сработало',
  'Trade Control':'Управление торговлей','Real-time positions, orders and fills across exchange accounts':'Позиции, ордера и исполнения по аккаунтам в реальном времени',
  'All accounts':'Все аккаунты','Symbol filter':'Фильтр по тикеру','Refresh':'Обновить','actions locked':'действия заблокированы','online':'онлайн','offline':'офлайн',
  'Unrealized':'Нереализованный PnL','Positions / Orders':'Позиции / Ордера','Positions':'Позиции','Orders':'Ордера','Executions':'Исполнения','History':'История',
  'Size':'Размер','Mark':'Mark','uPnL':'uPnL','SL':'SL','TP':'TP','Liq':'Ликв.','Actions':'Действия','Type':'Тип','Status':'Статус','Qty':'Кол-во','Filled':'Исполнено','Fee':'Комиссия','Order ID':'ID ордера','Time':'Время',
  'Cancel all':'Отменить все','No data for the selected filters.':'Нет данных по выбранным фильтрам.','Liquidation':'Ликвидация','Trailing Stop distance':'Расстояние Trailing Stop',
  'Update SL / TP / Trail':'Обновить SL / TP / Trail','Move SL to breakeven':'Перенести SL в безубыток','Emergency':'Экстренно','Close 50%':'Закрыть 50%','Force close 100%':'Принудительно закрыть 100%','Flatten symbol':'Закрыть всё по тикеру','Close all for {symbol}':'Закрыть всё по {symbol}',
  'Emergency flatten':'Экстренный Flatten','Close position':'Закрыть позицию','Cancel all orders':'Отменить все ордера','Cancel order':'Отменить ордер','FLATTEN NOW':'FLATTEN СЕЙЧАС',
  'New':'Новый','Cancelled':'Отменён','Rejected':'Отклонён','Untriggered':'Ожидает триггера','PartiallyFilled':'Частично исполнен',
  'Journal subtitle':'Сделки, заметки, скриншоты и аналитика','Trades':'Сделки','Analytics':'Аналитика','Date from':'Дата от','Date to':'Дата до','Long / Short':'Long / Short','Style':'Стиль','Entry type':'Тип входа',
  'Winrate':'Винрейт','Net R':'Итого R','Avg R':'Средний R','Profit Factor':'Profit Factor','Expectancy':'Матожидание','Date':'Дата','Exchange':'Биржа','TP / Exit':'TP / Выход','Setup':'Сетап',
  'No journal entries for the selected filters.':'Нет записей дневника по выбранным фильтрам.','Performance':'Результаты','Average winner':'Средняя прибыльная','Average loser':'Средняя убыточная','Expectancy / trade':'Матожидание / сделка','Net result':'Итоговый результат',
  'By trading style':'По стилю торговли','By account':'По аккаунту','By entry type':'По типу входа','By setup':'По сетапу','Group':'Группа','Point type':'Point type','Result R':'Результат R','Execution quality':'Качество исполнения',
  'Excellent':'Отличное','Good':'Хорошее','Average':'Среднее','Poor':'Плохое','Tags · comma separated':'Теги · через запятую','Notes':'Заметки','Screenshots':'Скриншоты',
  'Upload, drag an image here, or press Ctrl+V after making a Print Screen.':'Загрузите, перетащите изображение сюда или нажмите Ctrl+V после Print Screen.',
  'Before':'До','Management':'Сопровождение','Exit':'Выход','Other':'Другое','Uploading…':'Загрузка…','Add screenshot':'Добавить скриншот','Upload failed':'Ошибка загрузки','Legacy':'Legacy','Original screenshot':'Исходный скриншот','Delete screenshot':'Удалить скриншот',
  'Delete this screenshot?':'Удалить этот скриншот?','No screenshots yet. The easiest way: take a Print Screen and press Ctrl+V.':'Скриншотов пока нет. Проще всего: сделайте Print Screen и нажмите Ctrl+V.',
  'Notifications':'Уведомления','unread':'непрочитано','Read all':'Прочитать все','Loading…':'Загрузка…','No notifications yet.':'Уведомлений пока нет.','now':'сейчас',
  'Chart settings':'Настройки графика','Manual Levels':'Ручные уровни','Risk / Reward':'Риск / Прибыль','Trading overlays':'Торговые линии','Exchanges & accounts':'Биржи и аккаунты','Notifications settings':'Уведомления','Safety':'Безопасность','Recent system events':'Последние системные события','Reset local preferences':'Сброс локальных настроек',
  'Default risk %':'Риск по умолчанию, %','Default account':'Аккаунт по умолчанию','First available account':'Первый доступный аккаунт','Color':'Цвет','Auto contrast':'Автоконтраст','Custom':'Свой','Line width':'Толщина линии','Opacity':'Прозрачность','Show price label':'Показывать цену','Default R:R':'R:R по умолчанию','Default width · bars':'Ширина по умолчанию · бары','Snap to levels':'Привязка к уровням','Snap distance · px':'Дистанция привязки · px','Future space · bars':'Место справа · бары','Show grid':'Показывать сетку','Show current price line':'Показывать линию текущей цены','Auto-follow live':'Автоследование за LIVE','Reset saved chart views':'Сбросить сохранённые виды графика',
  'Show active orders':'Показывать активные ордера','Show open positions':'Показывать открытые позиции','Show Stop Loss':'Показывать Stop Loss','Show Take Profit':'Показывать Take Profit','Show executions':'Показывать исполнения','Show liquidation price':'Показывать цену ликвидации','Show account name':'Показывать имя аккаунта','Show order size':'Показывать размер ордера','Show PnL':'Показывать PnL','Labels':'Подписи','Full':'Полные','Compact':'Компактные','Price only':'Только цена','Order line':'Линия ордера','Position entry':'Вход позиции','Interaction':'Взаимодействие','Allow dragging pending order / trigger price':'Разрешить перетаскивать цену ожидающего ордера / триггера','Allow dragging Stop Loss':'Разрешить перетаскивать Stop Loss','Allow dragging Take Profit':'Разрешить перетаскивать Take Profit','Confirm chart trading changes before sending to exchange':'Подтверждать изменения с графика перед отправкой на биржу','Accounts shown on chart':'Аккаунты на графике',
  'All accounts overlay':'Все аккаунты','Order/Trigger/SL/TP lines come from the exchange and are separate from Manual Levels. Position Entry is read-only.':'Линии Order/Trigger/SL/TP приходят с биржи и не относятся к Manual Levels. Entry открытой позиции нельзя двигать.',
  'configured':'настроено','no keys':'нет ключей','No exchange accounts registered.':'Биржевые аккаунты не зарегистрированы.','Accounts are loaded from the SQLite registry. Binance / OKX adapters can be added later without changing Chart, Journal or Calculator.':'Аккаунты загружаются из SQLite. Binance / OKX можно добавить позже без изменения Chart, Journal или Calculator.',
  'connected':'подключён','not configured':'не настроен','Market notifications':'Рынок','Level reached':'Уровень достигнут','Pre-alert when approaching a level':'Предупреждать при приближении к уровню','Send market notifications to Telegram':'Отправлять рыночные уведомления в Telegram','Trading':'Торговля','Order accepted / New':'Ордер принят / New','Filled / TP / SL / close':'Filled / TP / SL / закрытие','Partial fill':'Частичное исполнение','Cancelled order':'Отменённый ордер','Rejected order':'Отклонённый ордер','Send trading notifications to Telegram':'Отправлять торговые уведомления в Telegram','Connection offline':'Соединение потеряно','Notify after · {seconds} sec':'Уведомить через · {seconds} сек','Notify when connection is restored':'Уведомлять о восстановлении соединения','Send system notifications to Telegram':'Отправлять системные уведомления в Telegram','Test in-app':'Тест в приложении','Test Telegram':'Тест Telegram','Saving…':'Сохранение…','Notification test failed':'Тест уведомления не удался','The bell in the top-right keeps an in-app history. Existing chart bells continue to define which price levels are monitored.':'Колокольчик справа сверху хранит историю. Колокольчики на графике по-прежнему задают отслеживаемые цены.',
  'API health':'Состояние API','Trading actions':'Торговые действия','ENABLED':'ВКЛЮЧЕНЫ','LOCKED':'ЗАБЛОКИРОВАНЫ','Default market':'Рынок по умолчанию','LIVE_TRADING_ENABLED is server-side and cannot be enabled from the browser.':'LIVE_TRADING_ENABLED задаётся на сервере и не включается из браузера.','No events yet.':'Событий пока нет.','This resets theme, chart appearance and calculator defaults. Trading data in SQLite is not touched.':'Сбрасывает тему, вид графика и настройки калькулятора. Торговые данные SQLite не затрагиваются.','Restore defaults':'Восстановить по умолчанию',
  'Manual':'Ручной','Support':'Поддержка','Resistance':'Сопротивление','Legacy calculator':'Legacy калькулятор','Trading actions are locked by LIVE_TRADING_ENABLED=false.':'Торговые действия заблокированы: LIVE_TRADING_ENABLED=false.','Place order':'Разместить ордер','Send to Bybit':'Отправить в Bybit',
  'Solid':'Сплошная','Dashed':'Штриховая','Dotted':'Точечная','same as interface':'как интерфейс',
};

const uk: Dict = {
  'Chart fullscreen':'Лише графік','Exit fullscreen':'Вийти з повноекранного режиму','Previous coin':'Попередня монета','Next coin':'Наступна монета','Timeframe':'Таймфрейм',
  'Chart':'Графік','Trade':'Торгівля','Alerts':'Сповіщення','Journal':'Щоденник','Settings':'Налаштування','private terminal':'приватний термінал',
  'English':'English','Українська':'Українська','Русский':'Русский','Language':'Мова','Interface language':'Мова інтерфейсу','General':'Загальні',
  'System':'Системна','Light':'Світла','Dark':'Темна','Theme':'Тема','Appearance':'Вигляд',
  'Market scanner · bars · automatic levels · persistent drawings':'Сканер ринку · бари · автоматичні рівні · збережені об’єкти',
  'Calculator':'Калькулятор','Select':'Вибір','Level':'Рівень','Risk/Reward':'Ризик/Прибуток','Alert':'Сповіщення',
  'Click repeatedly to save levels · Esc to finish':'Клацайте, щоб додавати рівні · Esc — завершити','Click repeatedly to create alerts · Esc to finish':'Клацайте, щоб додавати сповіщення · Esc — завершити','Click Entry → Stop · Target is created automatically':'Клік Entry → Stop · Target створюється автоматично','Click a level to send its price to Calculator':'Клікніть рівень, щоб передати ціну в калькулятор',
  'Visible levels':'Видимі рівні','Mirror':'Дзеркальні','Min 24h turnover':'Мін. оборот за 24г','Show auto levels':'Показувати авторівні','Search ticker…':'Пошук тікера…','Ticker':'Тікер','Turnover':'Оборот','No tickers match this filter.':'Немає тікерів за цим фільтром.','Modify exchange order':'Змінити біржовий ордер','Send change':'Надіслати зміну',
  'Trade calculator':'Торговий калькулятор','Invalid SL/TP geometry for {side}. Check Entry, Stop and Target.':'Неправильна геометрія SL/TP для {side}. Перевірте Entry, Stop і Target.','Account':'Акаунт','Side':'Сторона','Order':'Ордер','Buy':'Купівля','Sell':'Продаж','Trigger':'Тригер','Entry':'Вхід','Stop Loss':'Stop Loss','Take Profit':'Take Profit','Stop model':'Модель стопа','ATR calculated':'За ATR','Technical stop':'Технічний стоп','Price level':'Рівень ціни','Market calculations use the current market price; the selected level is kept here for reference.':'Для Market розрахунок іде за поточною ціною; вибраний рівень лишається для довідки.','Levels':'Рівні','No visible levels':'Немає видимих рівнів','Technical SL':'Технічний SL','Target R:R':'Цільовий R:R','Legacy strategy pointType: {value}':'Legacy pointType стратегії: {value}','Risk %':'Ризик %','Equity':'Equity','Risk amount':'Сума ризику','Stop':'Stop','Target':'Target','Position qty':'Розмір позиції','Notional':'Номінал','Prices and quantity are aligned to Bybit tickSize / qtyStep on the server before submission.':'Перед відправленням сервер округлює ціну та кількість за Bybit tickSize / qtyStep.','Confirm order':'Підтвердити ордер','Confirm':'Підтвердити','Cancel':'Скасувати','Close':'Закрити','Open on chart':'Відкрити на графіку',
  'Persistent price alerts watched by the Telegram worker':'Збережені цінові сповіщення, які відстежує Telegram worker','New alert':'Нове сповіщення','Symbol':'Тікер','Price':'Ціна','Condition':'Умова','Touch / cross':'Дотик / перетин','Cross up':'Перетин вгору','Cross down':'Перетин вниз','Pre-alert distance %':'Попереджати завчасно, %','Create alert':'Створити сповіщення','Telegram':'Telegram','No alerts yet. Add one here or click Alert on the chart.':'Сповіщень ще немає. Додайте тут або натисніть Alert на графіку.','triggered':'спрацювало',
  'Trade Control':'Керування торгівлею','Real-time positions, orders and fills across exchange accounts':'Позиції, ордери та виконання по акаунтах у реальному часі','All accounts':'Усі акаунти','Symbol filter':'Фільтр за тікером','Refresh':'Оновити','actions locked':'дії заблоковані','online':'онлайн','offline':'офлайн','Unrealized':'Нереалізований PnL','Positions / Orders':'Позиції / Ордери','Positions':'Позиції','Orders':'Ордери','Executions':'Виконання','History':'Історія','Size':'Розмір','Mark':'Mark','uPnL':'uPnL','SL':'SL','TP':'TP','Liq':'Лікв.','Actions':'Дії','Type':'Тип','Status':'Статус','Qty':'К-сть','Filled':'Виконано','Fee':'Комісія','Order ID':'ID ордера','Time':'Час','Cancel all':'Скасувати все','No data for the selected filters.':'Немає даних за вибраними фільтрами.','Liquidation':'Ліквідація','Trailing Stop distance':'Відстань Trailing Stop','Update SL / TP / Trail':'Оновити SL / TP / Trail','Move SL to breakeven':'Перенести SL у беззбиток','Emergency':'Екстрено','Close 50%':'Закрити 50%','Force close 100%':'Примусово закрити 100%','Flatten symbol':'Закрити все за тікером','Close all for {symbol}':'Закрити все за {symbol}','Emergency flatten':'Екстрений Flatten','Close position':'Закрити позицію','Cancel all orders':'Скасувати всі ордери','Cancel order':'Скасувати ордер','FLATTEN NOW':'FLATTEN ЗАРАЗ','New':'Новий','Cancelled':'Скасований','Rejected':'Відхилений','Untriggered':'Очікує тригера','PartiallyFilled':'Частково виконаний',
  'Journal subtitle':'Угоди, нотатки, скріншоти та аналітика','Trades':'Угоди','Analytics':'Аналітика','Date from':'Дата від','Date to':'Дата до','Long / Short':'Long / Short','Style':'Стиль','Entry type':'Тип входу','Winrate':'Вінрейт','Net R':'Підсумок R','Avg R':'Середній R','Profit Factor':'Profit Factor','Expectancy':'Очікування','Date':'Дата','Exchange':'Біржа','TP / Exit':'TP / Вихід','Setup':'Сетап','No journal entries for the selected filters.':'Немає записів щоденника за вибраними фільтрами.','Performance':'Результати','Average winner':'Середня прибуткова','Average loser':'Середня збиткова','Expectancy / trade':'Очікування / угода','Net result':'Підсумковий результат','By trading style':'За стилем торгівлі','By account':'За акаунтом','By entry type':'За типом входу','By setup':'За сетапом','Group':'Група','Point type':'Point type','Result R':'Результат R','Execution quality':'Якість виконання','Excellent':'Відмінна','Good':'Добра','Average':'Середня','Poor':'Погана','Tags · comma separated':'Теги · через кому','Notes':'Нотатки','Screenshots':'Скріншоти','Upload, drag an image here, or press Ctrl+V after making a Print Screen.':'Завантажте, перетягніть зображення сюди або натисніть Ctrl+V після Print Screen.','Before':'До','Management':'Супровід','Exit':'Вихід','Other':'Інше','Uploading…':'Завантаження…','Add screenshot':'Додати скріншот','Upload failed':'Помилка завантаження','Legacy':'Legacy','Original screenshot':'Оригінальний скріншот','Delete screenshot':'Видалити скріншот','Delete this screenshot?':'Видалити цей скріншот?','No screenshots yet. The easiest way: take a Print Screen and press Ctrl+V.':'Скріншотів ще немає. Найпростіше: зробіть Print Screen і натисніть Ctrl+V.',
  'Notifications':'Сповіщення','unread':'непрочитано','Read all':'Прочитати все','Loading…':'Завантаження…','No notifications yet.':'Сповіщень ще немає.','now':'зараз',
  'Chart settings':'Налаштування графіка','Manual Levels':'Ручні рівні','Risk / Reward':'Ризик / Прибуток','Trading overlays':'Торгові лінії','Exchanges & accounts':'Біржі та акаунти','Notifications settings':'Сповіщення','Safety':'Безпека','Recent system events':'Останні системні події','Reset local preferences':'Скидання локальних налаштувань','Default risk %':'Ризик за замовчуванням, %','Default account':'Акаунт за замовчуванням','First available account':'Перший доступний акаунт','Color':'Колір','Auto contrast':'Автоконтраст','Custom':'Свій','Line width':'Товщина лінії','Opacity':'Прозорість','Show price label':'Показувати ціну','Default R:R':'R:R за замовчуванням','Default width · bars':'Ширина за замовчуванням · бари','Snap to levels':'Прив’язка до рівнів','Snap distance · px':'Відстань прив’язки · px','Future space · bars':'Місце праворуч · бари','Show grid':'Показувати сітку','Show current price line':'Показувати лінію поточної ціни','Auto-follow live':'Автослідування за LIVE','Reset saved chart views':'Скинути збережені види графіка','Show active orders':'Показувати активні ордери','Show open positions':'Показувати відкриті позиції','Show Stop Loss':'Показувати Stop Loss','Show Take Profit':'Показувати Take Profit','Show executions':'Показувати виконання','Show liquidation price':'Показувати ціну ліквідації','Show account name':'Показувати назву акаунта','Show order size':'Показувати розмір ордера','Show PnL':'Показувати PnL','Labels':'Підписи','Full':'Повні','Compact':'Компактні','Price only':'Лише ціна','Order line':'Лінія ордера','Position entry':'Вхід позиції','Interaction':'Взаємодія','Allow dragging pending order / trigger price':'Дозволити перетягувати ціну очікуючого ордера / тригера','Allow dragging Stop Loss':'Дозволити перетягувати Stop Loss','Allow dragging Take Profit':'Дозволити перетягувати Take Profit','Confirm chart trading changes before sending to exchange':'Підтверджувати зміни з графіка перед надсиланням на біржу','Accounts shown on chart':'Акаунти на графіку','All accounts overlay':'Усі акаунти','Order/Trigger/SL/TP lines come from the exchange and are separate from Manual Levels. Position Entry is read-only.':'Лінії Order/Trigger/SL/TP надходять з біржі та не належать до Manual Levels. Entry відкритої позиції не можна рухати.','configured':'налаштовано','no keys':'немає ключів','No exchange accounts registered.':'Біржові акаунти не зареєстровані.','Accounts are loaded from the SQLite registry. Binance / OKX adapters can be added later without changing Chart, Journal or Calculator.':'Акаунти завантажуються з SQLite. Binance / OKX можна додати пізніше без зміни Chart, Journal або Calculator.','connected':'підключено','not configured':'не налаштовано','Market notifications':'Ринок','Level reached':'Рівень досягнуто','Pre-alert when approaching a level':'Попереджати при наближенні до рівня','Send market notifications to Telegram':'Надсилати ринкові сповіщення в Telegram','Trading':'Торгівля','Order accepted / New':'Ордер прийнято / New','Filled / TP / SL / close':'Filled / TP / SL / закриття','Partial fill':'Часткове виконання','Cancelled order':'Скасований ордер','Rejected order':'Відхилений ордер','Send trading notifications to Telegram':'Надсилати торгові сповіщення в Telegram','Connection offline':'З’єднання втрачено','Notify after · {seconds} sec':'Сповістити через · {seconds} сек','Notify when connection is restored':'Сповіщати про відновлення з’єднання','Send system notifications to Telegram':'Надсилати системні сповіщення в Telegram','Test in-app':'Тест у застосунку','Test Telegram':'Тест Telegram','Saving…':'Збереження…','Notification test failed':'Тест сповіщення не вдався','The bell in the top-right keeps an in-app history. Existing chart bells continue to define which price levels are monitored.':'Дзвіночок справа вгорі зберігає історію. Дзвіночки на графіку й надалі задають ціни для відстеження.','API health':'Стан API','Trading actions':'Торгові дії','ENABLED':'УВІМКНЕНО','LOCKED':'ЗАБЛОКОВАНО','Default market':'Ринок за замовчуванням','LIVE_TRADING_ENABLED is server-side and cannot be enabled from the browser.':'LIVE_TRADING_ENABLED задається на сервері та не вмикається з браузера.','No events yet.':'Подій ще немає.','This resets theme, chart appearance and calculator defaults. Trading data in SQLite is not touched.':'Скидає тему, вигляд графіка та налаштування калькулятора. Торгові дані SQLite не змінюються.','Restore defaults':'Відновити типові','Solid':'Суцільна','Dashed':'Штрихова','Dotted':'Крапкова','same as interface':'як інтерфейс',
};


Object.assign(ru, {
  'Freeze levels':'Зафиксировать уровни','Copies automatic levels currently visible on the chart into Manual Levels':'Копирует только видимые сейчас автоматические уровни в ручные.','Saved {count} visible levels':'Сохранено видимых уровней: {count}','All visible levels are already manual':'Все видимые уровни уже сохранены вручную.',
  'Neutral chart controls use automatic contrast, so white objects do not disappear on a light background.':'Нейтральные элементы графика используют автоконтраст, поэтому светлые объекты не пропадают на светлом фоне.',
  'Custom color':'Свой цвет',
  'R/R is created with two clicks: Entry → Stop. Direction is detected automatically and Target is created at the default R multiple.':'R/R создаётся двумя кликами: Entry → Stop. Направление определяется автоматически, а Target ставится по R по умолчанию.',
  'These are calculator defaults only. You can change risk for an individual trade without changing the default.':'Это только значения калькулятора по умолчанию. Риск отдельной сделки можно менять, не меняя настройку по умолчанию.',
  'Scanner preferences are stored locally and are shared with the sliders on the Chart page.':'Настройки сканера хранятся локально и используются теми же ползунками на странице графика.',
  'Follow live when already at the right edge':'Следовать за LIVE, если график уже у правого края',
  'Reset saved chart positions':'Сбросить сохранённые позиции графика',
  'Each symbol + timeframe remembers its own horizontal zoom and position in this browser.':'Каждый тикер + таймфрейм запоминает свой горизонтальный масштаб и позицию в этом браузере.',
  'Account display':'Отображение аккаунтов','Summary':'Сводно','Per account':'По аккаунтам','Summary across accounts':'Сводно по аккаунтам','Summary groups matching prices across accounts. Switch to Per account to drag one account separately.':'Сводный режим объединяет одинаковые торговые линии разных аккаунтов. Для изменения одного аккаунта переключитесь на «По аккаунтам».',
  'Label detail':'Детализация подписей','Show order / position size':'Показывать размер ордера / позиции','Show unrealized PnL on position label':'Показывать нереализованный PnL в подписи позиции','Lines':'Линии','Position':'Позиция','Loading notification preferences…':'Загрузка настроек уведомлений…',
  'Daily mirror + rejection':'Дневной mirror + отбой','FOMO, daily level, high volume':'FOMO, дневной уровень, высокий объём','What was the idea? What went well? What should change next time?':'В чём была идея? Что получилось хорошо? Что изменить в следующий раз?',
  'Auto':'Авто','Auto (recommended)':'Авто (рекомендуется)','Stop Market':'Stop Market','Auto selected: {type}':'Авто выбрало: {type}',
  'Automatic mode chooses Limit for pullbacks and Stop Market for breakouts.':'Авто использует Limit для входа на откате и Stop Market для входа на пробое.',
  'This Limit crosses the current market and may execute immediately. Auto would use {type}.':'Этот Limit пересекает текущую рыночную цену и может исполниться сразу. Авто использовало бы {type}.',
  'This Stop is already on the triggered side of the market. Auto would use {type}.':'Этот Stop уже находится на сработавшей стороне рынка. Авто использовало бы {type}.'
});

Object.assign(ru, {
  'All':'Все', 'Sort':'Сортировка', 'Newest first':'Сначала новые', 'Oldest first':'Сначала старые',
  'Most important first':'Сначала важные', 'Least important first':'Сначала менее важные', 'Date from':'Дата от', 'Date to':'Дата до',
  'Start date must not be later than end date.':'Начальная дата не может быть позже конечной.', 'Showing {from}–{to} of {total}':'Показано {from}–{to} из {total}',
  '0 results':'0 записей', 'Pagination':'Пагинация', 'First':'Первая', 'Previous':'Предыдущая', 'Next':'Следующая', 'Last':'Последняя', 'Rows per page':'Записей на странице',
  'of':'из',
});
Object.assign(uk, {
  'All':'Усі', 'Sort':'Сортування', 'Newest first':'Спочатку нові', 'Oldest first':'Спочатку старі',
  'Most important first':'Спочатку важливі', 'Least important first':'Спочатку менш важливі', 'Date from':'Дата від', 'Date to':'Дата до',
  'Start date must not be later than end date.':'Початкова дата не може бути пізнішою за кінцеву.', 'Showing {from}–{to} of {total}':'Показано {from}–{to} із {total}',
  '0 results':'0 записів', 'Pagination':'Пагінація', 'First':'Перша', 'Previous':'Попередня', 'Next':'Наступна', 'Last':'Остання', 'Rows per page':'Записів на сторінці',
  'of':'із',
});
Object.assign(uk, {
  'Freeze levels':'Зафіксувати рівні','Copies automatic levels currently visible on the chart into Manual Levels':'Копіює лише видимі зараз автоматичні рівні в ручні.','Saved {count} visible levels':'Збережено видимих рівнів: {count}','All visible levels are already manual':'Усі видимі рівні вже збережені вручну.',
  'Neutral chart controls use automatic contrast, so white objects do not disappear on a light background.':'Нейтральні елементи графіка використовують автоконтраст, тому світлі об’єкти не зникають на світлому фоні.',
  'Custom color':'Свій колір',
  'R/R is created with two clicks: Entry → Stop. Direction is detected automatically and Target is created at the default R multiple.':'R/R створюється двома кліками: Entry → Stop. Напрямок визначається автоматично, а Target ставиться за R за замовчуванням.',
  'These are calculator defaults only. You can change risk for an individual trade without changing the default.':'Це лише значення калькулятора за замовчуванням. Ризик окремої угоди можна змінювати без зміни типового значення.',
  'Scanner preferences are stored locally and are shared with the sliders on the Chart page.':'Налаштування сканера зберігаються локально й використовуються тими самими повзунками на сторінці графіка.',
  'Follow live when already at the right edge':'Слідувати за LIVE, якщо графік уже біля правого краю',
  'Reset saved chart positions':'Скинути збережені позиції графіка',
  'Each symbol + timeframe remembers its own horizontal zoom and position in this browser.':'Кожен тікер + таймфрейм запам’ятовує свій горизонтальний масштаб і позицію в цьому браузері.',
  'Account display':'Відображення акаунтів','Summary':'Зведено','Per account':'За акаунтами','Summary across accounts':'Зведено за акаунтами','Summary groups matching prices across accounts. Switch to Per account to drag one account separately.':'Зведений режим об’єднує однакові торгові лінії різних акаунтів. Щоб змінювати один акаунт окремо, перемкніться на «За акаунтами».',
  'Label detail':'Деталізація підписів','Show order / position size':'Показувати розмір ордера / позиції','Show unrealized PnL on position label':'Показувати нереалізований PnL у підписі позиції','Lines':'Лінії','Position':'Позиція','Loading notification preferences…':'Завантаження налаштувань сповіщень…',
  'Daily mirror + rejection':'Денний mirror + відбій','FOMO, daily level, high volume':'FOMO, денний рівень, високий обсяг','What was the idea? What went well? What should change next time?':'У чому була ідея? Що вийшло добре? Що змінити наступного разу?',
  'Auto':'Авто','Auto (recommended)':'Авто (рекомендовано)','Stop Market':'Stop Market','Auto selected: {type}':'Авто вибрало: {type}',
  'Automatic mode chooses Limit for pullbacks and Stop Market for breakouts.':'Авто використовує Limit для входу на відкаті та Stop Market для входу на пробої.',
  'This Limit crosses the current market and may execute immediately. Auto would use {type}.':'Цей Limit перетинає поточну ринкову ціну й може виконатися одразу. Авто використало б {type}.',
  'This Stop is already on the triggered side of the market. Auto would use {type}.':'Цей Stop уже знаходиться на спрацьованому боці ринку. Авто використало б {type}.'
});

Object.assign(ru, {
  'Create alert at level':'Создать алерт на уровне',
  'Alert already exists at this level':'На этом уровне уже есть алерт',
});
Object.assign(uk, {
  'Create alert at level':'Створити сповіщення на рівні',
  'Alert already exists at this level':'На цьому рівні вже є сповіщення',
});

const dictionaries: Record<AppLanguage, Dict> = { en: {}, uk, ru };

export function translate(language: AppLanguage, key: string, vars?: Vars): string {
  let value = dictionaries[language][key] || key;
  if (vars) for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

export function useI18n() {
  const { preferences } = usePreferences();
  const language = preferences.language;
  const t = useMemo(() => (key: string, vars?: Vars) => translate(language, key, vars), [language]);
  return { language, t };
}

export function languageLabel(language: AppLanguage) {
  if (language === 'uk') return 'Українська';
  if (language === 'ru') return 'Русский';
  return 'English';
}

export function localizeNotification<T extends {eventType:string;title:string;message:string;symbol?:string|null;accountName?:string|null;payload?:any}>(row:T, language:AppLanguage):T {
  const p=row.payload||{}; const symbol=row.symbol||p.symbol||'';
  let title=row.title, message=row.message;
  if(row.eventType==='notification.test') { title=language==='uk'?'Тестове сповіщення':language==='ru'?'Тестовое уведомление':'Test notification'; message=language==='uk'?'Центр сповіщень Trade App працює.':language==='ru'?'Центр уведомлений Trade App работает.':'Trade App notification center is working.'; }
  else if(row.eventType==='alert.pre') { title=language==='uk'?`${symbol} наближається до рівня`:language==='ru'?`${symbol} приближается к уровню`:`${symbol} approaching level`; if(p.level!=null&&p.price!=null) message=language==='uk'?`Рівень ${p.level}. Ціна ${p.price}.`:language==='ru'?`Уровень ${p.level}. Цена ${p.price}.`:`Level ${p.level}. Price ${p.price}.`; }
  else if(row.eventType==='alert.triggered') { title=language==='uk'?`${symbol} · рівень досягнуто`:language==='ru'?`${symbol} · уровень достигнут`:`${symbol} · level reached`; if(p.level!=null&&p.price!=null) message=language==='uk'?`Рівень ${p.level}. Поточна ціна ${p.price}.`:language==='ru'?`Уровень ${p.level}. Текущая цена ${p.price}.`:`Level ${p.level}. Current price ${p.price}.`; }
  else if(row.eventType.startsWith('order.')) {
    const status=row.eventType.slice(6);
    const titleMap:Record<string,[string,string,string]>={new:['Order accepted','Ордер прийнято','Ордер принят'],untriggered:['Conditional order accepted','Умовний ордер прийнято','Условный ордер принят'],filled:['Order filled','Ордер виконано','Ордер исполнен'],partiallyfilled:['Partial fill','Часткове виконання','Частичное исполнение'],cancelled:['Order cancelled','Ордер скасовано','Ордер отменён'],rejected:['Order rejected','Ордер відхилено','Ордер отклонён']};
    const names=titleMap[status]; if(names) title=language==='uk'?names[1]:language==='ru'?names[2]:names[0];
  }
  else if(row.eventType==='connection.offline') title=language==='uk'?'Проблема з’єднання':language==='ru'?'Проблема соединения':'Connection problem';
  else if(row.eventType==='connection.restored') title=language==='uk'?'З’єднання відновлено':language==='ru'?'Соединение восстановлено':'Connection restored';
  return {...row,title,message};
}


// EdgeDesk v15.15 — funding labels shown above the chart.
Object.assign(uk, {
  'Funding information':'Інформація про фінансування', 'Next':'Наступне',
  'Funding rate':'Ставка фінансування',
  'Longs pay shorts':'Лонги платять шортам',
  'Shorts pay longs':'Шорти платять лонгам',
  'Neutral funding rate':'Нульова ставка фінансування',
  'Next funding':'Наступне фінансування',
  'Estimated funding for open positions':'Орієнтовне фінансування за відкритими позиціями',
  'Estimate only. Final rate and position value may change before settlement.':'Це лише оцінка. Ставка та розмір позиції можуть змінитися до нарахування.',
  'Funding data unavailable':'Дані фінансування недоступні',
  'Long':'Лонг', 'Short':'Шорт',
});
Object.assign(ru, {
  'Funding information':'Информация о финансировании', 'Next':'Следующее',
  'Funding rate':'Ставка финансирования',
  'Longs pay shorts':'Лонги платят шортам',
  'Shorts pay longs':'Шорты платят лонгам',
  'Neutral funding rate':'Нулевая ставка финансирования',
  'Next funding':'Следующее финансирование',
  'Estimated funding for open positions':'Ориентировочное финансирование по открытым позициям',
  'Estimate only. Final rate and position value may change before settlement.':'Это только оценка. Ставка и размер позиции могут измениться до начисления.',
  'Funding data unavailable':'Данные финансирования недоступны',
  'Long':'Лонг', 'Short':'Шорт',
});

Object.assign(ru, {
  'Checklist':'Объяснение', 'Explain scores for {symbol}':'Показать объяснение оценок для {symbol}',
  'A dash means the feature was not confirmed; missing measurements are not zero.':'Прочерк означает, что признак не подтверждён; отсутствующие измерения не равны нулю.',
  'Confirmed':'Подтверждено', 'Not confirmed':'Не подтверждено', 'Observation time':'Время наблюдения',
  'Unsaved changes':'Есть несохранённые изменения', 'Watchlist symbol':'Монета в списке наблюдения', 'Watchlist is empty.':'Список наблюдения пуст.',
  'Enter a whole number from {min} to {max}.':'Введите целое число от {min} до {max}.', 'Enter a number from {min} to {max}.':'Введите число от {min} до {max}.',
  'Exit turnover must not exceed minimum turnover.':'Оборот для исключения не должен превышать минимальный оборот.',
  'Far retest must be greater than near retest.':'Дальний ретест должен быть больше ближнего.',
  'Reset distance must exceed approach distance.':'Дистанция сброса должна быть больше дистанции подхода.',
  'Far close distance must exceed near close distance.':'Дальнее закрытие должно быть дальше ближнего.',
  'Big bar threshold must exceed small bar threshold.':'Порог большого бара должен быть больше порога малого.',
  'Retry':'Повторить', 'Previously loaded data may be out of date.':'Ранее загруженные данные могут быть устаревшими.',
  'Select a symbol to open its chart; use the checklist button to explain the scores.':'Нажмите на монету, чтобы открыть график; кнопка объяснения показывает вклад каждого признака.',
  'Updated':'Обновлено', 'Up':'Вверх', 'Down':'Вниз', 'No symbols match this search.':'По этому запросу монеты не найдены.',
  'Waiting for the first scan. Check the universe and worker status.':'Ожидается первый анализ. Проверьте список монет и состояние процесса.',
  'No signals yet. Turn off Signals only to see all observations.':'Сигналов пока нет. Выключите «Только сигналы», чтобы увидеть все наблюдения.',
  'Newer observations':'Более новые наблюдения', 'Page':'Страница', 'Manual levels':'Ручные уровни', 'Yes':'Да', 'No':'Нет',
});
Object.assign(uk, {
  'Market scenarios at your chart levels':'Ринкові сценарії біля рівнів графіка',
  'Live monitor':'Поточний ринок','Signal feed':'Стрічка сигналів','symbols':'монет',
  'Source counts can overlap; total is deduplicated.':'Джерела можуть перетинатися; підсумок — унікальні монети.',
  'Last scan':'Останній аналіз','Next scan':'Наступний аналіз','Scanned':'Перевірено','Requests':'Запитів','Errors':'Помилок','Worker':'Процес',
  'Feature':'Ознака','Value':'Значення','Measurements and level cluster':'Метрики та кластер рівнів','Auto touches':'Автодотики','Strength':'Сила',
  'Score difference is too small for a directional alert.':'Різниця оцінок недостатня для спрямованого сигналу.',
  'Market Monitor enabled':'Market Monitor увімкнено','Always monitor manual levels':'Завжди включати ручні рівні','Telegram enabled':'Telegram увімкнено',
  'Universe mode':'Режим вибору монет','Min Telegram priority':'Мінімальний пріоритет Telegram',
  'Telegram also follows the global market notification setting. Analysis runs after each closed M5 bar.':'Telegram також враховує загальні налаштування ринкових сповіщень. Аналіз виконується після закриття кожної свічки M5.',
  'Advanced settings':'Розширені налаштування','Score weights':'Ваги ознак','Save settings':'Зберегти налаштування','Saved':'Збережено',
  'Only active Bybit USDT perpetual contracts enter the universe. Changes apply on the next scan.':'Аналізуються лише чинні безстрокові USDT-контракти Bybit. Зміни застосуються під час наступного аналізу.',
  'Enable Market Monitor in Settings to start collecting observations.':'Увімкніть Market Monitor у налаштуваннях, щоб почати збір спостережень.',
  'Signals only':'Лише сигнали','Latest':'Останні','Observation':'Спостереження','Open chart':'Відкрити графік','No observations yet.':'Спостережень поки немає.','Older observations':'Давніші спостереження',
  'Direction':'Напрямок','Move':'Рух','Level type':'Тип рівня','Distance':'Відстань','Approach':'Підхід','Breakout':'Пробій','Rejection':'Відбій','Priority':'Пріоритет','Last signal':'Останній сигнал',
  'Checklist':'Пояснення', 'Explain scores for {symbol}':'Показати пояснення оцінок для {symbol}',
  'A dash means the feature was not confirmed; missing measurements are not zero.':'Прочерк означає, що ознаку не підтверджено; відсутні вимірювання не дорівнюють нулю.',
  'Confirmed':'Підтверджено', 'Not confirmed':'Не підтверджено', 'Observation time':'Час спостереження',
  'Unsaved changes':'Є незбережені зміни', 'Watchlist symbol':'Монета у списку спостереження', 'Watchlist is empty.':'Список спостереження порожній.',
  'Enter a whole number from {min} to {max}.':'Введіть ціле число від {min} до {max}.', 'Enter a number from {min} to {max}.':'Введіть число від {min} до {max}.',
  'Exit turnover must not exceed minimum turnover.':'Оборот для виключення не має перевищувати мінімальний оборот.',
  'Far retest must be greater than near retest.':'Дальній ретест має бути більшим за ближній.',
  'Reset distance must exceed approach distance.':'Дистанція скидання має бути більшою за дистанцію підходу.',
  'Far close distance must exceed near close distance.':'Далеке закриття має бути далі за близьке.',
  'Big bar threshold must exceed small bar threshold.':'Поріг великого бара має бути більшим за поріг малого.',
  'Retry':'Повторити', 'Previously loaded data may be out of date.':'Раніше завантажені дані можуть бути застарілими.',
  'Select a symbol to open its chart; use the checklist button to explain the scores.':'Натисніть на монету, щоб відкрити графік; кнопка пояснення показує внесок кожної ознаки.',
  'Updated':'Оновлено', 'Up':'Вгору', 'Down':'Вниз', 'No symbols match this search.':'За цим запитом монет не знайдено.',
  'Waiting for the first scan. Check the universe and worker status.':'Очікується перший аналіз. Перевірте список монет і стан процесу.',
  'No signals yet. Turn off Signals only to see all observations.':'Сигналів поки немає. Вимкніть «Лише сигнали», щоб побачити всі спостереження.',
  'Newer observations':'Новіші спостереження', 'Page':'Сторінка', 'Manual levels':'Ручні рівні', 'Yes':'Так', 'No':'Ні',
});
