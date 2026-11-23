# Tasks: Prizma Calendar V1

План: [plan.md](plan.md) · Спеки: [../spec/](../spec/)

Проверка в каждой задаче, помимо своей: `npm test` и `npm run typecheck` зелёные.
Это стандартная планка, ниже она не повторяется.

---

## Фаза 0: Фундамент и быстрые провалы

### Task 1 ✅: Запустить тесты и подтвердить движок повторов

**Description:** Выяснить, работает ли `npm test` на Node 24 с нативным срезанием типов,
и прогнать 19 уже написанных тестов повторов. Это первая задача, потому что от неё зависят
тесты всех остальных модулей, а допущение непроверенное.

**Acceptance criteria:**
- [ ] `npm test` запускается и находит тесты (шаблон раскрывается в PowerShell)
- [ ] Все 19 тестов `test/recurrence.test.ts` проходят, либо на каждый провал есть разбор причины и исправление в `recurrence.ts`
- [ ] `npm run typecheck` без ошибок

**Verification:**
- [ ] Тесты: `npm test`
- [ ] Типы: `npm run typecheck`
- [ ] Руками: вывод прогона приложен в ответе целиком, включая падения

**Dependencies:** None

**Files likely touched:** `package.json`, `src/lib/recurrence.ts`, `test/recurrence.test.ts`

**Estimated scope:** S (1–2 файла, если тесты проходят; M, если движок придётся править)

---

### Task 2: Спайк: проверить CORS на ICS-ленте

**Description:** Подтвердить фактом, что браузер не даёт прочитать внешнюю ICS-ленту без
заголовка CORS, и проверить, работает ли лента с разрешающим CORS. От результата зависит,
что обещать в интерфейсе и насколько рано нужны обёртки платформ.

**Acceptance criteria:**
- [ ] Поведение запроса к ленте из браузера зафиксировано: какая ошибка, на каком хосте
- [ ] Найдена или признана отсутствующей лента с разрешающим CORS, пригодная для проверки Task 15
- [ ] Результат записан в [plan.md](plan.md) — раздел рисков обновлён фактом

**Verification:**
- [ ] Руками: запрос из консоли браузера, текст ошибки приложен
- [ ] Ревью: если CORS закрывает всё, порядок фаз 4 и 6 пересматривается с человеком

**Dependencies:** None (независима от Task 1, можно параллельно)

**Files likely touched:** `tasks/plan.md`

**Estimated scope:** XS

