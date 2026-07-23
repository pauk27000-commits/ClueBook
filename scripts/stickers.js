export class ClueBookStickers {
  static container = null;

  static init() {
    // Inject the container on body if not already present
    if (!document.getElementById("cb-stickers-layer")) {
      const layer = document.createElement("div");
      layer.id = "cb-stickers-layer";
      layer.style.pointerEvents = "none"; // allow clicking through empty space
      layer.style.position = "absolute";
      layer.style.top = "0";
      layer.style.left = "0";
      layer.style.width = "0";
      layer.style.height = "0";
      layer.style.zIndex = "105"; // below dialogs (110) but above canvas
      document.body.appendChild(layer);
      this.container = layer;

      // Close all palettes when clicking outside
      document.addEventListener("click", () => {
        document.querySelectorAll(".cb-sticker-color-palette").forEach(el => {
          el.style.display = "none";
        });
      });
    }

    // Initial render
    this.render();
  }

  static getStickers() {
    return game.user.getFlag("ClueBook", "stickers") || {};
  }

  static async saveStickers(stickers) {
    await game.user.setFlag("ClueBook", "stickers", stickers);
  }

  static async addSticker() {
    const stickers = this.getStickers();
    const id = foundry.utils.randomID();
    const currentScene = game.scenes.active;
    
    stickers[id] = {
      id: id,
      title: "",
      color: "yellow",
      isPinnedToScene: false,
      sceneId: currentScene ? currentScene.id : "",
      isCollapsed: false,
      text: "",
      x: Math.round(window.innerWidth / 2 - 125),
      y: Math.round(window.innerHeight / 2 - 100),
      checklist: [],
      links: []
    };

    await this.saveStickers(stickers);
    this.render();
  }

  static render() {
    if (!this.container) return;

    const stickersData = this.getStickers();
    const currentSceneId = game.scenes.active?.id;

    // Filter stickers: show if not pinned to scene, OR if pinned to scene and matches current scene
    const visibleStickers = Object.values(stickersData).filter(s => {
      if (!s) return false;
      if (!s.isPinnedToScene) return true;
      return s.sceneId === currentSceneId;
    });

    renderTemplate("modules/ClueBook/templates/stickers.hbs", { stickers: visibleStickers }).then(html => {
      this.container.innerHTML = html;
      this.activateListeners();
    });
  }

  static activateListeners() {
    const layer = this.container;
    if (!layer) return;

    layer.querySelectorAll(".cb-sticker").forEach(stickerEl => {
      stickerEl.style.pointerEvents = "auto"; // allow interaction with the stickers themselves
      const id = stickerEl.dataset.id;

      // в”Ђв”Ђ Drag & Drop of Sticker itself в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      const header = stickerEl.querySelector(".cb-sticker-header");
      let isDragging = false;
      let startX = 0, startY = 0;
      let initialLeft = 0, initialTop = 0;

      header.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return; // Left click only
        if (ev.target.closest(".cb-sticker-header-controls")) return; // skip if clicking controls

        isDragging = true;
        startX = ev.clientX;
        startY = ev.clientY;
        initialLeft = parseInt(stickerEl.style.left) || 0;
        initialTop = parseInt(stickerEl.style.top) || 0;
        stickerEl.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      });

      header.addEventListener("pointermove", (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // Keep inside boundaries
        if (newLeft < 0) newLeft = 0;
        if (newLeft > window.innerWidth - stickerEl.offsetWidth) newLeft = window.innerWidth - stickerEl.offsetWidth;
        if (newTop < 0) newTop = 0;
        if (newTop > window.innerHeight - stickerEl.offsetHeight) newTop = window.innerHeight - stickerEl.offsetHeight;

        stickerEl.style.left = `${newLeft}px`;
        stickerEl.style.top = `${newTop}px`;
      });

      header.addEventListener("pointerup", (ev) => {
        if (!isDragging) return;
        isDragging = false;
        stickerEl.releasePointerCapture(ev.pointerId);
      });

      // Save position & size when mouse/pointer is released anywhere on the sticker
      stickerEl.addEventListener("pointerup", async (ev) => {
        const width = stickerEl.offsetWidth;
        const height = stickerEl.offsetHeight;
        const finalLeft = parseInt(stickerEl.style.left) || 0;
        const finalTop = parseInt(stickerEl.style.top) || 0;

        const stickers = this.getStickers();
        if (stickers[id]) {
          let changed = false;
          if (stickers[id].x !== finalLeft || stickers[id].y !== finalTop) {
            stickers[id].x = finalLeft;
            stickers[id].y = finalTop;
            changed = true;
          }
          if (!stickers[id].isCollapsed) {
            if (stickers[id].w !== width || stickers[id].h !== height) {
              stickers[id].w = width;
              stickers[id].h = height;
              changed = true;
            }
          }
          if (changed) {
            await this.saveStickers(stickers);
          }
        }
      });

      // в”Ђв”Ђ Entity Drag & Drop INTO Sticker в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      stickerEl.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        stickerEl.classList.add("drag-over");
      });

      stickerEl.addEventListener("dragleave", () => {
        stickerEl.classList.remove("drag-over");
      });

      stickerEl.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        stickerEl.classList.remove("drag-over");

        try {
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          if (data && data.uuid) {
            // Retrieve document name from UUID
            const doc = await fromUuid(data.uuid);
            if (doc) {
              const name = doc.name || doc.label || game.i18n.localize("CLUEBOOK.Sticker.Document");
              const stickers = this.getStickers();
              if (stickers[id]) {
                if (!stickers[id].links) stickers[id].links = [];
                // Prevent duplicate links
                if (!stickers[id].links.some(l => l.uuid === data.uuid)) {
                  stickers[id].links.push({ uuid: data.uuid, name: name });
                  await this.saveStickers(stickers);
                  this.render();
                }
              }
            }
          }
        } catch (err) {
          console.error("ClueBook | Sticker drop error:", err);
        }
      });

      // в”Ђв”Ђ Input Blur handlers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      const titleInput = stickerEl.querySelector(".cb-sticker-title");
      titleInput.addEventListener("blur", async () => {
        const stickers = this.getStickers();
        if (stickers[id] && stickers[id].title !== titleInput.value) {
          stickers[id].title = titleInput.value;
          await this.saveStickers(stickers);
        }
      });

      const textInput = stickerEl.querySelector(".cb-sticker-text");
      textInput.addEventListener("blur", async () => {
        const stickers = this.getStickers();
        if (stickers[id] && stickers[id].text !== textInput.value) {
          stickers[id].text = textInput.value;
          await this.saveStickers(stickers);
        }
      });

      // Automatically adjust height for text areas on edit/load
      const autoResizeTextarea = (el) => {
        el.style.height = "auto";
        el.style.height = (el.scrollHeight) + "px";
      };
      textInput.addEventListener("input", () => autoResizeTextarea(textInput));
      autoResizeTextarea(textInput);

      // в”Ђв”Ђ Checklist Actions в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      const checklistContainer = stickerEl.querySelector(".cb-sticker-checklist");

      // Handle Checklist checkbox and inputs change
      checklistContainer.querySelectorAll(".cb-sticker-task-item").forEach(itemEl => {
        const taskId = itemEl.dataset.taskId;
        const checkbox = itemEl.querySelector(".cb-sticker-task-checkbox");
        const taskInput = itemEl.querySelector(".cb-sticker-task-input");
        const deleteBtn = itemEl.querySelector(".cb-sticker-task-delete");

        checkbox.addEventListener("change", async () => {
          const stickers = this.getStickers();
          if (stickers[id]) {
            const task = stickers[id].checklist.find(t => t.id === taskId);
            if (task) {
              task.checked = checkbox.checked;
              await this.saveStickers(stickers);
              // Toggle visual class
              if (checkbox.checked) {
                itemEl.classList.add("is-checked");
              } else {
                itemEl.classList.remove("is-checked");
              }
            }
          }
        });

        taskInput.addEventListener("blur", async () => {
          const stickers = this.getStickers();
          if (stickers[id]) {
            const task = stickers[id].checklist.find(t => t.id === taskId);
            if (task && task.text !== taskInput.value) {
              task.text = taskInput.value;
              await this.saveStickers(stickers);
            }
          }
        });

        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const stickers = this.getStickers();
          if (stickers[id]) {
            stickers[id].checklist = stickers[id].checklist.filter(t => t.id !== taskId);
            await this.saveStickers(stickers);
            this.render();
          }
        });
      });

      // Add task button
      const addTaskBtn = stickerEl.querySelector(".cb-sticker-add-task-btn");
      addTaskBtn.addEventListener("click", async () => {
        const stickers = this.getStickers();
        if (stickers[id]) {
          if (!stickers[id].checklist) stickers[id].checklist = [];
          stickers[id].checklist.push({
            id: foundry.utils.randomID(),
            text: "",
            checked: false
          });
          await this.saveStickers(stickers);
          this.render();
        }
      });

      // в”Ђв”Ђ Entity Link Clicks & Deletion в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      stickerEl.querySelectorAll(".cb-sticker-link-chip").forEach(chipEl => {
        const uuid = chipEl.dataset.uuid;
        const deleteLinkBtn = chipEl.querySelector(".cb-sticker-link-delete");

        chipEl.addEventListener("click", async (e) => {
          if (e.target.closest(".cb-sticker-link-delete")) return;
          const doc = await fromUuid(uuid);
          if (doc && doc.sheet) {
            doc.sheet.render(true);
          } else {
            ui.notifications.warn(game.i18n.localize("CLUEBOOK.Sticker.DocOpenError"));
          }
        });

        deleteLinkBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const stickers = this.getStickers();
          if (stickers[id]) {
            stickers[id].links = stickers[id].links.filter(l => l.uuid !== uuid);
            await this.saveStickers(stickers);
            this.render();
          }
        });
      });

      // в”Ђв”Ђ Header Controls в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
      const pinBtn = stickerEl.querySelector(".btn-pin");
      pinBtn.addEventListener("click", async () => {
        const stickers = this.getStickers();
        if (stickers[id]) {
          stickers[id].isPinnedToScene = !stickers[id].isPinnedToScene;
          stickers[id].sceneId = game.scenes.active?.id || "";
          await this.saveStickers(stickers);
          this.render();
        }
      });

      const collapseBtn = stickerEl.querySelector(".btn-collapse");
      collapseBtn.addEventListener("click", async () => {
        const stickers = this.getStickers();
        if (stickers[id]) {
          stickers[id].isCollapsed = !stickers[id].isCollapsed;
          await this.saveStickers(stickers);
          this.render();
        }
      });

      const closeBtn = stickerEl.querySelector(".btn-close");
      closeBtn.addEventListener("click", async () => {
        const proceed = await foundry.applications.api.DialogV2.confirm({
          window: { title: game.i18n.localize("CLUEBOOK.Sticker.Delete") },
          content: game.i18n.localize("CLUEBOOK.Sticker.DeleteConfirm"),
          rejectClose: false
        });
        if (proceed) {
          await game.user.unsetFlag("ClueBook", `stickers.${id}`);
        }
      });

      // Color Palette triggers
      const colorTrigger = stickerEl.querySelector(".cb-sticker-color-trigger");
      const colorBtn = colorTrigger.querySelector(".btn-color");
      const colorPalette = colorTrigger.querySelector(".cb-sticker-color-palette");

      colorBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Hide all other palettes first
        layer.querySelectorAll(".cb-sticker-color-palette").forEach(el => {
          if (el !== colorPalette) el.style.display = "none";
        });
        const isShown = colorPalette.style.display === "grid";
        colorPalette.style.display = isShown ? "none" : "grid";
      });

      colorPalette.querySelectorAll(".color-dot").forEach(dot => {
        dot.addEventListener("click", async (e) => {
          e.stopPropagation();
          const color = dot.dataset.color;
          const stickers = this.getStickers();
          if (stickers[id]) {
            stickers[id].color = color;
            await this.saveStickers(stickers);
            this.render();
          }
        });
      });
    });
  }
}
