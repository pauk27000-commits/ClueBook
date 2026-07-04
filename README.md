# QuickNotes V14 - AI Developer Documentation

## 1. Context & Architecture
"QuickNotes V14" is a high-performance, lightweight in-game notebook module for Foundry VTT (v14). It completely bypasses TinyMCE and heavy Markdown in favor of plain text inputs for maximum speed.

**Tech Stack:** `ApplicationV2`, Handlebars (`.hbs`), CSS Grid, Vanilla JS. 
**UI/UX:** Operates via a floating widget injected over the Foundry UI. Entries look like sticky notes pinned to a board.

## 2. State Management & Storage
Data is stored as dictionaries (keyed by UUID) rather than arrays. This is mandatory to allow atomic dot-notation updates, avoiding race conditions during concurrent player edits.

- **Personal Scope:** Stored in `game.user.update({ "flags.notebook.data.<tab>.<id>": data })`
- **Shared Scope:** Stored in a hidden root `JournalEntry` named `QuickNotes_Shared_DB`. All players are granted `OWNER` permission to this DB upon creation. Updates go to `journal.update({ "flags.notebook.data.<tab>.<id>": data })`.
- **Deletion:** To delete, the module passes `null` to the `-=` dot-notation key: `update({ "flags.notebook.data.<tab>.-=<id>": null })`.

**Data Schema (JSON Example):**
```json
{
  "notes": { "uuid1": { "text": "..." } },
  "npc": { "uuid2": { "name": "...", "location": "...", "attitude": "...", "note": "..." } },
  "clues": { "uuid3": { "text": "..." } },
  "quests": { "uuid4": { "text": "...", "status": "active" } },
  "timeline": { "uuid5": { "time": "...", "event": "..." } }
}
```

## 3. UI Implementation (ApplicationV2)
The UI extends `foundry.applications.api.ApplicationV2` via `HandlebarsApplicationMixin`.

- **Parts:** 
  - `tabs`: Renders sidebar navigation and Shared/Personal toggle.
  - `content`: Renders CSS Grid (`.entries-list`) of sticky notes.
- **Auto-Save:** Uses `foundry.utils.debounce` (500ms). Bound to `input` events. It specifically DOES NOT call `this.render()` after auto-saving to prevent inputs from losing focus.
- **View / Edit Mode:** To maintain performance and avoid AppV2 re-renders during state swaps, entries have a `.view-mode` and `.edit-mode` hardcoded in Handlebars. The "Edit" button adds the `.is-editing` class to the `.quicknotes-entry` DOM element, toggling visibility via CSS. Removing `.is-editing` calls `this.render()` to sync the static view with newly saved data.

## 4. Hooks & Injections
- `init`: Basic initialization.
- `ready`: GM logic. Checks for `QuickNotes_Shared_DB`. If missing, creates it with `ownership.default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER`.
- `renderSceneControls`: Injects `#quicknotes-widget` floating icon (bottom-left) to toggle the AppV2 window.

## 5. CSS & Styling Aesthetics
- **Floating Widget:** Glassmorphism with neon-violet gradient and hover scaling.
- **Layout:** `.entries-list` uses CSS Grid (`repeat(auto-fill, minmax(240px, 1fr))`) to adaptively spawn sticky notes.
- **Sticky Notes (`.quicknotes-entry`):** 
  - Yellowish gradient (`linear-gradient(135deg, #fff7d1, #ffeb99)`).
  - Contains `.sticky-pin` (red thumbtack via radial gradient).
  - Uses `::after` pseudo-element to create a curled bottom-right paper corner.
  - Controls (delete/edit) appear on hover (`opacity: 1`).
- **Confirmation:** Deletion uses `foundry.applications.api.DialogV2.confirm`.
