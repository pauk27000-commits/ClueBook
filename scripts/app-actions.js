import { ClueBookEditDialog } from "./edit-dialog.js";
export const ClueBookActionsMixin = (Base) => class extends Base {
  static async _onSubmitForm(event, form, formData) {}
  static async _onToggleZenMode(event, target) {
    this.state.isZenMode = !this.state.isZenMode;
    if (this.state.isZenMode) {
      this.element.classList.add("zen-mode");
      target.innerHTML = `<i class="fas fa-compress"></i>`;
    } else {
      this.element.classList.remove("zen-mode");
      target.innerHTML = `<i class="fas fa-expand"></i>`;
    }
    this.render({ parts: ["content"] });
  }

  static async _onToggleMode(event, target) {
    this.state.isShared = !this.state.isShared;
    this.render({ parts: ["content"] });
  }
  
  static async _onToggleEdit(event, target) {
    event.stopPropagation();
    if (this.state.isReadOnly) return;
    const entryElement = target.closest('.cluebook-entry');
    if (!entryElement) return;

    const entryId = entryElement.dataset.entryId;
    const sourceTab = entryElement.dataset.sourceTab || this.state.activeTab;

    let dataObj = {};
    if (this.state.activeWorkspace === "personal") {
      dataObj = game.user.getFlag("ClueBook", "data") || {};
    } else {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) dataObj = journal.getFlag("ClueBook", "data") || {};
    }

    const entryData = dataObj[sourceTab]?.[entryId];
    if (!entryData) return;

    new ClueBookEditDialog({
      entry: entryData,
      sourceTab: sourceTab,
      entryId: entryId,
      onSave: async (updateData) => {
        const flagUpdates = {};
        for (const [key, value] of Object.entries(updateData)) {
          flagUpdates[`flags.ClueBook.data.${sourceTab}.${entryId}.${key}`] = value;
        }
        await this._updateWorkspaceData(flagUpdates);
        this.render({ parts: ["content"] });
      }
    }).render(true);
  }

  static async _onToggleText(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = target.closest('.is-long-text');
    if (wrapper) {
      wrapper.classList.toggle('is-expanded');
      const span = target.querySelector('span');
      if (wrapper.classList.contains('is-expanded')) {
        if (span) span.innerText = game.i18n.localize("CLUEBOOK.Sticker.Collapse");
      } else {
        if (span) span.innerText = game.i18n.localize("CLUEBOOK.Sticker.Expand");
      }
    }
  }

  static async _onTogglePin(event, target) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const entryEl = target.closest('.cluebook-entry');
    const entryId = entryEl.dataset.entryId;
    const sourceTab = entryEl.dataset.sourceTab || this.state.activeTab;

    const isPinned = entryEl.dataset.pinned === "true";
    const newValue = !isPinned;

    await this._saveDataRaw(sourceTab, entryId, "pinned", newValue);

    if (newValue) {
      this.state.selectedEntries.delete(entryId);
      if (this.state.selectedEntryId === entryId) this.state.selectedEntryId = null;
    }

    this.render({ parts: ["content"] });
  }

  static async _onAddTime(event, target) {
    const minsToAdd = parseInt(target.dataset.mins) || 0;
    if (minsToAdd === 0) return;

    const entryElement = target.closest('.cluebook-entry');
    const entryId = entryElement.dataset.entryId;
    const sourceTab = entryElement.dataset.sourceTab || this.state.activeTab;
    const timeInput = entryElement.querySelector('input[data-field="time"]');
    
    if (!timeInput) return;
    
    let currentStr = timeInput.value.trim();
    if (!currentStr) currentStr = "00:00"; // default to midnight if empty
    
    let hours = 0;
    let mins = 0;
    let prefix = ""; // To preserve dates like "01.01.2025 "
    let suffix = "";

    const timeMatch = currentStr.match(/(.*?)(\d{1,2}):(\d{2})(.*)/);
    
    if (timeMatch) {
      prefix = timeMatch[1];
      hours = parseInt(timeMatch[2]);
      mins = parseInt(timeMatch[3]);
      suffix = timeMatch[4];
      
      mins += minsToAdd;
      while (mins >= 60) {
        mins -= 60;
        hours += 1;
      }
      while (hours >= 24) {
        hours -= 24;
      }
      
      const newTimeStr = `${prefix}${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}${suffix}`;
      timeInput.value = newTimeStr;
      
      // Save
      this._saveDataRaw(sourceTab, entryId, "time", newTimeStr);
    } else {
      ui.notifications.warn(game.i18n.localize("CLUEBOOK.AppActions.TimeFormatError"));
    }
  }

  static async _onToggleVisibility(event, target) {
    event.stopPropagation();
    const entry = target.closest('.cluebook-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;
    
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) data = journal.getFlag("ClueBook", "data") || {};
    } else {
      data = game.user.getFlag("ClueBook", "data") || {};
    }
    
    const currentEntry = data[sourceTab]?.[entryId];
    if (!currentEntry) return;
    
    await this._saveDataRaw(sourceTab, entryId, "isHidden", !currentEntry.isHidden);
    this.render({ parts: ["content"] });
  }

  static async _onShareEntry(event, target) {
    event.stopPropagation();
    const entryElement = target.closest('.cluebook-entry');
    const entryId = entryElement.dataset.entryId;
    const sourceTab = entryElement.dataset.sourceTab || this.state.activeTab;
    
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) data = journal.getFlag("ClueBook", "data") || {};
    } else {
      data = game.user.getFlag("ClueBook", "data") || {};
    }
    
    const entry = data[sourceTab]?.[entryId];
    if (!entry) return;
    
    // Process text for chat (enrich UUID links)
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
    const processUUIDs = (text) => {
      if (!text) return text;
      const uuidRegex = /(?<!@UUID\[)\b(?:Actor|Item|JournalEntry|JournalEntryPage|Scene|RollTable|Cards|Macro|Playlist|User)(?:\.[a-zA-Z0-9_-]+)+\b/g;
      let newText = text.replace(uuidRegex, match => `@UUID[${match}]`);
      const compendiumRegex = /(?<!@UUID\[)\bCompendium\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+\b/g;
      newText = newText.replace(compendiumRegex, match => `@UUID[${match}]`);
      return newText;
    };
    
    const enrich = async (t) => await TE.enrichHTML(processUUIDs(t), { async: true });
    
    let contentHTML = `<div class="cb-chat-message color-${entry.color || 'yellow'}">`;
    
    if (sourceTab === "notes") {
      contentHTML += `<div class="cb-chat-body">${await enrich(entry.text)}</div>`;
    } else if (sourceTab === "npc") {
      const npcIcon = entry.isDead ? "fa-skull" : "fa-user";
      contentHTML += `<h3 class="cb-chat-title"><i class="fas ${npcIcon}"></i> ${entry.name || game.i18n.localize("CLUEBOOK.AppActions.UnknownNPC")}</h3>`;
      if (entry.isDead) contentHTML += `<p><strong><i class="fas fa-skull" style="color:#ff5252;"></i> ${game.i18n.localize("CLUEBOOK.AppActions.Status")}:</strong> ${game.i18n.localize("CLUEBOOK.AppActions.Dead")}</p>`;
      if (entry.location) contentHTML += `<p><strong>${game.i18n.localize("CLUEBOOK.AppActions.Location")}:</strong> ${entry.location}</p>`;
      if (entry.attitude) contentHTML += `<p><strong>${game.i18n.localize("CLUEBOOK.AppActions.Attitude")}:</strong> ${entry.attitude}</p>`;
      if (entry.note) contentHTML += `<div class="cb-chat-body">${await enrich(entry.note)}</div>`;
    } else if (sourceTab === "quests") {
      const statusIcon = entry.status === "completed" ? "fa-check-circle" : (entry.status === "failed" ? "fa-times-circle" : "fa-clock");
      contentHTML += `<h3 class="cb-chat-title"><i class="fas fa-scroll"></i> ${game.i18n.localize("CLUEBOOK.AppActions.Quest")} <i class="fas ${statusIcon} cb-status-${entry.status}"></i></h3>`;
      
      if (entry.deadlineTimestamp && window.SimpleCalendar?.api) {
        const scApi = window.SimpleCalendar.api;
        const dt = scApi.timestampToDate(entry.deadlineTimestamp);
        const formatted = scApi.formatDateTime(dt).date + " " + scApi.formatDateTime(dt).time;
        if (entry.timeMode === "at") contentHTML += `<p><strong><i class="fas fa-clock"></i> ${game.i18n.localize("CLUEBOOK.AppActions.StrictlyAt")}:</strong> ${formatted}</p>`;
        else contentHTML += `<p><strong><i class="fas fa-hourglass-end"></i> ${game.i18n.localize("CLUEBOOK.AppActions.DoBy")}:</strong> ${formatted}</p>`;
      } else if (entry.deadline) {
        if (entry.timeMode === "at") contentHTML += `<p><strong><i class="fas fa-clock"></i> ${game.i18n.localize("CLUEBOOK.AppActions.StrictlyAt")}:</strong> ${entry.deadline}</p>`;
        else contentHTML += `<p><strong><i class="fas fa-hourglass-end"></i> ${game.i18n.localize("CLUEBOOK.AppActions.DoBy")}:</strong> ${entry.deadline}</p>`;
      }

      contentHTML += `<div class="cb-chat-body">${await enrich(entry.text)}</div>`;
    } else if (sourceTab === "timeline") {
      contentHTML += `<h3 class="cb-chat-title"><i class="fas fa-hourglass-half"></i> ${entry.time || game.i18n.localize("CLUEBOOK.AppActions.UnknownTime")}</h3>`;
      contentHTML += `<div class="cb-chat-body">${await enrich(entry.event)}</div>`;
    }
    
    contentHTML += `</div>`;
    
    ChatMessage.create({
      author: game.user.id,
      content: contentHTML
    });
    
    ui.notifications.info(game.i18n.localize("CLUEBOOK.AppActions.SentToChat"));
  }

  static async _onExportJSON(event, target) {
    let data = {};
    const workspaceName = this.state.activeWorkspace !== "personal" 
      ? game.journal.get(this.state.activeWorkspace)?.name || "shared_board"
      : "personal_board";

    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) data = journal.getFlag("ClueBook", "data") || {};
    } else {
      data = game.user.getFlag("ClueBook", "data") || {};
    }

    const exportData = {
      entries: [],
      links: Object.values(data.links || {})
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
    
    const content = `
      <p>${game.i18n.localize("CLUEBOOK.AppActions.ExportPrompt")}</p>
      <textarea id="cb-export-textarea" readonly style="width: 100%; height: 250px; font-family: monospace;">${jsonStr}</textarea>
    `;

    new foundry.applications.api.DialogV2({
      window: { title: game.i18n.localize("CLUEBOOK.AppActions.ExportTitle") },
      content: content,
      buttons: [
        {
          action: "download",
          label: game.i18n.localize("CLUEBOOK.AppActions.DownloadFile"),
          icon: "fas fa-download",
          callback: () => {
            saveDataToFile(jsonStr, "application/json", `cluebook_${workspaceName.replace(/\s+/g, '_')}.json`);
            ui.notifications.info(game.i18n.localize("CLUEBOOK.AppActions.BoardExported"));
          }
        },
        {
          action: "clipboard",
          label: game.i18n.localize("CLUEBOOK.AppActions.CopyToClipboard"),
          icon: "fas fa-clipboard",
          callback: () => {
            game.clipboard.copyPlainText(jsonStr);
            ui.notifications.info(game.i18n.localize("CLUEBOOK.AppActions.CopiedToClipboard"));
          }
        }
      ]
    }).render(true);
  }

  static async _onEditWorkspace(event, target) {
    const isPersonal = this.state.activeWorkspace === "personal" || this.state.activeWorkspace.startsWith("personal_");
    
    let currentName;
    if (this.state.activeWorkspace === "personal") {
      currentName = game.user.getFlag("ClueBook", "personalWorkspaceName") || game.i18n.localize("CLUEBOOK.Workspace.Personal");
    } else if (this.state.activeWorkspace.startsWith("personal_")) {
      const u = game.users.get(this.state.activeWorkspace.split("_")[1]);
      currentName = u ? (u.getFlag("ClueBook", "personalWorkspaceName") || game.i18n.format("CLUEBOOK.Workspace.PersonalUser", { user: u.name })) : game.i18n.localize("CLUEBOOK.Workspace.Personal");
    } else {
      currentName = game.journal.get(this.state.activeWorkspace)?.name || "shared_board";
    }

    if (isPersonal) {
      if (this.state.activeWorkspace.startsWith("personal_")) {
        ui.notifications.warn(game.i18n.localize("CLUEBOOK.AppActions.CannotRenameOthers"));
        return;
      }
      const newName = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("CLUEBOOK.AppActions.RenameClueBookTitle") },
        content: `${game.i18n.localize("CLUEBOOK.AppActions.RenameClueBookPrompt")}<input type="text" name="wsName" value="${currentName}" autofocus>`,
        ok: { callback: (event, button) => button.form.elements.wsName.value },
        rejectClose: false
      });
      if (newName && newName.trim() !== "" && newName !== currentName) {
        await game.user.setFlag("ClueBook", "personalWorkspaceName", newName.trim());
        this.render({ parts: ["content"] });
      }
      return;
    }

    const journal = game.journal.get(this.state.activeWorkspace);
    if (!journal) return;

    // Check ownership
    const isOwner = journal.isOwner;
    if (!isOwner) {
      ui.notifications.warn(game.i18n.localize("CLUEBOOK.AppActions.OnlyOwnerCanEditSettings"));
      return;
    }

    const currentOwnership = journal.ownership || {};
    let userCheckboxes = '';
    
    game.users.forEach(u => {
      if (u.id === game.user.id || u.isGM) return; // Self and GM always have access
      const hasAccess = currentOwnership[u.id] === 3;
      userCheckboxes += `<label style="display:block; margin-bottom: 5px;"><input type="checkbox" name="user_${u.id}" ${hasAccess ? 'checked' : ''}> ${u.name}</label>`;
    });

    const content = `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize("CLUEBOOK.AppActions.BoardName")}</label>
          <input type="text" name="workspaceName" value="${currentName}" required autofocus>
        </div>
        <hr>
        <div class="form-group">
          <label>${game.i18n.localize("CLUEBOOK.AppActions.WhoHasAccess")}</label>
          <div style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.1); padding: 5px; border-radius: 5px; margin-top: 5px;">
            ${userCheckboxes || game.i18n.localize("CLUEBOOK.AppActions.NoOtherPlayers")}
          </div>
        </div>
        <hr>
        <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
          <input type="checkbox" name="readOnly" id="cb-edit-ws-readonly" ${journal.getFlag("ClueBook", "settings")?.readOnly ? 'checked' : ''}>
          <label for="cb-edit-ws-readonly" style="margin: 0; cursor: pointer;">${game.i18n.localize("CLUEBOOK.AppActions.ReadOnlyForPlayers")}</label>
        </div>
      </form>
    `;

    const dialog = new Dialog({
      title: game.i18n.localize("CLUEBOOK.AppActions.BoardSettings"),
      content: content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: game.i18n.localize("CLUEBOOK.AppActions.Save"),
          callback: async (html) => {
            const newName = html.find('[name="workspaceName"]').val();
            if (!newName) return;

            // Gather permissions
            const ownership = { default: currentOwnership.default || 0 };
            ownership[game.user.id] = 3; // OWNER
            game.users.filter(u => u.isGM).forEach(gm => ownership[gm.id] = 3);

            html.find('input[type="checkbox"]').each(function() {
              if (this.name === "readOnly") return;
              const userId = this.name.split('_')[1];
              if (userId) {
                if (this.checked) ownership[userId] = 3; // Give OWNER access
                else ownership[userId] = 0; // Revoke access
              }
            });

            const isReadOnly = html.find('[name="readOnly"]').is(':checked');
            await journal.update({ "flags.ClueBook.settings.readOnly": isReadOnly });

            ClueBookSocket.updateBoard(journal.id, newName.trim(), ownership);
            this.render({ parts: ["content"] });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("CLUEBOOK.AppActions.Cancel")
        }
      },
      default: "save"
    });
    dialog.render(true);
  }

  static async _onDeleteWorkspace(event, target) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("CLUEBOOK.AppActions.OnlyGMCanDeleteBoards"));
      return;
    }
    if (this.state.activeWorkspace === "personal" || this.state.activeWorkspace.startsWith("personal_")) {
      ui.notifications.warn(game.i18n.localize("CLUEBOOK.AppActions.CannotDeletePersonal"));
      return;
    }

    const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
    if (!journal) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("CLUEBOOK.AppActions.DeleteBoardTitle") },
      content: game.i18n.format("CLUEBOOK.AppActions.DeleteBoardPrompt", { name: journal.name }),
      rejectClose: false
    });
    if (!confirmed) return;

    await journal.delete();
    this.state.activeWorkspace = "personal";
    await game.user.setFlag("ClueBook", "lastWorkspace", "personal");
    this.render({ parts: ["content"] });
  }

  static async _onJumpToBoard(event, target) {
    const entry = target.closest('.cluebook-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;
    
    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) data = journal.getFlag("ClueBook", "data") || {};
    } else {
      data = game.user.getFlag("ClueBook", "data") || {};
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
    game.user.update({ "flags.ClueBook.boardCamera": this.state.camera });
    
    this.render({ parts: ["content"] });
    
    const settings = this.getSettings();
    const durationMs = (settings.theme.highlightDuration || 2) * 1000;
    setTimeout(() => {
       if (this.state.highlightedEntryId === entryId) {
          this.state.highlightedEntryId = null;
          const el = this.element.querySelector(`.cluebook-entry[data-entry-id="${entryId}"]`);
          if (el) el.classList.remove('is-highlighted');
       }
    }, durationMs);
  }

  static async _onJumpToLinked(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    if (!targetId) return;

    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) data = journal.getFlag("ClueBook", "data") || {};
    } else {
      data = game.user.getFlag("ClueBook", "data") || {};
    }

    let targetEntry = null;
    let targetTab = null;

    for (const [tabKey, tabData] of Object.entries(data)) {
      if (tabKey === "links" || tabKey === "search" || tabKey === "board") continue;
      if (tabData?.[targetId]) {
        targetEntry = tabData[targetId];
        targetTab = tabKey;
        break;
      }
    }

    if (!targetEntry) return;

    // Smart Jump Logic
    if (targetEntry.onBoard) {
      const bx = targetEntry.boardX || 0;
      const by = targetEntry.boardY || 0;
      const zoom = 0.7; 
      const W = this.position.width;
      const H = this.position.height - 50; 
      const panX = W / 2 - ((bx + 100) * zoom);
      const panY = H / 2 - ((by + 50) * zoom);
      
      this.state.camera = { zoom, panX, panY };
      this.state.activeTab = "board";
      game.user.update({ "flags.ClueBook.boardCamera": this.state.camera });
    } else {
      this.state.activeTab = targetTab;
    }
    
    await game.user.setFlag("ClueBook", "lastTab", this.state.activeTab);
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
  }

  static async _onCreateSuggestedLink(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    const entry = target.closest('.cluebook-entry');
    const sourceId = entry.dataset.entryId;
    if (!targetId || !sourceId) return;

    let links = this._getWorkspaceLinks();
    const [a, b] = [sourceId, targetId].sort();
    const key = `${a}_${b}`;
    
    if (!links[key]) {
      const newLink = { source: sourceId, target: targetId, label: "", style: "solid", color: "" };
      await this._updateWorkspaceData({ [`flags.ClueBook.data.links.${key}`]: newLink });
      ui.notifications.info(game.i18n.localize("CLUEBOOK.AppActions.LinkCreated"));
      this.render({ parts: ["content"] });
    }
  }

  static async _onDeleteLink(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    const entry = target.closest('.cluebook-entry');
    const sourceId = entry.dataset.entryId;
    if (!targetId || !sourceId) return;

    let links = this._getWorkspaceLinks();
    const [a, b] = [sourceId, targetId].sort();
    const key = `${a}_${b}`;

    if (links[key]) {
      await this._updateWorkspaceData({ [`flags.ClueBook.data.links.-=${key}`]: null });
      ui.notifications.info(game.i18n.localize("CLUEBOOK.AppActions.LinkDeleted"));
      this.render({ parts: ["content"] });
    }
  }

  static async _onDismissSuggestedLink(event, target) {
    event.stopPropagation();
    const targetId = target.dataset.targetId;
    const entry = target.closest('.cluebook-entry');
    const sourceId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab;
    if (!targetId || !sourceId || !sourceTab) return;

    let data = {};
    if (this.state.activeWorkspace !== "personal") {
      const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) data = journal.getFlag("ClueBook", "data") || {};
    } else {
      data = game.user.getFlag("ClueBook", "data") || {};
    }

    const entryData = data[sourceTab]?.[sourceId];
    if (entryData) {
      const dismissed = entryData.dismissedLinks || [];
      if (!dismissed.includes(targetId)) {
        dismissed.push(targetId);
        await ClueBookApp._saveDataRaw(sourceTab, sourceId, "dismissedLinks", dismissed);
        this.render({ parts: ["content"] });
      }
    }
  }


  static async _onImportJSON(event, target) {
    const content = `
      <p>${game.i18n.localize("CLUEBOOK.AppActions.ImportAIPrompt")}</p>
      <div style="margin-bottom: 15px;">
        <input type="file" id="cb-import-file" accept=".json" style="width: 100%;">
      </div>
      <p style="text-align: center; margin-bottom: 5px; font-weight: bold;">${game.i18n.localize("CLUEBOOK.AppActions.Or")}</p>
      <textarea id="cb-import-text" style="width: 100%; height: 200px; font-family: monospace;"></textarea>
    `;

    const jsonStr = await new Promise((resolve) => {
      new foundry.applications.api.DialogV2({
        window: { title: game.i18n.localize("CLUEBOOK.AppActions.ImportAITitle"), resizable: true },
        position: { width: 600, height: "auto" },
        content: content,
        buttons: [
          {
            action: "import",
            label: game.i18n.localize("CLUEBOOK.AppActions.ImportBtn"),
            icon: "fas fa-file-import",
            callback: async (event, button, dialog) => {
              const fileInput = document.getElementById("cb-import-file");
              const textInput = document.getElementById("cb-import-text");
              
              if (fileInput && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const text = await file.text();
                resolve(text);
              } else if (textInput && textInput.value.trim() !== "") {
                resolve(textInput.value);
              } else {
                resolve(null);
              }
            }
          },
          {
            action: "cancel",
            label: game.i18n.localize("CLUEBOOK.AppActions.Cancel"),
            icon: "fas fa-times",
            callback: () => resolve(null)
          }
        ],
        close: () => resolve(null)
      }).render(true);
    });

    if (!jsonStr) return;

    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
        ui.notifications.error(game.i18n.localize("CLUEBOOK.AppActions.ImportAIErrorArray"));
        return;
      }

      const updateData = {};
      const idMap = {};
      
      let data = {};
      if (this.state.activeWorkspace !== "personal") {
        const journal = game.journal.get(this.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
        if (journal) data = journal.getFlag("ClueBook", "data") || {};
      } else {
        data = game.user.getFlag("ClueBook", "data") || {};
      }

      let gridX = 100;
      let gridY = 100;
      const xSpacing = 350;
      const ySpacing = 250;
      const maxColumns = 4;
      let currentIdx = 0;

      // Process entries
      for (const entry of parsed.entries) {
        const tempId = entry.id;
        const action = entry.action || "create"; // create / update / delete

        let existingTab = null;
        let existingEntry = null;

        if (tempId) {
          for (const tabKey of ["notes", "npc", "quests", "timeline"]) {
            if (data[tabKey]?.[tempId]) {
              existingTab = tabKey;
              existingEntry = data[tabKey][tempId];
              break;
            }
          }
        }

        if (existingEntry) {
          if (action === "delete" || action === "remove") {
            // Delete the card
            updateData[`flags.ClueBook.data.${existingTab}.-=${tempId}`] = null;
            // Also clean up state if selected
            if (this.state.selectedEntryId === tempId) this.state.selectedEntryId = null;
            this.state.selectedEntries.delete(tempId);
          } else {
            // Update the card
            const targetTab = entry.tab || existingTab;
            const updatedEntry = {
              ...existingEntry,
              ...entry
            };
            delete updatedEntry.id;
            delete updatedEntry.tab;
            delete updatedEntry.action;

            if (entry.onBoard !== undefined) {
              updatedEntry.onBoard = entry.onBoard;
            } else if (entry.boardX !== undefined && entry.boardY !== undefined) {
              updatedEntry.onBoard = true;
            }

            if (targetTab !== existingTab) {
              updateData[`flags.ClueBook.data.${existingTab}.-=${tempId}`] = null;
            }
            updateData[`flags.ClueBook.data.${targetTab}.${tempId}`] = updatedEntry;
            idMap[tempId] = tempId; // Map to itself
          }
        } else {
          // If the entry doesn't exist in workspace
          if (action === "delete" || action === "remove") {
            continue; // Skip deleting non-existing entry
          }

          // Create new entry
          const realId = foundry.utils.randomID();
          if (tempId) idMap[tempId] = realId;

          const tab = entry.tab || "notes";
          const newEntry = { ...entry };
          delete newEntry.id;
          delete newEntry.tab;
          delete newEntry.action;

          if (entry.onBoard !== undefined) {
            newEntry.onBoard = entry.onBoard;
          } else if (entry.boardX !== undefined && entry.boardY !== undefined) {
            newEntry.onBoard = true;
          } else {
            newEntry.onBoard = false;
          }

          updateData[`flags.ClueBook.data.${tab}.${realId}`] = newEntry;
        }
      }

      // Process links
      if (parsed.links && Array.isArray(parsed.links)) {
        for (const link of parsed.links) {
          const s = idMap[link.source] || link.source;
          const t = idMap[link.target] || link.target;
          if (s && t) {
            const [a, b] = [s, t].sort();
            const linkId = `${a}_${b}`;
            updateData[`flags.ClueBook.data.links.${linkId}`] = { source: s, target: t, label: link.label || "", style: link.style || "solid", color: link.color || "" };
          }
        }
      } else if (parsed.links && typeof parsed.links === "object") {
        for (const link of Object.values(parsed.links)) {
          const s = idMap[link.source] || link.source;
          const t = idMap[link.target] || link.target;
          if (s && t) {
            const [a, b] = [s, t].sort();
            const linkId = `${a}_${b}`;
            updateData[`flags.ClueBook.data.links.${linkId}`] = { source: s, target: t, label: link.label || "", style: link.style || "solid", color: link.color || "" };
          }
        }
      }

      // Clean up links for deleted entries
      let links = this._getWorkspaceLinks();
      for (const [key, l] of Object.entries(links)) {
        const sourceDeleted = updateData[`flags.ClueBook.data.notes.-=${l.source}`] === null ||
                              updateData[`flags.ClueBook.data.npc.-=${l.source}`] === null ||
                              updateData[`flags.ClueBook.data.quests.-=${l.source}`] === null ||
                              updateData[`flags.ClueBook.data.timeline.-=${l.source}`] === null;
        const targetDeleted = updateData[`flags.ClueBook.data.notes.-=${l.target}`] === null ||
                              updateData[`flags.ClueBook.data.npc.-=${l.target}`] === null ||
                              updateData[`flags.ClueBook.data.quests.-=${l.target}`] === null ||
                              updateData[`flags.ClueBook.data.timeline.-=${l.target}`] === null;
        if (sourceDeleted || targetDeleted) {
          updateData[`flags.ClueBook.data.links.-=${key}`] = null;
        }
      }

      // Second pass: Replace internal links in text fields with new IDs
      for (const [key, entry] of Object.entries(updateData)) {
        if (entry && !key.startsWith('flags.ClueBook.data.links.')) {
          ['text', 'note', 'event', 'gmNotes'].forEach(field => {
            if (entry[field] && typeof entry[field] === 'string') {
              // Regex matches [[qnmention:OLD_ID:Title]] and replaces OLD_ID with realId
              entry[field] = entry[field].replace(/\[\[qnmention:([^:]+):([^\]]+)\]\](?:\{([^}]*)\})?/g, (match, oldId, name, customText) => {
                const newId = idMap[oldId] || oldId; // fallback to oldId if not mapped (e.g. external link)
                const suffix = customText ? `{${customText}}` : '';
                return `[[qnmention:${newId}:${name}]]${suffix}`;
              });
            }
          });
        }
      }

      await this._updateWorkspaceData(updateData);
      ui.notifications.info(game.i18n.format("CLUEBOOK.AppActions.ImportSuccess", { count: parsed.entries.length }));
      this.render({ parts: ["content"] });

    } catch (err) {
      console.error(err);
      ui.notifications.error(game.i18n.localize("CLUEBOOK.AppActions.ImportJSONError"));
    }
  }

  static async _onCopyDataFormat(event, target) {
    let calendarInfo = "";
    if (window.SimpleCalendar?.api) {
      const scApi = window.SimpleCalendar.api;
      const currentTs = game.time.worldTime;
      const dt = scApi.timestampToDate(currentTs);
      const formatted = scApi.formatDateTime(dt);
      calendarInfo = `
В вашем мире АКТИВЕН Simple Calendar! 
Даты должны передаваться как UNIX-таймстемпы (в секундах).
В данный момент игровое время: ${formatted.date} ${formatted.time} (UNIX: ${currentTs}).
Прибавляйте секунды к ${currentTs} (86400 = 1 день), чтобы задать дату в будущем.`;
    } else {
      calendarInfo = `
В вашем мире НЕ АКТИВЕН Simple Calendar.
Даты передаются как обычные строки текста (например, "12:00", "Завтра").`;
    }

    const gmNotesFieldText = game.user.isGM ? '\n- Во всех карточках может присутствовать поле "gmNotes" (скрытые записи Мастера).' : '';
    const textFieldsAllowed = game.user.isGM ? '"text", "note", "event", "gmNotes"' : '"text", "note", "event"';

    const formatText = `Структура данных модуля ClueBook (JSON):

ГЛОБАЛЬНАЯ СТРУКТУРА:
1. Массив "entries" — содержит все карточки.

КАРТОЧКИ ("entries"):
Обязательные поля:
- "id": Уникальный строковый идентификатор. (Используйте простые ID, например "npc1", "clue2").
- "tab": Тип карточки ("notes", "npc", "quests", "timeline").
- "color": Цвет карточки: предустановленный ("yellow", "red", "green", "blue", "purple", "orange", "teal", "pink", "brown") или любой HEX-код цвета (например, "#7b61ff").

Поля в зависимости от типа ("tab"):
- notes (Заметка): "text" (основной текст), "name" (название).
- npc (Персонаж): "name" (имя), "location" (локация), "attitude" (отношение), "lifeStatus" (статус жизни: "alive", "unknown", "dead"), "note" (описание).
- quests (Квест): "text" (описание), "status" (состояние: "active", "completed", "failed"), "timeMode" (режим времени: "by" - сделать до, "at" - строго в), "deadlineTimestamp" (число-UNIX, если есть SimpleCalendar) или "deadline" (строка, если нет SC).
- timeline (Событие): "event" (что произошло), "startTimestamp" (число-UNIX), "endTimestamp" (число-UNIX). Если SimpleCalendar нет, используйте текстовое поле "time".${gmNotesFieldText}
${calendarInfo}

УПРАВЛЕНИЕ КАРТОЧКАМИ (ДОБАВЛЕНИЕ, ОБНОВЛЕНИЕ, УДАЛЕНИЕ):
В любой карточке можно передать необязательное поле "action" ("create", "update", "delete").
- "action": "create" (или поле не указано) — если карточка с таким "id" уже существует, она обновляется; если нет — создается новая.
- "action": "update" (или "edit") — обновляет поля существующей карточки по ее "id". Если карточки с таким "id" нет, ничего не происходит.
- "action": "delete" (или "remove") — удаляет существующую карточку по ее "id" из базы данных вместе со всеми ее связями.

Пример минимального JSON:
{
  "entries": [
    {
      "id": "npc1",
      "action": "create",
      "tab": "npc",
      "color": "green",
      "name": "Мэр Гудвин",
      "location": "Ратуша",
      "attitude": "Дружелюбный",
      "lifeStatus": "alive",
      "note": "Пожилой мэр города."
    },
    {
      "id": "note1",
      "action": "update",
      "tab": "notes",
      "color": "#7b61ff",
      "text": "Обновленный текст встречи с мэром Гудвином."
    },
    {
      "id": "old_clue_id",
      "action": "delete",
      "tab": "notes"
    }
  ]
}

ВНИМАНИЕ ДЛЯ ИИ (CRITICAL INSTRUCTION):
В этом формате КАТЕГОРИЧЕСКИ ЗАПРЕЩАЕТСЯ генерировать ключ "links", а также поля "boardX" и "boardY".
Также КАТЕГОРИЧЕСКИ ЗАПРЕЩАЕТСЯ генерировать любые внутренние связи, упоминания или ссылки между карточками (не используйте конструкции [[qnmention:...]] или @UUID).
В твоем ответе должен быть ТОЛЬКО массив "entries" и ничего больше! Строго соблюдай эту структуру.`;
    try {
      await navigator.clipboard.writeText(formatText);
      ui.notifications.info("Формат данных (Структура JSON) скопирован в буфер обмена!");
    } catch (err) {
      console.error(err);
      ui.notifications.error("Не удалось скопировать в буфер обмена. Возможно, нет прав доступа.");
    }
  }

  static async _onSelectColor(event, target) {
    if (this.state.isReadOnly) return;
    const entry = target.closest('.cluebook-entry');
    const color = target.dataset.color;
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;

    // Update DOM immediately for responsiveness
    entry.dataset.color = color;

    // Save to flags
    await this._saveDataRaw(sourceTab, entryId, "color", color);
  }

  static async _onSendToBoard(event, target) {
    const entry = target.closest('.cluebook-entry');
    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab || this.state.activeTab;
    
    const isOnBoard = entry.dataset.onBoard === "true";
    if (isOnBoard && entry.dataset.pinned === "true") {
      ui.notifications.warn("Нельзя убрать с доски закрепленную карточку!");
      return;
    }
    const newValue = !isOnBoard;

    await this._saveDataRaw(sourceTab, entryId, "onBoard", newValue);
    this.render({ parts: ["content"] });
  }

  static async _onRemoveFromBoard(event, target) {
    const entry = target.closest('.cluebook-entry');
    if (entry && entry.dataset.pinned === "true") {
      ui.notifications.warn("Нельзя убрать с доски закрепленную карточку!");
      return;
    }
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Убрать с доски" },
      content: "<p>Убрать эту запись с доски? (Она останется в своей вкладке)</p>",
      rejectClose: false
    });

    if (!proceed) return;

    const entryId = entry.dataset.entryId;
    const sourceTab = entry.dataset.sourceTab;

    await this._saveDataRaw(sourceTab, entryId, "onBoard", false);
    
    // Delete associated links
    let links = this._getWorkspaceLinks();
    const updates = {};
    let linkDeleted = false;
    for (const [key, l] of Object.entries(links)) {
      if (l.source === entryId || l.target === entryId) {
        updates[`flags.ClueBook.data.links.-=${key}`] = null;
        linkDeleted = true;
      }
    }
    
    if (linkDeleted) {
      await this._updateWorkspaceData(updates);
    }
    this.render({ parts: ["content"] });
  }

  static async _onAddEntry(event, target) {
    const id = foundry.utils.randomID();
    const activeTab = this.state.activeTab;
    const newEntry = this._getEmptyEntryForTab(activeTab);
    
    // Assign highest sort order
    let maxSort = 0;
    const document = this._getWorkspaceJournal() || game.user;
    const currentData = document.getFlag("ClueBook", "data")?.[activeTab] || {};
    Object.values(currentData).forEach(e => {
      if (e && e.sort !== undefined && e.sort > maxSort) maxSort = e.sort;
    });
    newEntry.sort = maxSort + 1;
    newEntry.id = id;
    
    const flagPath = `flags.ClueBook.data.${activeTab}.${id}`;
    const updateData = { [flagPath]: newEntry };

    await this._updateWorkspaceData(updateData);
    
    // Auto-refresh the main app
    this.render({ parts: ["content"] });

    // Open Edit Dialog automatically for the new entry
    const sourceTab = activeTab;
    const data = (this._getWorkspaceJournal() || game.user).getFlag("ClueBook", "data")?.[sourceTab]?.[id] || newEntry;
    
    new ClueBookEditDialog({
      entry: data,
      sourceTab: sourceTab,
      entryId: id,
      onSave: async (updateData) => {
        const flagUpdates = {};
        for (const [key, value] of Object.entries(updateData)) {
          flagUpdates[`flags.ClueBook.data.${sourceTab}.${id}.${key}`] = value;
        }
        await this._updateWorkspaceData(flagUpdates);
        this.render({ parts: ["content"] });
      }
    }).render(true);
  }

  static async _onDeleteEntry(event, target) {
    if (event) event.stopPropagation();
    const entryEl = target.closest('.cluebook-entry');
    if (entryEl && entryEl.dataset.pinned === "true") {
      ui.notifications.warn("Нельзя удалить закрепленную карточку!");
      return;
    }
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удаление записи" },
      content: "<p>Вы уверены, что хотите удалить эту запись?</p>",
      rejectClose: false
    });

    if (!proceed) return;

    const entryId = entryEl.dataset.entryId;
    const sourceTab = entryEl.dataset.sourceTab || this.state.activeTab;
    
    // Also delete any associated links
    let links = this._getWorkspaceLinks();
    const updates = {};
    for (const [key, l] of Object.entries(links)) {
      if (l.source === entryId || l.target === entryId) {
        updates[`flags.ClueBook.data.links.-=${key}`] = null;
      }
    }
    if (Object.keys(updates).length > 0) {
      await this._updateWorkspaceData(updates);
    }

    await this._updateWorkspaceData({
      [`flags.ClueBook.data.${sourceTab}.-=${entryId}`]: null
    });
    
    this.render({ parts: ["content"] });
  }

  async _onDeleteGroup() {
    const ids = Array.from(this.state.selectedEntries);
    if (ids.length === 0) return;

    // Filter out pinned entries
    const nonPinnedIds = ids.filter(id => {
      const el = this.element.querySelector(`[data-entry-id="${id}"]`);
      return !el || el.dataset.pinned !== "true";
    });

    if (nonPinnedIds.length === 0) {
      ui.notifications.warn("Все выбранные карточки закреплены и не могут быть удалены!");
      return;
    }

    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удаление группы" },
      content: `<p>Вы уверены, что хотите удалить <b>${nonPinnedIds.length}</b> выделенных записей?</p>`,
      rejectClose: false
    });

    if (!proceed) return;

    const updates = {};
    let links = this._getWorkspaceLinks();

    nonPinnedIds.forEach(id => {
      const entryEl = this.element.querySelector(`[data-entry-id="${id}"]`);
      if (entryEl) {
        const sourceTab = entryEl.dataset.sourceTab;
        if (sourceTab) updates[`flags.ClueBook.data.${sourceTab}.-=${id}`] = null;
      }
      
      // Delete associated links
      for (const [key, l] of Object.entries(links)) {
        if (l.source === id || l.target === id) {
          updates[`flags.ClueBook.data.links.-=${key}`] = null;
        }
      }
    });

    if (Object.keys(updates).length > 0) {
      if (this.state.activeWorkspace !== 'personal') {
        const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('ClueBook_Shared_DB');
        if (j) await j.update(updates);
      } else {
        await game.user.update(updates);
      }
    }
    
    this.state.selectedEntries.clear();
    this.state.selectedEntryId = null;
    this.render({ parts: ["content"] });
  }
  async _createNewWorkspace() {
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
        <hr>
        <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 10px;">
          <input type="checkbox" name="readOnly" id="cb-ws-readonly">
          <label for="cb-ws-readonly" style="margin: 0; cursor: pointer;">Режим "Только чтение" для игроков</label>
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

            let folder = game.folders.find(f => f.name === "ClueBook Boards" && f.type === "JournalEntry");
            if (!folder && game.user.isGM) {
              folder = await Folder.create({ name: "ClueBook Boards", type: "JournalEntry" });
            }

            if (game.user.isGM) {
              const isReadOnly = html.find('[name="readOnly"]').is(':checked');
              // Create Journal
              const journal = await JournalEntry.create({
                name: name,
                folder: folder ? folder.id : null,
                ownership: ownership,
                flags: {
                  ClueBook: {
                    isWorkspace: true,
                    data: {}, // Empty initial data
                    settings: { readOnly: isReadOnly }
                  }
                }
              });

              if (journal) {
                this.state.activeWorkspace = journal.id;
                this.render();
              }
            } else {
              console.log("ClueBook | Player emitting createBoard socket event:", {
                action: "createBoard",
                userId: game.user.id,
                name: name,
                ownership: ownership
              });
              game.socket.emit("module.ClueBook", {
                action: "createBoard",
                userId: game.user.id,
                name: name,
                ownership: ownership
              });
              ui.notifications.info("Запрос на создание доски отправлен Мастеру...");
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

  static async showQuickAddDialog(type, activeWorkspace = null) {
    if (!activeWorkspace) {
      const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "ClueBookApp");
      activeWorkspace = app ? app.state.activeWorkspace : (game.user?.getFlag("ClueBook", "lastWorkspace") || "personal");
    }
    let content = '';
    let title = '';

    if (type === "notes") {
      title = "Добавить заметку";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="name" class="cluebook-input" placeholder="Название (необязательно)" style="width: 100%;" autofocus onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const next = this.closest('.window-content').querySelector('textarea'); if (next) next.focus(); }">
          <textarea name="text" class="cluebook-input" placeholder="Текст заметки..." style="width: 100%; min-height: 80px;" onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    } else if (type === "npc") {
      title = "Добавить персонажа";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <input type="text" name="name" class="cluebook-input" placeholder="Имя" style="width: 100%;" autofocus onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('input[name=location]').focus(); }">
          <input type="text" name="location" class="cluebook-input" placeholder="Локация" style="width: 100%;" onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('input[name=attitude]').focus(); }">
          <input type="text" name="attitude" class="cluebook-input" placeholder="Отношение" style="width: 100%;" onkeydown="if(event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('textarea[name=note]').focus(); }">
          <textarea name="note" class="cluebook-input" placeholder="Описание..." style="width: 100%; min-height: 60px;" onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    } else if (type === "quests") {
      title = "Добавить квест";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <select name="status" class="cluebook-input" style="width: 100%;">
            <option value="active">Активно</option>
            <option value="completed">Выполнено</option>
            <option value="failed">Провалено</option>
          </select>
          <textarea name="text" class="cluebook-input" placeholder="Описание квеста..." style="width: 100%; min-height: 80px;" autofocus onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    } else if (type === "timeline") {
      title = "Добавить событие";
      content = `
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;">
          <textarea name="event" class="cluebook-input" placeholder="Описание события..." style="width: 100%; min-height: 80px;" autofocus onkeydown="if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); this.closest('.window-content').querySelector('button[data-action=ok]').click(); }"></textarea>
        </div>
      `;
    }

    content += `
      <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 10px;">
        <label style="font-size: 12px; color: var(--cb-text-muted);">Цвет карточки:</label>
        <select name="color" class="cluebook-input" style="width: 100%;">
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
    const settings = game.user.getFlag("ClueBook", "settings") || {};
    const defaultColor = settings.defaultColors?.[type] || "yellow";

    let maxSort = 0;
    let document = game.user;
    if (activeWorkspace !== "personal") {
      document = game.journal.get(activeWorkspace) || game.journal.getName("ClueBook_Shared_DB") || game.user;
    }
    const currentData = document.getFlag("ClueBook", "data")?.[type] || {};
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

    const flagPath = `flags.ClueBook.data.${type}.${entryId}`;
    
    if (activeWorkspace !== "personal") {
      const journal = game.journal.get(activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) {
        if (journal.isOwner) {
          await journal.update({ [flagPath]: entryData });
        } else {
          game.socket.emit("module.ClueBook", {
            action: "updateBoardData",
            journalId: journal.id,
            updateData: { [flagPath]: entryData }
          });
        }
      } else {
        await game.user.update({ [flagPath]: entryData });
      }
    } else {
      await game.user.update({ [flagPath]: entryData });
    }

    ui.notifications.info(`Запись добавлена в "${title}".`);
    
    // Auto-refresh the main app if it is open
    const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "ClueBookApp");
    if (app) app.render({ parts: ["content"] });
  }

  static async _onPickDate(event, target) {
    event.preventDefault();
    const entry = target.closest('.cluebook-entry');
    const entryId = entry.dataset.entryId;
    const tab = entry.dataset.sourceTab;
    const field = target.dataset.field; // "deadlineTimestamp", "startTimestamp", "endTimestamp"
    const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "ClueBookApp");
    if (!app) return;

    let currentVal = null;
    let dataObj = {};
    if (app.state.activeWorkspace === "personal") {
      dataObj = game.user.getFlag("ClueBook", "data") || {};
    } else {
      const journal = game.journal.get(app.state.activeWorkspace) || game.journal.getName("ClueBook_Shared_DB");
      if (journal) dataObj = journal.getFlag("ClueBook", "data") || {};
    }

    if (dataObj[tab] && dataObj[tab][entryId]) {
      currentVal = dataObj[tab][entryId][field];
    }

    const timestamp = await ClueBookDatePicker.prompt(currentVal, "Выбор даты и времени");
    if (timestamp !== null) {
      const input = entry.querySelector(`input[data-field="${field}"]`);
      if (input) {
        input.value = timestamp;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await app._saveDataRaw(tab, entryId, field, timestamp);

        // Instant UI update
        const scApi = window.SimpleCalendar?.api;
        if (scApi) {
          const dt = scApi.timestampToDate(timestamp);
          const formatted = scApi.formatDateTime(dt).date + " " + scApi.formatDateTime(dt).time;
          
          const pickBtn = entry.querySelector(`button[data-action="pickDate"][data-field="${field}"]`);
          if (pickBtn) {
            let icon = "far fa-calendar-alt";
            let color = "#fff";
            if (field === "startTimestamp") { icon = "fas fa-play"; color = "#4caf50"; }
            if (field === "endTimestamp") { icon = "fas fa-stop"; color = "#ff5252"; }
            pickBtn.innerHTML = `<i class="${icon}" style="color: ${color};"></i> ${formatted}`;
            
            let trashBtn = entry.querySelector(`button[data-action="clearDate"][data-field="${field}"]`);
            if (!trashBtn) {
              trashBtn = document.createElement("button");
              trashBtn.type = "button";
              trashBtn.dataset.action = "clearDate";
              trashBtn.dataset.field = field;
              trashBtn.title = "Удалить дату";
              trashBtn.style.cssText = "flex: 0 0 30px; padding: 2px; background: rgba(255,0,0,0.2); border: 1px solid rgba(255,0,0,0.5); border-radius: 4px; color: #ff5252;";
              if (field === "deadlineTimestamp") trashBtn.style.height = "30px";
              trashBtn.innerHTML = `<i class="fas fa-trash"></i>`;
              pickBtn.parentElement.appendChild(trashBtn);
            } else {
              trashBtn.style.display = "";
            }
          }
        }
      }
    }
  }

  static async _onClearDate(event, target) {
    event.preventDefault();
    const field = target.dataset.field; 
    const entry = target.closest('.cluebook-entry');
    const entryId = entry.dataset.entryId;
    const tab = entry.dataset.sourceTab;
    const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "ClueBookApp");
    
    const input = entry ? entry.querySelector(`input[data-field="${field}"]`) : null;
    if (input && app) {
      input.value = "";
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await app._saveDataRaw(tab, entryId, field, null);

      // Instant UI update
      const pickBtn = entry.querySelector(`button[data-action="pickDate"][data-field="${field}"]`);
      if (pickBtn) {
        let defaultText = "Дата...";
        if (field === "deadlineTimestamp") defaultText = "Дедлайн (необязательно)...";
        if (field === "startTimestamp") defaultText = "Начало (необязательно)...";
        if (field === "endTimestamp") defaultText = "Конец (необязательно)...";
        
        let icon = "far fa-calendar-alt";
        let color = "#fff";
        if (field === "startTimestamp") { icon = "fas fa-play"; color = "#4caf50"; }
        if (field === "endTimestamp") { icon = "fas fa-stop"; color = "#ff5252"; }
        
        pickBtn.innerHTML = `<i class="${icon}" style="color: ${color};"></i> ${defaultText}`;
      }
      
      const trashBtn = entry.querySelector(`button[data-action="clearDate"][data-field="${field}"]`);
      if (trashBtn) trashBtn.style.display = "none";
    }
  }
};
