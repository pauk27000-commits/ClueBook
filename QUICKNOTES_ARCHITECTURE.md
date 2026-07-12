# Архитектура и Документация модуля QuickNotes (AI Developer Guide)

Этот документ является **Базой Знаний (Knowledge Base)** для ИИ-ассистентов и разработчиков, работающих над модулем `notebook` (QuickNotes) для Foundry VTT. Здесь подробно описана архитектура, принятые решения и пути к основным функциям.

## 1. Общая Концепция и Технологии
- **Среда:** Foundry VTT (V12+).
- **API:** Модуль полностью написан на базе **ApplicationV2 API** (`foundry.applications.api.ApplicationV2`). Старые классы `FormApplication` и `Application` здесь не используются для основного интерфейса.
- **Шаблонизатор:** Handlebars (`.hbs`). В ApplicationV2 используется примесь `HandlebarsApplicationMixin`.
- **Стилизация:** Чистый CSS (`style.css`), без препроцессоров. Активно используется CSS-grid, flexbox и CSS variables (напр., `var(--qn-accent)`).

## 2. Структура Файлов
- `module.json` — манифест.
- `scripts/main.js` — Точка входа. Содержит:
  - Инициализация хуков `Hooks.once("init")` и `Hooks.once("ready")`.
  - Внедрение плавающего виджета (Widget) на экран (`#quicknotes-widget`).
  - Слушатели сокетов (вызов `QuickNotesSocket.init()`).
  - Слушатель `Hooks.on("updateJournalEntry")` для Live Sync обновления UI у других игроков.
- `scripts/app.js` — Главный класс `QuickNotesApp` (ApplicationV2). Сердце модуля.
  - Содержит все экшены `actions` (напр., `onEditWorkspace`, `onSortTimeline`, `onJumpToLinked`).
  - Логику Drag-and-Drop (нативная HTML5, методы `_onDragStart`, `_onDrop`).
  - Рендеринг бесконечной доски (`_onWheel`, `_onPointerDown`, `_onPointerMove` внутри `#bindBoardEvents`).
- `scripts/socket.js` — Обработка сокетов. Класс `QuickNotesSocket` перенаправляет запросы от игроков (напр., обновление прав доступа к доске) к активному GM, чтобы обойти ограничения Foundry на изменение `ownership`.
- `scripts/calendar.js` — Виджет календаря (Simple Calendar integration).
- `templates/content.hbs` — Единый шаблон содержимого (все вкладки: notes, npc, quests, timeline, board, settings).
- `templates/tabs.hbs` — Навигационное меню слева.

## 3. Модель Данных (Хранение)
Данные никогда не сохраняются в файлы локально, они живут внутри флагов (`flags.notebook.data`).

### 3.1. Разделение рабочих пространств
Модуль поддерживает "Личные блокноты" и "Общие доски":
1. **Личный блокнот (`personal`)**: Сохраняется в `game.user.getFlag("notebook", "data")`. Только игрок-владелец и GM имеют к нему доступ.
2. **Общая доска (Shared Board)**: Это `JournalEntry` внутри папки "QuickNotes Boards". Данные хранятся в `journal.getFlag("notebook", "data")`. Переключение досок меняет `this.state.activeWorkspace`.

### 3.2. Формат объекта Data
```javascript
{
  notes: {
    "id_123": { text: "HTML текст...", color: "yellow", sort: 0, onBoard: true, boardX: 100, boardY: 200, dismissedLinks: ["id_npc"] }
  },
  npc: {
    "id_npc": { name: "Мэр", location: "Город", attitude: "Враг", note: "Описание...", sort: 1 }
  },
  quests: { ... },
  timeline: { ... },
  links: [
    { source: "id_123", target: "id_npc", label: "Связь" }
  ]
}
```

## 4. Решения и Особенности (AI Cheat Sheet)

