import { ClueBookSocket } from "./socket.js";
import { ClueBookDatePicker } from "./date-picker.js";
import { ClueBookEditDialog } from "./edit-dialog.js";
import { ClueBookDataMixin } from "./app-data.js";
import { ClueBookBoardMixin } from "./app-board.js";
import { ClueBookActionsMixin } from "./app-actions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const BaseApp = ClueBookActionsMixin(ClueBookBoardMixin(ClueBookDataMixin(HandlebarsApplicationMixin(ApplicationV2))));

export class ClueBookApp extends BaseApp {
  constructor(options = {}) {
    super(options);
    
    // Store debounced save function per tab
    this._debouncedSaves = {};
  }
  static DEFAULT_OPTIONS = {
    id: "cluebook-app",
    classes: ["cluebook-window"],
    position: {
      width: 1200,
      height: 800
    },
    window: {
      title: "CLUEBOOK.App.Title",
      icon: "fas fa-book",
      resizable: true,
      minimizable: true,
      controls: [
        {
          action: "toggleZenMode",
          icon: "fas fa-expand",
          label: "CLUEBOOK.App.ZenMode"
        }
      ]
    },
    form: {
      handler: ClueBookApp._onSubmitForm,
      submitOnChange: false,
      closeOnSubmit: false
    },
    actions: {
      toggleZenMode: ClueBookApp._onToggleZenMode,
      toggleMode: ClueBookApp._onToggleMode,
      toggleEdit: ClueBookApp._onToggleEdit,
      toggleText: ClueBookApp._onToggleText,
      togglePin: ClueBookApp._onTogglePin,
      toggleVisibility: ClueBookApp._onToggleVisibility,
      shareEntry: ClueBookApp._onShareEntry,
      addTime: ClueBookApp._onAddTime,
      deleteEntry: ClueBookApp._onDeleteEntry,
      deleteWorkspace: ClueBookApp._onDeleteWorkspace,
      editWorkspace: ClueBookApp._onEditWorkspace,
      addEntry: ClueBookApp._onAddEntry,
      jumpToBoard: ClueBookApp._onJumpToBoard,
      sendToBoard: ClueBookApp._onSendToBoard,
      removeFromBoard: ClueBookApp._onRemoveFromBoard,
      recenterBoard: ClueBookApp._onRecenterBoard,
      jumpToLinked: ClueBookApp._onJumpToLinked,
      createSuggestedLink: ClueBookApp._onCreateSuggestedLink,
      deleteLink: ClueBookApp._onDeleteLink,
      dismissSuggestedLink: ClueBookApp._onDismissSuggestedLink,
      importJSON: ClueBookApp._onImportJSON,
      copyDataFormat: ClueBookApp._onCopyDataFormat,
      exportJSON: ClueBookApp._onExportJSON,
      hideHotkeys: ClueBookApp._onHideHotkeys,
      pickDate: ClueBookApp._onPickDate,
      clearDate: ClueBookApp._onClearDate
    }
  };

  get title() {
    return game.i18n.localize(this.options.window.title);
  }

  static PARTS = {
    tabs: {
      template: "modules/ClueBook/templates/tabs.hbs",
      classes: ["cluebook-tabs"]
    },
    content: {
      template: "modules/ClueBook/templates/content.hbs",
      classes: ["cluebook-content"]
    }
  };

