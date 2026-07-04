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
        folder: null, // Root level, but hidden by permissions if we wanted. Actually we make it owner for everyone so they can write.
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
});

// Inject the floating widget
Hooks.on("renderSceneControls", (controls, html) => {
  // Inject into the bottom left, above macro bar
  const widget = $(`
    <div id="quicknotes-widget" class="quicknotes-widget" title="QuickNotes">
      <i class="fas fa-book-open"></i>
    </div>
  `);

  widget.on("click", () => {
    if (!quickNotesApp) {
      quickNotesApp = new QuickNotesApp();
    }
    
    if (quickNotesApp.rendered) {
      quickNotesApp.close();
    } else {
      quickNotesApp.render(true);
    }
  });

  // Remove existing widget if re-rendering
  $("#quicknotes-widget").remove();
  
  // Append to body (floating)
  $("body").append(widget);
});
