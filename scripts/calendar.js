const WEATHER_PRESETS = {
  "clear": { name: "Ясно", icon: "fa-sun" },
  "cloudy": { name: "Облачно", icon: "fa-cloud" },
  "rain": { name: "Дождь", icon: "fa-cloud-rain" },
  "storm": { name: "Гроза", icon: "fa-bolt" },
  "fog": { name: "Туман", icon: "fa-smog" },
  "snow": { name: "Снег", icon: "fa-snowflake" }
};

const SEASON_PRESETS = {
  "spring": { name: "Весна", icon: "fa-seedling", color: "#6aa84f" },
  "summer": { name: "Лето", icon: "fa-sun", color: "#f1c232" },
  "autumn": { name: "Осень", icon: "fa-leaf", color: "#d87c2b" },
  "winter": { name: "Зима", icon: "fa-snowflake", color: "#9fc5e8" }
};

export class CalendarWidget extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "qn-calendar-widget",
      template: "modules/notebook/templates/calendar-widget.hbs",
      popOut: false, // Prevents default Foundry window frame
    });
  }

  getData(options) {
    const data = game.settings.get("notebook", "calendarData") || {};
    
    // Default values if empty
    const date = data.date || "21 Октябрь, 1931";
    const time = data.time || "18:30";
    const temperature = data.temperature !== undefined ? data.temperature : 13;
    
    const weatherId = data.weatherId || "fog";
    const weather = WEATHER_PRESETS[weatherId] || WEATHER_PRESETS["clear"];
    
    const seasonId = data.seasonId || "autumn";
    const season = SEASON_PRESETS[seasonId] || SEASON_PRESETS["autumn"];

    const pos = game.user.getFlag("notebook", "calendarWidgetPos") || { left: window.innerWidth / 2 - 150, top: 20 };

    return {
      isGM: game.user.isGM,
      left: pos.left,
      top: pos.top,
      date,
      time,
      temperature,
      weatherName: weather.name,
      weatherIcon: weather.icon,
      seasonName: season.name,
      seasonIcon: season.icon,
      seasonColor: season.color
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const widget = html[0];
    
    // Dragging Logic
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startLeft = 0;
    let startTop = 0;
    let hasMoved = false;

    widget.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest('[data-action="edit"]')) return; // Don't drag if clicking edit button
      
      isDragging = true;
      hasMoved = false;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      const rect = widget.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      widget.setPointerCapture(ev.pointerId);
    });

    widget.addEventListener('pointermove', (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - dragStartX;
      const dy = ev.clientY - dragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;
        widget.classList.add("is-dragging");
      }
      if (hasMoved) {
        widget.style.left = `${startLeft + dx}px`;
        widget.style.top = `${startTop + dy}px`;
      }
    });

    widget.addEventListener('pointerup', (ev) => {
      if (!isDragging) return;
      isDragging = false;
      widget.releasePointerCapture(ev.pointerId);
      if (hasMoved) {
        setTimeout(() => widget.classList.remove("is-dragging"), 100);
        game.user.setFlag("notebook", "calendarWidgetPos", {
          left: parseInt(widget.style.left),
          top: parseInt(widget.style.top)
        });
      }
    });

    // Edit Dialog (GM only)
    if (game.user.isGM) {
      html.find('[data-action="edit"]').click((ev) => {
        if (hasMoved) return; // Prevent opening if it was a drag
        this.openEditDialog();
      });
    }
  }

  async openEditDialog() {
    const data = game.settings.get("notebook", "calendarData") || {};
    
    const weatherPresetsArr = Object.entries(WEATHER_PRESETS).map(([id, p]) => ({ id, name: p.name }));
    const seasonPresetsArr = Object.entries(SEASON_PRESETS).map(([id, p]) => ({ id, name: p.name }));

    const templateData = {
      date: data.date || "21 Октябрь, 1931",
      time: data.time || "18:30",
      temperature: data.temperature !== undefined ? data.temperature : 13,
      currentWeatherId: data.weatherId || "fog",
      currentSeasonId: data.seasonId || "autumn",
      weatherPresets: weatherPresetsArr,
      seasonPresets: seasonPresetsArr
    };

    const content = await renderTemplate("modules/notebook/templates/calendar-edit.hbs", templateData);

    new Dialog({
      title: "Настройки календаря и погоды",
      content: content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: "Сохранить",
          callback: async (html) => {
            const form = html.find('.qn-calendar-edit-form')[0];
            const newData = {
              date: form.date.value,
              time: form.time.value,
              temperature: parseInt(form.temperature.value) || 0,
              weatherId: form.weatherPreset.value,
              seasonId: form.seasonPreset.value
            };
            await game.settings.set("notebook", "calendarData", newData);
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
}
