import { ClueBookEditDialog } from "./edit-dialog.js";

export const ClueBookBoardMixin = (Base) => class extends Base {
  _setupBoardInteractivity(html) {
    let draggedEntry = null;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    
    // For Linking
    let linkingSource = null;
    let tempLine = null;

    // For Pan & Zoom
    let currentZoom = 1;
    let currentPanX = 0;
    let currentPanY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let rAF_frame = null;

    const board = html.querySelector('.board-canvas');
    if (!board) return;
    
    const entriesList = board.querySelector('.entries-list');
    
    // Load camera state
    if (!this.state.camera) {
      this.state.camera = game.user.getFlag("ClueBook", "boardCamera") || { zoom: 1, panX: 0, panY: 0 };
    }
    currentZoom = this.state.camera.zoom || 1;
    currentPanX = Math.round(this.state.camera.panX || 0);
    currentPanY = Math.round(this.state.camera.panY || 0);

    const applyTransform = () => {
      entriesList.style.transformOrigin = "0 0";
      entriesList.style.zoom = 1;
      entriesList.style.transform = `translate(${Math.round(currentPanX)}px, ${Math.round(currentPanY)}px) scale(${currentZoom})`;
      
      // Force repaint to prevent Chromium from caching a blurry low-res texture of the board text
      entriesList.style.textShadow = '0 0 1px rgba(0,0,0,0.01)';
      setTimeout(() => entriesList.style.textShadow = '', 50);
    };
    applyTransform();
    requestAnimationFrame(applyTransform);
    
    const updateCameraState = foundry.utils.debounce(() => {
      this.state.camera = { zoom: currentZoom, panX: currentPanX, panY: currentPanY };
      game.user.update({ "flags.ClueBook.boardCamera": this.state.camera });
    }, 500);

    // --- DRAG AND DROP ---
    board.addEventListener('dragover', (ev) => {
      ev.preventDefault(); // allow drop
    });

    board.addEventListener('drop', async (ev) => {
      if (this.state.isReadOnly) return;
      
      let data = null;
      try {
        data = JSON.parse(ev.dataTransfer.getData('text/plain'));
      } catch (e) {
        return; // Not a valid JSON drop
      }
      
      if (data && data.uuid) {
        ev.preventDefault();
        ev.stopPropagation();
        
        const doc = await fromUuid(data.uuid);
        if (!doc) return;
        
        const rect = entriesList.getBoundingClientRect();
        const boardX = Math.round((ev.clientX - rect.left) / currentZoom);
        const boardY = Math.round((ev.clientY - rect.top) / currentZoom);
        
        const id = foundry.utils.randomID();
        const targetTab = "notes";
        const newEntry = this._getEmptyEntryForTab(targetTab);
        
        newEntry.id = id;
        newEntry.sort = 9999;
        newEntry.onBoard = true;
        newEntry.boardX = boardX;
        newEntry.boardY = boardY;
        newEntry.name = doc.name;
        newEntry.text = `@UUID[${data.uuid}]{${doc.name}}`;
        
        // Pick a nice color based on type
        if (data.type === "Actor") newEntry.color = "#4caf50"; // Green
        else if (data.type === "Item") newEntry.color = "#ff9800"; // Orange
        else if (data.type === "Scene") newEntry.color = "#9c27b0"; // Purple
        else if (data.type === "JournalEntry" || data.type === "JournalEntryPage") newEntry.color = "#2196f3"; // Blue
        
        const flagPath = `flags.ClueBook.data.${targetTab}.${id}`;
        await this._updateWorkspaceData({ [flagPath]: newEntry });
        this.render({ parts: ["content"] });
      }
    });
    // ---------------------

    // Zoom (Wheel)
    board.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const zoomFactor = 0.1;
      const direction = ev.deltaY < 0 ? 1 : -1;
      let newZoom = currentZoom + (direction * zoomFactor);
      newZoom = Math.max(0.1, Math.min(newZoom, 3.0));

      if (newZoom !== currentZoom) {
        const rect = board.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;

        currentPanX = Math.round(mouseX - (mouseX - currentPanX) * (newZoom / currentZoom));
        currentPanY = Math.round(mouseY - (mouseY - currentPanY) * (newZoom / currentZoom));
        
        currentZoom = newZoom;
        applyTransform();
        updateCameraState();
      }
    });

    let rightClickStartX = 0;
    let rightClickStartY = 0;

    // Context menu on empty board
    board.addEventListener('contextmenu', ev => {
      if (ev.target.closest('.cluebook-entry')) return; // handled by entry context menu
      ev.preventDefault();
      
      if (Math.abs(ev.clientX - rightClickStartX) > 5 || Math.abs(ev.clientY - rightClickStartY) > 5) return;
      
      this._showBoardCreateContextMenu(ev, currentZoom, currentPanX, currentPanY);
    });


    // Pan Start & Deselect
    board.addEventListener('mousedown', (ev) => {
      if (ev.button === 2) {
        rightClickStartX = ev.clientX;
        rightClickStartY = ev.clientY;
      }
      
      if (ev.button === 2 || ev.button === 1) {
        isPanning = true;
        panStartX = ev.clientX - currentPanX;
        panStartY = ev.clientY - currentPanY;
        ev.preventDefault();
      }
      
      // Left click on empty board -> deselect or lasso
      if (ev.button === 0 && ev.target.closest('.cluebook-entry') === null) {
        if (!ev.shiftKey) {
          this.state.selectedEntries.clear();
          html.querySelectorAll('.cluebook-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
        }
        
        const rect = entriesList.getBoundingClientRect();

        this.isLasso = true;
        this.lassoStartX = (ev.clientX - rect.left) / currentZoom;
        this.lassoStartY = (ev.clientY - rect.top) / currentZoom;
        
        this.lassoBox = document.createElement('div');
        this.lassoBox.className = 'cb-lasso-box';
        entriesList.appendChild(this.lassoBox);
        ev.preventDefault();
      }
    });

    const recenterBtn = this.element.querySelector('[data-action="recenterBoard"]');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const entries = board.querySelectorAll('.cluebook-entry');
        if (entries.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          entries.forEach(el => {
            const x = parseInt(el.style.left) || 0;
            const y = parseInt(el.style.top) || 0;
            const w = el.offsetWidth || 300;
            const h = el.offsetHeight || 200;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
          });
          if (minX !== Infinity) {
            const centerX = minX + (maxX - minX) / 2;
            const centerY = minY + (maxY - minY) / 2;
            currentZoom = 0.5;
            currentPanX = Math.round((board.offsetWidth / 2) - (centerX * currentZoom));
            currentPanY = Math.round((board.offsetHeight / 2) - (centerY * currentZoom));
          }
        } else {
          currentPanX = 0;
          currentPanY = 0;
          currentZoom = 1;
        }
        applyTransform();
        updateCameraState();
      });
    }

    const updateLines = () => {
      board.querySelectorAll('.board-svg line').forEach(line => {
        const sourceId = line.dataset.source;
        const targetId = line.dataset.target;
        const sourceEl = board.querySelector(`[data-entry-id="${sourceId}"]`);
        const targetEl = board.querySelector(`[data-entry-id="${targetId}"]`);
        if (sourceEl && targetEl) {
          const sX = parseInt(sourceEl.style.left) + (sourceEl.offsetWidth / 2);
          const sY = parseInt(sourceEl.style.top) + (sourceEl.offsetHeight / 2);
          const tX = parseInt(targetEl.style.left) + (targetEl.offsetWidth / 2);
          const tY = parseInt(targetEl.style.top) + (targetEl.offsetHeight / 2);
          line.setAttribute('x1', sX);
          line.setAttribute('y1', sY);
          line.setAttribute('x2', tX);
          line.setAttribute('y2', tY);
          line.setAttribute('opacity', '1');
          
          const label = board.querySelector(`.board-link-label[data-source="${sourceId}"][data-target="${targetId}"]`);
          if (label) {
            label.style.left = `${(sX + tX) / 2}px`;
            label.style.top = `${(sY + tY) / 2}px`;
          }
        } else {
          line.setAttribute('opacity', '0');
        }
      });
    };
    
    setTimeout(updateLines, 50);

    // Linking Action
    board.querySelectorAll('.btn-link').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const entry = ev.currentTarget.closest('.cluebook-entry');
        if (linkingSource === entry) {
          linkingSource.classList.remove('linking-source');
          linkingSource = null;
          return;
        }
        if (!linkingSource) {
          linkingSource = entry;
          entry.classList.add('linking-source');
        } else {
          const targetId = entry.dataset.entryId;
          const sourceId = linkingSource.dataset.entryId;
          linkingSource.classList.remove('linking-source');
          linkingSource = null;
          if (sourceId !== targetId) {
            this._createLink(sourceId, targetId);
          }
        }
      });
    });

    board.querySelectorAll('.board-link').forEach(link => {
      link.addEventListener('dblclick', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this._editConnectionSettings(link.dataset.source, link.dataset.target);
      });
    });

    board.querySelectorAll('.board-link-label').forEach(lbl => {
      lbl.addEventListener('dblclick', async (ev) => {
        if (this.state.isReadOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        await this._editConnectionSettings(lbl.dataset.source, lbl.dataset.target);
      });
    });

    board.querySelectorAll('.entry-content').forEach(content => {
      content.addEventListener('mouseup', (ev) => {
        if (this.state.isReadOnly) return;
        // If it was resized via CSS resize, style.width/height is set
        if (content.style.width || content.style.height) {
           const entry = content.closest('.cluebook-entry');
           const w = content.style.width ? parseInt(content.style.width) : null;
           const h = content.style.height ? parseInt(content.style.height) : null;
           const t = entry.dataset.sourceTab;
           const id = entry.dataset.entryId;
           if (w && w !== parseInt(entry.dataset.lastW)) {
             this._saveDataRaw(t, id, "boardW", w);
             entry.dataset.lastW = w;
           }
           if (h && h !== parseInt(entry.dataset.lastH)) {
             this._saveDataRaw(t, id, "boardH", h);
             entry.dataset.lastH = h;
           }
        }
      });
    });

    board.querySelectorAll('.cluebook-entry').forEach(entry => {
      entry.addEventListener('contextmenu', (ev) => {
        if (this.state.isReadOnly) return;
        const entryId = entry.dataset.entryId;
        if (this.state.selectedEntries.has(entryId) && this.state.selectedEntries.size > 1) {
          ev.preventDefault();
          ev.stopPropagation();
          this._showBoardContextMenu(ev, entry);
        }
      });

      entry.addEventListener('dblclick', (ev) => {
        if (this.state.isReadOnly) return;
        ev.stopPropagation();
        const entryId = entry.dataset.entryId;
        const sourceTab = entry.dataset.sourceTab;
        const data = (this._getWorkspaceJournal() || game.user).getFlag("ClueBook", "data")?.[sourceTab]?.[entryId];
        if (!data) return;

        new ClueBookEditDialog({
          entry: data,
          sourceTab: sourceTab,
          entryId: entryId,
          onSave: async (savedData) => {
            const flagUpdates = {};
            for (const [key, value] of Object.entries(savedData)) {
              flagUpdates[`flags.ClueBook.data.${sourceTab}.${entryId}.${key}`] = value;
            }
            await this._updateWorkspaceData(flagUpdates);
            this.render({ parts: ["content"] });
          }
        }).render(true);
      });

      entry.addEventListener('mouseenter', () => {
        if (!this.getSettings().theme.hoverHighlight) return;
        if (draggedEntry || isPanning || this.isLasso || linkingSource) return;
        
        if (this._hoverTimer) clearTimeout(this._hoverTimer);
        if (this._hoverHideTimer) clearTimeout(this._hoverHideTimer);
        
        this._hoverTimer = setTimeout(() => {
          if (draggedEntry || isPanning || this.isLasso || linkingSource) return;
          this._highlightConnections(entry.dataset.entryId);
        }, this.getSettings().theme.hoverDelay || 1000);
      });

      entry.addEventListener('mouseleave', () => {
        if (this._hoverTimer) clearTimeout(this._hoverTimer);
        
        if (board.classList.contains('is-dimmed')) {
          this._hoverHideTimer = setTimeout(() => {
            this._resetHighlight();
          }, 100);
        }
      });

      entry.addEventListener('mousedown', (ev) => {
        if (this.state.isReadOnly) return;
        if (ev.button !== 0) return; // Only left click drags
        if (ev.target.closest('.entry-controls') || ev.target.closest('.edit-mode')) return;
        if (entry.classList.contains('is-editing')) return;
        
        if (this._hoverTimer) clearTimeout(this._hoverTimer);
        this._resetHighlight();
        
        if (ev.ctrlKey || ev.metaKey) {
          if (linkingSource) return;
          linkingSource = entry;
          entry.classList.add('linking-source');
          
          tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
          tempLine.setAttribute("stroke", this.getSettings().theme.linkColor || "white");
          tempLine.setAttribute("stroke-width", "3");
          tempLine.setAttribute("stroke-dasharray", "5,5");
          tempLine.style.pointerEvents = "none";
          
          const sX = parseInt(entry.style.left) + (entry.offsetWidth / 2);
          const sY = parseInt(entry.style.top) + (entry.offsetHeight / 2);
          tempLine.setAttribute("x1", sX);
          tempLine.setAttribute("y1", sY);
          tempLine.setAttribute("x2", sX);
          tempLine.setAttribute("y2", sY);
          
          const svg = board.querySelector('.board-svg');
          if (svg) svg.appendChild(tempLine);
          
          ev.preventDefault();
          return;
        }

        if (ev.shiftKey) {
          const entryId = entry.dataset.entryId;
          if (this.state.selectedEntries.has(entryId)) {
            this.state.selectedEntries.delete(entryId);
            entry.classList.remove('is-selected');
          } else {
            this.state.selectedEntries.add(entryId);
            entry.classList.add('is-selected');
          }
          ev.preventDefault();
          return;
        }

        if (linkingSource) return;

        // Block dragging if the entry is pinned
        if (entry.dataset.pinned === "true") return;
        
        // Prevent dragging if clicking near bottom-right (resize handle)
        const content = entry.querySelector('.entry-content');
        if (content) {
          const rect = content.getBoundingClientRect();
          const handleSize = 40 * currentZoom;
          if (ev.clientX > rect.right - handleSize && ev.clientY > rect.bottom - handleSize) {
            return;
          }
        }
        
        const entryId = entry.dataset.entryId;
        if (!this.state.selectedEntries.has(entryId)) {
          // Clear previous selection if clicking on an unselected entry without shift
          this.state.selectedEntries.clear();
          board.querySelectorAll('.cluebook-entry.is-selected').forEach(el => el.classList.remove('is-selected'));
          
          this.state.selectedEntries.add(entryId);
          entry.classList.add('is-selected');
        }

        // Cache group positions (excluding pinned cards)
        this._groupDragCache = [];
        this.state.selectedEntries.forEach(id => {
          const el = board.querySelector(`.cluebook-entry[data-entry-id="${id}"]`);
          if (el && el.dataset.pinned !== "true") {
            this._groupDragCache.push({
              id,
              tab: el.dataset.sourceTab,
              el,
              initialLeft: parseInt(el.style.left) || 0,
              initialTop: parseInt(el.style.top) || 0
            });
          }
        });

        draggedEntry = entry;
        startX = ev.clientX;
        startY = ev.clientY;
        
        ev.preventDefault();
      });
    });
    
    if (this._boardMoveHandler) document.removeEventListener('mousemove', this._boardMoveHandler);
    if (this._boardUpHandler) document.removeEventListener('mouseup', this._boardUpHandler);

    this._boardMoveHandler = (ev) => {
      if (rAF_frame) return; // Skip if waiting for frame

      rAF_frame = requestAnimationFrame(() => {
        if (isPanning) {
          currentPanX = ev.clientX - panStartX;
          currentPanY = ev.clientY - panStartY;
          applyTransform();
          updateCameraState();
        } else if (this.isLasso) {
          const rect = entriesList.getBoundingClientRect();
          const endX = (ev.clientX - rect.left) / currentZoom;
          const endY = (ev.clientY - rect.top) / currentZoom;
          
          const left = Math.min(this.lassoStartX, endX);
          const top = Math.min(this.lassoStartY, endY);
          const width = Math.abs(endX - this.lassoStartX);
          const height = Math.abs(endY - this.lassoStartY);
          
          if (this.lassoBox) {
            this.lassoBox.style.left = `${left}px`;
            this.lassoBox.style.top = `${top}px`;
            this.lassoBox.style.width = `${width}px`;
            this.lassoBox.style.height = `${height}px`;
          }

          // Check intersections
          this.state.selectedEntries.clear();
          board.querySelectorAll('.cluebook-entry').forEach(entry => {
            const elLeft = parseInt(entry.style.left) || 0;
            const elTop = parseInt(entry.style.top) || 0;
            const elRight = elLeft + (entry.offsetWidth || 300);
            const elBottom = elTop + (entry.offsetHeight || 200);

            if (elLeft < left + width && elRight > left && elTop < top + height && elBottom > top) {
              this.state.selectedEntries.add(entry.dataset.entryId);
              entry.classList.add('is-selected');
            } else {
              entry.classList.remove('is-selected');
            }
          });

        } else if (draggedEntry && this._groupDragCache) {
          const dx = (ev.clientX - startX) / currentZoom;
          const dy = (ev.clientY - startY) / currentZoom;
          
          this._groupDragCache.forEach(item => {
            let newX = item.initialLeft + dx;
            let newY = item.initialTop + dy;
            
            if (ev.shiftKey || this.getSettings().theme.snapToGrid) {
              newX = Math.round(newX / 20) * 20;
              newY = Math.round(newY / 20) * 20;
            }
            
            item.el.style.left = `${newX}px`;
            item.el.style.top = `${newY}px`;
          });
          updateLines();
        } else if (linkingSource && tempLine) {
          const rect = entriesList.getBoundingClientRect();
          const x = (ev.clientX - rect.left) / currentZoom;
          const y = (ev.clientY - rect.top) / currentZoom;
          tempLine.setAttribute("x2", x);
          tempLine.setAttribute("y2", y);
        }
        rAF_frame = null;
      });
    };

    this._boardUpHandler = async (ev) => {
      if (isPanning) {
        isPanning = false;
        updateCameraState();
        return;
      }

      if (linkingSource) {
        if (tempLine) {
          tempLine.remove();
          tempLine = null;
        }
        linkingSource.classList.remove('linking-source');
        
        const targetEntry = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.cluebook-entry');
        if (targetEntry && targetEntry !== linkingSource) {
          const sourceId = linkingSource.dataset.entryId;
          const targetId = targetEntry.dataset.entryId;
          this._createLink(sourceId, targetId);
        }
        linkingSource = null;
        return;
      }

      if (this.isLasso) {
        this.isLasso = false;
        if (this.lassoBox) {
          this.lassoBox.remove();
          this.lassoBox = null;
        }
        return;
      }

      if (!draggedEntry) return;

      if (this._groupDragCache && this._groupDragCache.length > 0) {
        const updates = {};
        this._groupDragCache.forEach(item => {
          let newX = parseInt(item.el.style.left);
          let newY = parseInt(item.el.style.top);
          if (ev.shiftKey || this.getSettings().theme.snapToGrid) {
            newX = Math.round(newX / 20) * 20;
            newY = Math.round(newY / 20) * 20;
            item.el.style.left = `${newX}px`;
            item.el.style.top = `${newY}px`;
          }
          item.el.style.zIndex = "10";
          updates[`flags.ClueBook.data.${item.tab}.${item.id}.boardX`] = newX;
          updates[`flags.ClueBook.data.${item.tab}.${item.id}.boardY`] = newY;
        });
        
        updateLines();
        this._groupDragCache = null;
        draggedEntry = null;

        if (this.state.activeWorkspace !== 'personal') {
          const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('ClueBook_Shared_DB');
          if (j) await j.update(updates);
        } else {
          await game.user.update(updates);
        }
        return;
      }

      const entryId = draggedEntry.dataset.entryId;
      const sourceTab = draggedEntry.dataset.sourceTab;
      
      let newX = parseInt(draggedEntry.style.left);
      let newY = parseInt(draggedEntry.style.top);

      if (ev.shiftKey || this.getSettings().theme.snapToGrid) {
        newX = Math.round(newX / 20) * 20;
        newY = Math.round(newY / 20) * 20;
      }
      
      draggedEntry.style.left = `${newX}px`;
      draggedEntry.style.top = `${newY}px`;
      updateLines();
      
      draggedEntry.style.zIndex = "10";
      draggedEntry = null;

      await this._saveDataRaw(sourceTab, entryId, "boardX", newX);
      await this._saveDataRaw(sourceTab, entryId, "boardY", newY);
    };

    document.addEventListener('mousemove', this._boardMoveHandler);
    document.addEventListener('mouseup', this._boardUpHandler);
  }

  _highlightConnections(entryId) {
    const board = this.element.querySelector('.board-canvas');
    if (!board) return;

    board.classList.add('is-dimmed');

    const connectedNodes = new Set([entryId]);
    const connectedLinks = new Set();

    board.querySelectorAll('.board-svg line').forEach(line => {
      const sourceId = line.dataset.source;
      const targetId = line.dataset.target;
      
      if (sourceId === entryId || targetId === entryId) {
        connectedLinks.add(line);
        connectedNodes.add(sourceId);
        connectedNodes.add(targetId);
      }
    });

    connectedNodes.forEach(id => {
      const el = board.querySelector(`.cluebook-entry[data-entry-id="${id}"]`);
      if (el) el.classList.add('is-highlighted-node');
    });

    connectedLinks.forEach(line => {
      line.classList.add('is-highlighted-link');
      // Also highlight the label if it exists
      const sourceId = line.dataset.source;
      const targetId = line.dataset.target;
      const label = board.querySelector(`.board-link-label[data-source="${sourceId}"][data-target="${targetId}"]`);
      if (label) label.classList.add('is-highlighted-link');
    });
  }

  _resetHighlight() {
    const board = this.element?.querySelector('.board-canvas');
    if (!board) return;
    
    board.classList.remove('is-dimmed');
    board.querySelectorAll('.is-highlighted-node').forEach(el => el.classList.remove('is-highlighted-node'));
    board.querySelectorAll('.is-highlighted-link').forEach(el => el.classList.remove('is-highlighted-link'));
  }

  _showBoardContextMenu(ev, clickedEntry) {
    const existingMenu = document.querySelector('.cb-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'cb-context-menu';
    menu.innerHTML = `
      <div class="cb-menu-item" data-action="align-left"><i class="fas fa-align-left"></i> Выровнять по левому краю</div>
      <div class="cb-menu-item" data-action="align-center"><i class="fas fa-align-center"></i> Выровнять по центру</div>
      <div class="cb-menu-item" data-action="align-right"><i class="fas fa-align-right"></i> Выровнять по правому краю</div>
      <div class="cb-menu-separator"></div>
      <div class="cb-menu-item" data-action="distribute-vertical"><i class="fas fa-arrows-alt-v"></i> Распределить по вертикали</div>
      <div class="cb-menu-separator"></div>
      <div class="cb-menu-item danger" data-action="remove-board"><i class="fas fa-times"></i> Убрать с доски</div>
    `;

    document.body.appendChild(menu);

    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 10);

    menu.addEventListener('click', async (menuEv) => {
      menuEv.stopPropagation();
      const actionEl = menuEv.target.closest('.cb-menu-item');
      if (!actionEl) return;
      
      const action = actionEl.dataset.action;
      await this._executeBoardContextMenuAction(action);
      closeMenu();
    });
  }

  async _executeBoardContextMenuAction(action) {
    const board = this.element.querySelector('.board-canvas');
    if (!board) return;

    const selectedIds = Array.from(this.state.selectedEntries);
    const elements = selectedIds.map(id => board.querySelector(`.cluebook-entry[data-entry-id="${id}"]`)).filter(el => el);
    if (elements.length < 2) return;

    const updates = {};
    const gap = 20;

    if (action === 'align-left') {
      const minX = Math.min(...elements.map(el => parseInt(el.style.left) || 0));
      elements.forEach(el => {
        el.style.left = `${minX}px`;
        updates[`flags.ClueBook.data.${el.dataset.sourceTab}.${el.dataset.entryId}.boardX`] = minX;
      });
    } else if (action === 'align-right') {
      const maxX = Math.max(...elements.map(el => (parseInt(el.style.left) || 0) + (el.offsetWidth || 300)));
      elements.forEach(el => {
        const w = el.offsetWidth || 300;
        const newX = maxX - w;
        el.style.left = `${newX}px`;
        updates[`flags.ClueBook.data.${el.dataset.sourceTab}.${el.dataset.entryId}.boardX`] = newX;
      });
    } else if (action === 'align-center') {
      let minX = Infinity, maxX = -Infinity;
      elements.forEach(el => {
        const x = parseInt(el.style.left) || 0;
        const w = el.offsetWidth || 300;
        if (x < minX) minX = x;
        if (x + w > maxX) maxX = x + w;
      });
      const centerX = minX + (maxX - minX) / 2;
      elements.forEach(el => {
        const w = el.offsetWidth || 300;
        const newX = Math.round(centerX - w / 2);
        el.style.left = `${newX}px`;
        updates[`flags.ClueBook.data.${el.dataset.sourceTab}.${el.dataset.entryId}.boardX`] = newX;
      });
    } else if (action === 'distribute-vertical') {
      const sorted = [...elements].sort((a, b) => (parseInt(a.style.top) || 0) - (parseInt(b.style.top) || 0));
      let currentY = parseInt(sorted[0].style.top) || 0;
      sorted.forEach(el => {
        el.style.top = `${currentY}px`;
        updates[`flags.ClueBook.data.${el.dataset.sourceTab}.${el.dataset.entryId}.boardY`] = currentY;
        currentY += (el.offsetHeight || 200) + gap;
      });
    } else if (action === 'remove-board') {
      const nonPinnedElements = elements.filter(el => el.dataset.pinned !== "true");
      if (nonPinnedElements.length === 0) {
        ui.notifications.warn("Все выбранные карточки закреплены и не могут быть убраны с доски!");
        return;
      }

      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Убрать с доски" },
        content: `<p>Вы уверены, что хотите убрать <b>${nonPinnedElements.length}</b> выделенных записей с доски?</p>`,
        rejectClose: false
      });
      if (!proceed) return;

      nonPinnedElements.forEach(el => {
        updates[`flags.ClueBook.data.${el.dataset.sourceTab}.${el.dataset.entryId}.onBoard`] = false;
      });
      this.state.selectedEntries.clear();
    }

    if (Object.keys(updates).length > 0) {
      if (this.state.activeWorkspace !== 'personal') {
        const j = game.journal.get(this.state.activeWorkspace) || game.journal.getName('ClueBook_Shared_DB');
        if (j) await j.update(updates);
      } else {
        await game.user.update(updates);
      }
      this.render({ parts: ["content"] });
    }
  }

  _showBoardCreateContextMenu(ev, currentZoom, currentPanX, currentPanY) {
    if (this.state.isReadOnly) return;

    const existingMenu = document.querySelector('.cb-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'cb-context-menu';
    menu.innerHTML = `
      <div class="cb-menu-item" data-tab="notes"><i class="fas fa-sticky-note"></i> Создать заметку</div>
      <div class="cb-menu-item" data-tab="npc"><i class="fas fa-user"></i> Создать персонажа</div>
      <div class="cb-menu-item" data-tab="quests"><i class="fas fa-tasks"></i> Создать квест</div>
      <div class="cb-menu-item" data-tab="timeline"><i class="fas fa-history"></i> Создать событие</div>
    `;

    document.body.appendChild(menu);

    menu.style.left = `${ev.clientX}px`;
    menu.style.top = `${ev.clientY}px`;

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    }, 10);

    const board = this.element.querySelector('.board-canvas');
    const entriesList = board.querySelector('.entries-list');
    const rect = entriesList.getBoundingClientRect();
    const boardX = Math.round((ev.clientX - rect.left) / currentZoom);
    const boardY = Math.round((ev.clientY - rect.top) / currentZoom);

    menu.addEventListener('click', async (menuEv) => {
      menuEv.stopPropagation();
      const actionEl = menuEv.target.closest('.cb-menu-item');
      if (!actionEl) return;
      
      const targetTab = actionEl.dataset.tab;
      closeMenu();
      
      const id = foundry.utils.randomID();
      const newEntry = this._getEmptyEntryForTab(targetTab);
      newEntry.id = id;
      newEntry.sort = 9999;
      newEntry.onBoard = true;
      newEntry.boardX = boardX;
      newEntry.boardY = boardY;
      
      const flagPath = `flags.ClueBook.data.${targetTab}.${id}`;
      const updateData = { [flagPath]: newEntry };
      await this._updateWorkspaceData(updateData);
      this.render({ parts: ["content"] });
      
      const data = (this._getWorkspaceJournal() || game.user).getFlag("ClueBook", "data")?.[targetTab]?.[id] || newEntry;
      
      new ClueBookEditDialog({
        entry: data,
        sourceTab: targetTab,
        entryId: id,
        onSave: async (savedData) => {
          const flagUpdates = {};
          for (const [key, value] of Object.entries(savedData)) {
            flagUpdates[`flags.ClueBook.data.${targetTab}.${id}.${key}`] = value;
          }
          await this._updateWorkspaceData(flagUpdates);
          this.render({ parts: ["content"] });
        }
      }).render(true);
    });
  }

  async _createLink(sourceId, targetId) {
    let links = this._getWorkspaceLinks();
    const [a, b] = [sourceId, targetId].sort();
    const key = `${a}_${b}`;
    
    if (links[key]) return;

    const newLink = { source: sourceId, target: targetId, label: "", style: "solid", color: "" };
    await this._updateWorkspaceData({ [`flags.ClueBook.data.links.${key}`]: newLink });
    
    this.render();
  }

  async _deleteLink(s, t) {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Удаление связи" },
      content: "<p>Вы уверены, что хотите удалить эту нить?</p>",
      rejectClose: false
    });

    if (!proceed) return;

    const [a, b] = [s, t].sort();
    const key = `${a}_${b}`;
    
    await this._updateWorkspaceData({ [`flags.ClueBook.data.links.-=${key}`]: null });
    this.render({ parts: ["content"] });
  }

  async _editConnectionSettings(s, t) {
    let links = this._getWorkspaceLinks();
    const [a, b] = [s, t].sort();
    const key = `${a}_${b}`;
    
    if (!links[key]) return;
    
    const link = links[key];
    const currentLabel = link.label || "";
    const currentColor = link.color || ""; // Empty means default theme color
    const currentStyle = link.style || "solid";
    
    const html = `
      <style>
        .cb-link-setting { margin-bottom: 10px; }
        .cb-link-setting label { display: block; font-weight: bold; margin-bottom: 4px; }
        .cb-link-setting input[type="text"], .cb-link-setting select { width: 100%; padding: 6px; border: 1px solid rgba(0,0,0,0.2); border-radius: 4px; box-sizing: border-box; }
        .cb-link-setting input[type="color"] { width: 100%; height: 35px; border: none; cursor: pointer; padding: 0; box-sizing: border-box; }
        .cb-color-presets { display: flex; gap: 8px; margin-bottom: 6px; justify-content: space-between; }
        .cb-color-preset { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 2px solid rgba(0,0,0,0.2); transition: transform 0.1s; flex-shrink: 0; }
        .cb-color-preset:hover { transform: scale(1.15); box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
      </style>
      <div class="cb-link-setting">
        <label>Текст связи:</label>
        <input type="text" name="label" value="${currentLabel}" placeholder="Например: Враги, Друзья...">
      </div>
      <div class="cb-link-setting">
        <label>Стиль линии:</label>
        <select name="style">
          <option value="solid" ${currentStyle === 'solid' ? 'selected' : ''}>Сплошная</option>
          <option value="dashed" ${currentStyle === 'dashed' ? 'selected' : ''}>Пунктир</option>
          <option value="dotted" ${currentStyle === 'dotted' ? 'selected' : ''}>Точки</option>
        </select>
      </div>
      <div class="cb-link-setting">
        <label>Цвет линии:</label>
        <div class="cb-color-presets">
           <div class="cb-color-preset" style="background: #ffffff;" data-c="#ffffff" title="По умолчанию" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="cb-color-preset" style="background: #f44336;" data-c="#f44336" title="Вражда / Опасность" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="cb-color-preset" style="background: #4caf50;" data-c="#4caf50" title="Союз / Безопасность" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="cb-color-preset" style="background: #2196f3;" data-c="#2196f3" title="Семья / Нейтрально" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="cb-color-preset" style="background: #ff9800;" data-c="#ff9800" title="Важно / Квест" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="cb-color-preset" style="background: #9c27b0;" data-c="#9c27b0" title="Магия / Тайна" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
           <div class="cb-color-preset" style="background: #9e9e9e;" data-c="#9e9e9e" title="Слух / Прошлое" onclick="this.closest('.cb-link-setting').querySelector('input[type=color]').value = this.dataset.c"></div>
        </div>
        <input type="color" name="color" value="${currentColor || '#ffffff'}">
        <p style="font-size: 11px; color: #666; margin-top: 2px;">Нажмите на кружок для быстрого выбора или выберите свой цвет. Белый (#ffffff) = цвет по умолчанию.</p>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Настройки связи" },
      content: html,
      buttons: [
        {
          action: "save",
          icon: "fas fa-save",
          label: "Сохранить",
          default: true,
          callback: (event, button, dialog) => {
            return {
              action: "save",
              label: button.form.elements.label.value,
              style: button.form.elements.style.value,
              color: button.form.elements.color.value
            };
          }
        },
        {
          action: "delete",
          icon: "fas fa-trash",
          label: "Удалить связь",
          callback: () => ({ action: "delete" })
        }
      ],
      rejectClose: false
    });

    if (!result) return;

    if (result.action === "delete") {
      await this._updateWorkspaceData({ [`flags.ClueBook.data.links.-=${key}`]: null });
    } else {
      const updateData = {};
      updateData[`flags.ClueBook.data.links.${key}.label`] = result.label.trim() === "" ? null : result.label.trim();
      updateData[`flags.ClueBook.data.links.${key}.style`] = result.style;
      updateData[`flags.ClueBook.data.links.${key}.color`] = (result.color === "#ffffff") ? "" : result.color;
      await this._updateWorkspaceData(updateData);
    }

    this.render({ parts: ["content"] });
  }
};
