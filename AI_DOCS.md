# AI Documentation: ClueBook (QuickNotes) Foundry VTT Module

This document is intended for LLMs and AI assistants to quickly understand ClueBook's (module ID: `notebook`) architecture, data structures, and mechanics without parsing all source files, helping to optimize token usage.

---

## 1. Overview & Architecture
- **Name:** ClueBook (ID: `notebook`)
- **Type:** Foundry VTT Module (Verified V14 compatible)
- **Framework:** Built entirely on **Foundry VTT Application V2** API (`foundry.applications.api.ApplicationV2`). No legacy FormApplication/Application classes are used for widgets or interfaces.
- **Rendering:** Uses the `HandlebarsApplicationMixin` mixin for compiling Handlebars (`.hbs`) templates.
- **Styling:** Vanilla CSS (`style.css` & `calendar.css`). Flexbox, Grid, CSS Variables, and Glassmorphism design tokens.

---

## 2. File Structure & Responsibilities
- [module.json](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/module.json) - Manifest. Defines `main.js` as the ES entry point.
- [scripts/main.js](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/scripts/main.js) - Initializer. Hooks `init` and `ready`. Injects screen floating widget (`#quicknotes-widget`). Registers settings. Sets up live-sync hooks.
- [scripts/app.js](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/scripts/app.js) - Main notebook sheet (`QuickNotesApp`). Inherits `ApplicationV2`. Manages states, infinite detective canvas, card positioning/resize, custom links, auto-saves, search, and autocomplete mentions.
- [scripts/calendar.js](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/scripts/calendar.js) - Floating calendar widget (`CalendarWidget`). Modernized to `ApplicationV2`. Renders date, time, weather, and seasons. Contains form editing via `DialogV2`.
- [scripts/socket.js](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/scripts/socket.js) - Socket handler (`QuickNotesSocket`). Channels requests (creation, renaming, and permissions updates) from non-GM players to GMs.
- [templates/](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/templates/) - Handlebars templates for sidebar, dashboard content, calendar views, and editing.
- [styles/](file:///e:/Program/Foundry/DataGame/Data/modules/notebook/styles/) - CSS style sheets.

---

## 3. Data Storage Schema
Data is saved inside user/journal flags under path: `flags.notebook.data`.

### Workspaces (Active Mode)
1. **Personal Mode (`personal`)**: Data stored in User flags: `game.user.getFlag("notebook", "data")`. Only visible to that User and GMs.
2. **Shared Mode (Journal ID)**: Data stored in a JournalEntry's flags: `journal.getFlag("notebook", "data")`. Visible to all players with OBSERVER permissions.

### Dictionary Format
```json
{
  "notes": {
    "id_123": { "text": "HTML string...", "color": "yellow", "sort": 0, "onBoard": true, "boardX": 150, "boardY": 80 }
  },
  "npc": {
    "id_456": { "name": "Mayor", "location": "City Hall", "attitude": "Neutral", "note": "Notes...", "sort": 1, "onBoard": false }
  },
  "quests": {
    "id_789": { "text": "Solve case...", "status": "active", "sort": 0 }
  },
  "timeline": {
    "id_abc": { "time": "12:00", "event": "Crime committed...", "sort": 0 }
  },
  "links": {
    "id_123_id_456": { "source": "id_123", "target": "id_456", "label": "Relation text", "style": "solid", "color": "#f44336" }
  }
}
```

---

## 4. Key Mechanics & Workflows

### 4.1. Drag & Drop and Resizing
- **Card Drags (Board):** Coordinates are updated only on mouse release (`pointerup`/`mouseup`) to prevent heavy database write-backs during drags. Visual updates are applied directly to DOM transform elements in real-time (60 FPS).
- **List Drag Sort:** Native HTML5 Drag and Drop modifies the `sort` property across elements in the list when they are swapped.
- **Card Resize:** Done via native CSS `resize: both` in `.entry-content`. Releasing the mouse clicks save width and height parameters to `boardW`/`boardH` fields.

### 4.2. Links, Autocomplete & Mention Popups
- **Explicit Links:** Players link items on the canvas. These connections are drawn using SVG `<line>` elements.
- **Autocomplete Mentions:** Typing `@` inside a textarea queries existing entries in the workspace. Selecting one inserts `[[qnmention:entryId:entryName]]{}` placeholder.
- **Custom Tooltips:** To avoid CSS `overflow: hidden` clipping on lists, tooltips are generated as `position: fixed` containers appended directly to `document.body` on hover.

### 4.3. Socket Bridge for GMs
Non-GM users cannot modify `JournalEntry` ownership or create journals in folders directly. Thus:
- Players emit socket requests via `game.socket.emit("module.notebook", data)`.
- GMs capture them via `QuickNotesSocket` in `socket.js` and execute the action, maintaining the DB state.

### 4.4. Memory Management (Cleanup)
Since ClueBook attaches window/document listeners for global mouse coordinates, a manual cleanup is required in `_onClose` to prevent memory leaks and ghost pointer operations after sheet closure:
```javascript
_onClose(options) {
  super._onClose(options);
  // Remove document listeners for pan/drag coordinates
  document.removeEventListener('mousedown', this._outsideClickHandler);
  document.removeEventListener('mousemove', this._boardMoveHandler);
  document.removeEventListener('mouseup', this._boardUpHandler);
  
  // Clean up global DOM elements
  const dropdown = document.querySelector('.qn-mention-dropdown');
  if (dropdown) dropdown.remove();
  const tooltip = document.querySelector('.qn-custom-tooltip');
  if (tooltip) tooltip.remove();
}
```

---

## 5. Token Savings Cheat Sheet (For LLMs)
If you are modifying ClueBook components:
- **Workspace Data Updates:** Always write to `flags.notebook.data.<tab>.<id>`. When deleting, set the path value to `null` with `-=` prefix (e.g. `flags.notebook.data.notes.-=id1`).
- **Render updates:** For incremental visual updates, use `this.render({ parts: ["content"] })` instead of a full app render.
- **Deleting cards:** Extract `sourceTab` from `dataset.sourceTab` instead of relying on `this.state.activeTab`. The card might be visible in Search or Board tabs, but its database container resides under its original tab directory!
- **Dialogs:** Use `foundry.applications.api.DialogV2.wait` for modern prompts instead of the legacy `Dialog` wrapper.
