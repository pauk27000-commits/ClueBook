const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class QuickNotesEditDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.entry = options.entry;
    this.sourceTab = options.sourceTab;
    this.entryId = options.entryId;
    this.onSave = options.onSave;
  }

  static DEFAULT_OPTIONS = {
    id: "quicknotes-edit-dialog",
    classes: ["quicknotes-window", "qn-edit-dialog"],
    position: { width: 500, height: "auto" },
    window: {
      title: "Редактирование записи",
      icon: "fas fa-edit",
      resizable: true
    },
    actions: {
      saveDialog: QuickNotesEditDialog.#onSaveAction
    }
  };

  static PARTS = {
    content: {
      template: "modules/notebook/templates/edit-dialog.hbs",
      classes: ["window-content"]
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.entry = foundry.utils.deepClone(this.entry);
    context.sourceTab = this.sourceTab;
    context.isSimpleCalendarActive = !!window.SimpleCalendar?.api;

    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
    if (context.entry.text) context.enrichedText = await TE.enrichHTML(context.entry.text, { async: true });
    if (context.entry.note) context.enrichedNote = await TE.enrichHTML(context.entry.note, { async: true });
    if (context.entry.event) context.enrichedEvent = await TE.enrichHTML(context.entry.event, { async: true });

    if (context.isSimpleCalendarActive) {
      const scApi = window.SimpleCalendar.api;
      const currentTimestamp = game.time.worldTime;
      const allMonths = scApi.getCurrentCalendar().months || [];

      const buildDateContext = (timestamp, prefix) => {
        const targetTs = (timestamp !== null && timestamp !== undefined && timestamp !== "") ? timestamp : currentTimestamp;
        const scDate = scApi.timestampToDate(targetTs) || scApi.timestampToDate(currentTimestamp);
        
        const monthsData = allMonths.map((m, i) => ({
          index: i,
          name: m.name,
          selected: i === scDate.month
        }));

        return {
          prefix,
          year: scDate.year,
          month: scDate.month,
          day: scDate.day !== undefined ? scDate.day + 1 : 1,
          hour: scDate.hour,
          minute: scDate.minute,
          months: monthsData
        };
      };

      if (this.sourceTab === "quests") {
        const deadlineData = buildDateContext(this.entry.deadlineTimestamp, "deadline");
        context.deadlineDateHTML = await renderTemplate("modules/notebook/templates/date-fields.hbs", deadlineData);
      } else if (this.sourceTab === "timeline") {
        const startData = buildDateContext(this.entry.startTimestamp, "start");
        context.startDateHTML = await renderTemplate("modules/notebook/templates/date-fields.hbs", startData);

        const endData = buildDateContext(this.entry.endTimestamp, "end");
        context.endDateHTML = await renderTemplate("modules/notebook/templates/date-fields.hbs", endData);

        // Calculate duration and endMode
        let endMode = "none";
        let duration = { days: 0, hours: 0, minutes: 0 };
        
        if (this.entry.endTimestamp) {
          endMode = "time"; // Default to time if it exists
          if (this.entry.startTimestamp) {
             const diff = this.entry.endTimestamp - this.entry.startTimestamp;
             if (diff > 0) {
               duration.days = Math.floor(diff / 86400);
               duration.hours = Math.floor((diff % 86400) / 3600);
               duration.minutes = Math.floor((diff % 3600) / 60);
             }
          }
        }
        context.endMode = endMode;
        context.duration = duration;
      }
    }

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    
    const html = this.element;

    html.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        ev.stopPropagation();
        html.querySelector('button[data-action="saveDialog"]')?.click();
      }
    }, { capture: true });

    // Color Swatch Selection Visually
    const swatches = html.querySelectorAll('.color-swatch');
    const updateSwatches = () => {
      swatches.forEach(s => {
        const input = s.querySelector('input');
        if (input && input.checked) {
          s.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px var(--qn-accent)';
          s.style.transform = 'scale(1.15)';
        } else {
          s.style.boxShadow = 'none';
          s.style.transform = 'scale(1)';
        }
      });
    };
    swatches.forEach(s => s.addEventListener('change', updateSwatches));
    updateSwatches();

    // Bind checkbox toggles
    const deadlineCheck = html.querySelector('[name="hasDeadline"]');
    if (deadlineCheck) {
      deadlineCheck.addEventListener('change', (e) => {
        html.querySelector('.deadline-fields').style.display = e.target.checked ? 'block' : 'none';
      });
    }

    const endRadios = html.querySelectorAll('input[name="endMode"]');
    if (endRadios.length) {
      endRadios.forEach(r => {
        r.addEventListener('change', (e) => {
          const mode = e.target.value;
          html.querySelector('.end-time-fields').style.display = mode === 'time' ? 'block' : 'none';
          html.querySelector('.end-duration-fields').style.display = mode === 'duration' ? 'block' : 'none';
        });
      });
    }

    // Custom @ Autocomplete for Textareas
    const textareas = html.querySelectorAll('textarea.quicknotes-input');
    let autocompleteBox = null;
    let autocompleteIndex = 0;
    let currentMatches = [];

    const closeAutocomplete = () => {
      if (autocompleteBox) {
        autocompleteBox.remove();
        autocompleteBox = null;
      }
    };

    const insertSelected = () => {
      if (!currentMatches[autocompleteIndex]) return;
      const target = currentMatches[autocompleteIndex];
      const ta = document.activeElement;
      if (!ta || ta.tagName !== 'TEXTAREA') return;
      
      const val = ta.value;
      const cursor = ta.selectionStart;
      const textBeforeCursor = val.substring(0, cursor);
      const match = textBeforeCursor.match(/@([a-zA-Zа-яА-Я0-9_ -]*)$/);
      
      if (match) {
        const replaceString = `[[qnmention:${target.id}:${target.name}]] `;
        ta.value = val.substring(0, match.index) + replaceString + val.substring(cursor);
        ta.selectionStart = ta.selectionEnd = match.index + replaceString.length;
      }
      closeAutocomplete();
    };

    const renderAutocompleteItems = () => {
      if (!autocompleteBox) return;
      autocompleteBox.innerHTML = '';
      currentMatches.forEach((match, idx) => {
        const item = document.createElement('div');
        item.style.cssText = `padding: 5px 8px; cursor: pointer; border-radius: 4px; font-size: 13px; display: flex; align-items: flex-start; gap: 8px; transition: background 0.1s; background: ${idx === autocompleteIndex ? 'var(--qn-accent)' : 'transparent'};`;
        item.innerHTML = `<i class="fas fa-file-alt" style="opacity:0.5; margin-top: 2px; flex-shrink: 0;"></i> <span style="white-space: normal; line-height: 1.2; word-wrap: break-word;">${match.name}</span>`;
        item.onmousedown = (e) => {
           e.preventDefault(); // prevent blur
           autocompleteIndex = idx;
           insertSelected();
        };
        autocompleteBox.appendChild(item);
      });
      
      const activeEl = autocompleteBox.children[autocompleteIndex];
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    };

    const getCaretCoordinates = (element, position) => {
      const div = document.createElement('div');
      const style = window.getComputedStyle(element);
      for (const prop of style) {
        div.style[prop] = style[prop];
      }
      div.style.position = 'absolute';
      div.style.visibility = 'hidden';
      div.style.whiteSpace = 'pre-wrap';
      div.style.wordWrap = 'break-word';
      div.style.overflow = 'hidden';
      
      div.textContent = element.value.substring(0, position);
      
      const span = document.createElement('span');
      span.textContent = element.value.substring(position) || '.';
      div.appendChild(span);
      
      document.body.appendChild(div);
      const coordinates = {
        top: span.offsetTop - element.scrollTop,
        left: span.offsetLeft - element.scrollLeft,
        height: parseInt(style.lineHeight) || parseInt(style.fontSize) || 20
      };
      document.body.removeChild(div);
      return coordinates;
    };

    const showAutocomplete = (ta, query) => {
      const app = Array.from(foundry.applications.instances.values()).find(w => w.constructor.name === "QuickNotesApp");
      if (!app) return;
      
      let dataObj = {};
      if (app.state.activeWorkspace === "personal") {
        dataObj = game.user.getFlag("notebook", "data") || {};
      } else {
        const journal = game.journal.get(app.state.activeWorkspace) || game.journal.getName("QuickNotes_Shared_DB");
        if (journal) dataObj = journal.getFlag("notebook", "data") || {};
      }
      
      const entries = [];
      for (const [tab, tabData] of Object.entries(dataObj)) {
        if (tab === 'links') continue;
        for (const [id, entry] of Object.entries(tabData)) {
          let name = entry.name;
          if (!name && entry.text) {
             const div = document.createElement('div');
             div.innerHTML = entry.text;
             name = div.textContent.substring(0, 30).trim() || "Без названия";
          }
          if (!name) name = entry.event || "Запись";
          
          if (id !== this.entryId && name.toLowerCase().includes(query)) {
            entries.push({ id, name, tab });
          }
        }
      }
      
      currentMatches = entries.slice(0, 10);
      if (currentMatches.length === 0) {
        closeAutocomplete();
        return;
      }
      
      if (!autocompleteBox) {
        autocompleteBox = document.createElement('div');
        autocompleteBox.style.cssText = "position: fixed; background: rgba(20,20,30,0.95); border: 1px solid var(--qn-accent); border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); z-index: 1000000; width: max-content; min-width: 250px; max-width: 400px; max-height: 200px; overflow-y: auto; padding: 5px; color: white; display: flex; flex-direction: column; gap: 2px;";
        document.body.appendChild(autocompleteBox);
      }
      
      const rect = ta.getBoundingClientRect();
      const caret = getCaretCoordinates(ta, ta.selectionStart);
      
      autocompleteBox.style.top = (rect.top + caret.top + caret.height + 5) + "px";
      autocompleteBox.style.left = (rect.left + caret.left) + "px";
      
      autocompleteIndex = 0;
      renderAutocompleteItems();
    };

    textareas.forEach(ta => {
      ta.addEventListener('input', (ev) => {
        const val = ta.value;
        const cursor = ta.selectionStart;
        const textBeforeCursor = val.substring(0, cursor);
        const match = textBeforeCursor.match(/@([a-zA-Zа-яА-Я0-9_ -]*)$/);
        
        if (match) {
          const query = match[1].toLowerCase();
          showAutocomplete(ta, query);
        } else {
          closeAutocomplete();
        }
      });
      
      ta.addEventListener('keydown', (ev) => {
        if (autocompleteBox) {
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            autocompleteIndex = (autocompleteIndex + 1) % currentMatches.length;
            renderAutocompleteItems();
            return;
          } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            autocompleteIndex = (autocompleteIndex - 1 + currentMatches.length) % currentMatches.length;
            renderAutocompleteItems();
            return;
          } else if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            insertSelected();
            return;
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeAutocomplete();
            return;
          }
        }
      });
      
      ta.addEventListener('blur', () => {
        setTimeout(closeAutocomplete, 150);
      });
    });
  }

  static async #onSaveAction(event, target) {
    // Target is the button. The application form data can be found by querying inputs in this.element
    const html = this.element;
    const rawData = {};
    
    // Gather all inputs
    html.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.name) {
        if (el.type === 'checkbox') {
          rawData[el.name] = el.checked;
        } else if (el.type === 'radio') {
          if (el.checked) rawData[el.name] = el.value;
        } else {
          rawData[el.name] = el.value;
        }
      }
    });

    const data = foundry.utils.expandObject(rawData);
    
    const instance = this;
    const updateData = {};
    if (data.color) updateData.color = data.color;

    const scApi = window.SimpleCalendar?.api;

    if (instance.sourceTab === "notes") {
      updateData.name = data.name;
      updateData.text = data.text;
    } else if (instance.sourceTab === "npc") {
      updateData.name = data.name;
      updateData.location = data.location;
      updateData.attitude = data.attitude;
      updateData.note = data.note;
      updateData.isDead = data.isDead === "true";
    } else if (instance.sourceTab === "quests") {
      updateData.status = data.status;
      updateData.text = data.text;
      updateData.timeMode = data.timeMode || "by";
      
      if (scApi) {
        if (data.hasDeadline) {
          updateData.deadlineTimestamp = scApi.dateToTimestamp({
            year: Number(data.deadline_year) || 0,
            month: Number(data.deadline_month) || 0,
            day: Math.max(0, (Number(data.deadline_day) || 1) - 1),
            hour: Number(data.deadline_hour) || 0,
            minute: Number(data.deadline_minute) || 0
          });
        } else {
          updateData.deadlineTimestamp = null;
        }
      } else {
        updateData.deadline = data.deadline;
      }
    } else if (instance.sourceTab === "timeline") {
      updateData.event = data.event;
      
      if (scApi) {
        updateData.startTimestamp = scApi.dateToTimestamp({
          year: Number(data.start_year) || 0,
          month: Number(data.start_month) || 0,
          day: Math.max(0, (Number(data.start_day) || 1) - 1),
          hour: Number(data.start_hour) || 0,
          minute: Number(data.start_minute) || 0
        });

        if (data.endMode === "time") {
          updateData.endTimestamp = scApi.dateToTimestamp({
            year: Number(data.end_year) || 0,
            month: Number(data.end_month) || 0,
            day: Math.max(0, (Number(data.end_day) || 1) - 1),
            hour: Number(data.end_hour) || 0,
            minute: Number(data.end_minute) || 0
          });
        } else if (data.endMode === "duration") {
          const durationSec = (Number(data.duration_days) || 0) * 86400 +
                              (Number(data.duration_hours) || 0) * 3600 +
                              (Number(data.duration_minutes) || 0) * 60;
          updateData.endTimestamp = updateData.startTimestamp + durationSec;
        } else {
          updateData.endTimestamp = null;
        }
      } else {
        updateData.time = data.time;
      }
    }

    if (instance.onSave) {
      await instance.onSave(updateData);
    }
    
    // Visual feedback
    const originalText = target.innerHTML;
    target.innerHTML = `<i class="fas fa-check"></i> Сохранено!`;
    target.style.background = "#4caf50";
    setTimeout(() => {
      target.innerHTML = originalText;
      target.style.background = "var(--qn-accent)";
    }, 1500);
  }
}
