/**
 * Custom Layer for Jump'n'Run elements (Platforms, Spikes, etc.)
 */
import { JumpNRunSceneConfig } from './config.js';
import { ElementConfig } from './apps/element-config.js';
import { BulkElementConfig } from './apps/bulk-config.js';

export class JumpNRunLayer extends InteractionLayer {
    constructor() {
        super();
        console.log("JumpNRunLayer constructed!");
        this.isJumpNRunActive = false;
        this._clipboard = [];
        this._clipboardCenter = null;
        this._saveQueue = Promise.resolve(); // Queue for safe saving
    }

    /**
     * Safe Save Wrapper to prevent Race Conditions
     * @param {Function} modifierFn - Function that takes currentData and returns newData.
     */
    async _safeSave(modifierFn) {
        // Chain the save operation
        this._saveQueue = this._saveQueue.then(async () => {
            // Commit History before modification
            this.commitHistory();

            const currentData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
            const newData = modifierFn(currentData);
            await canvas.scene.setFlag("geanos-jump-n-run-editor", "levelData", newData);
        }).catch(err => {
            console.error("Jump'n'Run | Save Error:", err);
            ui.notifications.error("Jump'n'Run Save Error! Check console.");
        });
        return this._saveQueue;
    }

    /** @inheritdoc */
    static get layerOptions() {
        return foundry.utils.mergeObject(super.layerOptions, {
            name: "jumpnrun",
            zIndex: 5, // Lower than tiles in primary group
            canDrag: true // Explicitly enable dragging
        });
    }

    /**
     * Clear dragging preview
     */
    clearPreview() {
        if (this.preview) {
            this.preview.destroy();
            this.preview = null;
        }
    }

    /* ------------------------------------------- */
    /*  Lifecycle methods                          */
    /* ------------------------------------------- */