### 4.1. Обновление интерфейса (Реактивность)
- В ApplicationV2 нет автоматической двусторонней привязки (two-way binding).
- После изменения данных в БД мы вызываем `this.render({ parts: ["content"] })` для обновления UI.
- Для плавности ввода текста используется *Debounce*:
  - В `app.js` метод `#onInputChange` сохраняет данные через `foundry.utils.debounce`, чтобы не спамить БД и не перерендеривать окно во время печати.

### 4.2. Drag & Drop на Доске (Board Canvas)
- Карточки на доске абсолютно позиционированы.
- Сохранение координат происходит *только при отпускании мыши* (`pointerup`), а перемещение во время `pointermove` делается напрямую через `element.style.transform = translate(...)` для максимальной производительности (60fps), без записи в БД.
- Если игрок "отправляет на доску" карточку (кнопка `sendToBoard`), она получает флаг `onBoard: true` и центрируется относительно текущего `panX`/`panY` доски.

### 4.3. Сокеты и Права Игроков
- Игроки могут переименовывать общие доски и выдавать/забирать доступ у других игроков (checkboxes в `#onEditWorkspace`).
- Поскольку `journal.update({ ownership })` работает только у GM, в `app.js` мы делаем вызов:
  `QuickNotesSocket.updateBoard(journalId, newName, ownership)`
  Если это игрок, запрос летит через сокет (`game.socket.emit`), GM-клиент ловит его и делает обновление в БД.

### 4.4. Связи (Explicit Links) и Всплывающие подсказки
- Изначально планировалась система умных упоминаний (NLP), но от нее отказались в пользу чисто **Явных связей (Explicit Links)**. Пользователи создают связи на доске (нитями).
- Эти связи рендерятся внизу карточки в виде компактных чипов (tiny tags).
- Для заметок добавлено опциональное поле `name` (Название). Если оно заполнено, чип-ссылка берет его, иначе откатывается к началу текста заметки (fallback to text).
- **Tooltips (Всплывающие подсказки):** Из-за проблемы обрезки (clipping) в `overflow: hidden` родительских контейнерах Foundry, всплывающие окна для ссылок реализованы через кастомный JS (`#bindCustomTooltips` в `app.js`). Окно `.qn-custom-tooltip` программно создается внутри `document.body` с `position: fixed`, что гарантирует отображение поверх всех слоев без обрезки.

### 4.5. TextEditor и Enriched HTML
- В `app.js` -> `#enrichEntry(entry)` происходит асинхронный вызов `TextEditor.enrichHTML()`. 
- Результат пишется в `entry.enriched.text`, `entry.enriched.note`, и так далее.
- В `content.hbs` используется тройное экранирование `{{{this.enriched.text}}}` для вывода готового HTML.

### 4.6. ZEN-Режим (Zen Mode)
- Режим фокуса разворачивает окно приложения поверх всего интерфейса Foundry.
- Достигается это путем присвоения `this.element.classList.add("zen-mode")`.
- **CSS хак для ApplicationV2:** Окна в V12+ позиционируются через `transform: translate(...)`. Для полноэкранного режима необходимо в `.zen-mode` прописать `transform: none !important; width: 100vw !important; height: 100vh !important; position: fixed; top: 0; left: 0; z-index: 99999;`.
- Боковое меню `.tabs` и `.window-header` остаются видимыми, чтобы игрок мог выйти из режима.

### 4.7. Управление Досками (Workspaces)
- **Удаление досок:** Метод `#onDeleteWorkspace` позволяет GM полностью удалить `JournalEntry` текущей доски (кроме личных блокнотов).
- **Фильтрация у GM:** Метод `_prepareContext` итерируется по вкладкам в `data` игроков. Если ни в одной вкладке нет созданных записей, пустой "Личный блокнот" скрывается из выпадающего списка у мастера, чтобы не засорять UI.

## 5. Планы на будущее (Чего пока нет, но может появиться)
- Интеграция AI-генерации (нажатие кнопки для генерации лора NPC).
- Привязка к сетке (Snap to Grid) на доске (настройка добавлена, логика в процессе).
- Группировка (Контейнеры) карточек на доске.
- Мини-карта (Minimap) для доски.
