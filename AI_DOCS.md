# AI Documentation: ClueBook (QuickNotes) Foundry VTT Module

This document is intended for LLMs and AI assistants to quickly understand the architecture, data structures, and mechanics of the ClueBook module without parsing all source files.

## 1. Overview
- **Name:** ClueBook (ID: `notebook`)
- **Type:** Foundry VTT Module
- **Purpose:** A robust in-game notebook and detective board for players and GMs. Allows tracking Notes, NPCs, Quests, and Timelines, and visually connecting them on an infinite canvas (Board).
- **Architecture:** Built using **Foundry VTT Application V2** API. No external JS libraries (jQuery is only used minimally if at all; native DOM API preferred).

## 2. File Structure
- `module.json`: Standard Foundry manifest.
- `scripts/main.js`: Entry point. Listens to `init` and `ready` hooks. Injects the floating draggable UI button. Ensures the shared JournalEntry (`QuickNotes_Shared_DB`) exists.
- `scripts/app.js`: Contains `QuickNotesApp` (extends `foundry.applications.api.ApplicationV2`). Handles all state, rendering, data synchronization, and event listeners.
- `templates/tabs.hbs`: Renders the left-side navigation tabs.
- `templates/content.hbs`: Renders the main content area, forms, board canvas, and settings.
- `styles/style.css`: Contains all styling. Uses CSS variables for theming, CSS Grid/Flexbox for layouts, and Glassmorphism aesthetics.

## 3. Data Architecture (Storage)
The module operates in two distinct modes, toggled by the user in the UI:
1. **Personal Mode:** Data stored in user flags: `game.user.getFlag("notebook", "data")`
2. **Shared Mode:** Data stored in a specific JournalEntry flags: `journal.getFlag("notebook", "data")`

### Schema Structure
Data is structured as a dictionary of tabs, containing dictionaries of entries.
```json
{
  "notes": { "id1": { "text": "...", "color": "yellow", "onBoard": true, ... } },
  "npc": { "id2": { "name": "...", "location": "...", "attitude": "...", "note": "..." } },
  "quests": { "id3": { "status": "active", "text": "..." } },
  "timeline": { "id4": { "time": "...", "event": "..." } },
  "links": [
    { "source": "id1", "target": "id2" }
  ]
}
```

### Board Integration
Entries are placed on the board if `entry.onBoard === true`.
Board-specific metadata stored directly on the entry object:
- `boardX`, `boardY`: Absolute X/Y coordinates on the canvas.
- `boardW`, `boardH`: Custom width and height if resized by the user.

## 4. Key Mechanics & Workflows

### 4.1. Double-Click Editing & Auto-Save
- Entries render in `.view-mode` by default.
- Double-clicking an entry adds the `.is-editing` class (via `state.editingEntryId`), which hides `.view-mode` and shows `.edit-mode`.
- When focus is lost from the `.edit-mode` container (`focusout` event), the `#saveData(entryElement)` function fires, grabbing all inputs with `data-field` attributes and saving them to the database.

### 4.2. The Detective Board (Canvas)
- **Panning:** Middle/Right mouse drag applies a CSS `transform: translate(x, y) scale(z)` to the `.entries-list` container.
- **Zooming:** Mouse wheel modifies the `scale`.
- **Moving Cards:** Left-click drag on a `.quicknotes-entry` modifies its `style.left` and `style.top`. Saved to DB on `mouseup`.
- **Resizing Cards:** Uses native CSS `resize: both` on the inner `.entry-content` wrapper. To prevent dragging conflicts when clicking the resize handle, the drag logic checks `ev.offsetX` and `ev.offsetY` on the `.entry-content` target.
- **Linking:** Clicking the "Link" button sets a `linkingSource`. Clicking a target entry creates a link. Links are rendered as SVG `<line>` elements.
- **Deleting Links:** Implemented as a `<g>` with two lines (one thick transparent for the hit-area, one visible). Right-clicking the `<g>` triggers deletion.

### 5. Settings
- Stored separately in `settings` flag (either `game.user` or JournalEntry).
- **Theme:** `accent` (color), `opacity` (glassmorphism level), `linkColor`, `linkStyle`.
- **Visibility:** Toggles to hide specific tabs (NPC, Quests, Timeline).
- Settings are dynamically injected into CSS variables in `_onRender()`.

## 6. Features and Capabilities (Functional Overview)
What the module currently can do from a user's perspective:

### Core Functionality
- **Dual Notebooks:** The player has a "Personal Notebook" and a "Shared Journal". They can freely switch between them.
- **Categorized Tabs:** Notes are separated into distinct tabs:
  - **Заметки (Notes):** Simple text notes.
  - **NPC:** Track characters (Name, Location, Attitude, Notes).
  - **Квесты (Quests):** Track tasks with statuses (Active, Completed, Failed).
  - **Хронология (Timeline):** Log events with dates/times.
- **Global Search:** A dedicated search tab to quickly filter and find any entry across all categories.

### The Detective Board
- **Infinite Canvas:** A massive board area that can be panned (middle/right click drag) and zoomed (scroll wheel).
- **Pinning:** Any entry from the left-side tabs can be sent to the board ("Отправить на доску").
- **Drag & Resize:** Cards on the board can be dragged around and resized.
- **Linking (String Board):** Players can draw lines (threads) between any two cards on the board to visualize connections.
- **Custom Links:** The color and style (solid, dashed, dotted) of the connection lines can be customized. Links can be deleted with a right-click.

### Quality of Life & UI
- **Draggable UI Widget:** The module is accessed via a floating icon. This icon can be dragged around the screen to avoid blocking other Foundry UI elements.
- **Rich Text Support:** Displayed notes process Foundry's text enrichment (supporting `@UUID` links, etc.).
- **Color Coding:** Every note can be assigned one of 5 colors (yellow, red, green, blue, purple).
- **Auto-Save:** Editing is seamless; double-click a note to edit, click away to instantly save.
- **Aesthetic Customization:** Players can change the module's accent color and the transparency (glassmorphism effect) of the interface to match their tastes.
