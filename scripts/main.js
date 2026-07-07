import { QuickNotesApp } from "./app.js";

// Global reference to the app instance
let quickNotesApp = null;

Hooks.once("init", () => {
  console.log("QuickNotes V14 | Initializing...");
});

Hooks.once("ready", async () => {
  // Inject floating widget on ready
  const injectWidget = () => {
    if ($("#quicknotes-widget").length) return;

    const pos = game.user.getFlag("notebook", "widgetPos") || { left: 20, bottom: 80 };
    let styleStr = `left: ${pos.left}px;`;
    if (pos.top !== undefined) {
      styleStr += ` top: ${pos.top}px; bottom: auto;`;
    } else {
      styleStr += ` bottom: ${pos.bottom}px; top: auto;`;
    }

    const widget = $(`
      <div id="quicknotes-widget" class="quicknotes-widget" style="${styleStr}">
        <div class="qn-widget-main" title="Ежедневник (Перетащите для смещения)">
          <i class="fas fa-book-open"></i>
        </div>
        <div class="qn-fab-menu"></div>
      </div>
    `);

    let hoverTimeout;
    widget.on("mouseenter", () => {
      if (widget.hasClass("is-dragging")) return;
      clearTimeout(hoverTimeout);
      
      if (!widget.hasClass("qn-menu-active")) {
        widget.addClass("qn-menu-active");
        
        const settings = game.user.getFlag("notebook", "settings") || {};
        const widgetConf = settings.widget || { direction: "up-right", showNotes: true, showNpc: true, showQuests: true, showTimeline: true };
        
        let html = '';
        if (widgetConf.showNotes) html += '<a class="qn-fab-btn" data-type="notes" title="Добавить заметку"><i class="fas fa-sticky-note"></i></a>';
        if (widgetConf.showNpc) html += '<a class="qn-fab-btn" data-type="npc" title="Добавить персонажа"><i class="fas fa-user"></i></a>';
        if (widgetConf.showQuests) html += '<a class="qn-fab-btn" data-type="quests" title="Добавить квест"><i class="fas fa-map"></i></a>';
        if (widgetConf.showTimeline) html += '<a class="qn-fab-btn" data-type="timeline" title="Добавить событие"><i class="fas fa-clock"></i></a>';
        
        const menu = widget.find('.qn-fab-menu');
        menu.attr('data-direction', widgetConf.direction);
        menu.html(html);
      }
    });

    widget.on("mouseleave", () => {
      hoverTimeout = setTimeout(() => {
        widget.removeClass("qn-menu-active");
      }, 1500);
    });

    widget.on("click", (ev) => {
      if (widget.hasClass("is-dragging")) return;
      
      const btn = $(ev.target).closest('.qn-fab-btn');
      if (btn.length) {
        ev.stopPropagation();
        QuickNotesApp.showQuickAddDialog(btn.data("type"));
        return;
      }
      
      if (!quickNotesApp) {
        quickNotesApp = new QuickNotesApp();
      }
      
      if (quickNotesApp.rendered) {
        quickNotesApp.close();
      } else {
        quickNotesApp.render(true);
      }
    });

    $("body").append(widget);

    // Make widget draggable manually without jQuery UI
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hasMoved = false;

    const el = widget[0];

    el.addEventListener('pointerdown', (ev) => {
      // Don't drag if clicking a popup button
      if ($(ev.target).closest('.qn-fab-btn').length) return;
      if (ev.button !== 0) return; // only left click
      
      isDragging = true;
      hasMoved = false;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      el.setPointerCapture(ev.pointerId);
    });

    el.addEventListener('pointermove', (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
        widget.addClass("is-dragging");
      }
      if (hasMoved) {
        el.style.left = `${startLeft + dx}px`;
        el.style.top = `${startTop + dy}px`;
        el.style.bottom = 'auto';
      }
    });

    el.addEventListener('pointerup', (ev) => {
      if (!isDragging) return;
      isDragging = false;
      el.releasePointerCapture(ev.pointerId);
      if (hasMoved) {
        setTimeout(() => widget.removeClass("is-dragging"), 100);
        game.user.setFlag("notebook", "widgetPos", {
          left: parseInt(el.style.left),
          top: parseInt(el.style.top)
        });
      }
    });
  };

  injectWidget();
});

// Live Sync
Hooks.on("updateJournalEntry", (journal, data, options, userId) => {
  if (!quickNotesApp || !quickNotesApp.rendered) return;
  if (journal.id === quickNotesApp.state.activeWorkspace || journal.name === "QuickNotes_Shared_DB") {
    // If another user updated the board we are currently looking at, and we are not actively editing
    if (userId !== game.user.id && !quickNotesApp.state.editingEntryId) {
      quickNotesApp.render();
    }
  }
});