    /** @inheritdoc */
    activate() {
        super.activate();
        this.isJumpNRunActive = true;
        this.interactive = true;
        this.hitArea = canvas.dimensions.rect; // Capture clicks on empty space for selection box
        this.selectedIds = [];

        // --- MANUAL MIM BINDING (Force Drag) ---
        // V12 InteractionLayer sometimes needs explicit callback assignment for custom PIXI objects
        if (canvas.mouseInteractionManager) {
            // Save original values to restore them on deactivate
            this._originalMIM = {
                permissions: { ...canvas.mouseInteractionManager.permissions },
                callbacks: { ...canvas.mouseInteractionManager.callbacks }
            };

            canvas.mouseInteractionManager.permissions.dragStart = this._canDragLeftStart.bind(this);
            canvas.mouseInteractionManager.callbacks.dragLeftStart = this._onDragLeftStart.bind(this);
            canvas.mouseInteractionManager.callbacks.dragLeftMove = this._onDragLeftMove.bind(this);
            canvas.mouseInteractionManager.callbacks.dragLeftDrop = this._onDragLeftDrop.bind(this);
            canvas.mouseInteractionManager.callbacks.dragLeftCancel = this._onDragLeftCancel.bind(this);
        }

        window.addEventListener('keydown', this._onKeyDownWrapper = (e) => {
            if (!this.isJumpNRunActive) return; // Guard

            // Ignore if typing in a field
            if (document.activeElement) {
                const tag = document.activeElement.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) return;
            }

            if (e.key === "Delete" || e.key === "Backspace") this._onDeleteKey();
            if ((e.ctrlKey || e.metaKey) && e.key === "a") {
                e.preventDefault();
                this._onSelectAll();
            }

            // Precision Movement (Arrow Keys)
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                if (game.activeTool === "select" && this.selectedIds.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._onMoveSelection(e.key, e.shiftKey);
                }
            }

            // Copy (Ctrl+C)
            if ((e.ctrlKey || e.metaKey) && e.key === "c") {
                if (game.activeTool === "select") {
                    this._onCopy();
                }
            }

            // Paste (Ctrl+V)
            if ((e.ctrlKey || e.metaKey) && e.key === "v") {
                this._onPaste();
            }

            // Undo (Ctrl+Z)
            if ((e.ctrlKey || e.metaKey) && e.key === "z") {
                this.undo();
            }
        }, true);

        // History Stack
        this.history = [];

        // Bind Mouse Move for Cursor Feedback
        canvas.app.stage.on('mousemove', this._onMouseMoveWrapper = this._onMouseMove.bind(this));
    }

    /**
     * Store current state in history stack
     */
    commitHistory() {
        if (!this.history) this.history = [];
        const currentData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        // Deep copy to prevent reference issues
        this.history.push(JSON.stringify(currentData));
        if (this.history.length > 50) this.history.shift();
    }

    /**
     * Revert to previous state
     */
    async undo() {
        if (!this.history || this.history.length === 0) {
            ui.notifications.info("Jump'n'Run | Nothing to Undo");
            return;
        }

        const lastState = this.history.pop();
        try {
            const data = JSON.parse(lastState);
            await canvas.scene.setFlag("geanos-jump-n-run-editor", "levelData", data);
            ui.notifications.info("Jump'n'Run | Undo Successful");
            this.drawLevel();
        } catch (e) {
            console.error("Jump'n'Run | Undo Failed:", e);
        }
    }


    /** @inheritdoc */
    deactivate() {
        super.deactivate();
        this.isJumpNRunActive = false;
        this.interactive = false;

        // Restore original MouseInteractionManager state
        if (this._originalMIM && canvas.mouseInteractionManager) {
            Object.assign(canvas.mouseInteractionManager.permissions, this._originalMIM.permissions);
            Object.assign(canvas.mouseInteractionManager.callbacks, this._originalMIM.callbacks);
            this._originalMIM = null;
        }

        this.clearPreview();
        if (this._onKeyDownWrapper) window.removeEventListener('keydown', this._onKeyDownWrapper, true);
        if (this._onMouseMoveWrapper) canvas.app.stage.off('mousemove', this._onMouseMoveWrapper);
        canvas.app.view.style.cursor = "";
    }

    async _onMouseMove(event) {
        // RESIZE CURSOR LOGIC
        if (!this.isJumpNRunActive) return;

        const tool = game.activeTool;
        if (tool !== "select") {
            // Reset if tool changes
            // canvas.app.view.style.cursor = "";
            return;
        }

        // Use canvas.mousePosition for reliable World Coords
        const mouse = canvas.mousePosition;
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        // Check if hovering over a resize handle of a SELECTED item
        let hoverResize = false;
        for (let id of this.selectedIds) {
            const item = levelData.find(i => i.id === id);
            if (!item) continue;

            // Handle Area: Bottom-Right 25x25 (More forgiving)
            const handleSize = 25;
            const x = item.x + item.width - handleSize;
            const y = item.y + item.height - handleSize;

            if (mouse.x >= x && mouse.x <= item.x + item.width &&
                mouse.y >= y && mouse.y <= item.y + item.height) {
                hoverResize = true;
                break;
            }
        }

        if (hoverResize) {
            canvas.app.view.style.cursor = "nwse-resize";
        } else {
            canvas.app.view.style.cursor = "";
        }
    }

    async _onDeleteKey() {
        if (game.activeTool !== "select") return;
        if (!this.selectedIds || this.selectedIds.length === 0) return;

        Dialog.confirm({
            title: "Delete Elements",
            content: `Delete ${this.selectedIds.length} element(s)?`,
            yes: async () => {
                const idsToDelete = [...this.selectedIds]; // Capture snapshot
                await this._safeSave((current) => {
                    const originalCount = current.length;
                    const newData = current.filter(i => !idsToDelete.includes(i.id));
                    return newData;
                });
                this.selectedIds = [];
            }
        });
    }

    async _onSelectAll() {
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        if (levelData.length === 0) return;

        this.selectedIds = levelData.map(i => i.id);
        this.drawLevel();
        ui.notifications.info(`Selected ${this.selectedIds.length} elements.`);
    }

    /**
     * Merge multiple same-type elements into one multi-shape element
     */
    async _mergeElements() {
        if (!this.selectedIds || this.selectedIds.length < 2) {
            ui.notifications.warn("Jump'n'Run | Select at least two elements to merge.");
            return;
        }

        await this._safeSave((current) => {
            const selectedItems = current.filter(i => this.selectedIds.includes(i.id));
            if (selectedItems.length < 2) return current;

            // Type check
            const type = selectedItems[0].type;
            if (!selectedItems.every(i => i.type === type)) {
                ui.notifications.warn("Jump'n'Run | Only elements of the same type can be merged.");
                return current;
            }

            // Calculate Bounding Box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const shapes = [];

            for (let item of selectedItems) {
                if (item.shapes && item.shapes.length > 0) {
                    for (let s of item.shapes) {
                        shapes.push({ ...s });
                        minX = Math.min(minX, s.x);
                        minY = Math.min(minY, s.y);
                        maxX = Math.max(maxX, s.x + s.width);
                        maxY = Math.max(maxY, s.y + s.height);
                    }
                } else {
                    shapes.push({ x: item.x, y: item.y, width: item.width, height: item.height });
                    minX = Math.min(minX, item.x);
                    minY = Math.min(minY, item.y);
                    maxX = Math.max(maxX, item.x + item.width);
                    maxY = Math.max(maxY, item.y + item.height);
                }
            }

            // Create New Item
            const primary = selectedItems[0];
            const newItem = {
                ...primary,
                id: foundry.utils.randomID(),
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                shapes: shapes
            };

            // Remove old, add new
            const newData = current.filter(i => !this.selectedIds.includes(i.id));
            newData.push(newItem);

            // Update selection to the new merged item
            setTimeout(() => {
                this.selectedIds = [newItem.id];
                this.drawLevel();
            }, 100);

            ui.notifications.info(`Merged ${selectedItems.length} elements into one ${type}.`);
            return newData;
        });
    }

    async _bringSelectionToFront() {
        if (!this.selectedIds || this.selectedIds.length === 0) return;

        await this._safeSave((current) => {
            const itemsToFront = current.filter(i => this.selectedIds.includes(i.id));
            const remaining = current.filter(i => !this.selectedIds.includes(i.id));
            return [...remaining, ...itemsToFront];
        });

        ui.notifications.info(`Brought ${this.selectedIds.length} elements to front.`);
        this.drawLevel();
    }

    async _sendSelectionToBack() {
        if (!this.selectedIds || this.selectedIds.length === 0) return;

        await this._safeSave((current) => {
            const itemsToBack = current.filter(i => this.selectedIds.includes(i.id));
            const remaining = current.filter(i => !this.selectedIds.includes(i.id));
            return [...itemsToBack, ...remaining];
        });

        ui.notifications.info(`Sent ${this.selectedIds.length} elements to back.`);
        this.drawLevel();
    }

    /**
     * Handle Precision Movement
     */
    async _onMoveSelection(key, snap) {
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        const gridSize = canvas.grid.size || 100;

        let updates = false;

        const newData = levelData.map(item => {
            if (!this.selectedIds.includes(item.id)) return item;

            updates = true;
            let nx = item.x;
            let ny = item.y;

            if (snap) {
                // Snap to Next Grid Line
                if (key === "ArrowLeft") {
                    nx = Math.floor((nx - 1) / gridSize) * gridSize;
                }
                if (key === "ArrowRight") {
                    nx = Math.floor((nx + gridSize + 1) / gridSize) * gridSize;
                }
                if (key === "ArrowUp") {
                    ny = Math.floor((ny - 1) / gridSize) * gridSize;
                }
                if (key === "ArrowDown") {
                    ny = Math.floor((ny + gridSize + 1) / gridSize) * gridSize;
                }
            } else {
                // 1 Pixel Nudge
                if (key === "ArrowLeft") nx -= 1;
                if (key === "ArrowRight") nx += 1;
                if (key === "ArrowUp") ny -= 1;
                if (key === "ArrowDown") ny += 1;
            }

            // OPTIMISTIC UPDATE (Immediate Visual Feedback)
            const child = this.children.find(c => c.levelItemId === item.id);
            if (child) {
                child.x = nx;
                child.y = ny;
            }

            return { ...item, x: nx, y: ny };
        });

        if (updates) {
            // Persist safely
            await this._safeSave((current) => {
                return current.map(item => {
                    if (!this.selectedIds.includes(item.id)) return item;
                    const myUpdate = newData.find(u => u.id === item.id);
                    if (myUpdate) {
                        return { ...item, x: myUpdate.x, y: myUpdate.y };
                    }
                    return item;
                });
            });
        }
    }

    _onCopy() {
        if (!this.selectedIds || this.selectedIds.length === 0) return;
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        // Filter and Deep Clone
        this._clipboard = levelData
            .filter(i => this.selectedIds.includes(i.id))
            .map(i => JSON.parse(JSON.stringify(i)));

        // Calculate Center for reference
        if (this._clipboard.length > 0) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let item of this._clipboard) {
                if (item.x < minX) minX = item.x;
                if (item.x + item.width > maxX) maxX = item.x + item.width;
                if (item.y < minY) minY = item.y;
                if (item.y + item.height > maxY) maxY = item.y + item.height;
            }
            this._clipboardCenter = {
                x: minX + (maxX - minX) / 2,
                y: minY + (maxY - minY) / 2
            };
        }

        ui.notifications.info(`Copied ${this._clipboard.length} elements.`);
    }

    async _onPaste() {
        if (!this._clipboard || this._clipboard.length === 0) return;

        // Get Mouse Position (World)
        const mouse = canvas.mousePosition;

        // Calculate Delta
        let dx = 0;
        let dy = 0;

        if (this._clipboardCenter) {
            dx = mouse.x - this._clipboardCenter.x;
            dy = mouse.y - this._clipboardCenter.y;
        }

        const newItems = [];
        const newIds = [];
        const gridSize = canvas.grid.size || 100;

        for (let item of this._clipboard) {
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.id = foundry.utils.randomID();
            newItem.x += dx;
            newItem.y += dy;

            // Snap to grid (Half Grid precision for easier placement)
            newItem.x = Math.round(newItem.x / (gridSize / 2)) * (gridSize / 2);
            newItem.y = Math.round(newItem.y / (gridSize / 2)) * (gridSize / 2);

            newItems.push(newItem);
            newIds.push(newItem.id);
        }

        await this._safeSave((current) => {
            return [...current, ...newItems];
        });

        this.selectedIds = newIds;
        ui.notifications.info(`Pasted ${newItems.length} elements.`);
    }

    /* ------------------------------------------- */
    /*  Event Listeners                            */
    /* ------------------------------------------- */



    async _onDoubleClickLeft(event) {
        const tool = game.activeTool;
        if (tool !== "select") return;

        const { origin } = event.interactionData;
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        // Find clicked item (Precise)
        const item = levelData.slice().reverse().find(i => this._isHit(i, origin));

        if (!item) return;

        if (this.selectedIds && this.selectedIds.includes(item.id) && this.selectedIds.length > 1) {
            const count = this.selectedIds.length;
            new BulkElementConfig(count, async (updates, mode) => {
                if (mode === "merge") {
                    await this._mergeElements();
                    return;
                }
                if (mode === "bringToFront") {
                    await this._bringSelectionToFront();
                    return;
                }
                if (mode === "sendToBack") {
                    await this._sendSelectionToBack();
                    return;
                }

                await this._safeSave((current) => {
                    return current.map(i => {
                        if (!this.selectedIds.includes(i.id)) return i;
                        if (updates.isHidden !== undefined) {
                            if (updates.isHidden === "visible") return { ...i, isHidden: false };
                            if (updates.isHidden === "hidden") return { ...i, isHidden: true };
                            if (updates.isHidden === "toggle") return { ...i, isHidden: !i.isHidden };
                        }
                        if (updates.img !== undefined) {
                            // If we applied image, we keep other props
                            if (updates.img && updates.img.length > 0) return { ...i, img: updates.img };
                        }
                        // Default
                        return { ...i, ...updates };
                    });
                });
            }).render(true);
            return;
        }

        // SINGLE ITEM CONFIG
        new ElementConfig(item, async (updates, mode) => {
            if (mode === "bringToFront") {
                await this._bringSelectionToFront();
                return;
            }
            if (mode === "sendToBack") {
                await this._sendSelectionToBack();
                return;
            }
            if (updates) {
                await this._safeSave((current) => {
                    return current.map(i => i.id === item.id ? { ...i, ...updates } : i);
                });
            }
        }).render(true);
    }


    /**
     * Right Click to Configure
     */
    async _onClickRight(event) {
        // Reuse double click logic for Right Click
        return this._onDoubleClickLeft(event);
    }

    /** @inheritdoc */
    async _onClickLeft(event) {
        const tool = game.activeTool;

        if (tool === "select") {
            const { origin } = event.interactionData;
            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

            // Find clicked element (Reverse to find top-most)
            const clickedItem = levelData.slice().reverse().find(rect => this._isHit(rect, origin));

            if (clickedItem) {
                // Shift+Click Toggle
                const isShift = event.shiftKey || event.data?.originalEvent?.shiftKey;

                if (isShift) {
                    if (this.selectedIds.includes(clickedItem.id)) {
                        this.selectedIds = this.selectedIds.filter(id => id !== clickedItem.id);
                    } else {
                        this.selectedIds.push(clickedItem.id);
                    }
                } else {
                    this.selectedIds = [clickedItem.id];
                }
                this.drawLevel();
            } else {
                const isShift = event.shiftKey || event.data?.originalEvent?.shiftKey;
                if (!isShift) {
                    this.selectedIds = [];
                    this.drawLevel();
                }
            }
        }

        // TOOL: Potion (Click to Place)
        if (tool === "potion") {
            const { origin } = event.interactionData;
            const gridSize = canvas.grid.size || 100;
            const w = gridSize / 4;
            const h = gridSize / 4;
            const x = origin.x - (w / 2);
            let y = origin.y - (h / 2);

            // GRAVITY LOGIC (Snap to Floor)
            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
            let nearestY = Infinity;

            for (const item of levelData) {
                // Check if solid floor (Platform, Gate, Crumble)
                if (["platform", "gate", "crumble", "plate"].includes(item.type) || (item.type === "spike" && !item.isSafe)) {
                    // Check if directly below potion (horizontal overlap)
                    if (x + w > item.x && x < item.x + item.width) {
                        if (item.y >= y + h) { // Must be below
                            if (item.y < nearestY) {
                                nearestY = item.y;
                            }
                        }
                    }
                }
            }

            if (nearestY !== Infinity) {
                y = nearestY - h; // Place on top
            }

            const newItem = {
                id: foundry.utils.randomID(),
                type: "potion",
                x: x,
                y: y,
                width: w,
                height: h,
                img: "modules/geanos-jump-n-run-editor/assets/PixelPotion.png",
                isHidden: false
            };
            await this._safeSave((current) => [...current, newItem]);
        }
    }

    /**
     * Helper to check if a point hits an item (taking shapes into account)
     */
    _isHit(item, point) {
        if (item.shapes && item.shapes.length > 0) {
            return item.shapes.some(s =>
                point.x >= s.x && point.x <= s.x + s.width &&
                point.y >= s.y && point.y <= s.y + s.height
            );
        }
        return point.x >= item.x && point.x <= item.x + item.width &&
            point.y >= item.y && point.y <= item.y + item.height;
    }

    /** @inheritdoc */
    _canDragLeftStart(user, event) {
        return true;
    }



    /** @inheritdoc */
    async _onDragLeftStart(event) {
        const tool = game.activeTool;
        const drawTools = ["platform", "spike", "start", "checkpoint", "ladder", "plate", "gate", "crumble", "portal"];
        if (tool !== "select" && !drawTools.includes(tool)) return;

        if (tool === "select") {
            const { origin } = event.interactionData;
            this._dragStartMouse = { x: origin.x, y: origin.y };
            const mouse = origin;

            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

            // 1. RESIZE CHECK (Only if not multi-shape)
            let resizeCandidate = null;
            for (let id of this.selectedIds) {
                const item = levelData.find(i => i.id === id);
                if (!item || (item.shapes && item.shapes.length > 0)) continue;

                const handleSize = 25;
                const hx = item.x + item.width - handleSize;
                const hy = item.y + item.height - handleSize;

                if (mouse.x >= hx && mouse.x <= item.x + item.width &&
                    mouse.y >= hy && mouse.y <= item.y + item.height) {
                    resizeCandidate = item;
                    break;
                }
            }

            if (resizeCandidate) {
                this.isResizing = true;
                this.resizeTarget = resizeCandidate;
                this.resizeStart = {
                    x: mouse.x,
                    y: mouse.y,
                    w: resizeCandidate.width,
                    h: resizeCandidate.height
                };
                return;
            }

            // 2. DRAG CHECK
            // Find clicked element (Precise)
            const clickedItem = levelData.slice().reverse().find(i => this._isHit(i, mouse));

            if (clickedItem) {
                const isShift = event.shiftKey || event.data?.originalEvent?.shiftKey;
                if (isShift) {
                    if (this.selectedIds.includes(clickedItem.id)) {
                        this.selectedIds = this.selectedIds.filter(id => id !== clickedItem.id);
                    } else {
                        this.selectedIds.push(clickedItem.id);
                        this.drawLevel();
                    }
                } else {
                    if (!this.selectedIds.includes(clickedItem.id)) {
                        this.selectedIds = [clickedItem.id];
                        this.drawLevel();
                    }
                }

                // Initialize Drag
                this.isDraggingSelection = true;
                this.dragStartPositions = {};
                for (let id of this.selectedIds) {
                    const item = levelData.find(i => i.id === id);
                    if (item) this.dragStartPositions[id] = { x: item.x, y: item.y };
                }
                return; // CRITICAL: Return here to prevent super._onDragLeftStart (Selection Box)
            }

            // 3. SELECTION BOX (Empty Space)
            await super._onDragLeftStart(event);
            return;
        }

        // DRAWING LOGIC (No super call needed/wanted)
        const origin = event.interactionData.origin;
        this.preview = this.addChild(new PIXI.Graphics());
        this.preview.position.set(origin.x, origin.y);
    }

    async _onDragLeftMove(event) {
        // RESIZING
        if (this.isResizing && this.resizeTarget) {
            // Use current mouse position to calculate delta against start mouse position
            const mouse = canvas.mousePosition;
            const gridSize = canvas.grid.size || 100;

            // Calculate new dimensions based on mouse delta
            let dx = mouse.x - this.resizeStart.x;
            let dy = mouse.y - this.resizeStart.y;

            let newW = this.resizeStart.w + dx;
            let newH = this.resizeStart.h + dy;

            // Shift Key for Snapping
            const isShift = event.data.originalEvent.shiftKey;

            if (isShift) {
                // Snap to Grid (Half Grid minimum)
                const snap = gridSize / 2;
                newW = Math.max(snap, Math.round(newW / snap) * snap);
                newH = Math.max(snap, Math.round(newH / snap) * snap);
            } else {
                // Free Scaling (No Grid Snap), Minimum 16px
                newW = Math.max(16, newW);
                newH = Math.max(16, newH);
            }

            // Update Visuals (Optimistic)
            for (let c of this.children) {
                if (c.levelItemId === this.resizeTarget.id) {
                    c.width = newW;
                    c.height = newH;
                }
            }
            return;
        }

        if (game.activeTool === "select") {
            if (this.isDraggingSelection && this.dragStartPositions && this._dragStartMouse) {
                const mouse = canvas.mousePosition;
                const dx = mouse.x - this._dragStartMouse.x;
                const dy = mouse.y - this._dragStartMouse.y;
                const gridSize = canvas.grid.size || 100;

                for (let child of this.children) {
                    if (child.levelItemId && this.selectedIds.includes(child.levelItemId)) {
                        const start = this.dragStartPositions[child.levelItemId];
                        if (start) {
                            // Optional: Snap to Grid behavior while dragging?
                            let newX = start.x + dx;
                            let newY = start.y + dy;

                            // SNAP TO GRID (Shift)
                            const isShift = event.data?.originalEvent?.shiftKey;
                            if (isShift) {
                                const snap = gridSize / 2;
                                newX = Math.round(newX / snap) * snap;
                                newY = Math.round(newY / snap) * snap;
                            }

                            child.x = newX;
                            child.y = newY;
                        }
                    }
                }
            }
            return;
        }

        if (!this.preview) return;
        const { destination, origin } = event.interactionData;
        const w = destination.x - origin.x;
        const h = destination.y - origin.y;

        this.preview.clear();
        const tool = game.activeTool;
        let color = 0x00FF00;
        if (tool === "spike") color = 0xFF0000;
        if (tool === "start") color = 0x0000FF;
        if (tool === "checkpoint") color = 0xFFFF00;
        if (tool === "toolbox") color = 0x000000; // Fallback

        this.preview.beginFill(color, 0.5);
        this.preview.drawRect(0, 0, w, h);
        this.preview.endFill();
    }


    /** @inheritdoc */
    async _onDragLeftDrop(event) {
        const tool = game.activeTool;

        // COMMIT RESIZE
        if (this.isResizing && this.resizeTarget) {
            // Use canonical mouse position
            const mouse = canvas.mousePosition;
            const gridSize = canvas.grid.size || 100;

            let dx = mouse.x - this.resizeStart.x;
            let dy = mouse.y - this.resizeStart.y;

            let newW = this.resizeStart.w + dx;
            let newH = this.resizeStart.h + dy;

            // Shift Key for Snapping
            const isShift = event.data.originalEvent.shiftKey;

            if (isShift) {
                const snap = gridSize / 2;
                newW = Math.max(snap, Math.round(newW / snap) * snap);
                newH = Math.max(snap, Math.round(newH / snap) * snap);
            } else {
                // Free Scaling (No Grid Snap), Minimum 16px
                newW = Math.max(16, newW);
                newH = Math.max(16, newH);
            }

            await this._safeSave((current) => {
                return current.map(i => {
                    if (i.id === this.resizeTarget.id) {
                        return { ...i, width: newW, height: newH };
                    }
                    return i;
                });
            });

            this.isResizing = false;
            // this.resizeTarget = null; // Don't clear immediately if we want to redraw properly or keep selection
            this.resizeTarget = null;
            return;
        }

        // COMMIT SELECTION MOVE
        if (tool === "select" && this.isDraggingSelection) {
            this.isDraggingSelection = false;
            // Robust calculation
            if (!this._dragStartMouse) return;
            const mouse = canvas.mousePosition;
            const dx = mouse.x - this._dragStartMouse.x;
            const dy = mouse.y - this._dragStartMouse.y;

            const isShift = event.data?.originalEvent?.shiftKey;
            const gridSize = canvas.grid.size || 100;
            const snap = gridSize / 2;

            if (dx === 0 && dy === 0) return;

            await this._safeSave((current) => {
                return current.map(item => {
                    if (this.selectedIds.includes(item.id)) {
                        const start = this.dragStartPositions[item.id];
                        if (!start) return item;

                        let newX = start.x + dx;
                        let newY = start.y + dy;

                        if (isShift) {
                            newX = Math.round(newX / snap) * snap;
                            newY = Math.round(newY / snap) * snap;
                        }

                        // Calculate actual final delta for this specific item
                        const itemDx = newX - start.x;
                        const itemDy = newY - start.y;

                        const updatedItem = {
                            ...item,
                            x: newX,
                            y: newY
                        };

                        if (item.shapes) {
                            updatedItem.shapes = item.shapes.map(s => ({
                                ...s,
                                x: s.x + itemDx,
                                y: s.y + itemDy
                            }));
                        }
                        return updatedItem;
                    }
                    return item;
                });
            });
            return;
        }

        // CREATE NEW ITEM
        const drawTools = ["platform", "spike", "start", "checkpoint", "ladder", "plate", "gate", "crumble", "portal"];
        if (!drawTools.includes(tool)) return;

        const { destination, origin } = event.interactionData;

        // Normalize
        let x = Math.min(origin.x, destination.x);
        let y = Math.min(origin.y, destination.y);
        let w = Math.abs(destination.x - origin.x);
        let h = Math.abs(destination.y - origin.y);

        if (w < 10 || h < 10) return;

        const newItem = {
            id: foundry.utils.randomID(),
            type: tool,
            x: x,
            y: y,
            width: w,
            height: h,
            isHidden: false
        };

        if (tool === "spike") newItem.isStatic = false;

        await this._safeSave((current) => {
            return [...current, newItem];
        });

        this.clearPreview();
        // Drawing happens automatically via Flag update hook in main.js
    }

    /**
     * Render the level data to the canvas
     */
    async drawLevel() {
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        const previousChildren = new Map();
        const previousBorders = [];
        for (const child of this.children) {
            if (child.levelItemId) {
                if (child.isSelectionBorder) previousBorders.push(child);
                else previousChildren.set(child.levelItemId, child);
            }
        }

        this.removeChildren();
        previousBorders.forEach(b => b.destroy());
        if (this.preview) this.addChild(this.preview);

        for (let item of levelData) {
            const isHidden = item.isHidden;
            const isGM = game.user.isGM;
            let alpha = 1.0;
            let shouldRender = true;

            const hasShapes = item.shapes && item.shapes.length > 0;
            let imgPath = item.img; // Moved declaration up
            const isTiled = item.isTiled;

            if (isHidden) {
                if (isGM) alpha = 0.3;
                else shouldRender = false;
            }

            // --- HITBOX VISIBILITY SETTING ---
            const showHitboxes = game.settings.get("geanos-jump-n-run-editor", "showHitboxesToPlayers");
            if (!isGM && !showHitboxes && !imgPath) {
                alpha = 0; // Completely transparent for players if no image
            }

            if (!shouldRender) continue;


            let displayObject = previousChildren.get(item.id);

            // Texture Handling
            let texture = null;
            if (imgPath && imgPath.length > 0) {
                // Safety check: Ensure it's a valid path (has extension or slash) to avoid loading IDs
                const isCandidatePath = imgPath.includes(".") || imgPath.includes("/");
                if (!isCandidatePath) {
                    if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
                        console.warn(`Jump'n'Run | Invalid Asset Path ignored: ${imgPath}`);
                    }
                    imgPath = null;
                } else {
                    try {
                        // Try to use PIXI cache first for speed, fallback to loadTexture
                        texture = PIXI.utils.TextureCache[imgPath] || await loadTexture(imgPath);
                    } catch (e) {
                        imgPath = null;
                    }
                }
            }

            const needsRecreation = !displayObject ||
                (imgPath && isTiled && !(displayObject instanceof PIXI.TilingSprite)) ||
                (imgPath && !isTiled && (displayObject instanceof PIXI.TilingSprite || !(displayObject instanceof PIXI.Sprite))) ||
                (!imgPath && !(displayObject instanceof PIXI.Graphics));

            if (needsRecreation) {
                if (displayObject) displayObject.destroy({ children: true });
                if (imgPath) {
                    if (isTiled) {
                        texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                        displayObject = new PIXI.TilingSprite(texture, item.width, item.height);
                    } else {
                        displayObject = new PIXI.Sprite(texture);
                    }
                } else {
                    displayObject = new PIXI.Graphics();
                }
                displayObject.levelItemId = item.id;
                displayObject.interactive = true;
            } else if (texture && displayObject.texture !== texture) {
                displayObject.texture = texture;
            }

            // Update Properties and Reset Animation Offsets
            displayObject.x = item.x;
            displayObject.y = item.y;
            displayObject.width = item.width;
            displayObject.height = item.height;
            displayObject.alpha = alpha;

            displayObject.originalY = undefined;
            displayObject.originalHeight = undefined;

            if (displayObject instanceof PIXI.TilingSprite) {
                displayObject.tilePosition.x = -item.x;
                displayObject.tilePosition.y = -item.y;
            }

            if (!imgPath) {
                const g = displayObject;
                g.clear();
                let color = 0x00FF00;
                if (item.type === "spike") color = 0xFF0000;
                if (item.type === "start") color = 0x0000FF;
                if (item.type === "checkpoint") color = 0xFFFF00;
                if (item.type === "ladder") color = 0xFF8800;
                if (item.type === "plate") color = 0xAAAAAA;
                if (item.type === "gate") color = 0x444444;
                if (item.type === "potion") color = 0xFF00FF;
                if (item.type === "crumble") color = 0x8B4513;
                if (item.type === "portal") color = 0x800080;
                g.beginFill(color, 0.5);
                g.drawRect(0, 0, item.width, item.height);
                g.endFill();
            }

            // Masking Logic
            if (hasShapes) {
                let mask = displayObject.children.find(c => c.name === "jnr-mask");
                if (!mask) {
                    mask = new PIXI.Graphics();
                    mask.name = "jnr-mask";
                    displayObject.addChild(mask);
                    displayObject.mask = mask;
                }
                mask.clear();
                mask.beginFill(0xFFFFFF);
                for (let shape of item.shapes) {
                    mask.drawRect(shape.x - item.x, shape.y - item.y, shape.width, shape.height);
                }
                mask.endFill();
            } else if (displayObject.mask) {
                const mask = displayObject.children.find(c => c.name === "jnr-mask");
                if (mask) mask.destroy();
                displayObject.mask = null;
            }

            this.addChild(displayObject);

            // SELECTION BORDER
            if (this.selectedIds && this.selectedIds.includes(item.id)) {
                const border = new PIXI.Graphics();
                border.isSelectionBorder = true;
                border.lineStyle(2, 0xFF9900, 1.0);
                if (hasShapes) this._drawUnionOutline(border, item.shapes, item.x, item.y);
                else {
                    border.drawRect(0, 0, item.width, item.height);
                    const handleSize = 10;
                    border.beginFill(0xFFFFFF);
                    border.drawRect(item.width - handleSize, item.height - handleSize, handleSize, handleSize);
                    border.endFill();
                }
                border.x = item.x;
                border.y = item.y;
                border.levelItemId = item.id;
                this.addChild(border);
            }
        }

        // Cleanup unused objects
        for (const [id, child] of previousChildren) {
            if (!levelData.some(i => i.id === id)) child.destroy({ children: true });
        }
    }

    _drawUnionOutline(graphics, shapes, offsetX, offsetY) {
        for (let s of shapes) {
            const edges = [
                { x1: s.x, y1: s.y, x2: s.x + s.width, y2: s.y, type: 'h' },
                { x1: s.x + s.width, y1: s.y, x2: s.x + s.width, y2: s.y + s.height, type: 'v' },
                { x1: s.x, y1: s.y + s.height, x2: s.x + s.width, y2: s.y + s.height, type: 'h' },
                { x1: s.x, y1: s.y, x2: s.x, y2: s.y + s.height, type: 'v' }
            ];

            for (let e of edges) {
                let intervals = [{ start: 0, end: 1 }];

                for (let other of shapes) {
                    if (s === other) continue;
                    const eps = 0.5;
                    const ox = other.x - eps;
                    const oy = other.y - eps;
                    const ow = other.width + eps * 2;
                    const oh = other.height + eps * 2;

                    let intersectStart = null;
                    let intersectEnd = null;

                    if (e.type === 'h') {
                        if (e.y1 >= oy && e.y1 <= oy + oh) {
                            intersectStart = Math.max(0, (ox - e.x1) / (e.x2 - e.x1));
                            intersectEnd = Math.min(1, (ox + ow - e.x1) / (e.x2 - e.x1));
                        }
                    } else {
                        if (e.x1 >= ox && e.x1 <= ox + ow) {
                            intersectStart = Math.max(0, (oy - e.y1) / (e.y2 - e.y1));
                            intersectEnd = Math.min(1, (oy + oh - e.y1) / (e.y2 - e.y1));
                        }
                    }

                    if (intersectStart !== null && intersectEnd !== null && intersectStart < intersectEnd) {
                        const nextIntervals = [];
                        for (let interval of intervals) {
                            if (intersectEnd <= interval.start || intersectStart >= interval.end) {
                                nextIntervals.push(interval);
                            } else {
                                if (intersectStart > interval.start) nextIntervals.push({ start: interval.start, end: intersectStart });
                                if (intersectEnd < interval.end) nextIntervals.push({ start: intersectEnd, end: interval.end });
                            }
                        }
                        intervals = nextIntervals;
                    }
                }

                for (let seg of intervals) {
                    graphics.moveTo(e.x1 + (e.x2 - e.x1) * seg.start - offsetX, e.y1 + (e.y2 - e.y1) * seg.start - offsetY);
                    graphics.lineTo(e.x1 + (e.x2 - e.x1) * seg.end - offsetX, e.y1 + (e.y2 - e.y1) * seg.end - offsetY);
                }
            }
        }
    }

    updateVisuals(gateStates) {
        if (!gateStates || gateStates.size === 0) return;

        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        const itemMap = new Map(levelData.map(i => [i.id, i]));

        for (let child of this.children) {
            const id = child.levelItemId;
            if (!id || !gateStates.has(id)) continue;

            // Skip if currently dragging or resizing this item
            if (this.isDraggingSelection && this.selectedIds.includes(id)) continue;
            if (this.isResizing && this.resizeTarget && this.resizeTarget.id === id) continue;

            const state = gateStates.get(id);
            if (child.originalY === undefined) child.originalY = child.y;
            child.y = child.originalY + state.offset;

            // Spike Scaling logic
            const item = itemMap.get(id);
            if (item && item.type === "spike") {
                if (child.originalHeight === undefined) child.originalHeight = child.height;
                const newHeight = Math.max(0, child.originalHeight - state.offset);
                // Only update height if not resizing
                if (!this.isResizing || this.resizeTarget?.id !== item.id) {
                    if (child.height !== newHeight) child.height = newHeight;
                }
            }
        }
    }
}
