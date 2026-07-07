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
      selectColor: QuickNotesApp.#onSelectColor,
      toggleVisibility: QuickNotesApp.#onToggleVisibility,
      importJSON: QuickNotesApp.#onImportJSON,
      copyAIPrompt: QuickNotesApp.#onCopyAIPrompt,
      exportJSON: QuickNotesApp.#onExportJSON,
      renameWorkspace: QuickNotesApp.#onRenameWorkspace,
      jumpToBoard: QuickNotesApp.#onJumpToBoard
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
    activeWorkspace: "personal", // 'personal' or JournalEntry ID
    searchQuery: "",
    editingEntryId: null,
    highlightedEntryId: null
  };

  static DEFAULT_SETTINGS = {
    readOnly: false,
    theme: {
      accent: "#7b61ff",
      opacity: 85,
      linkColor: "#ff5252",
      linkStyle: "6,4",
      showHotkeys: true,
      snapToGrid: false,
      highlightDuration: 2
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
    
    let visibility, defaultColors, readOnly;
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      const sharedSettings = journal ? (journal.getFlag("notebook", "settings") || {}) : {};
      visibility = foundry.utils.mergeObject(defaults.visibility, sharedSettings.visibility || {});
      defaultColors = foundry.utils.mergeObject(defaults.defaultColors, sharedSettings.defaultColors || {});
      readOnly = sharedSettings.readOnly ?? defaults.readOnly;
    } else {
      visibility = foundry.utils.mergeObject(defaults.visibility, localSettings.visibility || {});
      defaultColors = foundry.utils.mergeObject(defaults.defaultColors, localSettings.defaultColors || {});
      readOnly = false;
    }
    
    return { theme, visibility, defaultColors, readOnly };
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
    
    // Find all available workspaces
    const personalName = game.user.getFlag("notebook", "personalWorkspaceName") || "Личный блокнот (Только я)";
    const availableWorkspaces = [
      { id: "personal", name: personalName }
    ];

    game.journal.forEach(j => {
      if ((j.getFlag("notebook", "isWorkspace") || j.name === "QuickNotes_Shared_DB") && j.testUserPermission(game.user, "OBSERVER")) {
        availableWorkspaces.push({ id: j.id, name: j.name });
      }
    });

    // Ensure activeWorkspace is valid, fallback to personal if not
    if (this.state.activeWorkspace !== "personal" && !game.journal.get(this.state.activeWorkspace) && !game.journal.getName("QuickNotes_Shared_DB")) {
      this.state.activeWorkspace = "personal";
    }

    // Load data based on mode
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        data = journal.getFlag("notebook", "data") || {};
        context.workspaceName = journal.name;
        context.isShared = true;
      }
    } else {
      data = game.user.getFlag("notebook", "data") || {};
      context.workspaceName = game.user.getFlag("notebook", "personalWorkspaceName") || "Личный блокнот";
      context.isShared = false;
    }

    context.tabs = this.tabs;
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
      context.links = data.links || [];
      
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
    if (entry.text) enriched.text = await TE.enrichHTML(entry.text, { async: true });
    if (entry.note) enriched.note = await TE.enrichHTML(entry.note, { async: true });
    if (entry.event) enriched.event = await TE.enrichHTML(entry.event, { async: true });
    if (entry.gmNotes && game.user.isGM) enriched.gmNotes = await TE.enrichHTML(entry.gmNotes, { async: true });
    return enriched;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;
    const settings = this.getSettings();
    
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
      workspaceSelect.addEventListener('change', (ev) => {
        this.state.activeWorkspace = ev.target.value;
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
    if (!this.state.camera) {
      this.state.camera = game.user.getFlag("notebook", "boardCamera") || { zoom: 1, panX: 0, panY: 0 };
    }
    currentZoom = this.state.camera.zoom;
    currentPanX = this.state.camera.panX;
    currentPanY = this.state.camera.panY;

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

        currentPanX = mouseX - (mouseX - currentPanX) * (newZoom / currentZoom);
        currentPanY = mouseY - (mouseY - currentPanY) * (newZoom / currentZoom);
        
        currentZoom = newZoom;
        applyTransform();
        updateCameraState();
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

    const recenterBtn = this.element.querySelector('[data-action="recenterBoard"]');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        currentPanX = 0;
        currentPanY = 0;
        currentZoom = 1;
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

    board.querySelectorAll('.board-link').forEach(line => {
      line.addEventListener('contextmenu', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this.#deleteLink(line.dataset.source, line.dataset.target);
      });
      line.addEventListener('click', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this.#editLinkLabel(line.dataset.source, line.dataset.target);
      });
    });

    board.querySelectorAll('.board-link-label').forEach(lbl => {
      lbl.addEventListener('contextmenu', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this.#deleteLink(lbl.dataset.source, lbl.dataset.target);
      });
      lbl.addEventListener('click', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this.#editLinkLabel(lbl.dataset.source, lbl.dataset.target);
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
      if (isPanning) {
        currentPanX = ev.clientX - panStartX;
        currentPanY = ev.clientY - panStartY;
        applyTransform();
        updateCameraState();
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
        updateCameraState();
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
        draggedEntry.style.left = `${newX}px`;
        draggedEntry.style.top = `${newY}px`;
        updateLines();
      }
      
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
    
    // Check if exists
    const exists = links.find(l => (l.source === sourceId && l.target === targetId) || (l.source === targetId && l.target === sourceId));
    if (exists) return;

    links.push({ source: sourceId, target: targetId });
    
    await this.#updateWorkspaceData({ "flags.notebook.data.links": links });
    
    this.render();
  }

  async #deleteLink(s, t) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удаление связи" },
      content: "<p>Вы уверены, что хотите удалить эту нить?</p>",
      rejectClose: false
    });

    if (!proceed) return;

    let links = this.#getWorkspaceLinks();
    
    links = links.filter(l => !(l.source === s && l.target === t) && !(l.source === t && l.target === s));
    
    await this.#updateWorkspaceData({ "flags.notebook.data.links": links });
    this.render({ parts: ["content"] });
  }

  async #editLinkLabel(s, t) {
    let links = this.#getWorkspaceLinks();
    const linkIndex = links.findIndex(l => (l.source === s && l.target === t) || (l.source === t && l.target === s));
    if (linkIndex === -1) return;
    
    const currentLabel = links[linkIndex].label || "";
    
    const newLabel = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Текст связи" },
      content: `<p>Введите текст (оставьте пустым для удаления):</p><input type="text" name="label" value="${currentLabel}" autofocus>`,
      ok: { callback: (event, button, dialog) => button.form.elements.label.value },
      rejectClose: false
    });
    
    if (newLabel === null || newLabel === undefined) return;
    
    if (newLabel.trim() === "") {
      delete links[linkIndex].label;
    } else {
      links[linkIndex].label = newLabel.trim();
    }
    
    await this.#updateWorkspaceData({ "flags.notebook.data.links": links });
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

  static async #onRenameWorkspace(event, target) {
    if (!game.user.isGM && this.state.activeWorkspace !== "personal") {
      ui.notifications.warn("Переименовывать общие доски может только Мастер.");
      return;
    }

    const currentName = this.state.activeWorkspace === "personal" 
      ? (game.user.getFlag("notebook", "personalWorkspaceName") || "Личный блокнот")
      : (game.journal.get(this.state.activeWorkspace)?.name || "Общая доска");

    const newName = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Переименовать доску" },
      content: `<p>Введите новое название:</p><input type="text" name="wsName" value="${currentName}" autofocus>`,
      ok: { callback: (event, button) => button.form.elements.wsName.value },
      rejectClose: false
    });

    if (!newName || newName.trim() === "" || newName === currentName) return;

    if (this.state.activeWorkspace === "personal") {
      await game.user.setFlag("notebook", "personalWorkspaceName", newName.trim());
    } else {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
      if (journal) {
        await journal.update({ name: newName.trim() });
      }
    }
    
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

      // Process entries
      for (const entry of parsed.entries) {
        const tempId = entry.id;
        const realId = foundry.utils.randomID();
        if (tempId) idMap[tempId] = realId;

        const tab = entry.tab || "notes";
        delete entry.id;
        delete entry.tab;

        // Auto-place on board if coords are provided
        if (entry.boardX !== undefined && entry.boardY !== undefined) {
          entry.onBoard = true;
        }

        updateData[`flags.notebook.data.${tab}.${realId}`] = entry;
      }

      // Process links
      let links = data.links || [];
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

  static async #onCopyAIPrompt(event, target) {
    const promptText = `Я использую модуль ClueBook для Foundry VTT. Сгенерируй детективный сценарий (персонажей, улики, квесты) и верни результат строго в формате JSON. Не пиши ничего, кроме самого JSON (без разметки markdown, только сырой код).

ПРАВИЛА И ФОРМАТ:
1. Результат должен быть объектом с двумя массивами: "entries" (записи) и "links" (связи).
2. Каждой записи в "entries" дай временный уникальный "id" (например: npc1, clue2, quest1).
3. Доступные вкладки (поле "tab"): "notes" (заметки), "npc" (персонажи), "quests" (квесты), "timeline" (хронология).
4. Доступные цвета (поле "color"): "yellow", "red", "green", "blue", "purple".
5. Координаты на доске (поля "boardX" и "boardY"): числа от 0 до 1500. Выстраивай логичную композицию. Связанные объекты располагай рядом.
6. Поля в зависимости от вкладки:
   - "notes": "text" (основной текст).
   - "npc": "name", "location", "attitude", "note" (публичный лор).
   - "quests": "text", "status" (active, completed, failed).
   - "timeline": "time" (время/дата), "event" (описание).
7. Секреты для Мастера: Любая запись может содержать поле "gmNotes" с текстом, который игроки никогда не увидят. Смело пиши сюда главные твисты!
8. Блок "links" описывает нити между записями. Включает: "source" (id источника), "target" (id цели), "label" (необязательный текст над нитью, например "Брат" или "Найдено здесь").

ПРИМЕР:
{
  "entries": [
    {
      "id": "mayor",
      "tab": "npc",
      "color": "green",
      "name": "Мэр Джонсон",
      "location": "Ратуша",
      "attitude": "Дружелюбный",
      "note": "Утверждает, что город в безопасности.",
      "gmNotes": "Является главой культа.",
      "boardX": 500,
      "boardY": 100
    },
    {
      "id": "clue1",
      "tab": "notes",
      "color": "yellow",
      "text": "Найден окровавленный амулет мэра",
      "boardX": 500,
      "boardY": 300
    }
  ],
  "links": [
    { "source": "mayor", "target": "clue1", "label": "Его вещь?" }
  ]
}

Сгенерируй для меня интересный детективный сюжет в этом формате JSON:`;

    try {
      await navigator.clipboard.writeText(promptText);
      ui.notifications.info("Промпт для нейросети скопирован в буфер обмена!");
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
    
    const initialLength = links.length;
    links = links.filter(l => l.source !== entryId && l.target !== entryId);
    
    if (links.length !== initialLength) {
      await this.#updateWorkspaceData({ "flags.notebook.data.links": links });
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
      case "quests": return { ...base, text: "", status: "active" };
      case "timeline": return { ...base, time: "", event: "" };
      default: return { ...base };
    }
  }
  #getWorkspaceJournal() {
    if (this.state.activeWorkspace === "personal") return null;
    return game.journal.get(this.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
  }

  async #updateWorkspaceData(updateData) {
    const journal = this.#getWorkspaceJournal();
    if (journal) {
      await journal.update(updateData);
    } else {
      await game.user.update(updateData);
    }
  }

  #getWorkspaceLinks() {
    const journal = this.#getWorkspaceJournal();
    if (journal) return journal.getFlag("notebook", "data.links") || [];
    return game.user.getFlag("notebook", "data.links") || [];
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
            if (!folder) {
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

  static async showQuickAddDialog(type, activeWorkspace = "personal") {
    let content = '';
    let title = '';

    if (type === "notes") {
      title = "Добавить заметку";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <textarea name="text" class="quicknotes-input" placeholder="Текст заметки..." style="width: 100%; min-height: 80px;" autofocus></textarea>
        </div>
      `;
    } else if (type === "npc") {
      title = "Добавить персонажа";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="name" class="quicknotes-input" placeholder="Имя" style="width: 100%;" autofocus>
          <input type="text" name="location" class="quicknotes-input" placeholder="Локация" style="width: 100%;">
          <input type="text" name="attitude" class="quicknotes-input" placeholder="Отношение" style="width: 100%;">
          <textarea name="note" class="quicknotes-input" placeholder="Описание..." style="width: 100%; min-height: 60px;"></textarea>
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
          <textarea name="text" class="quicknotes-input" placeholder="Описание квеста..." style="width: 100%; min-height: 80px;" autofocus></textarea>
        </div>
      `;
    } else if (type === "timeline") {
      title = "Добавить событие";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="time" class="quicknotes-input" placeholder="Время / Дата" style="width: 100%;" autofocus>
          <textarea name="event" class="quicknotes-input" placeholder="Описание события..." style="width: 100%; min-height: 80px;"></textarea>
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
    const app = Object.values(ui.windows).find(w => w.constructor.name === "QuickNotesApp");
    if (app) app.render();
  }
}