  // State mapping
  state = {
    activeTab: game.user?.getFlag("ClueBook", "lastTab") || "notes",
    activeWorkspace: game.user?.getFlag("ClueBook", "lastWorkspace") || game.user?.getFlag("ClueBook", "settings")?.theme?.defaultWorkspace || "personal",
    searchQuery: "",
    editingEntryId: null,
    highlightedEntryId: null,
    selectedEntryId: null,
    selectedEntries: new Set()
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
      showCalendarWidget: true,
      showQuickWidget: true,
      snapToGrid: false,
      hoverHighlight: true,
      hoverDelay: 1000,
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
    const defaults = foundry.utils.deepClone(ClueBookApp.DEFAULT_SETTINGS);
    const localSettings = game.user.getFlag("ClueBook", "settings") || {};
    
    // NOTE: We use plain JS spread instead of foundry.utils.mergeObject because
    // mergeObject silently drops `false` values when overwriting `true` defaults.
    const theme = { ...defaults.theme, ...(localSettings.theme || {}) };
    const features = { ...defaults.features, ...(localSettings.features || {}) };
    const widget = { ...defaults.widget, ...(localSettings.widget || {}) };
    
    let defaultColors, readOnly;
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      const sharedSettings = journal ? (journal.getFlag("ClueBook", "settings") || {}) : {};
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
      { id: "search", icon: "fas fa-search", label: game.i18n.localize("CLUEBOOK.Tabs.Search") },
      { id: "notes", icon: "fas fa-sticky-note", label: game.i18n.localize("CLUEBOOK.Tabs.Notes") },
      { id: "npc", icon: "fas fa-user", label: game.i18n.localize("CLUEBOOK.Tabs.NPC") },
      { id: "quests", icon: "fas fa-map", label: game.i18n.localize("CLUEBOOK.Tabs.Quests") },
      { id: "timeline", icon: "fas fa-clock", label: game.i18n.localize("CLUEBOOK.Tabs.Timeline") },
      { id: "board", icon: "fas fa-project-diagram", label: game.i18n.localize("CLUEBOOK.Tabs.Board") }
    ];
  }


  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    // Find all available workspaces
    const personalName = game.user.getFlag("ClueBook", "personalWorkspaceName") || game.i18n.localize("CLUEBOOK.Workspace.PersonalOnlyMe");
    const availableWorkspaces = [
      { id: "personal", name: personalName }
    ];

    if (game.user.isGM) {
      game.users.forEach(u => {
        if (u.id !== game.user.id && !u.isGM) {
          const uData = u.getFlag("ClueBook", "data") || {};
          let isEmpty = true;
          for (const [tabKey, tabData] of Object.entries(uData)) {
            if (tabKey === "board" || tabKey === "links" || tabKey === "search") continue;
            if (tabData && Object.keys(tabData).length > 0) {
              isEmpty = false;
              break;
            }
          }
          
          if (!isEmpty) {
            const uName = u.getFlag("ClueBook", "personalWorkspaceName") || game.i18n.format("CLUEBOOK.Workspace.PersonalUser", { user: u.name });
            availableWorkspaces.push({ id: `personal_${u.id}`, name: game.i18n.format("CLUEBOOK.Workspace.Player", { user: uName }) });
          }
        }
      });
    }

    game.journal.forEach(j => {
      if ((j.getFlag("ClueBook", "isWorkspace") || j.name === "ClueBook_Shared_DB") && j.testUserPermission(game.user, "OBSERVER")) {
        availableWorkspaces.push({ id: j.id, name: j.name });
      }
    });

    // Ensure activeWorkspace is valid, fallback to personal if not
    if (this.state.activeWorkspace !== "personal" && !this.state.activeWorkspace.startsWith("personal_") && !game.journal.get(this.state.activeWorkspace) && !game.journal.getName("ClueBook_Shared_DB")) {
      this.state.activeWorkspace = "personal";
    }

    // Load data based on mode
    let data = {};
    if (this.state.activeWorkspace === "personal") {
      data = game.user.getFlag("ClueBook", "data") || {};
      context.workspaceName = game.user.getFlag("ClueBook", "personalWorkspaceName") || game.i18n.localize("CLUEBOOK.Workspace.Personal");
      context.isShared = false;
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      if (u && game.user.isGM) {
        data = u.getFlag("ClueBook", "data") || {};
        context.workspaceName = u.getFlag("ClueBook", "personalWorkspaceName") || game.i18n.format("CLUEBOOK.Workspace.PersonalUser", { user: u.name });
        context.isShared = false;
        context.isReadOnly = false;
      } else {
        this.state.activeWorkspace = "personal";
        data = game.user.getFlag("ClueBook", "data") || {};
        context.workspaceName = game.i18n.localize("CLUEBOOK.Workspace.Personal");
        context.isShared = false;
      }
    } else {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) {
        data = journal.getFlag("ClueBook", "data") || {};
        context.workspaceName = journal.name;
        context.isShared = true;
      }
    }

    data = await this._sanitizeData(data);

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
    this.state.isReadOnly = this.state.isZenMode || (context.isShared && context.settings.readOnly && !context.isGM);
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
              const enriched = await this._enrichEntry(entry);
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
            const enriched = await this._enrichEntry(entry);
            entries.push({ id, sourceTab: tabKey, ...entry, enriched });
          }
        }
      }
      // Pass raw links, math will be done dynamically in DOM
      context.links = Object.values(data.links || {});
      
    } else {
      // Standard tabs
      const tabData = data[this.state.activeTab] || {};
      let sortedEntries;
      if (this.state.activeTab === "timeline") {
        sortedEntries = Object.entries(tabData).sort((a, b) => {
          const tA = a[1].startTimestamp ?? Number.MAX_SAFE_INTEGER;
          const tB = b[1].startTimestamp ?? Number.MAX_SAFE_INTEGER;
          return tA - tB;
        });
      } else {
        sortedEntries = Object.entries(tabData).sort((a, b) => (a[1].sort || 0) - (b[1].sort || 0));
      }
      for (const [id, entry] of sortedEntries) {
        if (!entry) continue;
        if (skipHidden && entry.isHidden) continue;
        const enriched = await this._enrichEntry(entry);
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
          let previewText = entry.text || entry.note || entry.event || "";
          previewText = previewText.replace(/\[\[qnmention:[^:]+:([^\]]+)\]\](?:\{([^}]*)\})?/g, (m, name, cText) => cText || name);
          previewText = previewText.replace(/@UUID\[[^\]]+\](?:\{([^\}]+)\})?/g, (m, p1) => p1 || game.i18n.localize("CLUEBOOK.EntryDetails.Link"));
          previewText = previewText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 150).trim() + "...";
          allEntities.push({ id, title: entry.name || entry.event || entry.text || game.i18n.localize("CLUEBOOK.EntryDetails.Untitled"), preview: previewText });
        }
      }
    }

    const PRESET_COLORS = ["yellow", "red", "green", "blue", "purple", "orange", "teal", "pink", "brown"];
    const isBoard = this.state.activeTab === "board";
    for (const entry of entries) {
      entry.isCustomColor = entry.color && !PRESET_COLORS.includes(entry.color);
      entry.explicitLinks = [];
      const showExplicit = isBoard ? context.settings.features?.boardShowExplicitLinks : context.settings.features?.cardsShowExplicitLinks;
      
      if (showExplicit !== false) {
        for (const l of Object.values(allLinks)) {
          if (l.source === entry.id || l.target === entry.id) {
            const otherId = l.source === entry.id ? l.target : l.source;
            const otherEntity = allEntities.find(e => e.id === otherId);
            if (otherEntity) {
              // Clean qnmention and UUID tags, and strip HTML for the tiny chip
              let cleanName = otherEntity.title.replace(/\[\[qnmention:[^:]+:([^\]]+)\]\](?:\{([^}]*)\})?/g, (m, name, cText) => cText || name);
              cleanName = cleanName.replace(/@UUID\[[^\]]+\](?:\{([^\}]+)\})?/g, (m, p1) => p1 || game.i18n.localize("CLUEBOOK.EntryDetails.Link"));
              cleanName = cleanName.replace(/<[^>]+>/g, '').substring(0, 40).trim();
              entry.explicitLinks.push({ id: otherId, name: cleanName, label: l.label, preview: otherEntity.preview });
            }
          }
        }
      }
    }

    context.isSimpleCalendarActive = !!window.SimpleCalendar;
    for (const entry of entries) {
      if (context.isSimpleCalendarActive && window.SimpleCalendar?.api) {
        const scApi = window.SimpleCalendar.api;
        if (entry.sourceTab === "quests" && entry.deadlineTimestamp) {
          const dl = entry.deadlineTimestamp;
          const curr = game.time.worldTime;
          const diff = dl - curr;
          
          const dt = scApi.timestampToDate(dl);
          entry.formattedDeadline = scApi.formatDateTime(dt).date + " " + scApi.formatDateTime(dt).time;
          entry.formattedDeadlineDate = scApi.formatDateTime(dt).date;
          entry.formattedDeadlineTime = scApi.formatDateTime(dt).time;
          
          const absDiff = Math.abs(diff);
          const d = Math.floor(absDiff / 86400);
          const h = Math.floor((absDiff % 86400) / 3600);
          const m = Math.floor((absDiff % 3600) / 60);
          const dStr = d > 0 ? d + game.i18n.localize("CLUEBOOK.Time.DaysShort") : '';
          const hStr = h > 0 ? h + game.i18n.localize("CLUEBOOK.Time.HoursShort") : '';
          const mStr = m + game.i18n.localize("CLUEBOOK.Time.MinutesShort");
          const timeStr = `${dStr}${hStr}${mStr}`.trim();

          if (diff < 0) {
            entry.isOverdue = true;
            entry.timeRemaining = timeStr;
            entry.timeStr = timeStr;
          } else {
            entry.isOverdue = false;
            entry.timeRemaining = timeStr;
            entry.timeStr = timeStr;
          }
        }

        if (entry.sourceTab === "timeline") {
          if (entry.startTimestamp) {
            const dt = scApi.timestampToDate(entry.startTimestamp);
            entry.formattedStart = scApi.formatDateTime(dt).date + " " + scApi.formatDateTime(dt).time;
            entry.formattedStartDate = scApi.formatDateTime(dt).date;
            entry.formattedStartTime = scApi.formatDateTime(dt).time;
          }
          if (entry.endTimestamp) {
            const dt = scApi.timestampToDate(entry.endTimestamp);
            entry.formattedEnd = scApi.formatDateTime(dt).date + " " + scApi.formatDateTime(dt).time;
            entry.formattedEndDate = scApi.formatDateTime(dt).date;
            entry.formattedEndTime = scApi.formatDateTime(dt).time;
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


  _onClose(options) {
    super._onClose(options);
    if (this._outsideClickHandler) {
      document.removeEventListener('mousedown', this._outsideClickHandler);
      this._outsideClickHandler = null;
    }
    if (this._boardMoveHandler) {
      document.removeEventListener('mousemove', this._boardMoveHandler);
      this._boardMoveHandler = null;
    }
    if (this._boardUpHandler) {
      document.removeEventListener('mouseup', this._boardUpHandler);
      this._boardUpHandler = null;
    }
    const dropdown = document.querySelector('.cb-mention-dropdown');
    if (dropdown) dropdown.remove();
    const tooltip = document.querySelector('.cb-custom-tooltip');
    if (tooltip) tooltip.remove();
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;
    const settings = this.getSettings();
    const isReadOnly = this.state.isReadOnly;
    
    if (this._savedScrollPos !== undefined) {
      const contentPane = html.querySelector('.cluebook-content');
      if (contentPane) contentPane.scrollTop = this._savedScrollPos;
      this._savedScrollPos = undefined;
    }
    
    // Bind Keyboard Shortcuts (Hotkeys)
    html.addEventListener('keydown', (ev) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
      
      if (this.state.selectedEntryId || this.state.selectedEntries.size > 0) {
        if (ev.key === "Delete" || ev.key === "Backspace") {
          ev.preventDefault();
          if (isReadOnly) return;
          
          if (this.state.selectedEntries.size > 1) {
            this._onDeleteGroup();
          } else {
            const id = this.state.selectedEntryId || Array.from(this.state.selectedEntries)[0];
            const entryEl = html.querySelector(`[data-entry-id="${id}"]`);
            if (entryEl) ClueBookApp._onDeleteEntry(null, entryEl);
          }
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          this.state.selectedEntryId = null;
          this.state.selectedEntries.clear();
          html.querySelectorAll('.cluebook-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
        }
      }
    });

    if (this.state.activeTab === "board") {
      html.style.overflow = "hidden";
    } else {
      html.style.overflow = "";
    }
    
    // Apply aesthetics globally
    html.style.setProperty('--cb-bg-glass', `rgba(26, 26, 36, ${settings.theme.opacity / 100})`);
    html.style.setProperty('--cb-accent', settings.theme.accent);
    const hex = settings.theme.accent.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      html.style.setProperty('--cb-accent-glow', `rgba(${r}, ${g}, ${b}, 0.4)`);
    }

    if (this.state.activeTab === "settings") {
      this._bindSettingsListeners(html);
    }
    
    // Bind workspace selector
    const workspaceSelect = html.querySelector('#cb-workspace-select');
    if (workspaceSelect) {
      workspaceSelect.addEventListener('change', async (ev) => {
        this.state.activeWorkspace = ev.target.value;
        await game.user.setFlag("ClueBook", "lastWorkspace", ev.target.value);
        this.render();
      });
    }

    // Bind workspace creation
    const workspaceCreate = html.querySelector('#cb-workspace-create');
    if (workspaceCreate) {
      workspaceCreate.addEventListener('click', (ev) => {
        ev.preventDefault();
        this._createNewWorkspace();
      });
    }
    
    // Bind hide hotkeys
    const hideHotkeysBtn = html.querySelector('[data-action="hideHotkeys"]');
    if (hideHotkeysBtn) {
      hideHotkeysBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        await game.user.update({ "flags.ClueBook.settings.theme.showHotkeys": false });
        this.render({ parts: ["content"] });
      });
    }

    // Bind search input
    const searchInput = html.querySelector('#cluebook-search');
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
        await game.user.setFlag("ClueBook", "lastTab", tab);
        this.render();
      });
    });

    // Bind auto-save inputs
    html.querySelectorAll('.cluebook-input').forEach(input => {
      input.addEventListener('input', (ev) => {
        this._handleInputDebounced(ev.currentTarget);
      });
    });

    // --- @ Mention Autocomplete ---
    this._bindMentionAutocomplete(html);
    
    // --- Custom Tooltips ---
    this._bindCustomTooltips(html);

    // Handle Selection logic
    html.querySelectorAll('.cluebook-entry').forEach(entry => {
      entry.addEventListener('mousedown', (ev) => {
        // Skip list-view selection logic if we are on the board
        if (this.state.activeTab === "board") return;
        
        // Only select on left click, ignore if clicking inputs
        if (ev.button !== 0) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
        
        // Remove previous selection
        html.querySelectorAll('.cluebook-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
        
        this.state.selectedEntryId = entry.dataset.entryId;
        entry.classList.add('is-selected');
        entry.focus({ preventScroll: true }); // Give focus so keydown on window works reliably
      });
      
      // Make entry focusable so it can capture key events without scrolling
      entry.setAttribute('tabindex', '-1');
    });

    // Auto-focus new/editing entry
    if (this.state.editingEntryId) {
      const editingNode = html.querySelector(`.cluebook-entry[data-entry-id="${this.state.editingEntryId}"]`);
      if (editingNode) {
        const firstInput = editingNode.querySelector('.cluebook-input');
        if (firstInput) {
          firstInput.focus({ preventScroll: true });
          if (typeof firstInput.selectionStart === 'number') {
            firstInput.selectionStart = firstInput.value.length;
          }
        }
      }
    }

    // Double-click to edit
    html.querySelectorAll('.cluebook-entry .view-mode').forEach(viewNode => {
      viewNode.addEventListener('dblclick', (ev) => {
        const toggleBtn = ev.currentTarget.closest('.cluebook-entry')?.querySelector('[data-action="toggleEdit"]');
        if (toggleBtn) toggleBtn.click();
      });
    });

    // Intercept Scene Links to offer View/Activate/Configure
    html.addEventListener('click', async (ev) => {
      const sceneLink = ev.target.closest('a.content-link[data-type="Scene"]');
      if (sceneLink) {
        ev.preventDefault();
        ev.stopPropagation();
        
        const uuid = sceneLink.dataset.uuid;
        const scene = await fromUuid(uuid);
        if (!scene) return;
        
        const { ApplicationV2 } = foundry.applications.api;
        
        class SceneActionDialog extends ApplicationV2 {
          static DEFAULT_OPTIONS = {
            id: `scene-dialog-${scene.id}`,
            classes: ["cluebook-window"],
            window: { title: scene.name, icon: "fas fa-map" },
            position: { width: 450, height: "auto" }
          };
          
          _renderHTML(context, options) {
            return Promise.resolve(`
              <div style="padding: 15px; text-align: center; color: #fff; display: flex; flex-direction: column; gap: 15px;">
                <p style="margin: 0; font-size: 15px;">Что сделать со сценой <strong>${scene.name}</strong>?</p>
                <div style="display: flex; justify-content: center; gap: 12px;">
                  <button data-action="view" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 8px; cursor: pointer; transition: all 0.2s; overflow: hidden;">
                    <i class="fas fa-eye" style="font-size: 18px;"></i>
                    <span style="font-size: 12px; font-weight: 500; letter-spacing: 0.5px;">Предпросмотр</span>
                  </button>
                  <button data-action="activate" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 8px; cursor: pointer; transition: all 0.2s; overflow: hidden;">
                    <i class="fas fa-bullseye" style="font-size: 18px;"></i>
                    <span style="font-size: 12px; font-weight: 500; letter-spacing: 0.5px;">Активировать</span>
                  </button>
                  <button data-action="config" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 10px 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 8px; cursor: pointer; transition: all 0.2s; overflow: hidden;">
                    <i class="fas fa-cog" style="font-size: 18px;"></i>
                    <span style="font-size: 12px; font-weight: 500; letter-spacing: 0.5px;">Настройки</span>
                  </button>
                </div>
              </div>
            `);
          }
          
          _replaceHTML(result, content, options) {
            content.innerHTML = result;
          }
          
          _onRender(context, options) {
            super._onRender(context, options);
            const html = this.element;
            
            html.style.background = "rgba(26, 26, 36, 0.95)";
            html.style.backdropFilter = "blur(12px)";
            html.style.webkitBackdropFilter = "blur(12px)";
            html.style.border = "1px solid rgba(255,255,255,0.1)";
            html.style.boxShadow = "0 10px 30px rgba(0,0,0,0.8)";
            html.style.color = "#fff";
            html.style.borderRadius = "8px";
            
            const header = html.querySelector('.window-header');
            if (header) {
               header.style.background = "rgba(0,0,0,0.3)";
               header.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
               header.style.color = "#fff";
               header.style.borderRadius = "8px 8px 0 0";
            }
            
            const content = html.querySelector('.window-content');
            if (content) {
               content.style.background = "transparent";
               content.style.color = "#fff";
               content.style.padding = "0";
            }
            
            html.querySelectorAll('button').forEach(btn => {
              btn.addEventListener('mouseenter', () => {
                btn.style.background = "rgba(123, 97, 255, 0.4)";
                btn.style.borderColor = "#7b61ff";
                btn.style.boxShadow = "0 0 10px rgba(123, 97, 255, 0.3)";
              });
              btn.addEventListener('mouseleave', () => {
                btn.style.background = "rgba(255,255,255,0.05)";
                btn.style.borderColor = "rgba(255,255,255,0.2)";
                btn.style.boxShadow = "none";
              });
              btn.addEventListener('click', (ev) => {
                const action = ev.currentTarget.dataset.action;
                if (action === "view") scene.view();
                if (action === "activate") scene.activate();
                if (action === "config") scene.sheet.render(true);
                this.close();
              });
            });
          }
        }
        
        new SceneActionDialog().render(true);
      }
    });

    // Setup Board Interactivity
    if (this.state.activeTab === "board" && !this.state.searchQuery) {
      this._setupBoardInteractivity(html);
    }

    // Setup List Drag & Drop
    if (!this.state.isBoardView && !this.state.searchQuery && this.state.activeTab !== "settings" && this.state.activeTab !== "workspaces" && !this.state.isReadOnly) {
      this._setupListDragDrop(html);
    }
  }

  _setupListDragDrop(html) {
    let draggedItem = null;
    const listContainer = html.querySelector('.entries-list');
    if (!listContainer) return;

    listContainer.addEventListener('dragover', ev => ev.preventDefault());

    html.querySelectorAll('.entries-list .cluebook-entry').forEach(entry => {
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
        const allEntries = Array.from(listContainer.querySelectorAll('.cluebook-entry'));
        const updates = {};
        
        allEntries.forEach((el, index) => {
          const id = el.dataset.entryId;
          const flagPath = `flags.ClueBook.data.${this.state.activeTab}.${id}.sort`;
          updates[flagPath] = index;
        });

        await this._updateWorkspaceData(updates);
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

  _bindSettingsListeners(html) {
    const saveSetting = async (scope, key, value) => {
      // Foundry resolves "flags.ClueBook.settings.X.Y" paths into proper nested objects
      const flagPath = `flags.ClueBook.settings.${key}`;
      
      // Theme settings are ALWAYS saved to the personal user
      if (key.startsWith('theme.')) {
        await game.user.update({ [flagPath]: value });
      } else {
        // Visibility, widget and defaultColors follow workspace scope
        if (this.state.isShared) {
          const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
          if (journal) {
            if (journal.isOwner) {
              await journal.update({ [flagPath]: value });
            } else {
              game.socket.emit("module.ClueBook", {
                action: "updateBoardData",
                journalId: journal.id,
                updateData: { [flagPath]: value }
              });
            }
          }
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
        
        const contentPane = html.querySelector('.cluebook-content');
        if (contentPane) this._savedScrollPos = contentPane.scrollTop;

        let value = target.value;
        if (target.type === 'checkbox') value = target.checked;
        if (target.type === 'range') value = Number(target.value);
        saveSetting(this.state.isShared ? 'shared' : 'personal', key, value);
      });
    });
  }


  /**
   * Raw saving without debounce for internal actions
   */
  async _saveDataRaw(tab, entryId, field, value) {
    const flagPath = `flags.ClueBook.data.${tab}.${entryId}.${field}`;
    await this._updateWorkspaceData({ [flagPath]: value });
  }

  /**
   * Debounced save handler for inputs
   */
  _handleInputDebounced(target) {
    const entryElement = target.closest('.cluebook-entry');
    const entryId = entryElement.dataset.entryId;
    const sourceTab = entryElement.dataset.sourceTab || this.state.activeTab;
    const field = target.dataset.field;
    
    const debounceKey = `${entryId}-${field}`;
    if (!this._debouncedSaves[debounceKey]) {
      this._debouncedSaves[debounceKey] = foundry.utils.debounce(() => {
        this._saveDataRaw(sourceTab, entryId, field, target.value);
      }, 500);
    }
    this._debouncedSaves[debounceKey]();
  }


  // ---- @-Mention Autocomplete System ----
  _bindCustomTooltips(html) {
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

    html.querySelectorAll('.cb-link-chip').forEach(chip => {
      chip.addEventListener('mouseenter', () => {
        const preview = chip.dataset.qnPreview;
        if (!preview) return;
        const name = chip.textContent.trim();

        tooltipTimeout = setTimeout(() => {
          removeTooltip(); // Clean any existing
          
          tooltipEl = document.createElement('div');
          tooltipEl.className = 'cb-custom-tooltip';
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

  _bindMentionAutocomplete(html) {
    // Create a single shared dropdown element
    let dropdown = document.querySelector('.cb-mention-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'cb-mention-dropdown';
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
        const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('ClueBook_Shared_DB');
        if (j) data = j.getFlag('ClueBook', 'data') || {};
      } else {
        data = game.user.getFlag('ClueBook', 'data') || {};
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
        item.className = 'cb-mention-item';
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

    html.querySelectorAll('textarea.cluebook-input').forEach(textarea => {
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
        const items = dropdown.querySelectorAll('.cb-mention-item');
        const current = dropdown.querySelector('.cb-mention-item.active');
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
          return `<a class="cb-mention-link" data-mention-id="${id}" title="${game.i18n.format("CLUEBOOK.App.GoToEntry", { name: name })}">${displayText}</a>`;
        }
      );
    });

    html.querySelectorAll('.cb-mention-link').forEach(link => {
      link.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const targetId = link.dataset.mentionId;
        if (!targetId) return;
        // Jump to linked entry (reuse existing jumpToLinked logic)
        let data = {};
        if (this.state.activeWorkspace !== 'personal') {
          const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('ClueBook_Shared_DB');
          if (j) data = j.getFlag('ClueBook', 'data') || {};
        } else {
          data = game.user.getFlag('ClueBook', 'data') || {};
        }
        let targetTab = null;
        for (const [tab, tabData] of Object.entries(data)) {
          if (tab === 'links' || tab === 'board' || tab === 'search') continue;
          if (tabData && tabData[targetId]) { targetTab = tab; break; }
        }
        if (!targetTab) { ui.notifications.warn(game.i18n.localize("CLUEBOOK.App.EntryNotFound")); return; }
        await game.user.setFlag('ClueBook', 'lastTab', targetTab);
        this.state.activeTab = targetTab;
        this.state.highlightedEntryId = targetId;
        // Full render so the tabs nav also updates to the new active tab
        await this.render();
        // Scroll highlighted card into view after DOM update
        setTimeout(() => {
          const el = this.element?.querySelector(`.cluebook-entry[data-entry-id="${targetId}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        const settings = this.getSettings();
        const durationMs = (settings.theme.highlightDuration || 2) * 1000;
        setTimeout(() => {
          if (this.state.highlightedEntryId === targetId) {
            this.state.highlightedEntryId = null;
            const el = this.element?.querySelector(`.cluebook-entry[data-entry-id="${targetId}"]`);
            if (el) el.classList.remove('is-highlighted');
          }
        }, durationMs);
      });
    });
  }



}