> **Блокируется решением человека:** нужен URL ленты. По границе «Ask first» новый хост
> требует одобрения. См. открытый вопрос 1 в [plan.md](plan.md#open-questions).

---

### Task 3 ✅: Хранилище: схема, репозиторий, tombstone, засев

**Description:** Реализовать `storage` по [SPEC-storage.md](../spec/SPEC-storage.md):
база `prizma` версии 1 на `idb`, четыре хранилища с индексами, операции репозитория,
удаление через tombstone, полный дамп, засев при первом запуске.

**Acceptance criteria:**
- [ ] Все 9 критериев [SPEC-storage.md](../spec/SPEC-storage.md#success-criteria) выполнены
- [ ] `put` сам проставляет `uid` и `updatedAt`; `remove` ставит `deletedAt`, а не удаляет
- [ ] `exportDump`/`importDump` в режимах `replace` и `merge`

**Verification:**
- [ ] Тесты: `node --test test/storage.test.ts` — круг put → get → remove → export → import
- [ ] Руками: открыть приложение дважды, убедиться, что календари не задвоились

**Dependencies:** Task 1 (нужен работающий прогон тестов)

**Files likely touched:** `src/lib/db.ts`, `src/lib/seed.ts`, `test/storage.test.ts`, `package.json`

**Estimated scope:** M

> Ставит одобренную зависимость `fake-indexeddb` (dev).

---

### Task 4 ✅: Выборка вхождений и раскладка пересечений

**Description:** `src/lib/occurrences.ts`: `queryOccurrences` разворачивает события на интервал,
подставляет цвет календаря и отсекает скрытое и удалённое; `layoutDay` раскладывает
пересекающиеся события по ширине колонки.

**Acceptance criteria:**
- [ ] Критерии 2–7 и 11 из [SPEC-calendar-core.md](../spec/SPEC-calendar-core.md#success-criteria) выполнены
- [ ] Вхождение, начавшееся до интервала и заходящее в него, попадает в результат
- [ ] Событие короче 30 минут получает высоту как 30 минут

**Verification:**
- [ ] Тесты: `node --test test/occurrences.test.ts`
- [ ] Тест производительности: разворачивание серии от 2000 года на месяце 2026 — не более 100 итераций

**Dependencies:** Task 1

**Files likely touched:** `src/lib/occurrences.ts`, `test/occurrences.test.ts`

**Estimated scope:** M

---

> ### Checkpoint: Фундамент
> - [ ] `npm test` зелёный: повторы, хранилище, выборка
> - [ ] `npm run typecheck` без ошибок
> - [ ] Поведение CORS зафиксировано, план поправлен при необходимости
> - [ ] **Ревью с человеком перед продолжением**

---

## Фаза 1: Календарь видно

### Task 5 ✅: Токены темы, оболочка приложения, стор

**Description:** CSS-переменные темы и палитра 10 цветов календарей; стор zustand с загрузкой
из `db.ts` и оптимистичной записью; оболочка: заголовок с навигацией по интервалу,
переключатель видов, боковая панель календарей.

**Acceptance criteria:**
- [ ] Стор поднимает календари, события и настройки из базы при старте
- [ ] Правка применяется в сторе сразу, пишется в базу после, ошибка откатывает
- [ ] Загружаемый интервал — вид ±месяц
- [ ] Видимость календаря переключается и влияет на выборку

**Verification:**
- [ ] Сборка: `npm run build`
- [ ] Руками: приложение открывается, панель календарей показывает засеянные календари

**Dependencies:** Task 3, Task 4

**Files likely touched:** `src/store/useStore.ts`, `src/styles/theme.css`, `src/lib/colors.ts`, `src/App.tsx`, `src/main.tsx`

**Estimated scope:** M

---

### Task 6 ✅: Вид месяца на реальных данных

**Description:** Сетка 6×7 из `monthGrid`, до трёх событий в дне и «+N» дальше, подсветка
сегодняшнего дня, листание месяцев.

**Acceptance criteria:**
- [ ] Засеянные события видны в своих днях
- [ ] День с четырьмя и более событиями показывает три и «+N»
- [ ] Листание вперёд и назад без мигания и видимой задержки
- [ ] Сегодняшний день выделен

**Verification:**
- [ ] Руками: критерий 14 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria)
- [ ] Сборка: `npm run build`

**Dependencies:** Task 5

**Files likely touched:** `src/components/month/MonthView.tsx`, `src/components/month/MonthCell.tsx`, `src/components/EventChip.tsx`

**Estimated scope:** M

---

> ### Checkpoint: Календарь видно
> - [ ] Засеянные события видны в месяце, листание работает
> - [ ] `npm run build` проходит

---

## Фаза 2: Событие живёт полный цикл

### Task 7 ✅: Виды недели и дня с сеткой часов

**Description:** Колонки дней с сеткой часов от `dayStartHour` до `dayEndHour`, строка
«весь день» сверху, линия текущего времени, прокрутка к текущему часу при открытии.
Раскладка берётся из `layoutDay`.

**Acceptance criteria:**
- [ ] Неделя и день показывают те же события, что месяц
- [ ] Два пересекающихся события делят ширину пополам и оба читаемы
- [ ] Линия текущего времени на правильной высоте
- [ ] События на весь день в отдельной строке, не в сетке часов

**Verification:**
- [ ] Руками: критерии 1, 7, 8 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria)

**Dependencies:** Task 6

**Files likely touched:** `src/components/week/WeekView.tsx`, `src/components/week/DayColumn.tsx`, `src/components/week/HourGutter.tsx`, `src/components/week/AllDayRow.tsx`

**Estimated scope:** M

---

### Task 8 ✅: Редактор события: создание, правка, удаление

**Description:** Панель редактора — снизу на телефоне, справа на широком экране. Поля:
название, календарь, «весь день», начало и конец, место, описание. Создание, сохранение,
удаление.

**Acceptance criteria:**
- [ ] Событие создаётся, правится и удаляется; изменения видны в сетке сразу
- [ ] Переключение «весь день» корректно меняет формат времени и исключающий конец
- [ ] Панель закрывается по `Esc`; события из ленты открываются только на чтение
- [ ] Нет `alert`, `confirm`, `prompt`

**Verification:**
- [ ] Руками: создать, изменить, удалить событие; перезагрузить и убедиться, что сохранилось

**Dependencies:** Task 7

**Files likely touched:** `src/components/editor/EventEditor.tsx`, `src/components/editor/fields/*.tsx`, `src/store/useStore.ts`

**Estimated scope:** M

---

### Task 9 ✅: Прямое управление: клик, протягивание, перенос, растягивание

**Description:** Pointer Events с `setPointerCapture` — одна ветка кода на мышь и палец.
Клик по пустому месту создаёт событие, протягивание задаёт длину, событие переносится
и растягивается за края, с прилипанием к `snapMinutes`.

**Acceptance criteria:**
- [ ] Критерии 2–5 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria) выполнены
- [ ] Прилипание к 15 минутам при переносе и растягивании
- [ ] Растягивание за нижний край не двигает начало, за верхний — не двигает конец
- [ ] Перенос в месяце меняет дату, сохраняя время

