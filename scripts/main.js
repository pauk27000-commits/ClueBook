import { ClueBookApp } from "./app.js";
import { CalendarWidget } from "./calendar.js";
import { ClueBookSocket } from "./socket.js";


// Global reference to the app instance
let clueBookApp = null;
let calendarWidgetApp = null;

Hooks.once("init", () => {
  console.log("ClueBook V14 | Initializing...");
  


  game.settings.register("ClueBook", "calendarData", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => {
      if (calendarWidgetApp && calendarWidgetApp.rendered) {
        calendarWidgetApp.render({ force: true });
      }
    }
  });

  // Re-render widget whenever world time changes (Simple Calendar fires this too)
  Hooks.on("updateWorldTime", () => {
    if (calendarWidgetApp && calendarWidgetApp.rendered) {
      calendarWidgetApp.render({ force: true });
    }
    if (clueBookApp && clueBookApp.rendered && !clueBookApp.state.editingEntryId) {
      clueBookApp.render({ parts: ["content"] });
    }
  });
});

Hooks.once("ready", async () => {
  console.log("ClueBook | Ready hook fired! Registering socket.");
  game.socket.on("module.ClueBook", (data) => {
    console.log("ClueBook | RAW SOCKET RECEIVED:", data);
  });
  ClueBookSocket.init();

  const settings = game.user.getFlag("ClueBook", "settings") || {};
  
  if (settings.theme?.showCalendarWidget !== false) {
    calendarWidgetApp = new CalendarWidget();
    calendarWidgetApp.render({ force: true });
  }

  // Register Simple Calendar's dedicated hook for date/time changes
  if (window.SimpleCalendar?.Hooks?.DateTimeChange) {
    Hooks.on(window.SimpleCalendar.Hooks.DateTimeChange, () => {
      if (calendarWidgetApp && calendarWidgetApp.rendered) {
        calendarWidgetApp.render({ force: true });
      }
      if (clueBookApp && clueBookApp.rendered && !clueBookApp.state.editingEntryId) {
        clueBookApp.render({ parts: ["content"] });
      }
    });
  }

  // Inject floating widget on ready
  const injectWidget = () => {
    if ($("#cluebook-widget").length) return;

    const pos = game.user.getFlag("ClueBook", "widgetPos") || { left: 20, bottom: 80 };
    const direction = game.user.getFlag("ClueBook", "settings")?.widget?.direction || "up-right";
    const settings = game.user.getFlag("ClueBook", "settings") || {};
    
    // Ограничиваем координаты размерами текущего окна (чтобы виджет не улетел за экран)
    let left = pos.left !== undefined ? pos.left : 20;
    if (left > window.innerWidth - 60) left = window.innerWidth - 60;
    if (left < 0) left = 20;
    
    let styleStr = `left: ${left}px;`;
    
    if (pos.top !== undefined) {
      let top = pos.top;
      if (top > window.innerHeight - 60) top = window.innerHeight - 60;
      if (top < 0) top = 20;
      styleStr += ` top: ${top}px; bottom: auto;`;
    } else {
      let bottom = pos.bottom !== undefined ? pos.bottom : 80;
      if (bottom > window.innerHeight - 60) bottom = window.innerHeight - 60;
      if (bottom < 0) bottom = 80;
      styleStr += ` bottom: ${bottom}px; top: auto;`;
    }

    const widget = $(`
      <div id="cluebook-widget" class="cluebook-widget" style="${styleStr}">
        <div class="cb-widget-main" title="${game.i18n.localize("CLUEBOOK.Main.WidgetTitle")}">
          <i class="fas fa-book-open"></i>
        </div>
        <div class="cb-fab-menu"></div>
      </div>
    `);

    let hoverTimeout;
    widget.on("mouseenter", () => {
      if (widget.hasClass("is-dragging")) return;
      clearTimeout(hoverTimeout);
      
      const currentSettings = game.user.getFlag("ClueBook", "settings") || {};
      if (currentSettings.theme?.showQuickWidget === false) return;

      if (!widget.hasClass("cb-menu-active")) {
        widget.addClass("cb-menu-active");
        
        const settings = game.user.getFlag("ClueBook", "settings") || {};
        const direction = (settings.widget && settings.widget.direction) ? settings.widget.direction : "up-right";
        
        const html = 
          '<a class="cb-fab-btn" data-type="notes" title="' + game.i18n.localize("CLUEBOOK.Main.AddNote") + '"><i class="fas fa-sticky-note"></i></a>' +
          '<a class="cb-fab-btn" data-type="npc" title="' + game.i18n.localize("CLUEBOOK.Main.AddNPC") + '"><i class="fas fa-user"></i></a>' +
          '<a class="cb-fab-btn" data-type="quests" title="' + game.i18n.localize("CLUEBOOK.Main.AddQuest") + '"><i class="fas fa-map"></i></a>' +
          '<a class="cb-fab-btn" data-type="timeline" title="' + game.i18n.localize("CLUEBOOK.Main.AddEvent") + '"><i class="fas fa-clock"></i></a>';
        
        const menu = widget.find('.cb-fab-menu');
        menu.attr('data-direction', direction);
        menu.html(html);
      }
    });

    widget.on("mouseleave", () => {
      hoverTimeout = setTimeout(() => {
        widget.removeClass("cb-menu-active");
      }, 1500);
    });

    widget.on("click", (ev) => {
      if (widget.hasClass("is-dragging")) return;
      
      const btn = $(ev.target).closest('.cb-fab-btn');
      if (btn.length) {
        ev.stopPropagation();
        ClueBookApp.showQuickAddDialog(btn.data("type"));
        return;
      }
      
      if (!clueBookApp) {
        clueBookApp = new ClueBookApp();
      }
      
      if (clueBookApp.rendered) {
        clueBookApp.close();
      } else {
        clueBookApp.render({ force: true });
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
      if ($(ev.target).closest('.cb-fab-btn').length) return;
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
        game.user.setFlag("ClueBook", "widgetPos", {
          left: parseInt(el.style.left),
          top: parseInt(el.style.top)
        });
      }
    });
  };

  injectWidget();
});

Hooks.on("updateUser", (user, updateData) => {
  if (user.id !== game.user.id) return;
  
  const settings = foundry.utils.getProperty(updateData, "flags.ClueBook.settings.theme");
  if (!settings) return;

  if (settings.showQuickWidget !== undefined) {
    if (!settings.showQuickWidget) {
      // Just hide the bubbles (menu) if it's currently open, do not hide the widget
      $("#cluebook-widget").removeClass("cb-menu-active");
    }
  }

  if (settings.showCalendarWidget !== undefined) {
    if (settings.showCalendarWidget) {
      if (!calendarWidgetApp) {
        calendarWidgetApp = new CalendarWidget();
        calendarWidgetApp.render({ force: true });
      }
    } else {
      if (calendarWidgetApp) {
        calendarWidgetApp.close();
        calendarWidgetApp = null;
      }
    }
  }
});

// Live Sync
Hooks.on("updateJournalEntry", (journal, data, options, userId) => {
  if (!clueBookApp || !clueBookApp.rendered) return;
  if (journal.id === clueBookApp.state.activeWorkspace || journal.name === "ClueBook_Shared_DB") {
    // If another user updated the board we are currently looking at, and we are not actively editing
    if (userId !== game.user.id && !clueBookApp.state.editingEntryId) {
      clueBookApp.render();
    }
  }
});
