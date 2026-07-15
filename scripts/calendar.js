const WEATHER_PRESETS = {
  "clear":  { name: "Ясно",    icon: "fa-sun" },
  "cloudy": { name: "Облачно", icon: "fa-cloud" },
  "rain":   { name: "Дождь",   icon: "fa-cloud-rain" },
  "storm":  { name: "Гроза",   icon: "fa-bolt" },
  "fog":    { name: "Туман",   icon: "fa-smog" },
  "snow":   { name: "Снег",    icon: "fa-snowflake" }
};

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CalendarWidget extends HandlebarsApplicationMixin(ApplicationV2) {
  // In-memory weather/temperature so changes are instant without waiting for Foundry settings sync
  static #weather = null;

  static DEFAULT_OPTIONS = {
    id: "qn-calendar-widget",
    classes: ["qn-calendar-widget"],
    tag: "div",
    window: {
      frame: false,
      positioned: true
    },
    position: {
      width: "auto",
      height: "auto"
    },
    actions: {
      edit: CalendarWidget.#onEdit,
      adjustTime: CalendarWidget.#onAdjustTime,
      openSimpleCalendar: CalendarWidget.#onOpenSimpleCalendar
    }
  };

  static PARTS = {
    widget: {
      template: "modules/notebook/templates/calendar-widget.hbs"
    }
  };

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Read current date+time from Simple Calendar if present, returns { date, time } */
  static #getScDateTime() {
    try {
      const api = window.SimpleCalendar?.api;
      if (!api) return null;

      // timestampToDate returns an object with numeric fields
      const d = api.timestampToDate(game.time.worldTime);
      if (!d) return null;

      // Build HH:MM time string from numeric fields
      const h  = String(d.hour   ?? 0).padStart(2, "0");
      const m  = String(d.minute ?? 0).padStart(2, "0");
      const timeStr = `${h}:${m}`;

      // Build date string. Prefer display.date if it exists.
      const dateStr = d.display?.date
        ?? `${d.day} ${d.monthName ?? d.month}, ${d.year}`;

      const weekdayStr = d.weekday || d.display?.weekday || "";

      return { date: dateStr, time: timeStr, weekday: weekdayStr };
    } catch (err) {
      console.error("QuickNotes | SimpleCalendar read error:", err);
      return null;
    }
  }

  /** Return the in-memory weather state, lazily loaded from settings on first call */
  static #getWeather() {
    if (!CalendarWidget.#weather) {
      const saved = game.settings.get("notebook", "calendarData") || {};
      CalendarWidget.#weather = {
        weatherId:   saved.weatherId   ?? "fog",
        temperature: saved.temperature ?? 13
      };
    }
    return CalendarWidget.#weather;
  }

  // ─── ApplicationV2 lifecycle ─────────────────────────────────────────────────

  async _prepareContext(options) {
    const scActive  = !!(window.SimpleCalendar?.api);
    const scData    = scActive ? CalendarWidget.#getScDateTime() : null;
    const saved     = game.settings.get("notebook", "calendarData") || {};

    const date = scData?.date ?? saved.date ?? "21 Октябрь, 1931";
    const time = scData?.time ?? saved.time ?? "18:30";
    const weekday = scData?.weekday ?? saved.weekday ?? "Среда";

    // Weather always comes from in-memory store
    const wx = CalendarWidget.#getWeather();
    const preset = WEATHER_PRESETS[wx.weatherId] ?? WEATHER_PRESETS["fog"];

    const pos = game.user.getFlag("notebook", "calendarWidgetPos")
      ?? { left: Math.round(window.innerWidth / 2 - 150), top: 20 };

    this.position.left = pos.left;
    this.position.top  = pos.top;

    return {
      isGM:                  game.user.isGM,
      isSimpleCalendarActive: scActive,
      date,
      time,
      weekday,
      temperature:  wx.temperature,
      weatherName:  preset.name,
      weatherIcon:  preset.icon
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const widget = this.element;
    if (!widget) return;

    const pos = game.user.getFlag("notebook", "calendarWidgetPos")
      ?? { left: Math.round(window.innerWidth / 2 - 150), top: 20 };
    widget.style.left = `${pos.left}px`;
    widget.style.top  = `${pos.top}px`;

    // ── Drag ──────────────────────────────────────────────────────────────────
    let isDragging = false, hasMoved = false;
    let dragStartX = 0, dragStartY = 0, startLeft = 0, startTop = 0;

    widget.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      // Don't intercept clicks on any interactive action element
      if (ev.target.closest("[data-action]")) return;

      isDragging = true;
      hasMoved   = false;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      const rect = widget.getBoundingClientRect();
      startLeft  = rect.left;
      startTop   = rect.top;
      widget.setPointerCapture(ev.pointerId);
    });

    widget.addEventListener("pointermove", (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
        widget.classList.add("is-dragging");
      }
      if (hasMoved) {
        widget.style.left = `${startLeft + dx}px`;
        widget.style.top  = `${startTop  + dy}px`;
      }
    });

    widget.addEventListener("pointerup", (ev) => {
      if (!isDragging) return;
      isDragging = false;
      widget.releasePointerCapture(ev.pointerId);
      if (hasMoved) {
        setTimeout(() => widget.classList.remove("is-dragging"), 100);
        const newLeft = parseInt(widget.style.left);
        const newTop  = parseInt(widget.style.top);
        this.position.left = newLeft;
        this.position.top  = newTop;
        game.user.setFlag("notebook", "calendarWidgetPos", { left: newLeft, top: newTop });
      }
    });
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  static async #onEdit(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;

    const scActive       = !!(window.SimpleCalendar?.api);
    const wx             = CalendarWidget.#getWeather();
    const saved          = game.settings.get("notebook", "calendarData") || {};
    const weatherOptions = Object.entries(WEATHER_PRESETS)
      .map(([id, p]) => ({ id, name: p.name, selected: id === wx.weatherId }));

    const templateData = {
      isSimpleCalendarActive: scActive,
      temperature:      wx.temperature,
      currentWeatherId: wx.weatherId,
      weatherPresets:   weatherOptions,
      date:             saved.date    ?? "21 Октябрь, 1931",
      time:             saved.time    ?? "18:30",
      weekday:          saved.weekday ?? "Среда"
    };

    const content = await renderTemplate(
      "modules/notebook/templates/calendar-edit.hbs",
      templateData
    );

    new Dialog({
      title: "Настройки погоды",
      content: content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Сохранить",
          callback: async (html) => {
            const tempVal = html.find('[name="temperature"]').val();
            const weatherId = html.find('[name="weatherPreset"]').val();
            const dateVal = html.find('[name="date"]').val();
            const weekdayVal = html.find('[name="weekday"]').val();
            const timeVal = html.find('[name="time"]').val();
            
            const temp = Number(tempVal);
            
            // Update in-memory cache
            CalendarWidget.#weather = {
              weatherId: weatherId,
              temperature: isNaN(temp) ? 13 : temp
            };

            // Persist — onChange in main.js will call render({ force: true })
            const saved = game.settings.get("notebook", "calendarData") || {};
            const updateObj = {
              ...saved,
              weatherId: CalendarWidget.#weather.weatherId,
              temperature: CalendarWidget.#weather.temperature
            };
            
            if (dateVal !== undefined) updateObj.date = dateVal;
            if (weekdayVal !== undefined) updateObj.weekday = weekdayVal;
            if (timeVal !== undefined) updateObj.time = timeVal;
            
            await game.settings.set("notebook", "calendarData", updateObj);

            // Immediate render via the instance (this = app instance in V2 action handlers)
            this.render({ force: true });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Отмена"
        }
      },
      default: "save"
    }).render(true);
  }

  static async #onAdjustTime(event, target) {
    event.preventDefault();
    if (!game.user.isGM) return;

    const minutes = parseInt(target.dataset.amount, 10) || 0;
    if (minutes === 0) return;

    if (window.SimpleCalendar?.api) {
      window.SimpleCalendar.api.changeDate({ minute: minutes });
      // updateWorldTime hook fires automatically; also force render immediately
      this.render({ force: true });
      return;
    }

    // ── Fallback: no Simple Calendar ─────────────────────────────────────────
    const saved = game.settings.get("notebook", "calendarData") || {};
    const match = (saved.time ?? "18:30").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) { ui.notifications.warn("Не удалось прочитать время."); return; }

    let total = parseInt(match[1]) * 60 + parseInt(match[2]) + minutes;
    if (total < 0) total += 24 * 60;
    total = total % (24 * 60);

    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");

    game.settings.set("notebook", "calendarData", { ...saved, time: `${hh}:${mm}` });
  }

  static #onOpenSimpleCalendar(event, _target) {
    event.preventDefault();
    window.SimpleCalendar?.api?.showCalendar();
  }
}
