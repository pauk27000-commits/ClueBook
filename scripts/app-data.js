export const ClueBookDataMixin = (Base) => class extends Base {
  async _sanitizeData(data) {
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
      updates["flags.ClueBook.data.links"] = newLinks;
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
          await this._updateWorkspaceData(updates);
        } catch (e) {
          console.warn("ClueBook | Could not migrate links.");
        }
      }
    }

    return newData;
  }
  async _enrichEntry(entry) {
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
  _getEmptyEntryForTab(tab) {
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
  _getWorkspaceJournal() {
    if (this.state.activeWorkspace === "personal" || this.state.activeWorkspace.startsWith("personal_")) return null;
    return game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
  }

  async _updateWorkspaceData(updateData) {
    let finalData = { ...updateData };
    let unsetPaths = [];

    for (const key of Object.keys(finalData)) {
      if (key.includes(".-=")) {
        const path = key.replace("flags.ClueBook.", "").replace(".-=", ".");
        unsetPaths.push(path);
        delete finalData[key];
      }
    }

    const journal = this._getWorkspaceJournal();
    if (journal) {
      if (journal.isOwner) {
        for (const path of unsetPaths) await journal.unsetFlag("ClueBook", path);
        if (Object.keys(finalData).length > 0) await journal.update(finalData);
      } else {
        game.socket.emit("module.ClueBook", {
          action: "updateBoardData",
          journalId: journal.id,
          updateData: finalData,
          unsetPaths: unsetPaths
        });
      }
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      if (u && game.user.isGM) {
        for (const path of unsetPaths) await u.unsetFlag("ClueBook", path);
        if (Object.keys(finalData).length > 0) await u.update(finalData);
      }
    } else {
      for (const path of unsetPaths) await game.user.unsetFlag("ClueBook", path);
      if (Object.keys(finalData).length > 0) await game.user.update(finalData);
    }
  }

  _getWorkspaceLinks() {
    const journal = this._getWorkspaceJournal();
    if (journal) return journal.getFlag("ClueBook", "data.links") || {};
    if (this.state.activeWorkspace.startsWith("personal_")) {
      const uId = this.state.activeWorkspace.split("_")[1];
      const u = game.users.get(uId);
      if (u && game.user.isGM) return u.getFlag("ClueBook", "data.links") || {};
    }
    return game.user.getFlag("ClueBook", "data.links") || {};
  }
};
