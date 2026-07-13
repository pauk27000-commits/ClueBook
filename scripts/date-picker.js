export class QuickNotesDatePicker {
  /**
   * Open the custom date picker dialog.
   * @param {number|null} initialTimestamp - The starting timestamp (optional). If null, defaults to current world time.
   * @param {string} title - The title of the dialog.
   * @returns {Promise<number|null>} - Resolves to the selected timestamp, or null if cancelled.
   */
  static async prompt(initialTimestamp = null, title = "Выбор даты и времени") {
    if (!window.SimpleCalendar || !window.SimpleCalendar.api) {
      ui.notifications.warn("Simple Calendar не активен!");
      return null;
    }

    const scApi = window.SimpleCalendar.api;
    const currentTimestamp = game.time.worldTime;
    const targetTimestamp = (initialTimestamp !== null && initialTimestamp !== undefined && initialTimestamp !== "") ? initialTimestamp : currentTimestamp;

    // Convert timestamp to DateData
    const scDate = scApi.timestampToDate(targetTimestamp) || scApi.timestampToDate(currentTimestamp);
    if (!scDate) return null;

    // Get all months in current calendar
    let allMonths = [];
    try {
      allMonths = scApi.getCurrentCalendar().months || [];
    } catch (e) {
      console.warn("QuickNotes | Could not get calendar months", e);
      // Fallback
      allMonths = Array.from({length: 12}, (_, i) => ({ name: `Месяц ${i+1}` }));
    }
    
    const monthsData = allMonths.map((m, i) => ({
      index: i,
      name: m.name,
      selected: i === scDate.month
    }));

    // Estimate max days for current month (rough fallback if API doesn't expose it directly for current month easily, though Simple Calendar months have different lengths)
    // Actually, getDaysForMonth API doesn't exist directly, but we can allow up to 99 and let SC normalize it, or try to clamp. Let's allow up to 99.
    const maxDays = 99; 

    const templateData = {
      year: scDate.year,
      month: scDate.month, // index
      day: scDate.day,
      hour: scDate.hour,
      minute: scDate.minute,
      months: monthsData,
      maxDays
    };

    const content = await renderTemplate("modules/notebook/templates/date-picker.hbs", templateData);

    return new Promise((resolve) => {
      new Dialog({
        title: title,
        content: content,
        classes: ["dialog", "qn-date-picker-dialog"],
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: "Выбрать",
            callback: (html) => {
              const year = Number(html.find('[name="year"]').val()) || 0;
              const month = Number(html.find('[name="month"]').val()) || 0;
              const day = Number(html.find('[name="day"]').val()) || 1;
              const hour = Number(html.find('[name="hour"]').val()) || 0;
              const minute = Number(html.find('[name="minute"]').val()) || 0;

              // Convert back to timestamp
              const newTimestamp = scApi.dateToTimestamp({ year, month, day, hour, minute });
              resolve(newTimestamp);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Отмена",
            callback: () => resolve(null)
          }
        },
        default: "save"
      }).render(true);
    });
  }
}
