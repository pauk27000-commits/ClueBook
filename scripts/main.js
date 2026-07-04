import { QuickNotesApp } from "./app.js";

// Global reference to the app instance
let quickNotesApp = null;

Hooks.once("init", () => {
  console.log("QuickNotes V14 | Initializing...");
});

Hooks.once("ready", async () => {
  // Ensure the shared journal database exists
  if (game.user.isGM) {
    let journal = game.journal.getName("QuickNotes_Shared_DB");
    
    if (!journal) {
      journal = await JournalEntry.create({
        name: "QuickNotes_Shared_DB",
        folder: null, 
        ownership: {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
        },
        flags: {
          notebook: {
            isDB: true
          }
        }
      });
      console.log("QuickNotes V14 | Created Shared DB Journal Entry.");
    }
  }

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
      <div id="quicknotes-widget" class="quicknotes-widget" title="Ежедневник (Перетащите для смещения)" style="${styleStr}">
        <i class="fas fa-book-open"></i>
      </div>
    `);

    widget.on("click", (ev) => {
      if (widget.hasClass("is-dragging")) return;
      
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

    // Make widget draggable
    widget.draggable({
      distance: 5,
      start: () => {
        widget.addClass("is-dragging");
      },
      stop: (event, ui) => {
        setTimeout(() => widget.removeClass("is-dragging"), 100);
        game.user.setFlag("notebook", "widgetPos", {
          left: ui.position.left,
          top: ui.position.top
        });
      }
    });
  };

  injectWidget();
});
