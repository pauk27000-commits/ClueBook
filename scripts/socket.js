export class QuickNotesSocket {
  static init() {
    game.socket.on("module.notebook", async (data) => {
      console.log("QuickNotes | Socket event received by client:", {
        userName: game.user.name,
        isGM: game.user.isGM,
        data: data
      });
      
      if (data.action === "updateBoard") {
        if (!game.user.isGM) return;
        try {
          const journal = game.journal.get(data.journalId);
          if (journal) await journal.update({ name: data.name, ownership: data.ownership });
        } catch (err) { console.error(err); }
      }

      if (data.action === "updateBoardData") {
        if (!game.user.isGM) return;
        try {
          const journal = game.journal.get(data.journalId);
          if (journal) await journal.update(data.updateData);
        } catch (err) { console.error(err); }
      }

      if (data.action === "createBoard") {
        if (!game.user.isGM) return;
        try {
          const playerName = game.users.get(data.userId)?.name || "Игрок";
          ui.notifications.info(`Запрос от ${playerName}: создание доски "${data.name}"...`);

          let folder = game.folders.find(f => f.name === "QuickNotes Boards" && f.type === "JournalEntry");
          if (!folder) {
            folder = await Folder.create({ name: "QuickNotes Boards", type: "JournalEntry" });
          }
          const journal = await JournalEntry.create({
            name: data.name,
            folder: folder ? folder.id : null,
            ownership: data.ownership,
            flags: { notebook: { isWorkspace: true, data: {} } }
          });
          if (journal) {
            game.socket.emit("module.notebook", {
              action: "boardCreated",
              journalId: journal.id,
              userId: data.userId
            });
            ui.notifications.info(`Доска "${data.name}" создана!`);
          }
        } catch (err) {
          console.error("QuickNotes | Error creating board:", err);
          ui.notifications.error("Ошибка при создании доски. См. консоль.");
        }
      }

      if (data.action === "boardCreated" && data.userId === game.user.id) {
        ui.notifications.info("Доска успешно создана!");
        const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "QuickNotesApp");
        if (app) {
          app.state.activeWorkspace = data.journalId;
          app.render();
        }
      }

      if (data.action === "addSimpleCalendarNote") {
        if (!game.user.isGM) return;
        try {
          if (window.SimpleCalendar && window.SimpleCalendar.api) {
            const permissions = {};
            game.users.forEach(u => {
              permissions[u.id] = 2; // OBSERVER
            });
            permissions[data.userId] = 3; // OWNER

            const scNote = await window.SimpleCalendar.api.addNote(
              data.title,
              data.content,
              data.startDate,
              data.endDate,
              true, // allDay
              false, // repeats
              {}, // categories
              { default: 0, ...permissions } // Note permissions!
            );

            if (scNote) {
              game.socket.emit("module.notebook", {
                action: "scNoteCreated",
                userId: data.userId,
                journalId: scNote.id || scNote._id
              });
            }
          }
        } catch (err) {
          console.error("Simple Calendar note error:", err);
        }
      }

      if (data.action === "scNoteCreated" && data.userId === game.user.id) {
        ui.notifications.info("Отправлено в Simple Calendar!");
        const journal = game.journal.get(data.journalId);
        if (journal && journal.sheet) {
          journal.sheet.render(true);
        }
      }
    });
  }

  static async updateBoard(journalId, name, ownership) {
    if (game.user.isGM) {
      const journal = game.journal.get(journalId);
      if (journal) {
        await journal.update({ name, ownership });
      }
    } else {
      game.socket.emit("module.notebook", {
        action: "updateBoard",
        journalId: journalId,
        name: name,
        ownership: ownership
      });
      // We assume it succeeds. We could add a callback/response if needed.
    }
  }
}