**Verification:**
- [ ] Руками: мышью и на тач-эмуляции в DevTools
- [ ] Тесты: расчёт нового времени по смещению указателя — чистая функция, покрыта тестом

**Dependencies:** Task 8

**Files likely touched:** `src/components/week/useDragOccurrence.ts`, `src/lib/drag.ts`, `src/components/week/DayColumn.tsx`, `test/drag.test.ts`

**Estimated scope:** M

> Если расползается за 5 файлов — делится на «перенос» и «растягивание». Это ожидаемое
> деление, см. риски в [plan.md](plan.md#risks-and-mitigations).

---

### Task 10 ✅: Повторы в интерфейсе и режимы правки серии

**Description:** Быстрый выбор правила из `presetRules` и своё правило в редакторе;
три режима правки серии (`this` / `following` / `series`) из
[SPEC-calendar-core.md](../spec/SPEC-calendar-core.md#requirements) с вопросом перед записью.

**Acceptance criteria:**
- [ ] Критерии 8–10 из [SPEC-calendar-core.md](../spec/SPEC-calendar-core.md#success-criteria) выполнены
- [ ] Перенос повторяющегося события спрашивает режим до записи
- [ ] «Это вхождение» не меняет остальные; «это и следующие» колет серию по `UNTIL`
- [ ] Описание правила в редакторе читаемо (`describeRule`)

**Verification:**
- [ ] Тесты: `node --test test/series-edit.test.ts` — три режима на уровне логики
- [ ] Руками: критерий 6 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria)

**Dependencies:** Task 9

**Files likely touched:** `src/lib/series.ts`, `src/components/editor/RecurrenceField.tsx`, `src/components/editor/SeriesScopeDialog.tsx`, `test/series-edit.test.ts`

**Estimated scope:** M

---

> ### Checkpoint: Событие живёт полный цикл
> - [ ] Критерии 3–6 из [SPEC.md](../spec/SPEC.md#success-criteria) выполнены
> - [ ] Правка одного вхождения не задевает остальные
> - [ ] **Ревью с человеком перед продолжением**

---

## Фаза 3: Задачи и напоминания

### Task 11 ✅: Задачи: логика, панель, строка «весь день»

**Description:** `src/lib/tasks.ts` с просроченностью, сортировкой и дробным `order`;
боковая панель со списком и показ задач с дедлайном в строке «весь день» по настройке.

**Acceptance criteria:**
- [ ] Все 8 критериев [SPEC-tasks.md](../spec/SPEC-tasks.md#success-criteria) выполнены
- [ ] Настройка «показывать задачи в сетке» работает в обе стороны
- [ ] Отметка выполнения убирает задачу из сетки с анимацией

**Verification:**
- [ ] Тесты: `node --test test/tasks.test.ts` — просроченность, сортировка, `order`
- [ ] Руками: критерии 9–10 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria)

**Dependencies:** Task 5 (независима от Task 9–10, можно параллельно)

**Files likely touched:** `src/lib/tasks.ts`, `src/components/tasks/TaskPanel.tsx`, `src/components/tasks/TaskRow.tsx`, `test/tasks.test.ts`

**Estimated scope:** M

---

### Task 12 ✅: Напоминания: планировщик и уведомления

**Description:** Один таймер на ближайшее срабатывание, пересчёт по событиям из
[SPEC-reminders.md](../spec/SPEC-reminders.md), дедупликация, окно 5 минут для пропущенных,
запрос разрешения по жесту. Интерфейс `NotificationSink` — точка подмены для мобильных.

**Acceptance criteria:**
- [ ] Все 9 критериев [SPEC-reminders.md](../spec/SPEC-reminders.md#success-criteria) выполнены
- [ ] `NotificationSink` определён как интерфейс, веб-реализация по умолчанию
- [ ] В настройках есть строка о негарантированности веб-уведомлений при закрытом приложении

**Verification:**
- [ ] Тесты: `node --test test/reminders.test.ts` — расчёт расписания на поддельных часах
- [ ] Руками: критерий 7 из [SPEC.md](../spec/SPEC.md#success-criteria)

**Dependencies:** Task 11

**Files likely touched:** `src/lib/reminders.ts`, `src/lib/notificationSink.ts`, `src/components/settings/NotificationSettings.tsx`, `test/reminders.test.ts`

**Estimated scope:** M

---

> ### Checkpoint: Задачи и напоминания
> - [ ] Критерии 6–7 из SPEC.md выполнены
> - [ ] `npm test` зелёный, добавлены тесты задач и напоминаний

---

## Фаза 4: Внешний мир

### Task 13 ✅: Разбор ICS

**Description:** `parseIcs` по таблице особенностей формата из
[SPEC-ics-sync.md](../spec/SPEC-ics-sync.md#requirements). Тесты — на фикстурах, до реализации.
Битая запись пропускается, разбор продолжается, число пропущенных возвращается.

**Acceptance criteria:**
- [ ] Критерии 1–8 из [SPEC-ics-sync.md](../spec/SPEC-ics-sync.md#success-criteria) выполнены
- [ ] Один сломанный `VEVENT` среди трёх даёт два события и счётчик пропущенных
- [ ] `VTODO`, `VALARM`, `VTIMEZONE` пропускаются, не ломая разбор

**Verification:**
- [ ] Тесты: `node --test test/ics-parse.test.ts` на фикстурах в `test/fixtures/*.ics`

**Dependencies:** Task 1 (независима от интерфейса, можно параллельно с фазой 2)

**Files likely touched:** `src/lib/ics.ts`, `test/ics-parse.test.ts`, `test/fixtures/*.ics`

**Estimated scope:** M

---

### Task 14 ✅: Генерация ICS, круговой тест, экспорт файла

**Description:** `serializeIcs` со складыванием строк на 75 октетах и `\r\n`; круговой тест
разбор↔генерация; кнопка экспорта в интерфейсе.

**Acceptance criteria:**
- [ ] Критерии 9–10 из [SPEC-ics-sync.md](../spec/SPEC-ics-sync.md#success-criteria) выполнены
- [ ] `parseIcs(serializeIcs(x))` равно `x` по названию, времени, «весь день» и правилу повтора
- [ ] Экспортированный файл скачивается из интерфейса

**Verification:**
- [ ] Тесты: `node --test test/ics-serialize.test.ts`
- [ ] Руками: критерий 15 — открыть экспорт в Google Calendar

**Dependencies:** Task 13

**Files likely touched:** `src/lib/ics.ts`, `src/components/settings/ExportPanel.tsx`, `test/ics-serialize.test.ts`

**Estimated scope:** M

---

### Task 15 ✅: Подписка на ленту: обновление, дедупликация, ошибки

**Description:** Календарь `kind: 'ics-feed'`, загрузка через подменяемый интерфейс загрузчика,
сверка по `uid` (новые, изменённые, исчезнувшие), расписание `refreshMinutes`, `lastSyncError`
в интерфейсе. Понятное сообщение при ошибке CORS с предложением импортировать файлом.

**Acceptance criteria:**
- [ ] Критерии 11–14 из [SPEC-ics-sync.md](../spec/SPEC-ics-sync.md#success-criteria) выполнены
- [ ] Интерфейс загрузчика определён как точка подмены для обёрток
- [ ] Ошибка CORS объяснена пользователем понятным текстом, прошлые события не удалены
- [ ] События ленты помечены только для чтения и не правятся

**Verification:**
- [ ] Тесты: сверка по `uid` на поддельном загрузчике — `node --test test/feed-sync.test.ts`
- [ ] Руками: критерий 8 из [SPEC.md](../spec/SPEC.md#success-criteria) на ленте из Task 2

**Dependencies:** Task 14, Task 2

**Files likely touched:** `src/lib/feed.ts`, `src/lib/fetcher.ts`, `src/components/settings/FeedPanel.tsx`, `test/feed-sync.test.ts`

**Estimated scope:** M

---

### Task 16 ✅: Полный дамп: экспорт и импорт

**Description:** Кнопки экспорта и импорта полного дампа в настройках, поверх
`exportDump`/`importDump` из Task 3, с выбором режима `replace` или `merge`.

**Acceptance criteria:**
- [ ] Дамп скачивается и загружается обратно, состояние восстанавливается один в один
- [ ] Режим `merge` объясняет, что произойдёт, до записи
- [ ] Импорт показывает сводку (сколько календарей, событий, задач) до применения

**Verification:**
- [ ] Руками: критерий 9 из [SPEC.md](../spec/SPEC.md#success-criteria) — экспорт, очистка, импорт

**Dependencies:** Task 3

**Files likely touched:** `src/components/settings/BackupPanel.tsx`, `src/lib/db.ts`

**Estimated scope:** S

---

> ### Checkpoint: Внешний мир
> - [ ] Критерии 8–9 из SPEC.md выполнены
> - [ ] Экспорт открыт в Google Calendar без ошибок
> - [ ] **Ревью с человеком перед продолжением**

---

## Фаза 5: Виды и отделка

### Task 17 ✅: Вид список и поиск

**Description:** Плоский список вхождений вперёд от курсора с группировкой по дням;
поиск по `/` по названию, описанию и месту в загруженном интервале.

**Acceptance criteria:**
- [ ] Список показывает те же события, что остальные виды
- [ ] Поиск открывается по `/`, результат ведёт к дате
- [ ] Пустой результат объяснён текстом, а не пустым экраном

**Verification:**
- [ ] Руками: критерий 1 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria)

**Dependencies:** Task 7

**Files likely touched:** `src/components/agenda/AgendaView.tsx`, `src/components/Search.tsx`

**Estimated scope:** M

---

### Task 18 ✅: Светлая тема и контраст

**Description:** Светлая тема переключателем плюс «как в системе», на CSS-переменных.
Проверка контраста текста на блоках событий в обеих темах.

**Acceptance criteria:**
- [ ] Критерий 11 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria) выполнен
- [ ] Контраст текста на блоке события не ниже 4.5:1 во всех 10 цветах и обеих темах
- [ ] Выбор темы сохраняется в настройках

**Verification:**
- [ ] Руками: проверка контраста пипеткой или DevTools по всем 10 цветам
- [ ] Руками: переключение темы и перезагрузка

**Dependencies:** Task 5

**Files likely touched:** `src/styles/theme.css`, `src/lib/colors.ts`, `src/components/settings/ThemeToggle.tsx`

**Estimated scope:** M

---

### Task 19 ✅: Клавиатура и раскладка на 375 px

**Description:** Таблица горячих клавиш из [SPEC-ui.md](../spec/SPEC-ui.md#клавиатура);
проверка и правка раскладки на узком экране, редактор снизу, отступы безопасной зоны.

**Acceptance criteria:**
- [ ] Все клавиши из таблицы работают
- [ ] Критерии 12–13 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria) выполнены
- [ ] Таб обходит все интерактивные элементы, фокус виден

**Verification:**
- [ ] Руками: пройти все клавиши; эмуляция 375 px в DevTools; обход табом без мыши

**Dependencies:** Task 17

**Files likely touched:** `src/lib/hotkeys.ts`, `src/App.tsx`, `src/styles/theme.css`, `src/components/editor/EventEditor.tsx`

**Estimated scope:** M

---

> ### Checkpoint: Виды и отделка
> - [ ] Критерии 11–13 из [SPEC-ui.md](../spec/SPEC-ui.md#success-criteria) выполнены
> - [ ] Контраст не ниже 4.5:1 в обеих темах

---

## Фаза 6: Платформы

### Task 20 ✅: PWA: иконки, офлайн, плашки обновления и установки

**Description:** Сгенерировать иконки из одного SVG скриптом, проверить офлайн-работу,
добавить плашку обновления и предложение установки со второго визита.

**Acceptance criteria:**
- [ ] Все 8 критериев [SPEC-shell-web.md](../spec/SPEC-shell-web.md#success-criteria) выполнены
- [ ] Страница не перезагружается без действия пользователя
- [ ] Созданное офлайн событие остаётся после перезагрузки

**Verification:**
- [ ] Сборка: `npm run build`, затем `npm run preview`
- [ ] Руками: установка в Chrome, отключение сети, создание события, перезагрузка

**Dependencies:** Task 19

**Files likely touched:** `scripts/icons.mjs`, `public/favicon.svg`, `src/components/UpdatePrompt.tsx`, `src/components/InstallPrompt.tsx`

**Estimated scope:** M

---

### Task 21 ✅: Tauri: конфиг, нативный загрузчик лент, README

**Description:** `src-tauri/` с конфигом и минимальными разрешениями; подстановка нативного
загрузчика лент в точку из Task 15; раздел в `README.md` с требованиями и командами.

**Acceptance criteria:**
- [ ] Критерии 1–5 из [SPEC-shell-desktop.md](../spec/SPEC-shell-desktop.md#success-criteria) выполнены
- [ ] `capabilities` перечисляет только сеть для хостов лент, диалоги файлов, уведомления
- [ ] `README.md` прямо говорит, что здесь сборка не запускалась и бинарников нет

**Verification:**
- [ ] Руками: проверка `tauri.conf.json` по схеме
- [ ] Руками: веб-сборка открывается из `file://` без ошибок путей
- [ ] **Непроверяемо здесь:** запуск окна, подписки без CORS, установщики

**Dependencies:** Task 15, Task 20

**Files likely touched:** `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src/lib/fetcher.ts`, `README.md`

**Estimated scope:** M

> Ставит одобренные `@tauri-apps/cli`, `@tauri-apps/api`, `tauri-plugin-http`.

---

### Task 22 ✅: Capacitor: конфиг, нативные уведомления и загрузчик, README

**Description:** `capacitor.config.ts`; подстановка `LocalNotifications` в `NotificationSink`
из Task 12 и `CapacitorHttp` в загрузчик из Task 15; предел 64 напоминания; раздел в `README.md`.

**Acceptance criteria:**
- [ ] Все 6 критериев [SPEC-shell-mobile.md](../spec/SPEC-shell-mobile.md#success-criteria) выполнены
- [ ] Подстановки не требуют правок `reminders.ts` и `ics.ts`
- [ ] `README.md` прямо говорит, что здесь сборка не запускалась и сборок для сторов нет

**Verification:**
- [ ] Типы: `npm run typecheck` с подключёнными пакетами Capacitor
- [ ] **Непроверяемо здесь:** запуск на устройстве, нативные уведомления, ленты без CORS

**Dependencies:** Task 21 (только из-за общей точки загрузчика; иначе параллельна)

**Files likely touched:** `capacitor.config.ts`, `src/lib/notificationSink.ts`, `src/lib/fetcher.ts`, `src/lib/reminders.ts`, `README.md`

**Estimated scope:** M

---

> ### Checkpoint: Complete
> - [ ] Все 12 критериев [SPEC.md](../spec/SPEC.md#success-criteria) проверены
> - [ ] Явно перечислено непроверенное: сборки десктопа и мобильных
> - [ ] Готово к ревью
