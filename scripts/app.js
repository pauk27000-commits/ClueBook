import { QuickNotesSocket } from "./socket.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class QuickNotesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    
    // Store debounced save function per tab
    this._debouncedSaves = {};
  }

  static DEFAULT_OPTIONS = {
    id: "quicknotes-app",
    classes: ["quicknotes-window"],
    position: {
      width: 1200,
      height: 800
    },
    window: {
      title: "Ежедневник (QuickNotes)",
      icon: "fas fa-book",
      resizable: true,
      minimizable: true,
      controls: [
        {
          action: "toggleZenMode",
          icon: "fas fa-expand",
          label: "Zen-режим (На весь экран)"
        }
      ]
    },
    form: {
      handler: QuickNotesApp.#onSubmitForm,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      addEntry: QuickNotesApp.#onAddEntry,
      deleteEntry: QuickNotesApp.#onDeleteEntry,
      toggleMode: QuickNotesApp.#onToggleMode,
      toggleEdit: QuickNotesApp.#onToggleEdit,
      sendToBoard: QuickNotesApp.#onSendToBoard,
      removeFromBoard: QuickNotesApp.#onRemoveFromBoard,
      selectColor: QuickNotesApp.#onSelectColor,
      toggleVisibility: QuickNotesApp.#onToggleVisibility,
      shareEntry: QuickNotesApp.#onShareEntry,
      importJSON: QuickNotesApp.#onImportJSON,
      copyDataFormat: QuickNotesApp.#onCopyDataFormat,
      exportJSON: QuickNotesApp.#onExportJSON,
      editWorkspace: QuickNotesApp.#onEditWorkspace,
      deleteWorkspace: QuickNotesApp.#onDeleteWorkspace,
      sortTimeline: QuickNotesApp.#onSortTimeline,
      jumpToBoard: QuickNotesApp.#onJumpToBoard,
      jumpToLinked: QuickNotesApp.#onJumpToLinked,
      createSuggestedLink: QuickNotesApp.#onCreateSuggestedLink,
      deleteLink: QuickNotesApp.#onDeleteLink,
      dismissSuggestedLink: QuickNotesApp.#onDismissSuggestedLink,
      toggleZenMode: QuickNotesApp.#onToggleZenMode
    }
  };

  static PARTS = {
    tabs: {
      template: "modules/notebook/templates/tabs.hbs",
      classes: ["quicknotes-tabs"]
    },
    content: {
      template: "modules/notebook/templates/content.hbs",
      classes: ["quicknotes-content"]
    }
  };

  // State mapping
  state = {
    activeTab: game.user?.getFlag("notebook", "lastTab") || "notes",
    activeWorkspace: game.user?.getFlag("notebook", "lastWorkspace") || game.user?.getFlag("notebook", "settings")?.theme?.defaultWorkspace || "personal",
    searchQuery: "",
    editingEntryId: null,
    highlightedEntryId: null,
    selectedEntryId: null
  };

  static DEFAULT_SETTINGS = {
    readOnly: false,
    features: {
      cardsShowExplicitLinks: true,
      cardsShowSuggestedLinks: true,
      boardShowExplicitLinks: false,
      boardShowSuggestedLinks: false
    },
    theme: {
      defaultWorkspace: "personal",
      accent: "#7b61ff",
      opacity: 85,
      linkColor: "#ff5252",
      linkStyle: "6,4",
      showHotkeys: true,
      snapToGrid: false,
      highlightDuration: 2
    },
    defaultColors: {
      notes: "yellow",
      npc: "green",
      quests: "purple",
      timeline: "red"
    },
    widget: {
      direction: "up-right"
    }
  };

  getSettings() {
    // We do a deep clone of defaults to prevent mutating them
    const defaults = foundry.utils.deepClone(QuickNotesApp.DEFAULT_SETTINGS);
    const localSettings = game.user.getFlag("notebook", "settings") || {};
    
    // NOTE: We use plain JS spread instead of foundry.utils.mergeObject because
    // mergeObject silently drops `false` values when overwriting `true` defaults.
    const theme = { ...defaults.theme, ...(localSettings.theme || {}) };
    const features = { ...defaults.features, ...(localSettings.features || {}) };
    const widget = { ...defaults.widget, ...(localSettings.widget || {}) };
    
    let defaultColors, readOnly;
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      const sharedSettings = journal ? (journal.getFlag("notebook", "settings") || {}) : {};
      defaultColors = { ...defaults.defaultColors, ...(sharedSettings.defaultColors || {}) };
      readOnly = sharedSettings.readOnly ?? defaults.readOnly;
    } else {
      defaultColors = { ...defaults.defaultColors, ...(localSettings.defaultColors || {}) };
      readOnly = false;
    }
    
    return { theme, features, defaultColors, widget, readOnly };
  }

  /**
   * Defines the tabs for the application
   */
  get tabs() {
    return [
      { id: "search", icon: "fas fa-search", label: "Поиск" },
      { id: "notes", icon: "fas fa-sticky-note", label: "Заметки" },
      { id: "npc", icon: "fas fa-user", label: "Персонажи (NPC)" },
      { id: "quests", icon: "fas fa-map", label: "Квесты" },
      { id: "timeline", icon: "fas fa-clock", label: "Хронология" },
      { id: "board", icon: "fas fa-project-diagram", label: "Доска" }
    ];
  }

  async #sanitizeData(data) {
    let requiresUpdate = false;
    const updates = {};
    const newData = foundry.utils.deepClone(data);

    // 1. Migrate Links Array to Object (Dictionary)
    if (Array.isArray(newData.links)) {
      const newLinks = {};
      newData.links.forEach(l => {
        if (!l.source || !l.target) return;
        const [a, b] = [l.source, l.target].sort();
        const key = `${a}_${b}`;
        newLinks[key] = {
          source: l.source,
          target: l.target,
          label: l.label || "",
          style: l.style || "solid",
          color: l.color || ""
        };
      });
      newData.links = newLinks;
      updates["flags.notebook.data.links"] = newLinks;
      requiresUpdate = true;
    }

    // 2. Ensure basic data structure exists
    if (!newData.links || typeof newData.links !== 'object') newData.links = {};
    const tabs = ["notes", "npc", "quests", "timeline", "board"];
    tabs.forEach(tab => {
      if (!newData[tab]) newData[tab] = {};
    });

    // We do save if migration happened (links array to object)
    if (requiresUpdate) {
      if (!this.state.isReadOnly) {
        try {
          await this.#updateWorkspaceData(updates);
        } catch (e) {
          console.warn("QuickNotes | Could not migrate links.");
        }
      }
    }

    return newData;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    // Find all available workspaces
    const personalName = game.user.getFlag("notebook", "personalWorkspaceName") || "Личный блокнот (Только я)";
    const availableWorkspaces = [
      { id: "personal", name: personalName }
    ];

    if (game.user.isGM) {
      game.users.forEach(u => {
        if (u.id !== game.user.id && !u.isGM) {
          const uData = u.getFlag("notebook", "data") || {};
          let isEmpty = true;
          for (const [tabKey, tabData] of Object.entries(uData)) {
            if (tabKey === "board" || tabKey === "links" || tabKey === "search") continue;
            if (tabData && Object.keys(tabData).length > 0) {
              isEmpty = false;
              break;
            }
          }
          
          if (!isEmpty) {
            const uName = u.getFlag("notebook", "personalWorkspaceName") || `Личный блокнот (${u.name})`;
            availableWorkspaces.push({ id: `personal_${u.id}`, name: `[Игрок] ${uName}` });
          }
        }
      });
    }

    game.journal.forEach(j => {
      if ((j.getFlag("notebook", "isWorkspace") || j.name === "QuickNotes_Shared_DB") && j.testUserPermission(game.user, "OBSERVER")) {
        availableWorkspaces.push({ id: j.id, name: j.name });
      }
    });

    // Ensure activeWorkspace is valid, fallback to personal if not
    if (this.state.activeWorkspace !== "personal" && !this.state.activeWorkspace.startsWith("personal_") && !game.journal.get(this.state.activeWorkspace) && !game.journal.getName("QuickNotes_Shared_DB")) {
      this.state.activeWorkspace = "personal";
    }

    // Load data based on mode
    let data = {};
    if (this.state.activeWorkspace === "personal") {
      data = game.user.getFlag("notebook", "data") || {};
      context.workspaceName = game.user.getFlag("notebook", "personalWorkspaceName") || "Личный блокнот";
      context.isShared = false;
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      if (u && game.user.isGM) {
        data = u.getFlag("notebook", "data") || {};
        context.workspaceName = u.getFlag("notebook", "personalWorkspaceName") || `Личный блокнот (${u.name})`;
        context.isShared = false;
        context.isReadOnly = false;
      } else {
        this.state.activeWorkspace = "personal";
        data = game.user.getFlag("notebook", "data") || {};
        context.workspaceName = "Личный блокнот";
        context.isShared = false;
      }
    } else {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        data = journal.getFlag("notebook", "data") || {};
        context.workspaceName = journal.name;
        context.isShared = true;
      }
    }

    data = await this.#sanitizeData(data);

    context.tabs = this.tabs;
    
    // Ensure activeTab is actually visible
    if (!context.tabs.some(t => t.id === this.state.activeTab) && !["settings", "workspaces"].includes(this.state.activeTab)) {
      this.state.activeTab = "notes";
    }
    
    context.activeTab = this.state.activeTab;
    context.activeWorkspace = this.state.activeWorkspace;
    context.workspaces = availableWorkspaces;
    context.searchQuery = this.state.searchQuery;
    context.isSettings = this.state.activeTab === "settings";
    context.isWorkspaces = this.state.activeTab === "workspaces";
    context.settings = this.getSettings(); // Ensure settings are available for all tabs
    
    context.isGM = game.user.isGM;
    this.state.isReadOnly = context.isShared && context.settings.readOnly && !context.isGM;
    context.isReadOnly = this.state.isReadOnly;
    
    if (context.isSettings || context.isWorkspaces) {
      context.showAddBtn = false;
      context.isBoardView = false;
      return context;
    }
    
    // We must process TextEditor.enrichHTML asynchronously for the display mode,
    // while keeping raw text for the edit mode.
    const entries = [];
    const skipHidden = context.isShared && !context.isGM;
    
    if (this.state.activeTab === "search") {
      // Global Search Tab
      const q = this.state.searchQuery.toLowerCase();
      if (q) {
        for (const [tabKey, tabData] of Object.entries(data)) {
          if (tabKey === "links" || tabKey === "board" || tabKey === "search") continue;
          for (const [id, entry] of Object.entries(tabData || {})) {
            if (!entry) continue;
            if (skipHidden && entry.isHidden) continue;
            let match = false;
            for (const val of Object.values(entry)) {
              if (typeof val === "string" && val.toLowerCase().includes(q)) {
                match = true;
                break;
              }
            }
            if (match) {
              const enriched = await this.#enrichEntry(entry);
              entries.push({ id, sourceTab: tabKey, ...entry, enriched });
            }
          }
        }
      }
      context.links = []; // No links in search mode
    } else if (this.state.activeTab === "board") {
      // For the board, we aggregate all entries across all tabs that have onBoard == true
      for (const [tabKey, tabData] of Object.entries(data)) {
        if (tabKey === "board" || tabKey === "links" || tabKey === "search") continue; // links is for board connections
        for (const [id, entry] of Object.entries(tabData || {})) {
          if (!entry) continue;
          if (skipHidden && entry.isHidden) continue;
          if (entry.onBoard) {
            const enriched = await this.#enrichEntry(entry);
            entries.push({ id, sourceTab: tabKey, ...entry, enriched });
          }
        }
      }
      // Pass raw links, math will be done dynamically in DOM
      context.links = Object.values(data.links || {});
      
    } else {
      // Standard tabs
      const tabData = data[this.state.activeTab] || {};
      const sortedEntries = Object.entries(tabData).sort((a, b) => (a[1].sort || 0) - (b[1].sort || 0));
      for (const [id, entry] of sortedEntries) {
        if (!entry) continue;
        if (skipHidden && entry.isHidden) continue;
        const enriched = await this.#enrichEntry(entry);
        entries.push({ id, sourceTab: this.state.activeTab, ...entry, enriched });
      }
    }
    // PROCESS LINKS (EXPLICIT ONLY)
    const allLinks = data.links || [];
    
    // Gather entities for explicit links names
    const allEntities = [];
    for (const [tabKey, tabData] of Object.entries(data)) {
      if (tabKey === "links" || tabKey === "search" || tabKey === "board") continue;
      for (const [id, entry] of Object.entries(tabData || {})) {
        if (entry) {
          let previewText = (entry.text || entry.note || entry.event || entry.name || "").replace(/<[^>]+>/g, '').trim();
          if (previewText.length > 250) previewText = previewText.substring(0, 250) + "...";
          allEntities.push({ id, title: entry.name || entry.event || entry.text || "Без названия", preview: previewText });
        }
      }
    }

    for (const entry of entries) {
      entry.explicitLinks = [];
      const isBoard = this.state.activeTab === "board";
      const showExplicit = isBoard ? context.settings.features?.boardShowExplicitLinks : context.settings.features?.cardsShowExplicitLinks;
      
      if (showExplicit !== false) {
        for (const l of Object.values(allLinks)) {
          if (l.source === entry.id || l.target === entry.id) {
            const otherId = l.source === entry.id ? l.target : l.source;
            const otherEntity = allEntities.find(e => e.id === otherId);
            if (otherEntity) {
              // Strip HTML from title for the tiny chip
              const cleanName = otherEntity.title.replace(/<[^>]+>/g, '').substring(0, 40).trim();
              entry.explicitLinks.push({ id: otherId, name: cleanName, label: l.label, preview: otherEntity.preview });
            }
          }
        }
      }
    }

    context.entries = entries;
    context.showAddBtn = this.state.activeTab !== "board" && this.state.activeTab !== "search";
    context.isBoardView = this.state.activeTab === "board";
    context.editingEntryId = this.state.editingEntryId;
    context.highlightedEntryId = this.state.highlightedEntryId;

    return context;
  }

  async #enrichEntry(entry) {
    const enriched = {};
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
    
    // Превращаем "голые" UUID (например, Actor.rD8k1q6zP4dG8v9x) в @UUID[...] 
    const processUUIDs = (text) => {
      if (!text) return text;
      // Regex ищет стандартные UUID Foundry (16 символов) и UUID из компендиумов.
      // Негативный просмотр назад (?<!@UUID\[) гарантирует, что мы не обернем уже обернутый UUID.
      const uuidRegex = /(?<!@UUID\[)\b(?:Actor|Item|JournalEntry|JournalEntryPage|Scene|RollTable|Cards|Macro|Playlist|User)(?:\.[a-zA-Z0-9_-]+)+\b/g;
      let newText = text.replace(uuidRegex, match => `@UUID[${match}]`);
      
      const compendiumRegex = /(?<!@UUID\[)\bCompendium\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+\b/g;
      newText = newText.replace(compendiumRegex, match => `@UUID[${match}]`);
      
      return newText;
    };

    if (entry.text) enriched.text = await TE.enrichHTML(processUUIDs(entry.text), { async: true });
    if (entry.note) enriched.note = await TE.enrichHTML(processUUIDs(entry.note), { async: true });
    if (entry.event) enriched.event = await TE.enrichHTML(processUUIDs(entry.event), { async: true });
    if (entry.gmNotes && game.user.isGM) enriched.gmNotes = await TE.enrichHTML(processUUIDs(entry.gmNotes), { async: true });
    return enriched;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;
    const settings = this.getSettings();
    const isReadOnly = this.state.isReadOnly;
    
    if (this._savedScrollPos !== undefined) {
      const contentPane = html.querySelector('.quicknotes-content');
      if (contentPane) contentPane.scrollTop = this._savedScrollPos;
      this._savedScrollPos = undefined;
    }
    
    // Bind Keyboard Shortcuts (Hotkeys)
    html.addEventListener('keydown', (ev) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
      
      if (this.state.selectedEntryId) {
        if (ev.key === "Delete" || ev.key === "Backspace") {
          ev.preventDefault();
          const entryEl = html.querySelector(`[data-entry-id="${this.state.selectedEntryId}"]`);
          if (entryEl && !isReadOnly) QuickNotesApp.#onDeleteEntry(null, entryEl);
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          this.state.selectedEntryId = null;
          html.querySelectorAll('.quicknotes-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
        }
      }
    });

    if (this.state.activeTab === "board") {
      html.style.overflow = "hidden";
    } else {
      html.style.overflow = "";
    }
    
    // Apply aesthetics globally
    html.style.setProperty('--qn-bg-glass', `rgba(26, 26, 36, ${settings.theme.opacity / 100})`);
    html.style.setProperty('--qn-accent', settings.theme.accent);
    const hex = settings.theme.accent.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      html.style.setProperty('--qn-accent-glow', `rgba(${r}, ${g}, ${b}, 0.4)`);
    }

    if (this.state.activeTab === "settings") {
      this.#bindSettingsListeners(html);
    }
    
    // Bind workspace selector
    const workspaceSelect = html.querySelector('#qn-workspace-select');
    if (workspaceSelect) {
      workspaceSelect.addEventListener('change', async (ev) => {
        this.state.activeWorkspace = ev.target.value;
        await game.user.setFlag("notebook", "lastWorkspace", ev.target.value);
        this.render();
      });
    }

    // Bind workspace creation
    const workspaceCreate = html.querySelector('#qn-workspace-create');
    if (workspaceCreate) {
      workspaceCreate.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.#createNewWorkspace();
      });
    }
    
    // Bind hide hotkeys
    const hideHotkeysBtn = html.querySelector('[data-action="hideHotkeys"]');
    if (hideHotkeysBtn) {
      hideHotkeysBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        await game.user.update({ "flags.notebook.settings.theme.showHotkeys": false });
        this.render({ parts: ["content"] });
      });
    }

    // Bind search input
    const searchInput = html.querySelector('#quicknotes-search');
    if (searchInput) {
      searchInput.addEventListener('input', (ev) => {
        this.state.searchQuery = ev.target.value;
        this.render({ parts: ["content"] });
      });
      // Restore focus
      if (this.state.searchQuery !== "") {
        searchInput.focus();
        searchInput.selectionStart = searchInput.value.length;
      }
    }

    // Bind tab clicks
    html.querySelectorAll('.item[data-tab]').forEach(el => {
      el.addEventListener('click', async (ev) => {
        // Clear search query and edit mode on tab change
        this.state.searchQuery = "";
        this.state.editingEntryId = null;
        const tab = ev.currentTarget.dataset.tab;
        this.state.activeTab = tab;
        await game.user.setFlag("notebook", "lastTab", tab);
        this.render();
      });
    });

    // Bind auto-save inputs
    html.querySelectorAll('.quicknotes-input').forEach(input => {
      input.addEventListener('input', (ev) => {
        this.#handleInputDebounced(ev.currentTarget);
      });
    });

    // --- @ Mention Autocomplete ---
    this.#bindMentionAutocomplete(html);
    
    // --- Custom Tooltips ---
    this.#bindCustomTooltips(html);

    // Handle Selection logic
    html.querySelectorAll('.quicknotes-entry').forEach(entry => {
      entry.addEventListener('mousedown', (ev) => {
        // Only select on left click, ignore if clicking inputs
        if (ev.button !== 0) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
        
        // Remove previous selection
        html.querySelectorAll('.quicknotes-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
        
        this.state.selectedEntryId = entry.dataset.entryId;
        entry.classList.add('is-selected');
        entry.focus({ preventScroll: true }); // Give focus so keydown on window works reliably
      });
      
      // Make entry focusable so it can capture key events without scrolling
      entry.setAttribute('tabindex', '-1');
    });

    // Auto-focus new/editing entry
    if (this.state.editingEntryId) {
      const editingNode = html.querySelector(`.quicknotes-entry[data-entry-id="${this.state.editingEntryId}"]`);
      if (editingNode) {
        const firstInput = editingNode.querySelector('.quicknotes-input');
        if (firstInput) {
          firstInput.focus({ preventScroll: true });
          if (typeof firstInput.selectionStart === 'number') {
            firstInput.selectionStart = firstInput.value.length;
          }
        }
      }
    }

    // Double-click to edit
    html.querySelectorAll('.quicknotes-entry .view-mode').forEach(viewNode => {
      viewNode.addEventListener('dblclick', (ev) => {
        const entry = ev.currentTarget.closest('.quicknotes-entry');
        const entryId = entry.dataset.entryId;
        if (this.state.editingEntryId !== entryId) {
          this.state.editingEntryId = entryId;
          this.render();
        }
      });
    });

    // Global click-outside to save
    if (this._outsideClickHandler) document.removeEventListener('mousedown', this._outsideClickHandler);
    this._outsideClickHandler = (ev) => {
      if (!this.state.editingEntryId) return;
      // If the app was closed
      if (!this.element) return;
      
      const editingNode = this.element.querySelector('.quicknotes-entry.is-editing');
      if (editingNode && editingNode.contains(ev.target)) return;
      
      // Ignore if clicking the edit toggle button or add entry button or tabs
      if (ev.target.closest('[data-action="toggleEdit"]') || ev.target.closest('[data-action="addEntry"]') || ev.target.closest('.item[data-tab]')) return;

      // Force save any pending inputs immediately
      if (editingNode) {
        const inputs = editingNode.querySelectorAll('.quicknotes-input');
        const entryId = editingNode.dataset.entryId;
        const sourceTab = editingNode.dataset.sourceTab || this.state.activeTab;
        inputs.forEach(input => {
          if (input.dataset.field) {
            this.#saveDataRaw(sourceTab, entryId, input.dataset.field, input.value);
          }
        });
      }

      this.state.editingEntryId = null;
      setTimeout(() => this.render(), 100);
    };
    document.addEventListener('mousedown', this._outsideClickHandler);

    // Setup Board Interactivity
    if (this.state.activeTab === "board" && !this.state.searchQuery) {
      this.#setupBoardInteractivity(html);
    }

    // Setup List Drag & Drop
    if (!this.state.isBoardView && !this.state.searchQuery && this.state.activeTab !== "settings" && this.state.activeTab !== "workspaces" && !this.state.isReadOnly) {
      this.#setupListDragDrop(html);
    }
  }

  #setupListDragDrop(html) {
    let draggedItem = null;
    const listContainer = html.querySelector('.entries-list');
    if (!listContainer) return;

    listContainer.addEventListener('dragover', ev => ev.preventDefault());

    html.querySelectorAll('.entries-list .quicknotes-entry').forEach(entry => {
      entry.addEventListener('dragstart', (ev) => {
        if (ev.target.closest('.entry-controls') || ev.target.closest('.edit-mode')) {
          ev.preventDefault();
          return;
        }
        draggedItem = entry;
        listContainer.classList.add('is-dragging-list');
        setTimeout(() => entry.classList.add('is-dragging'), 0);
      });

      entry.addEventListener('dragend', async () => {
        if (!draggedItem) return;
        listContainer.classList.remove('is-dragging-list');
        draggedItem.classList.remove('is-dragging');
        draggedItem = null;

        // Save the new sort order
        const allEntries = Array.from(listContainer.querySelectorAll('.quicknotes-entry'));
        const updates = {};
        
        allEntries.forEach((el, index) => {
          const id = el.dataset.entryId;
          const flagPath = `flags.notebook.data.${this.state.activeTab}.${id}.sort`;
          updates[flagPath] = index;
        });

        await this.#updateWorkspaceData(updates);
      });

      entry.addEventListener('dragenter', (ev) => {
        ev.preventDefault();
        if (!draggedItem || draggedItem === entry) return;

        const allEntries = Array.from(listContainer.children);
        const draggedIndex = allEntries.indexOf(draggedItem);
        const targetIndex = allEntries.indexOf(entry);

        if (draggedIndex < targetIndex) {
          listContainer.insertBefore(draggedItem, entry.nextSibling);
        } else {
          listContainer.insertBefore(draggedItem, entry);
        }
      });
    });
  }

  #bindSettingsListeners(html) {
    const saveSetting = async (scope, key, value) => {
      // Foundry resolves "flags.notebook.settings.X.Y" paths into proper nested objects
      const flagPath = `flags.notebook.settings.${key}`;
      
      // Theme settings are ALWAYS saved to the personal user
      if (key.startsWith('theme.')) {
        await game.user.update({ [flagPath]: value });
      } else {
        // Visibility, widget and defaultColors follow workspace scope
        if (this.state.isShared) {
          const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
          if (journal) await journal.update({ [flagPath]: value });
        } else {
          await game.user.update({ [flagPath]: value });
        }
      }
      this.render();
    };

    html.querySelectorAll('.setting-input').forEach(el => {
      el.addEventListener('change', (ev) => {
        const target = ev.currentTarget;
        const key = target.dataset.key;
        
        const contentPane = html.querySelector('.quicknotes-content');
        if (contentPane) this._savedScrollPos = contentPane.scrollTop;

        let value = target.value;
        if (target.type === 'checkbox') value = target.checked;
        if (target.type === 'range') value = Number(target.value);
        saveSetting(this.state.isShared ? 'shared' : 'personal', key, value);
      });
    });
  }

  #setupBoardInteractivity(html) {
    let draggedEntry = null;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    
    // For Linking
    let linkingSource = null;
    let tempLine = null;

    // For Pan & Zoom
    let currentZoom = 1;
    let currentPanX = 0;
    let currentPanY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let rAF_frame = null;

    const board = html.querySelector('.board-canvas');
    if (!board) return;
    
    const entriesList = board.querySelector('.entries-list');
    
    // Load camera state
    if (!this.state.camera) {
      this.state.camera = game.user.getFlag("notebook", "boardCamera") || { zoom: 1, panX: 0, panY: 0 };
    }
    currentZoom = this.state.camera.zoom || 1;
    currentPanX = Math.round(this.state.camera.panX || 0);
    currentPanY = Math.round(this.state.camera.panY || 0);

    const applyTransform = () => {
      entriesList.style.transformOrigin = "0 0";
      entriesList.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
    };
    applyTransform();
    requestAnimationFrame(applyTransform);
    
    const saveCameraToDB = foundry.utils.debounce(() => {
      game.user.update({ "flags.notebook.boardCamera": this.state.camera });
    }, 500);

    const updateCameraState = () => {
      this.state.camera = { zoom: currentZoom, panX: currentPanX, panY: currentPanY };
      saveCameraToDB();
    };

    // Zoom (Wheel)
    board.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const zoomFactor = 0.1;
      const direction = ev.deltaY < 0 ? 1 : -1;
      let newZoom = currentZoom + (direction * zoomFactor);
      newZoom = Math.max(0.1, Math.min(newZoom, 3.0));

      if (newZoom !== currentZoom) {
        const rect = board.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;

        currentPanX = Math.round(mouseX - (mouseX - currentPanX) * (newZoom / currentZoom));
        currentPanY = Math.round(mouseY - (mouseY - currentPanY) * (newZoom / currentZoom));
        
        currentZoom = newZoom;
        applyTransform();
        updateCameraState();
      }
    });

    // Prevent context menu
    board.addEventListener('contextmenu', ev => ev.preventDefault());


    // Pan Start & Deselect
    board.addEventListener('mousedown', (ev) => {
      if (ev.button === 2 || ev.button === 1) {
        isPanning = true;
        panStartX = ev.clientX - currentPanX;
        panStartY = ev.clientY - currentPanY;
        ev.preventDefault();
      }
      
      // Left click on empty board -> deselect
      if (ev.button === 0 && ev.target.closest('.quicknotes-entry') === null) {
        this.state.selectedEntryId = null;
        html.querySelectorAll('.quicknotes-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
      }
    });

    const recenterBtn = this.element.querySelector('[data-action="recenterBoard"]');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const entries = board.querySelectorAll('.quicknotes-entry');
        if (entries.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          entries.forEach(el => {
            const x = parseInt(el.style.left) || 0;
            const y = parseInt(el.style.top) || 0;
            const w = el.offsetWidth || 300;
            const h = el.offsetHeight || 200;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
          });
          if (minX !== Infinity) {
            const centerX = minX + (maxX - minX) / 2;
            const centerY = minY + (maxY - minY) / 2;
            currentZoom = 0.5;
            currentPanX = Math.round((board.offsetWidth / 2) - (centerX * currentZoom));
            currentPanY = Math.round((board.offsetHeight / 2) - (centerY * currentZoom));
          }
        } else {
          currentPanX = 0;
          currentPanY = 0;
          currentZoom = 1;
        }
        applyTransform();
        updateCameraState();
      });
    }

    const updateLines = () => {
      board.querySelectorAll('.board-svg line').forEach(line => {
        const sourceId = line.dataset.source;
        const targetId = line.dataset.target;
        const sourceEl = board.querySelector(`[data-entry-id="${sourceId}"]`);
        const targetEl = board.querySelector(`[data-entry-id="${targetId}"]`);
        if (sourceEl && targetEl) {
          const sX = parseInt(sourceEl.style.left) + (sourceEl.offsetWidth / 2);
          const sY = parseInt(sourceEl.style.top) + (sourceEl.offsetHeight / 2);
          const tX = parseInt(targetEl.style.left) + (targetEl.offsetWidth / 2);
          const tY = parseInt(targetEl.style.top) + (targetEl.offsetHeight / 2);
          line.setAttribute('x1', sX);
          line.setAttribute('y1', sY);
          line.setAttribute('x2', tX);
          line.setAttribute('y2', tY);
          line.setAttribute('opacity', '1');
          
          const label = board.querySelector(`.board-link-label[data-source="${sourceId}"][data-target="${targetId}"]`);
          if (label) {
            label.style.left = `${(sX + tX) / 2}px`;
            label.style.top = `${(sY + tY) / 2}px`;
          }
        } else {
          line.setAttribute('opacity', '0');
        }
      });
    };
    
    setTimeout(updateLines, 50);

    // Linking Action
    board.querySelectorAll('.btn-link').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const entry = ev.currentTarget.closest('.quicknotes-entry');
        if (linkingSource === entry) {
          linkingSource.classList.remove('linking-source');
          linkingSource = null;
          return;
        }
        if (!linkingSource) {
          linkingSource = entry;
          entry.classList.add('linking-source');
        } else {
          const targetId = entry.dataset.entryId;
          const sourceId = linkingSource.dataset.entryId;
          linkingSource.classList.remove('linking-source');
          linkingSource = null;
          if (sourceId !== targetId) {
            this.#createLink(sourceId, targetId);
          }
        }
      });
    });

    board.querySelectorAll('.board-link').forEach(link => {
      link.addEventListener('dblclick', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this.#editConnectionSettings(link.dataset.source, link.dataset.target);
      });
    });

    board.querySelectorAll('.board-link-label').forEach(lbl => {
      lbl.addEventListener('dblclick', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this.#editConnectionSettings(lbl.dataset.source, lbl.dataset.target);
      });
    });

    board.querySelectorAll('.entry-content').forEach(content => {
      content.addEventListener('mouseup', (ev) => {
        if (this.state.isReadOnly) return;
        // If it was resized via CSS resize, style.width/height is set
        if (content.style.width || content.style.height) {
           const entry = content.closest('.quicknotes-entry');
           const w = content.style.width ? parseInt(content.style.width) : null;
           const h = content.style.height ? parseInt(content.style.height) : null;
           const t = entry.dataset.sourceTab;
           const id = entry.dataset.entryId;
           if (w && w !== parseInt(entry.dataset.lastW)) {
             this.#saveDataRaw(t, id, "boardW", w);
             entry.dataset.lastW = w;
           }
           if (h && h !== parseInt(entry.dataset.lastH)) {
             this.#saveDataRaw(t, id, "boardH", h);
             entry.dataset.lastH = h;
           }
        }
      });
    });

    board.querySelectorAll('.quicknotes-entry').forEach(entry => {
      entry.addEventListener('mousedown', (ev) => {
        if (this.state.isReadOnly) return;
        if (ev.button !== 0) return; // Only left click drags
        if (ev.target.closest('.entry-controls') || ev.target.closest('.edit-mode')) return;
        if (entry.classList.contains('is-editing')) return;
        
        if (ev.ctrlKey || ev.metaKey) {
          if (linkingSource) return;
          linkingSource = entry;
          entry.classList.add('linking-source');
          
          tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          tempLine.setAttribute("stroke", this.getSettings().theme.linkColor || "white");
          tempLine.setAttribute("stroke-width", "3");
          tempLine.setAttribute("stroke-dasharray", "5,5");
          tempLine.style.pointerEvents = "none";
          
          const sX = parseInt(entry.style.left) + (entry.offsetWidth / 2);
          const sY = parseInt(entry.style.top) + (entry.offsetHeight / 2);
          tempLine.setAttribute("x1", sX);
          tempLine.setAttribute("y1", sY);
          tempLine.setAttribute("x2", sX);
          tempLine.setAttribute("y2", sY);
          
          const svg = board.querySelector('.board-svg');
          if (svg) svg.appendChild(tempLine);
          
          ev.preventDefault();
          return;
        }

        if (linkingSource) return;
        
        // Prevent dragging if clicking near bottom-right (resize handle)
        const content = entry.querySelector('.entry-content');
        if (content) {
          const rect = content.getBoundingClientRect();
          const handleSize = 40 * currentZoom;
          if (ev.clientX > rect.right - handleSize && ev.clientY > rect.bottom - handleSize) {
            return;
          }
        }
        
        draggedEntry = entry;
        startX = ev.clientX;
        startY = ev.clientY;
        initialLeft = parseInt(entry.style.left) || 0;
        initialTop = parseInt(entry.style.top) || 0;
        
        ev.preventDefault();
      });
    });
    
    if (this._boardMoveHandler) document.removeEventListener('mousemove', this._boardMoveHandler);
    if (this._boardUpHandler) document.removeEventListener('mouseup', this._boardUpHandler);

    this._boardMoveHandler = (ev) => {
      if (rAF_frame) return; // Skip if waiting for frame

      rAF_frame = requestAnimationFrame(() => {
        if (isPanning) {
          currentPanX = ev.clientX - panStartX;
          currentPanY = ev.clientY - panStartY;
          applyTransform();
          updateCameraState();
        } else if (draggedEntry) {
          const dx = (ev.clientX - startX) / currentZoom;
          const dy = (ev.clientY - startY) / currentZoom;
          draggedEntry.style.left = `${initialLeft + dx}px`;
          draggedEntry.style.top = `${initialTop + dy}px`;
          updateLines();
        } else if (linkingSource && tempLine) {
          const rect = entriesList.getBoundingClientRect();
          const x = (ev.clientX - rect.left) / currentZoom;
          const y = (ev.clientY - rect.top) / currentZoom;
          tempLine.setAttribute("x2", x);
          tempLine.setAttribute("y2", y);
        }
        rAF_frame = null;
      });
    };

    this._boardUpHandler = async (ev) => {
      if (isPanning) {
        isPanning = false;
        updateCameraState();
        return;
      }

      if (linkingSource) {
        if (tempLine) {
          tempLine.remove();
          tempLine = null;
        }
        linkingSource.classList.remove('linking-source');
        
        const targetEntry = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.quicknotes-entry');
        if (targetEntry && targetEntry !== linkingSource) {
          const sourceId = linkingSource.dataset.entryId;
          const targetId = targetEntry.dataset.entryId;
          this.#createLink(sourceId, targetId);
        }
        linkingSource = null;
        return;
      }

      if (!draggedEntry) return;
      const entryId = draggedEntry.dataset.entryId;
      const sourceTab = draggedEntry.dataset.sourceTab;
      
      let newX = parseInt(draggedEntry.style.left);
      let newY = parseInt(draggedEntry.style.top);

      if (ev.shiftKey || this.getSettings().theme.snapToGrid) {
        newX = Math.round(newX / 20) * 20;
        newY = Math.round(newY / 20) * 20;
      }
      
      draggedEntry.style.left = `${newX}px`;
      draggedEntry.style.top = `${newY}px`;
      updateLines();
      
      draggedEntry.style.zIndex = "10";
      draggedEntry = null;

      await this.#saveDataRaw(sourceTab, entryId, "boardX", newX);
      await this.#saveDataRaw(sourceTab, entryId, "boardY", newY);
    };

    document.addEventListener('mousemove', this._boardMoveHandler);
    document.addEventListener('mouseup', this._boardUpHandler);
  }

  async #createLink(sourceId, targetId) {
    let links = this.#getWorkspaceLinks();
    const [a, b] = [sourceId, targetId].sort();
    const key = `${a}_${b}`;
    
    if (links[key]) return;

    const newLink = { source: sourceId, target: targetId, label: "", style: "solid", color: "" };
    await this.#updateWorkspaceData({ [`flags.notebook.data.links.${key}`]: newLink });
    
    this.render();
  }

  async #deleteLink(s, t) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удаление связи" },
      content: "<p>Вы уверены, что хотите удалить эту нить?</p>",
      rejectClose: false
    });

    if (!proceed) return;

    const [a, b] = [s, t].sort();
    const key = `${a}_${b}`;
    
    await this.#updateWorkspaceData({ [`flags.notebook.data.links.-=${key}`]: null });
    this.render({ parts: ["content"] });
  }

  async #editConnectionSettings(s, t) {
    let links = this.#getWorkspaceLinks();
    const [a, b] = [s, t].sort();
    const key = `${a}_${b}`;
    
    if (!links[key]) return;
    
    const link = links[key];
    const currentLabel = link.label || "";
    const currentColor = link.color || ""; // Empty means default theme color
    const currentStyle = link.style || "solid";
    
    const html = `
      <style>
        .qn-link-setting { margin-bottom: 10px; }
        .qn-link-setting label { display: block; font-weight: bold; margin-bottom: 4px; }
        .qn-link-setting input[type="text"], .qn-link-setting select { width: 100%; padding: 6px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; box-sizing: border-box; }
        .qn-link-setting input[type="color"] { width: 100%; height: 35px; border: none; cursor: pointer; padding: 0; box-sizing: border-box; }
        .qn-color-presets { display: flex; gap: 8px; margin-bottom: 6px; justify-content: space-between; }
        .qn-color-preset { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.2); transition: transform 0.1s; flex-shrink: 0; }
        .qn-color-preset:hover { transform: scale(1.15); box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
      </style>
      <div class="qn-link-setting">
        <label>Текст связи:</label>
        <input type="text" name="label" value="${currentLabel}" placeholder="Например: Враги, Друзья...">
      </div>
      <div class="qn-link-setting">
        <label>Стиль линии:</label>
        <select name="style">
          <option value="solid" ${currentStyle === 'solid' ? 'selected' : ''}>Сплошная</option>
          <option value="dashed" ${currentStyle === 'dashed' ? 'selected' : ''}>Пунктир</option>
          <option value="dotted" ${currentStyle === 'dotted' ? 'selected' : ''}>Точки</option>
        </select>
      </div>
      <div class="qn-link-setting">
        <label>Цвет линии:</label>
        <div class="qn-color-presets">
           <div class="qn-color-preset" style="background: #ffffff;" data-c="#ffffff" title="По умолчанию" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="qn-color-preset" style="background: #f44336;" data-c="#f44336" title="Вражда / Опасность" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="qn-color-preset" style="background: #4caf50;" data-c="#4caf50" title="Союз / Безопасность" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="qn-color-preset" style="background: #2196f3;" data-c="#2196f3" title="Семья / Нейтрально" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="qn-color-preset" style="background: #ff9800;" data-c="#ff9800" title="Важно / Квест" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="qn-color-preset" style="background: #9c27b0;" data-c="#9c27b0" title="Магия / Тайна" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="qn-color-preset" style="background: #9e9e9e;" data-c="#9e9e9e" title="Слух / Прошлое" onclick="this.closest('.qn-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
        </div>
        <input type="color" name="color" value="${currentColor || '#ffffff'}">
        <p style="font-size: 11px; color: #666; margin-top: 2px;">Нажмите на кружок для быстрого выбора или выберите свой цвет. Белый (#ffffff) = цвет по умолчанию.</p>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Настройки связи" },
      content: html,
      buttons: [
        {
          action: "save",
          icon: "fas fa-save",
          label: "Сохранить",
          default: true,
          callback: (event, button, dialog) => {
            return {
              action: "save",
              label: button.form.elements.label.value,
              style: button.form.elements.style.value,
              color: button.form.elements.color.value
            };
          }
        },
        {
          action: "delete",
          icon: "fas fa-trash",
          label: "Удалить связь",
          callback: () => ({ action: "delete" })
        }
      ],
      rejectClose: false
    });

    if (!result) return;

    if (result.action === "delete") {
      await this.#updateWorkspaceData({ [`flags.notebook.data.links.-=${key}`]: null });
    } else {
      const updateData = {};
      updateData[`flags.notebook.data.links.${key}.label`] = result.label.trim() === "" ? null : result.label.trim();
      updateData[`flags.notebook.data.links.${key}.style`] = result.style;
      updateData[`flags.notebook.data.links.${key}.color`] = (result.color === "#ffffff") ? "" : result.color;
      await this.#updateWorkspaceData(updateData);
    }

    this.render({ parts: ["content"] });
  }

  /**
   * Raw saving without debounce for internal actions
   */
  async #saveDataRaw(tab, entryId, field, value) {
    const flagPath = `flags.notebook.data.${tab}.${entryId}.${field}`;
    await this.#updateWorkspaceData({ [flagPath]: value });
  }

  /**
   * Debounced save handler for inputs
   */
  #handleInputDebounced(target) {
    const entryElement = target.closest('.quicknotes-entry');
    const entryId = entryElement.dataset.entryId;
    const sourceTab = entryElement.dataset.sourceTab || this.state.activeTab;
    const field = target.dataset.field;
    
    const debounceKey = `${entryId}-${field}`;
    if (!this._debouncedSaves[debounceKey]) {
      this._debouncedSaves[debounceKey] = foundry.utils.debounce(() => {
        this.#saveDataRaw(sourceTab, entryId, field, target.value);
      }, 500);
    }
    this._debouncedSaves[debounceKey]();
  }

  static async #onSubmitForm(event, form, formData) {}

  // ---- @-Mention Autocomplete System ----
  #bindCustomTooltips(html) {
    let tooltipTimeout;
    let tooltipEl;

    const removeTooltip = () => {
      clearTimeout(tooltipTimeout);
      if (tooltipEl) {
        tooltipEl.style.opacity = '0';
        tooltipEl.style.transform = 'translateX(-50%) translateY(5px)';
        const el = tooltipEl;
        setTimeout(() => { if (el && el.parentNode) el.remove(); }, 300);
        tooltipEl = null;
      }
    };

    html.querySelectorAll('.qn-link-chip').forEach(chip => {
      chip.addEventListener('mouseenter', () => {
        const preview = chip.dataset.qnPreview;
        if (!preview) return;
        const name = chip.textContent.trim();

        tooltipTimeout = setTimeout(() => {
          removeTooltip(); // Clean any existing
          
          tooltipEl = document.createElement('div');
          tooltipEl.className = 'qn-custom-tooltip';
          tooltipEl.innerHTML = `<strong>${name}</strong><div style="margin-top: 4px; opacity: 0.9;">${preview}</div>`;
          document.body.appendChild(tooltipEl);

          const rect = chip.getBoundingClientRect();
          tooltipEl.style.left = (rect.left + rect.width / 2) + 'px';
          tooltipEl.style.top = (rect.top - 5) + 'px';
          
          // Trigger reflow for animation
          tooltipEl.offsetHeight;
          tooltipEl.style.opacity = '1';
          tooltipEl.style.transform = 'translateX(-50%) translateY(-100%)';

        }, 1000); // 1 second delay
      });

      chip.addEventListener('mouseleave', () => {
        clearTimeout(tooltipTimeout);
        removeTooltip();
      });
      
      chip.addEventListener('click', () => {
        clearTimeout(tooltipTimeout);
        removeTooltip();
      });
    });
  }

  #bindMentionAutocomplete(html) {
    // Create a single shared dropdown element
    let dropdown = html.querySelector('.qn-mention-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'qn-mention-dropdown';
      dropdown.style.cssText = `
        position: fixed; z-index: 99999;
        background: #1a1a2e; border: 1px solid rgba(123,97,255,0.6);
        border-radius: 8px; padding: 4px 0; min-width: 200px; max-width: 320px;
        max-height: 200px; overflow-y: auto; display: none;
        box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      `;
      document.body.appendChild(dropdown);
    }

    let activeTextarea = null;
    let atStartPos = -1;

    const closeDropdown = () => {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      atStartPos = -1;
    };

    const getEntries = () => {
      let data = {};
      if (this.state.activeWorkspace !== 'personal') {
        const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('QuickNotes_Shared_DB');
        if (j) data = j.getFlag('notebook', 'data') || {};
      } else {
        data = game.user.getFlag('notebook', 'data') || {};
      }
      const all = [];
      for (const [tab, tabData] of Object.entries(data)) {
        if (tab === 'links' || tab === 'board' || tab === 'search') continue;
        for (const [id, entry] of Object.entries(tabData || {})) {
          if (!entry) continue;
          const name = (entry.name || entry.event || entry.text || '').replace(/<[^>]+>/g, '').trim().slice(0, 60);
          if (name.length > 1) all.push({ id, tab, name });
        }
      }
      return all;
    };

    const insertMention = (textarea, entry) => {
      const val = textarea.value;
      const before = val.slice(0, atStartPos);
      const after = val.slice(textarea.selectionStart);
      const marker = `[[qnmention:${entry.id}:${entry.name}]]{}`;
      textarea.value = before + marker + after;
      const newPos = before.length + marker.length;
      textarea.setSelectionRange(newPos - 1, newPos - 1); // Place cursor inside {}
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      closeDropdown();
      textarea.focus();
    };

    const showDropdown = (textarea, query) => {
      const entries = getEntries().filter(e => e.name.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
      if (!entries.length) { closeDropdown(); return; }

      dropdown.innerHTML = '';
      entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'qn-mention-item';
        item.style.cssText = `
          padding: 6px 12px; cursor: pointer; font-size: 13px;
          color: #e0e0e0; transition: background 0.15s;
        `;
        item.innerHTML = `<i class="fas fa-tag" style="color:#7b61ff;margin-right:6px;font-size:11px;"></i>${entry.name}`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          insertMention(textarea, entry);
        });
        item.addEventListener('mouseover', () => { item.style.background = 'rgba(123,97,255,0.2)'; });
        item.addEventListener('mouseout', () => { item.style.background = ''; });
        dropdown.appendChild(item);
      });

      const rect = textarea.getBoundingClientRect();
      dropdown.style.display = 'block';
      dropdown.style.left = rect.left + 'px';
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.width = rect.width + 'px';
    };

    html.querySelectorAll('textarea.quicknotes-input').forEach(textarea => {
      textarea.addEventListener('input', (ev) => {
        const pos = textarea.selectionStart;
        const val = textarea.value;
        // Find last @ before cursor
        const textBeforeCursor = val.slice(0, pos);
        const atIdx = textBeforeCursor.lastIndexOf('@');
        if (atIdx === -1) { closeDropdown(); return; }
        const query = textBeforeCursor.slice(atIdx + 1);
        // @ must not have spaces (so we stop completing on space)
        if (query.includes(' ') || query.includes('\n')) { closeDropdown(); return; }
        atStartPos = atIdx;
        activeTextarea = textarea;
        showDropdown(textarea, query);
      });

      textarea.addEventListener('keydown', (ev) => {
        if (dropdown.style.display === 'none') return;
        const items = dropdown.querySelectorAll('.qn-mention-item');
        const current = dropdown.querySelector('.qn-mention-item.active');
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          const next = current ? current.nextElementSibling : items[0];
          if (current) current.classList.remove('active');
          if (next) { next.classList.add('active'); next.style.background = 'rgba(123,97,255,0.2)'; }
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          const prev = current ? current.previousElementSibling : items[items.length - 1];
          if (current) current.classList.remove('active');
          if (prev) { prev.classList.add('active'); prev.style.background = 'rgba(123,97,255,0.2)'; }
        } else if (ev.key === 'Enter' && current) {
          ev.preventDefault();
          current.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        } else if (ev.key === 'Escape') {
          closeDropdown();
        }
      });

      textarea.addEventListener('blur', () => {
        setTimeout(closeDropdown, 150);
      });
    });

    // Render mention links in view mode (already-saved mentions)
    html.querySelectorAll('.display-text, .display-gm-notes, .timeline-event').forEach(el => {
      el.innerHTML = el.innerHTML.replace(
        /\[\[qnmention:([^:]+):([^\]]+)\]\](?:\{([^}]*)\})?/g,
        (_, id, name, customText) => {
          const displayText = customText || name;
          return `<a class="qn-mention-link" data-mention-id="${id}" style="color:#7b61ff;cursor:pointer;text-decoration:underline;font-weight:500;" title="Перейти к записи: ${name}">@${displayText}</a>`;
        }
      );
    });

    html.querySelectorAll('.qn-mention-link').forEach(link => {
      link.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const targetId = link.dataset.mentionId;
        if (!targetId) return;
        // Jump to linked entry (reuse existing jumpToLinked logic)
        let data = {};
        if (this.state.activeWorkspace !== 'personal') {
          const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('QuickNotes_Shared_DB');
          if (j) data = j.getFlag('notebook', 'data') || {};
        } else {
          data = game.user.getFlag('notebook', 'data') || {};
        }
        let targetTab = null;
        for (const [tab, tabData] of Object.entries(data)) {
          if (tab === 'links' || tab === 'board' || tab === 'search') continue;
          if (tabData && tabData[targetId]) { targetTab = tab; break; }
        }
        if (!targetTab) { ui.notifications.warn('Запись не найдена.'); return; }
        await game.user.setFlag('notebook', 'lastTab', targetTab);
        this.state.activeTab = targetTab;
        this.state.highlightedEntryId = targetId;
        // Full render so the tabs nav also updates to the new active tab
        await this.render();
        // Scroll highlighted card into view after DOM update
        setTimeout(() => {
          const el = this.element?.querySelector(`.quicknotes-entry[data-entry-id="${targetId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        const settings = this.getSettings();
        const durationMs = (settings.theme.highlightDuration || 2) * 1000;
        setTimeout(() => {
          if (this.state.highlightedEntryId === targetId) {
            this.state.highlightedEntryId = null;
            const el = this.element?.querySelector(`.quicknotes-entry[data-entry-id="${targetId}"]`);
            if (el) el.classList.remove('is-highlighted');
          }
        }, durationMs);
      });
    });
  }



  static async #onToggleZenMode(event, target) {
    this.state.isZenMode = !this.state.isZenMode;
    if (this.state.isZenMode) {
      this.element.classList.add("zen-mode");
      target.innerHTML = `<i class="fas fa-compress"></i>`;
    } else {
      this.element.classList.remove("zen-mode");
      target.innerHTML = `<i class="fas fa-expand"></i>`;
    }
  }

  static async #onToggleMode(event, target) {
    this.state.isShared = !this.state.isShared;
    this.render({ parts: ["content"] });
  }
  
  static async #onToggleEdit(event, target) {
    if (this.state.isReadOnly) return;
    const entry = target.closest('.quicknotes-entry');
    const entryId = entry.dataset.entryId;
    
    if (this.state.editingEntryId === entryId) {
      this.state.editingEntryId = null;
    } else {
      this.state.editingEntryId = entryId;
    }
    this.render({ parts: ["content"] });
  }

  static async #onToggleVisibility(event, target) {
    const entry = target.closest('.quicknotes-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;
    
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) data = journal.getFlag("notebook", "data") || {};
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }
    
    const currentEntry = data[sourceTab]?.[entryId];
    if (!currentEntry) return;
    
    await this.#saveDataRaw(sourceTab, entryId, "isHidden", !currentEntry.isHidden);
    this.render({ parts: ["content"] });
  }

  static async #onShareEntry(event, target) {
    const entryElement = target.closest('.quicknotes-entry');
    const entryId = entryElement.dataset.entryId;
    const sourceTab = entryElement.dataset.sourceTab || this.state.activeTab;
    
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) data = journal.getFlag("notebook", "data") || {};
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }
    
    const entry = data[sourceTab]?.[entryId];
    if (!entry) return;
    
    // Process text for chat (enrich UUID links)
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
    const processUUIDs = (text) => {
      if (!text) return text;
      const uuidRegex = /(?<!@UUID\[)\b(?:Actor|Item|JournalEntry|JournalEntryPage|Scene|RollTable|Cards|Macro|Playlist|User)(?:\.[a-zA-Z0-9_-]+)+\b/g;
      let newText = text.replace(uuidRegex, match => `@UUID[${match}]`);
      const compendiumRegex = /(?<!@UUID\[)\bCompendium\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+\b/g;
      newText = newText.replace(compendiumRegex, match => `@UUID[${match}]`);
      return newText;
    };
    
    const enrich = async (t) => await TE.enrichHTML(processUUIDs(t), { async: true });
    
    let contentHTML = `<div class="qn-chat-message color-${entry.color || 'yellow'}">`;
    
    if (sourceTab === "notes") {
      contentHTML += `<div class="qn-chat-body">${await enrich(entry.text)}</div>`;
    } else if (sourceTab === "npc") {
      contentHTML += `<h3 class="qn-chat-title"><i class="fas fa-user"></i> ${entry.name || "Неизвестный NPC"}</h3>`;
      if (entry.location) contentHTML += `<p><strong>Локация:</strong> ${entry.location}</p>`;
      if (entry.attitude) contentHTML += `<p><strong>Отношение:</strong> ${entry.attitude}</p>`;
      if (entry.note) contentHTML += `<div class="qn-chat-body">${await enrich(entry.note)}</div>`;
    } else if (sourceTab === "quests") {
      const statusIcon = entry.status === "completed" ? "fa-check-circle" : (entry.status === "failed" ? "fa-times-circle" : "fa-clock");
      contentHTML += `<h3 class="qn-chat-title"><i class="fas fa-scroll"></i> Задание <i class="fas ${statusIcon} qn-status-${entry.status}"></i></h3>`;
      contentHTML += `<div class="qn-chat-body">${await enrich(entry.text)}</div>`;
    } else if (sourceTab === "timeline") {
      contentHTML += `<h3 class="qn-chat-title"><i class="fas fa-hourglass-half"></i> ${entry.time || "Неизвестное время"}</h3>`;
      contentHTML += `<div class="qn-chat-body">${await enrich(entry.event)}</div>`;
    }
    
    contentHTML += `</div>`;
    
    ChatMessage.create({
      author: game.user.id,
      content: contentHTML
    });
    
    ui.notifications.info("Запись отправлена в чат!");
  }

  static async #onExportJSON(event, target) {
    let data = {};
    const workspaceName = this.state.activeWorkspace !== "personal" 
      ? game.journal.get(this.state.activeWorkspace)?.name || "shared_board"
      : "personal_board";

    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) data = journal.getFlag("notebook", "data") || {};
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }

    const exportData = {
      entries: [],
      links: data.links || []
    };

    // Flatten entries across tabs
    for (const [tabKey, tabData] of Object.entries(data)) {
      if (tabKey === "links" || tabKey === "board" || tabKey === "search") continue;
      for (const [id, entry] of Object.entries(tabData || {})) {
        if (!entry) continue;
        exportData.entries.push({
          id,
          tab: tabKey,
          ...entry
        });
      }
    }

    const jsonStr = JSON.stringify(exportData, null, 2);
    saveDataToFile(jsonStr, "application/json", `cluebook_${workspaceName.replace(/\s+/g, '_')}.json`);
    ui.notifications.info("Доска успешно экспортирована!");
  }

  static async #onEditWorkspace(event, target) {
    const isPersonal = this.state.activeWorkspace === "personal" || this.state.activeWorkspace.startsWith("personal_");
    
    let currentName;
    if (this.state.activeWorkspace === "personal") {
      currentName = game.user.getFlag("notebook", "personalWorkspaceName") || "Личный блокнот";
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const u = game.users.get(this.state.activeWorkspace.split("_")[1]);
      currentName = u ? (u.getFlag("notebook", "personalWorkspaceName") || `Личный блокнот (${u.name})`) : "Личный блокнот";
    } else {
      currentName = game.journal.get(this.state.activeWorkspace)?.name || "Общая доска";
    }

    if (isPersonal) {
      if (this.state.activeWorkspace.startsWith("personal_")) {
        ui.notifications.warn("Нельзя переименовывать чужие личные блокноты.");
        return;
      }
      const newName = await foundry.applications.api.DialogV2.prompt({
        window: { title: "Переименовать личный блокнот" },
        content: `<p>Введите новое название:</p><input type="text" name="wsName" value="${currentName}" autofocus>`,
        ok: { callback: (event, button) => button.form.elements.wsName.value },
        rejectClose: false
      });
      if (newName && newName.trim() !== "" && newName !== currentName) {
        await game.user.setFlag("notebook", "personalWorkspaceName", newName.trim());
        this.render({ parts: ["content"] });
      }
      return;
    }

    const journal = game.journal.get(this.state.activeWorkspace);
    if (!journal) return;

    // Check ownership
    const isOwner = journal.isOwner;
    if (!isOwner) {
      ui.notifications.warn("Только владелец или Мастер может изменять настройки этой доски.");
      return;
    }

    const currentOwnership = journal.ownership || {};
    let userCheckboxes = '';
    
    game.users.forEach(u => {
      if (u.id === game.user.id || u.isGM) return; // Self and GM always have access
      const hasAccess = currentOwnership[u.id] === 3;
      userCheckboxes += `<label style="display:block; margin-bottom: 5px;"><input type="checkbox" name="user_${u.id}" ${hasAccess ? 'checked' : ''}> ${u.name}</label>`;
    });

    const content = `
      <form>
        <div class="form-group">
          <label>Название доски:</label>
          <input type="text" name="workspaceName" value="${currentName}" required autofocus>
        </div>
        <hr>
        <div class="form-group">
          <label>Кто имеет доступ (Вы и Мастер всегда имеют доступ):</label>
          <div style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.1); padding: 5px; border-radius: 5px; margin-top: 5px;">
            ${userCheckboxes || "<em>Нет других игроков</em>"}
          </div>
        </div>
      </form>
    `;

    const dialog = new Dialog({
      title: "Настройки доски",
      content: content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Сохранить",
          callback: async (html) => {
            const newName = html.find('[name="workspaceName"]').val();
            if (!newName) return;

            // Gather permissions
            const ownership = { default: currentOwnership.default || 0 };
            ownership[game.user.id] = 3; // OWNER
            game.users.filter(u => u.isGM).forEach(gm => ownership[gm.id] = 3);

            html.find('input[type="checkbox"]').each(function() {
              const userId = this.name.split('_')[1];
              if (userId) {
                if (this.checked) ownership[userId] = 3; // Give OWNER access
                else ownership[userId] = 0; // Revoke access
              }
            });

            await journal.update({ name: newName.trim(), ownership: ownership });
            this.render({ parts: ["content"] });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Отмена"
        }
      },
      default: "save"
    });
    dialog.render(true);
  }

  static async #onDeleteWorkspace(event, target) {
    if (!game.user.isGM) {
      ui.notifications.warn("Удалять доски может только Мастер.");
      return;
    }
    if (this.state.activeWorkspace === "personal" || this.state.activeWorkspace.startsWith("personal_")) {
      ui.notifications.warn("Личные блокноты нельзя удалить.");
      return;
    }

    const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
    if (!journal) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удалить доску" },
      content: `<p>Удалить доску <strong>${journal.name}</strong>? Все данные будут потеряны безвозвратно.</p>`,
      rejectClose: false
    });
    if (!confirmed) return;

    await journal.delete();
    this.state.activeWorkspace = "personal";
    await game.user.setFlag("notebook", "lastWorkspace", "personal");
    this.render({ parts: ["content"] });
  }

  static _parseTimelineDateString(str) {
    if (!str) return 0;
    // Try to match DD.MM.YYYY
    const dateMatch = str.match(/(\d{1,2})[\.\-](\d{1,2})[\.\-](\d{4})/);
    if (!dateMatch) return 0; 
  
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1; // 0-indexed
    const year = parseInt(dateMatch[3], 10);
  
    let hours = 0;
    let minutes = 0;
    let extraWeight = 0;
  
    // Try to match HH:MM
    const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
    } else {
      const lowerStr = str.toLowerCase();
      if (lowerStr.includes("утро") || lowerStr.includes("утром")) hours = 8;
      else if (lowerStr.includes("день") || lowerStr.includes("днем")) hours = 12;
      else if (lowerStr.includes("вечер") || lowerStr.includes("вечером")) hours = 18;
      else if (lowerStr.includes("ночь") || lowerStr.includes("ночью")) hours = 23;
      else if (lowerStr.includes("ближайшее время") || lowerStr.includes("скоро")) {
        hours = 23; minutes = 59; extraWeight = 1; 
      } else {
        hours = 0; minutes = 0; 
      }
    }
  
    const d = new Date(year, month, day, hours, minutes, 0);
    return d.getTime() + extraWeight;
  }

  static async #onSortTimeline(event, target) {
    let data = {};
    if (this.state.activeWorkspace === "personal") {
      data = game.user.getFlag("notebook", "data") || {};
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      data = u ? u.getFlag("notebook", "data") || {} : {};
    } else {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      data = journal ? journal.getFlag("notebook", "data") || {} : {};
    }

    const timelineData = data.timeline;
    if (!timelineData) return;

    const entries = Object.entries(timelineData);
    entries.sort((a, b) => {
      const timeA = QuickNotesApp._parseTimelineDateString(a[1].time || "");
      const timeB = QuickNotesApp._parseTimelineDateString(b[1].time || "");
      if (timeA !== timeB) return timeA - timeB;
      return (a[1].sort || 0) - (b[1].sort || 0);
    });

    const updates = {};
    entries.forEach(([id, entry], index) => {
      updates[`flags.notebook.data.timeline.${id}.sort`] = index;
    });

    await this.#updateWorkspaceData(updates);
    ui.notifications.info("Хронология отсортирована по датам.");
    this.render({ parts: ["content"] });
  }

  static async #onJumpToBoard(event, target) {
    const entry = target.closest('.quicknotes-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;
    
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) data = journal.getFlag("notebook", "data") || {};
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }
    
    const entryData = data[sourceTab]?.[entryId];
    if (!entryData || !entryData.onBoard) return;
    
    const bx = entryData.boardX || 0;
    const by = entryData.boardY || 0;
    
    const zoom = 0.7; // Fixed zoom
    const W = this.position.width;
    const H = this.position.height - 50; // offset for tabs
    
    // Approximate card center
    const cardCenterX = bx + 100;
    const cardCenterY = by + 50;
    
    const panX = W / 2 - (cardCenterX * zoom);
    const panY = H / 2 - (cardCenterY * zoom);
    
    this.state.camera = { zoom, panX, panY };
    this.state.activeTab = "board";
    this.state.highlightedEntryId = entryId;
    
    // Update DB with new camera
    game.user.update({ "flags.notebook.boardCamera": this.state.camera });
    
    this.render({ parts: ["content"] });
    
    const settings = this.getSettings();
    const durationMs = (settings.theme.highlightDuration || 2) * 1000;
    setTimeout(() => {
       if (this.state.highlightedEntryId === entryId) {
          this.state.highlightedEntryId = null;
          const el = this.element.querySelector(`.quicknotes-entry[data-entry-id="${entryId}"]`);
          if (el) el.classList.remove('is-highlighted');
       }
    }, durationMs);
  }

  static async #onJumpToLinked(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    if (!targetId) return;

    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) data = journal.getFlag("notebook", "data") || {};
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }

    let targetEntry = null;
    let targetTab = null;

    for (const [tabKey, tabData] of Object.entries(data)) {
      if (tabKey === "links" || tabKey === "search" || tabKey === "board") continue;
      if (tabData?.[targetId]) {
        targetEntry = tabData[targetId];
        targetTab = tabKey;
        break;
      }
    }

    if (!targetEntry) return;

    // Smart Jump Logic
    if (targetEntry.onBoard) {
      const bx = targetEntry.boardX || 0;
      const by = targetEntry.boardY || 0;
      const zoom = 0.7; 
      const W = this.position.width;
      const H = this.position.height - 50; 
      const panX = W / 2 - ((bx + 100) * zoom);
      const panY = H / 2 - ((by + 50) * zoom);
      
      this.state.camera = { zoom, panX, panY };
      this.state.activeTab = "board";
      game.user.update({ "flags.notebook.boardCamera": this.state.camera });
    } else {
      this.state.activeTab = targetTab;
    }
    
    await game.user.setFlag("notebook", "lastTab", this.state.activeTab);
    this.state.highlightedEntryId = targetId;
    // Full render so the tabs nav also updates to the new active tab
    await this.render();

    // Scroll highlighted card into view after DOM update
    setTimeout(() => {
      const el = this.element?.querySelector(`.quicknotes-entry[data-entry-id="${targetId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    const settings = this.getSettings();
    const durationMs = (settings.theme.highlightDuration || 2) * 1000;
    setTimeout(() => {
       if (this.state.highlightedEntryId === targetId) {
          this.state.highlightedEntryId = null;
          const el = this.element?.querySelector(`.quicknotes-entry[data-entry-id="${targetId}"]`);
          if (el) el.classList.remove('is-highlighted');
       }
    }, durationMs);
  }

  static async #onCreateSuggestedLink(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    const entry = target.closest('.quicknotes-entry');
    const sourceId = entry.dataset.entryId;
    if (!targetId || !sourceId) return;

    let links = this.#getWorkspaceLinks();
    const [a, b] = [sourceId, targetId].sort();
    const key = `${a}_${b}`;
    
    if (!links[key]) {
      const newLink = { source: sourceId, target: targetId, label: "", style: "solid", color: "" };
      await this.#updateWorkspaceData({ [`flags.notebook.data.links.${key}`]: newLink });
      ui.notifications.info("Связь успешно создана!");
      this.render({ parts: ["content"] });
    }
  }

  static async #onDeleteLink(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    const entry = target.closest('.quicknotes-entry');
    const sourceId = entry.dataset.entryId;
    if (!targetId || !sourceId) return;

    let links = this.#getWorkspaceLinks();
    const [a, b] = [sourceId, targetId].sort();
    const key = `${a}_${b}`;

    if (links[key]) {
      await this.#updateWorkspaceData({ [`flags.notebook.data.links.-=${key}`]: null });
      ui.notifications.info("Связь удалена.");
      this.render({ parts: ["content"] });
    }
  }

  static async #onDismissSuggestedLink(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    const entry = target.closest('.quicknotes-entry');
    const sourceId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab;
    if (!targetId || !sourceId || !sourceTab) return;

    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) data = journal.getFlag("notebook", "data") || {};
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }

    const entryData = data[sourceTab]?.[sourceId];
    if (entryData) {
      const dismissed = entryData.dismissedLinks || [];
      if (!dismissed.includes(targetId)) {
        dismissed.push(targetId);
        await QuickNotesApp.#saveDataRaw(sourceTab, sourceId, "dismissedLinks", dismissed);
        this.render({ parts: ["content"] });
      }
    }
  }


  static async #onImportJSON(event, target) {
    const jsonStr = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Импорт сценария из AI (JSON)", resizable: true },
      position: { width: 600, height: 400 },
      content: `<p>Вставьте сгенерированный нейросетью JSON-код сюда:</p><textarea name="jsonInput" style="width: 100%; height: 250px; font-family: monospace;" autofocus></textarea>`,
      ok: { callback: (event, button) => button.form.elements.jsonInput.value },
      rejectClose: false
    });

    if (!jsonStr) return;

    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
        ui.notifications.error("Неверный формат JSON: отсутствует массив 'entries'.");
        return;
      }

      const updateData = {};
      const idMap = {};
      
      let data = {};
      if (this.state.activeWorkspace !== "personal") {
        const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
        if (journal) data = journal.getFlag("notebook", "data") || {};
      } else {
        data = game.user.getFlag("notebook", "data") || {};
      }

      let gridX = 100;
      let gridY = 100;
      const xSpacing = 350;
      const ySpacing = 250;
      const maxColumns = 4;
      let currentIdx = 0;

      // Process entries
      for (const entry of parsed.entries) {
        const tempId = entry.id;
        const realId = foundry.utils.randomID();
        if (tempId) idMap[tempId] = realId;

        const tab = entry.tab || "notes";
        delete entry.id;
        delete entry.tab;

        // Auto-place on board in a grid if coords are missing or identical default values
        if (entry.boardX === undefined || entry.boardY === undefined || (entry.boardX === 100 && entry.boardY === 100)) {
          entry.boardX = gridX + (currentIdx % maxColumns) * xSpacing;
          entry.boardY = gridY + Math.floor(currentIdx / maxColumns) * ySpacing;
          currentIdx++;
        }
        
        entry.onBoard = true;

        updateData[`flags.notebook.data.${tab}.${realId}`] = entry;
      }

      // Process links
      let links = foundry.utils.deepClone(data.links || []);
      if (parsed.links && Array.isArray(parsed.links)) {
        for (const link of parsed.links) {
          const s = idMap[link.source];
          const t = idMap[link.target];
          if (s && t) {
            links.push({ source: s, target: t, label: link.label || "" });
          }
        }
        updateData["flags.notebook.data.links"] = links;
      }

      await this.#updateWorkspaceData(updateData);
      ui.notifications.info(`Успешно импортировано ${parsed.entries.length} записей!`);
      this.render({ parts: ["content"] });

    } catch (err) {
      console.error(err);
      ui.notifications.error("Ошибка при чтении JSON. Проверьте синтаксис.");
    }
  }

  static async #onCopyDataFormat(event, target) {
    const formatText = `Структура данных модуля QuickNotes (JSON):

ГЛОБАЛЬНАЯ СТРУКТУРА:
1. Массив "entries" — содержит все карточки.
2. Массив "links" — содержит связи между карточками.

КАРТОЧКИ ("entries"):
Обязательные поля:
- "id": Уникальный строковый идентификатор. (Важно: используйте простые ID, например "npc1", "clue2").
- "tab": Тип карточки ("notes", "npc", "quests", "timeline").
- "color": Цвет карточки ("yellow", "red", "green", "blue", "purple").
- "boardX", "boardY": Координаты на доске. Чтобы карточки не слипались, делайте между ними расстояние минимум 300 по X и 250 по Y (например: 100, 450, 800...).

Поля в зависимости от типа ("tab"):
- notes (Заметка): "text" (основной текст).
- npc (Персонаж): "name" (имя), "location" (локация), "attitude" (отношение), "note" (описание).
- quests (Квест): "text" (описание), "status" (состояние: "active", "completed", "failed").
- timeline (Событие): "time" (когда), "event" (что произошло).
- Во всех карточках может присутствовать поле "gmNotes" (скрытые записи Мастера).

ИСПОЛЬЗОВАНИЕ ССЫЛОК В ТЕКСТАХ:
Вы можете вставлять кликабельные ссылки внутрь текстовых полей ("text", "note", "event", "gmNotes"):
1. Ссылки на сущности Foundry VTT: Просто пишите UUID сущности (например, Actor.rD8k1q6zP4dG8v9x) или используйте стандартный формат @UUID[Actor.id]. Модуль сам сделает их кликабельными.
2. Ссылки на другие карточки QuickNotes: Используйте формат [[qnmention:ID_ЦЕЛЕВОЙ_КАРТОЧКИ:Отображаемое Имя]]. Например: "Встретиться с [[qnmention:npc1:Мэром Гудвином]] в ратуше". При клике на такую ссылку модуль переведет на нужную вкладку и подсветит карточку.

СВЯЗИ ("links"):
- "source": id исходной карточки.
- "target": id целевой карточки.
- "label": текст подписи на линии (опционально).
ВНИМАНИЕ: ID в "source" и "target" должны СТРОГО совпадать с "id" из блока "entries", иначе связь сломается!

Пример минимального JSON с внутренней ссылкой:
{
  "entries": [
    {
      "id": "npc1",
      "tab": "npc",
      "color": "green",
      "name": "Мэр Гудвин",
      "boardX": 100,
      "boardY": 100
    },
    {
      "id": "note1",
      "tab": "notes",
      "color": "yellow",
      "text": "Задание получено от [[qnmention:npc1:Мэра Гудвина]].",
      "boardX": 450,
      "boardY": 100
    }
  ],
  "links": []
}`;
    try {
      await navigator.clipboard.writeText(formatText);
      ui.notifications.info("Формат данных (Структура JSON) скопирован в буфер обмена!");
    } catch (err) {
      console.error(err);
      ui.notifications.error("Не удалось скопировать в буфер обмена. Возможно, нет прав доступа.");
    }
  }

  static async #onSelectColor(event, target) {
    if (this.state.isReadOnly) return;
    const entry = target.closest('.quicknotes-entry');
    const color = target.dataset.color;
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;

    // Update DOM immediately for responsiveness
    entry.dataset.color = color;

    // Save to flags
    await this.#saveDataRaw(sourceTab, entryId, "color", color);
  }

  static async #onSendToBoard(event, target) {
    const entry = target.closest('.quicknotes-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;
    
    // Toggle board status
    const isOnBoard = entry.dataset.onBoard === "true";
    const newValue = !isOnBoard;

    await this.#saveDataRaw(sourceTab, entryId, "onBoard", newValue);
    this.render({ parts: ["content"] });
  }

  static async #onRemoveFromBoard(event, target) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Убрать с доски" },
      content: "<p>Убрать эту запись с доски? (Она останется в своей вкладке)</p>",
      rejectClose: false
    });

    if (!proceed) return;

    const entry = target.closest('.quicknotes-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab;

    await this.#saveDataRaw(sourceTab, entryId, "onBoard", false);
    
    // Delete associated links
    let links = this.#getWorkspaceLinks();
    const updates = {};
    let linkDeleted = false;
    for (const [key, l] of Object.entries(links)) {
      if (l.source === entryId || l.target === entryId) {
        updates[`flags.notebook.data.links.-=${key}`] = null;
        linkDeleted = true;
      }
    }
    
    if (linkDeleted) {
      await this.#updateWorkspaceData(updates);
    }
    this.render({ parts: ["content"] });
  }

  static async #onAddEntry(event, target) {
    const id = foundry.utils.randomID();
    const activeTab = this.state.activeTab;
    const newEntry = this.#getEmptyEntryForTab(activeTab);
    
    // Assign highest sort order
    let maxSort = 0;
    const document = this.#getWorkspaceJournal() || game.user;
    const currentData = document.getFlag("notebook", "data")?.[activeTab] || {};
    Object.values(currentData).forEach(e => {
      if (e && e.sort !== undefined && e.sort > maxSort) maxSort = e.sort;
    });
    newEntry.sort = maxSort + 1;
    
    const flagPath = `flags.notebook.data.${activeTab}.${id}`;
    const updateData = { [flagPath]: newEntry };

    await this.#updateWorkspaceData(updateData);
    
    // Automatically start editing the new entry
    this.state.editingEntryId = id;

    // Refresh to show new entry
    this.render({ parts: ["content"] });
  }

  static async #onDeleteEntry(event, target) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удаление записи" },
      content: "<p>Вы уверены, что хотите удалить эту запись?</p>",
      rejectClose: false
    });

    if (!proceed) return;

    const entryId = target.closest('.quicknotes-entry').dataset.entryId;
    const activeTab = this.state.activeTab;
    
    const document = this.#getWorkspaceJournal() || game.user;
    
    // Also delete any associated links
    let links = this.#getWorkspaceLinks();
    const updates = {};
    for (const [key, l] of Object.entries(links)) {
      if (l.source === entryId || l.target === entryId) {
        updates[`flags.notebook.data.links.-=${key}`] = null;
      }
    }
    if (Object.keys(updates).length > 0) {
      await this.#updateWorkspaceData(updates);
    }

    await document.unsetFlag("notebook", `data.${activeTab}.${entryId}`);
    
    this.render({ parts: ["content"] });
  }

  #getEmptyEntryForTab(tab) {
    const settings = this.getSettings();
    const defaultColor = settings.defaultColors[tab] || "yellow";
    const base = { color: defaultColor, onBoard: false, boardX: 100, boardY: 100 };
    switch (tab) {
      case "notes": return { ...base, text: "" };
      case "npc": return { ...base, name: "", location: "", attitude: "", note: "" };
      case "quests": return { ...base, text: "", status: "active", deadline: "" };
      case "timeline": return { ...base, time: "", event: "" };
      default: return { ...base };
    }
  }
  #getWorkspaceJournal() {
    if (this.state.activeWorkspace === "personal" || this.state.activeWorkspace.startsWith("personal_")) return null;
    return game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
  }

  async #updateWorkspaceData(updateData) {
    const journal = this.#getWorkspaceJournal();
    if (journal) {
      await journal.update(updateData);
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      if (u && game.user.isGM) await u.update(updateData);
    } else {
      await game.user.update(updateData);
    }
  }

  #getWorkspaceLinks() {
    const journal = this.#getWorkspaceJournal();
    if (journal) return journal.getFlag("notebook", "data.links") || {};
    if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      if (u && game.user.isGM) return u.getFlag("notebook", "data.links") || {};
    }
    return game.user.getFlag("notebook", "data.links") || {};
  }
  async #createNewWorkspace() {
    let userCheckboxes = '';
    game.users.forEach(u => {
      if (u.id === game.user.id || u.isGM) return; // Self and GM always have access
      userCheckboxes += `<label style="display:block; margin-bottom: 5px;"><input type="checkbox" name="user_${u.id}"> ${u.name}</label>`;
    });

    const content = `
      <form>
        <div class="form-group">
          <label>Название доски/блокнота:</label>
          <input type="text" name="workspaceName" value="Новая доска" required autofocus>
        </div>
        <hr>
        <div class="form-group">
          <label>Кто имеет доступ (Вы и Мастер всегда имеют доступ):</label>
          <div style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.1); padding: 5px; border-radius: 5px; margin-top: 5px;">
            ${userCheckboxes || "<em>Нет других игроков</em>"}
          </div>
        </div>
      </form>
    `;

    const dialog = new Dialog({
      title: "Создать новую доску",
      content: content,
      buttons: {
        create: {
          icon: '<i class="fas fa-check"></i>',
          label: "Создать",
          callback: async (html) => {
            const name = html.find('[name="workspaceName"]').val();
            if (!name) return;

            // Gather permissions
            const ownership = { default: 0 };
            ownership[game.user.id] = 3; // OWNER
            
            game.users.filter(u => u.isGM).forEach(gm => ownership[gm.id] = 3);

            html.find('input[type="checkbox"]:checked').each(function() {
              const userId = this.name.split('_')[1];
              if (userId) ownership[userId] = 3; // Give OWNER access to selected users
            });

            // Ensure folder exists
            let folder = game.folders.find(f => f.name === "QuickNotes Boards" && f.type === "JournalEntry");
            if (!folder && game.user.isGM) {
              folder = await Folder.create({ name: "QuickNotes Boards", type: "JournalEntry" });
            }

            // Create Journal
            const journal = await JournalEntry.create({
              name: name,
              folder: folder ? folder.id : null,
              ownership: ownership,
              flags: {
                notebook: {
                  isWorkspace: true,
                  data: {} // Empty initial data
                }
              }
            });

            if (journal) {
              this.state.activeWorkspace = journal.id;
              this.render();
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Отмена"
        }
      },
      default: "create"
    });
    dialog.render(true);
  }

  static async showQuickAddDialog(type, activeWorkspace = null) {
    if (!activeWorkspace) {
      const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "QuickNotesApp");
      activeWorkspace = app ? app.state.activeWorkspace : (game.user?.getFlag("notebook", "lastWorkspace") || "personal");
    }
    let content = '';
    let title = '';

    if (type === "notes") {
      title = "Добавить заметку";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="name" class="quicknotes-input" placeholder="Название (необязательно)" style="width: 100%;" autofocus onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const next = this.closest('.window-content').querySelector('textarea'); if (next) next.focus(); }">
          <textarea name="text" class="quicknotes-input" placeholder="Текст заметки..." style="width: 100%; min-height: 80px;" onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    } else if (type === "npc") {
      title = "Добавить персонажа";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="name" class="quicknotes-input" placeholder="Имя" style="width: 100%;" autofocus onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('input[name=location]').focus(); }">
          <input type="text" name="location" class="quicknotes-input" placeholder="Локация" style="width: 100%;" onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('input[name=attitude]').focus(); }">
          <input type="text" name="attitude" class="quicknotes-input" placeholder="Отношение" style="width: 100%;" onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('textarea[name=note]').focus(); }">
          <textarea name="note" class="quicknotes-input" placeholder="Описание..." style="width: 100%; min-height: 60px;" onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    } else if (type === "quests") {
      title = "Добавить квест";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <select name="status" class="quicknotes-input" style="width: 100%;">
            <option value="active">Активно</option>
            <option value="completed">Выполнено</option>
            <option value="failed">Провалено</option>
          </select>
          <textarea name="text" class="quicknotes-input" placeholder="Описание квеста..." style="width: 100%; min-height: 80px;" autofocus onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    } else if (type === "timeline") {
      title = "Добавить событие";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="time" class="quicknotes-input" placeholder="Время / Дата" style="width: 100%;" autofocus onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('textarea[name=event]').focus(); }">
          <textarea name="event" class="quicknotes-input" placeholder="Описание события..." style="width: 100%; min-height: 80px;" onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    }

    content += `
      <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 10px;">
        <label style="font-size: 12px; color: var(--qn-text-muted);">Цвет карточки:</label>
        <select name="color" class="quicknotes-input" style="width: 100%;">
          <option value="default">По умолчанию</option>
          <option value="yellow">Желтый</option>
          <option value="green">Зеленый</option>
          <option value="blue">Синий</option>
          <option value="red">Красный</option>
          <option value="purple">Фиолетовый</option>
        </select>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `<form>${content}</form>`,
      ok: {
        label: "Создать",
        icon: "fas fa-check",
        callback: (event, button, dialog) => {
          const formElement = event.target.closest('form') || event.target.closest('.window-app').querySelector('form');
          const formData = new FormData(formElement);
          return Object.fromEntries(formData.entries());
        }
      }
    });

    if (!result) return;

    const entryId = foundry.utils.randomID();
    const settings = game.user.getFlag("notebook", "settings") || {};
    const defaultColor = settings.defaultColors?.[type] || "yellow";

    let maxSort = 0;
    let document = game.user;
    if (activeWorkspace !== "personal") {
      document = game.journal.get(activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB") || game.user;
    }
    const currentData = document.getFlag("notebook", "data")?.[type] || {};
    Object.values(currentData).forEach(e => {
      if (e && e.sort !== undefined && e.sort > maxSort) maxSort = e.sort;
    });

    const entryData = {
      id: entryId,
      sourceTab: type,
      color: result.color === "default" ? defaultColor : result.color,
      onBoard: false,
      isHidden: false,
      sort: maxSort + 1
    };

    delete result.color;
    Object.assign(entryData, result);

    const flagPath = `flags.notebook.data.${type}.${entryId}`;
    
    if (activeWorkspace !== "personal") {
      const journal = game.journal.get(activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        await journal.update({ [flagPath]: entryData });
      } else {
        await game.user.update({ [flagPath]: entryData });
      }
    } else {
      await game.user.update({ [flagPath]: entryData });
    }

    ui.notifications.info(`Запись добавлена в "${title}".`);
    
    // Auto-refresh the main app if it is open
    const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "QuickNotesApp");
    if (app) app.render({ parts: ["content"] });
  }
}
