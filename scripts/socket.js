export class QuickNotesSocket {
  static init() {
    game.socket.on("module.notebook", async (data) => {
      // Only the GM processes these incoming requests
      if (!game.user.isGM) return;

      if (data.action === "updateBoard") {
        // Ensure only one active GM processes this to avoid race conditions
        const activeGMs = game.users.filter(u => u.isGM && u.active);
        if (activeGMs.length > 0 && activeGMs[0].id === game.user.id) {
          const journal = game.journal.get(data.journalId);
          if (journal) {
            await journal.update({ name: data.name, ownership: data.ownership });
          }
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
