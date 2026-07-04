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
      width: 400,
      height: 600
    },
    window: {
      title: "Ежедневник (QuickNotes)",
      icon: "fas fa-book",
      resizable: true,
      minimizable: true
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
      selectColor: QuickNotesApp.#onSelectColor
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
    activeTab: "notes",
    isShared: false,
    searchQuery: "",
    editingEntryId: null
  };

  static DEFAULT_SETTINGS = {
    theme: {
      accent: "#7b61ff",
      opacity: 85
    },
    visibility: {
      npc: true,
      quests: true,
      timeline: true
    },
    defaultColors: {
      notes: "yellow",
      npc: "green",
      quests: "purple",
      timeline: "red"
    }
  };

  getSettings() {
    // We do a deep clone of defaults to prevent mutating them
    const defaults = foundry.utils.deepClone(QuickNotesApp.DEFAULT_SETTINGS);
    const localSettings = game.user.getFlag("notebook", "settings") || {};
    
    const theme = foundry.utils.mergeObject(defaults.theme, localSettings.theme || {});
    
    let visibility, defaultColors;
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      const sharedSettings = journal ? (journal.getFlag("notebook", "settings") || {}) : {};
      visibility = foundry.utils.mergeObject(defaults.visibility, sharedSettings.visibility || {});
      defaultColors = foundry.utils.mergeObject(defaults.defaultColors, sharedSettings.defaultColors || {});
    } else {
      visibility = foundry.utils.mergeObject(defaults.visibility, localSettings.visibility || {});
      defaultColors = foundry.utils.mergeObject(defaults.defaultColors, localSettings.defaultColors || {});
    }
    
    return { theme, visibility, defaultColors };
  }

  /**
   * Defines the tabs for the application
   */
  get tabs() {
    const settings = this.getSettings();
    const allTabs = [
      { id: "search", icon: "fas fa-search", label: "Поиск" },
      { id: "notes", icon: "fas fa-sticky-note", label: "Заметки" },
      { id: "npc", icon: "fas fa-user", label: "Персонажи (NPC)" },
      { id: "quests", icon: "fas fa-map", label: "Квесты" },
      { id: "timeline", icon: "fas fa-clock", label: "Хронология" },
      { id: "board", icon: "fas fa-project-diagram", label: "Доска" }
    ];
    return allTabs.filter(t => ["search", "notes", "board"].includes(t.id) || settings.visibility[t.id] !== false);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    // Load data based on mode
    let data = {};
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        data = journal.getFlag("notebook", "data") || {};
      }
    } else {
      data = game.user.getFlag("notebook", "data") || {};
    }

    context.tabs = this.tabs;
    context.activeTab = this.state.activeTab;
    context.isShared = this.state.isShared;
    context.searchQuery = this.state.searchQuery;
    context.isSettings = this.state.activeTab === "settings";
    
    if (context.isSettings) {
      context.settings = this.getSettings();
      context.showAddBtn = false;
      context.isBoardView = false;
      return context;
    }
    
    // We must process TextEditor.enrichHTML asynchronously for the display mode,
    // while keeping raw text for the edit mode.
    const entries = [];
    
    if (this.state.activeTab === "search") {
      // Global Search Tab
      const q = this.state.searchQuery.toLowerCase();
      if (q) {
        for (const [tabKey, tabData] of Object.entries(data)) {
          if (tabKey === "links" || tabKey === "board" || tabKey === "search") continue;
          for (const [id, entry] of Object.entries(tabData || {})) {
            if (!entry) continue;
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
          if (entry.onBoard) {
            const enriched = await this.#enrichEntry(entry);
            entries.push({ id, sourceTab: tabKey, ...entry, enriched });
          }
        }
      }
      // Pass raw links, math will be done dynamically in DOM
      context.links = data.links || [];
      
    } else {
      // Standard tabs
      const tabData = data[this.state.activeTab] || {};
      for (const [id, entry] of Object.entries(tabData)) {
        if (!entry) continue;
        const enriched = await this.#enrichEntry(entry);
        entries.push({ id, sourceTab: this.state.activeTab, ...entry, enriched });
      }
    }
    
    context.entries = entries;
    context.showAddBtn = this.state.activeTab !== "board" && this.state.activeTab !== "search";
    context.isBoardView = this.state.activeTab === "board";
    context.editingEntryId = this.state.editingEntryId;

    return context;
  }

  async #enrichEntry(entry) {
    const enriched = {};
    if (entry.text) enriched.text = await TextEditor.enrichHTML(entry.text, { async: true });
    if (entry.note) enriched.note = await TextEditor.enrichHTML(entry.note, { async: true });
    if (entry.event) enriched.event = await TextEditor.enrichHTML(entry.event, { async: true });
    return enriched;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;
    const settings = this.getSettings();
    
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
      el.addEventListener('click', (ev) => {
        // Clear search query and edit mode on tab change
        this.state.searchQuery = "";
        this.state.editingEntryId = null;
        const tab = ev.currentTarget.dataset.tab;
        this.state.activeTab = tab;
        this.render();
      });
    });

    // Bind auto-save inputs
    html.querySelectorAll('.quicknotes-input').forEach(input => {
      input.addEventListener('input', (ev) => {
        this.#handleInputDebounced(ev.currentTarget);
      });
    });

    // Auto-focus new/editing entry
    if (this.state.editingEntryId) {
      const editingNode = html.querySelector(`.quicknotes-entry[data-entry-id="${this.state.editingEntryId}"]`);
      if (editingNode) {
        const firstInput = editingNode.querySelector('.quicknotes-input');
        if (firstInput) {
          firstInput.focus();
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

      this.state.editingEntryId = null;
      this.render();
    };
    document.addEventListener('mousedown', this._outsideClickHandler);

    // Setup Board Interactivity
    if (this.state.activeTab === "board" && !this.state.searchQuery) {
      this.#setupBoardInteractivity(html);
    }
  }

  #bindSettingsListeners(html) {
    const saveSetting = async (scope, key, value) => {
      const flagPath = `flags.notebook.settings.${key}`;
      
      // Theme is ALWAYS personal
      if (key.startsWith('theme.')) {
        await game.user.update({ [flagPath]: value });
      } else {
        // Visibility and defaultColors follow the scope
        if (this.state.isShared) {
          const journal = game.journal.getName("QuickNotes_Shared_DB");
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

    // For Pan & Zoom
    let currentZoom = 1;
    let currentPanX = 0;
    let currentPanY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;

    const board = html.querySelector('.board-canvas');
    if (!board) return;
    
    const entriesList = board.querySelector('.entries-list');
    
    // Load camera state
    const camFlags = game.user.getFlag("notebook", "boardCamera") || { zoom: 1, panX: 0, panY: 0 };
    currentZoom = camFlags.zoom;
    currentPanX = camFlags.panX;
    currentPanY = camFlags.panY;

    const applyTransform = () => {
      entriesList.style.transformOrigin = "0 0";
      entriesList.style.transform = `translate(${currentPanX}px, ${currentPanY}px) scale(${currentZoom})`;
    };
    applyTransform();
    
    const saveCamera = foundry.utils.debounce(() => {
      game.user.update({ "flags.notebook.boardCamera": { zoom: currentZoom, panX: currentPanX, panY: currentPanY } });
    }, 500);

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

        currentPanX = mouseX - (mouseX - currentPanX) * (newZoom / currentZoom);
        currentPanY = mouseY - (mouseY - currentPanY) * (newZoom / currentZoom);
        
        currentZoom = newZoom;
        applyTransform();
        saveCamera();
      }
    });

    // Prevent context menu
    board.addEventListener('contextmenu', ev => ev.preventDefault());

    // Pan Start
    board.addEventListener('mousedown', (ev) => {
      if (ev.button === 2 || ev.button === 1) {
        isPanning = true;
        panStartX = ev.clientX - currentPanX;
        panStartY = ev.clientY - currentPanY;
        ev.preventDefault();
      }
    });

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

    board.querySelectorAll('.board-link').forEach(line => {
      line.addEventListener('contextmenu', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await this.#deleteLink(line.dataset.source, line.dataset.target);
      });
    });

    // Save resize on mouseup
    board.querySelectorAll('.quicknotes-entry').forEach(entry => {
      entry.addEventListener('mouseup', (ev) => {
        // If it was resized via CSS resize, style.width/height is set
        if (entry.style.width || entry.style.height) {
           const w = entry.style.width ? parseInt(entry.style.width) : null;
           const h = entry.style.height ? parseInt(entry.style.height) : null;
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
        if (ev.button !== 0) return; // Only left click drags
        if (ev.target.closest('.entry-controls') || ev.target.closest('.edit-mode')) return;
        if (linkingSource) return;
        
        draggedEntry = entry;
        startX = ev.clientX;
        startY = ev.clientY;
        initialLeft = parseInt(entry.style.left) || 0;
        initialTop = parseInt(entry.style.top) || 0;
        entry.style.zIndex = 100;
        ev.preventDefault();
      });
    });
    
    if (this._boardMoveHandler) document.removeEventListener('mousemove', this._boardMoveHandler);
    if (this._boardUpHandler) document.removeEventListener('mouseup', this._boardUpHandler);

    this._boardMoveHandler = (ev) => {
      if (isPanning) {
        currentPanX = ev.clientX - panStartX;
        currentPanY = ev.clientY - panStartY;
        applyTransform();
        return;
      }
      
      if (!draggedEntry) return;
      
      // Dragging entry, divide by zoom for correct mapping
      const dx = (ev.clientX - startX) / currentZoom;
      const dy = (ev.clientY - startY) / currentZoom;
      draggedEntry.style.left = `${initialLeft + dx}px`;
      draggedEntry.style.top = `${initialTop + dy}px`;
      updateLines();
    };

    this._boardUpHandler = async (ev) => {
      if (isPanning) {
        isPanning = false;
        saveCamera();
        return;
      }

      if (!draggedEntry) return;
      const entryId = draggedEntry.dataset.entryId;
      const sourceTab = draggedEntry.dataset.sourceTab;
      
      const newX = parseInt(draggedEntry.style.left);
      const newY = parseInt(draggedEntry.style.top);
      
      draggedEntry.style.zIndex = "10";
      draggedEntry = null;

      await this.#saveDataRaw(sourceTab, entryId, "boardX", newX);
      await this.#saveDataRaw(sourceTab, entryId, "boardY", newY);
    };

    document.addEventListener('mousemove', this._boardMoveHandler);
    document.addEventListener('mouseup', this._boardUpHandler);
  }

  async #createLink(sourceId, targetId) {
    let links = [];
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) links = journal.getFlag("notebook", "data.links") || [];
    } else {
      links = game.user.getFlag("notebook", "data.links") || [];
    }
    
    // Check if exists
    const exists = links.find(l => (l.source === sourceId && l.target === targetId) || (l.source === targetId && l.target === sourceId));
    if (exists) return;

    links.push({ source: sourceId, target: targetId });
    
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) await journal.update({ "flags.notebook.data.links": links });
    } else {
      await game.user.update({ "flags.notebook.data.links": links });
    }
    
    this.render();
  }

  async #deleteLink(s, t) {
    let links = [];
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) links = journal.getFlag("notebook", "data.links") || [];
    } else {
      links = game.user.getFlag("notebook", "data.links") || [];
    }
    
    links = links.filter(l => !(l.source === s && l.target === t) && !(l.source === t && l.target === s));
    
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) await journal.update({ "flags.notebook.data.links": links });
    } else {
      await game.user.update({ "flags.notebook.data.links": links });
    }
    
    this.render();
  }

  /**
   * Raw saving without debounce for internal actions
   */
  async #saveDataRaw(tab, entryId, field, value) {
    const flagPath = `flags.notebook.data.${tab}.${entryId}.${field}`;
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) await journal.update({ [flagPath]: value });
    } else {
      await game.user.update({ [flagPath]: value });
    }
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

  static async #onToggleMode(event, target) {
    this.state.isShared = !this.state.isShared;
    this.render();
  }
  
  static async #onToggleEdit(event, target) {
    const entry = target.closest('.quicknotes-entry');
    const entryId = entry.dataset.entryId;
    
    if (this.state.editingEntryId === entryId) {
      this.state.editingEntryId = null;
    } else {
      this.state.editingEntryId = entryId;
    }
    this.render();
  }

  static async #onSelectColor(event, target) {
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
    this.render();
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
    let links = [];
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) links = journal.getFlag("notebook", "data.links") || [];
    } else {
      links = game.user.getFlag("notebook", "data.links") || [];
    }
    
    const initialLength = links.length;
    links = links.filter(l => l.source !== entryId && l.target !== entryId);
    
    if (links.length !== initialLength) {
      if (this.state.isShared) {
        const journal = game.journal.getName("QuickNotes_Shared_DB");
        if (journal) await journal.update({ "flags.notebook.data.links": links });
      } else {
        await game.user.update({ "flags.notebook.data.links": links });
      }
    }
    
    this.render();
  }

  static async #onAddEntry(event, target) {
    const id = foundry.utils.randomID();
    const activeTab = this.state.activeTab;
    const newEntry = this.#getEmptyEntryForTab(activeTab);
    
    const flagPath = `flags.notebook.data.${activeTab}.${id}`;
    const updateData = { [flagPath]: newEntry };

    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        await journal.update(updateData);
      }
    } else {
      await game.user.update(updateData);
    }
    
    // Automatically start editing the new entry
    this.state.editingEntryId = id;

    // Refresh to show new entry
    this.render();
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
    
    // Use -= syntax to delete keys from Foundry flags
    const flagPath = `flags.notebook.data.${activeTab}.-=${entryId}`;
    
    if (this.state.isShared) {
      const journal = game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        await journal.update({ [flagPath]: null });
      }
    } else {
      await game.user.update({ [flagPath]: null });
    }
    
    this.render();
  }

  #getEmptyEntryForTab(tab) {
    const settings = this.getSettings();
    const defaultColor = settings.defaultColors[tab] || "yellow";
    const base = { color: defaultColor, onBoard: false, boardX: 100, boardY: 100 };
    switch (tab) {
      case "notes": return { ...base, text: "" };
      case "npc": return { ...base, name: "", location: "", attitude: "", note: "" };
      case "quests": return { ...base, text: "", status: "active" };
      case "timeline": return { ...base, time: "", event: "" };
      default: return { ...base };
    }
  }
}
