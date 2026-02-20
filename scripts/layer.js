/**
 * Custom Layer for Jump'n'Run elements (Platforms, Spikes, etc.)
 */
import { JumpNRunSceneConfig } from './config.js';
// Dynamic imports used for apps to prevent load-time errors


export class JumpNRunLayer extends foundry.canvas.layers.InteractionLayer {
    constructor() {
        super();
        this.isJumpNRunActive = false;
        this._clipboard = [];
        this._clipboardCenter = null;
        this._saveQueue = Promise.resolve(); // Queue for safe saving
        this.history = []; // Undo History
    }

    /**
     * Safe Save Wrapper to prevent Race Conditions
     * @param {Function} modifierFn - Function that takes currentData and returns newData.
     */
    async _safeSave(modifierFn) {
        // Chain the save operation
        this._saveQueue = this._saveQueue.then(async () => {
            this.commitHistory(); // Save state before change
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
            zIndex: 100 // Visual ordering
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

    /* ------------------------------------------- */
    /*  Lifecycle methods                          */
    /* ------------------------------------------- */

    /** @inheritdoc */
    activate() {
        if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
            console.log("Jump'n'Run | Layer ACTIVATED");
        }
        super.activate();
        this.isJumpNRunActive = true;
        this.eventMode = 'static'; // V13/PIXI 7+ preferred over interactive = true

        // Cursor Feedback
        canvas.app.stage.on('pointermove', this._onMouseMoveWrapper = this._onMouseMove.bind(this));
        if (canvas.dimensions) {
            this.hitArea = canvas.dimensions.rect;
            if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
                console.log("Jump'n'Run | Set HitArea:", this.hitArea);
            }
        } else {
            console.warn("Jump'n'Run | Canvas Dimensions Missing during Activate!");
        }

        // --- MANUAL MIM BINDING (Force Drag) ---
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

        // Debug Interaction
        this.on('pointerdown', (e) => {
            if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
                console.log("Jump'n'Run | Pointer Down on Layer", e.data.global);
            }
        });
        this.zIndex = 1000; // Ensure we are on top
        this.selectedIds = [];
        window.addEventListener('keydown', this._onKeyDownWrapper = (e) => {
            if (!this.isJumpNRunActive) return; // Guard

            // Ignore if user is typing in a field
            const target = e.target;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                return;
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
        if (this._onMouseMoveWrapper) canvas.app.stage.off('pointermove', this._onMouseMoveWrapper);
    }

    async _onDeleteKey() {
        if (game.activeTool !== "select") return;
        if (!this.selectedIds || this.selectedIds.length === 0) return;

        foundry.applications.api.DialogV2.confirm({
            window: { title: "Delete Elements" },
            content: `Delete ${this.selectedIds.length} element(s)?`,
            yes: {
                callback: async () => {
                    const idsToDelete = [...this.selectedIds]; // Capture snapshot
                    console.log(`Jump'n'Run | Deleting ${idsToDelete.length} items:`, idsToDelete);

                    await this._safeSave((current) => {
                        const originalCount = current.length;
                        const newData = current.filter(i => !idsToDelete.includes(i.id));
                        console.log(`Jump'n'Run | Delete: ${originalCount} -> ${newData.length}`);
                        return newData;
                    });
                    this.selectedIds = [];
                }
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
                if (key === "ArrowLeft") nx = Math.floor((nx - 1) / gridSize) * gridSize;
                if (key === "ArrowRight") nx = Math.floor((nx + gridSize + 1) / gridSize) * gridSize;
                if (key === "ArrowUp") ny = Math.floor((ny - 1) / gridSize) * gridSize;
                if (key === "ArrowDown") ny = Math.floor((ny + gridSize + 1) / gridSize) * gridSize;
            } else {
                // 1 Pixel Nudge
                if (key === "ArrowLeft") nx -= 1;
                if (key === "ArrowRight") nx += 1;
                if (key === "ArrowUp") ny -= 1;
                if (key === "ArrowDown") ny += 1;
            }

            const dx = nx - item.x;
            const dy = ny - item.y;

            // OPTIMISTIC UPDATE (Immediate Visual Feedback)
            const children = this.children.filter(c => c.levelItemId === item.id);
            for (let child of children) {
                child.x += dx;
                child.y += dy;
            }

            const updatedItem = { ...item, x: nx, y: ny };
            if (item.shapes && item.shapes.length > 0) {
                updatedItem.shapes = item.shapes.map(s => ({
                    ...s,
                    x: s.x + dx,
                    y: s.y + dy
                }));
            }

            return updatedItem;
        });

        if (updates) {
            // Persist safely
            await this._safeSave((current) => {
                return current.map(item => {
                    if (!this.selectedIds.includes(item.id)) return item;
                    const myUpdate = newData.find(u => u.id === item.id);
                    if (myUpdate) {
                        return myUpdate;
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

            const startX = newItem.x;
            const startY = newItem.y;

            // Apply movement and Snap to grid (Half Grid precision for easier placement)
            newItem.x = Math.round((newItem.x + dx) / (gridSize / 2)) * (gridSize / 2);
            newItem.y = Math.round((newItem.y + dy) / (gridSize / 2)) * (gridSize / 2);

            const appliedDx = newItem.x - startX;
            const appliedDy = newItem.y - startY;

            if (newItem.shapes && newItem.shapes.length > 0) {
                newItem.shapes = newItem.shapes.map(s => ({
                    ...s,
                    x: s.x + appliedDx,
                    y: s.y + appliedDy
                }));
            }

            newItems.push(newItem);
            newIds.push(newItem.id);
        }

        await this._safeSave((current) => {
            return [...current, ...newItems];
        });

        this.selectedIds = newIds;
        ui.notifications.info(`Pasted ${newItems.length} elements.`);
    }

    _onMouseMove(event) {
        if (!this.isJumpNRunActive) return;
        if (game.activeTool !== "select") {
            canvas.app.view.style.cursor = "default";
            return;
        }

        const mouse = event.data.global; // Screen/Stage coords? Need World?
        // PIXI 7 event.data.global is stage coords (world).
        // Actually, let's use canvas.mousePosition for consistency with other methods if possible, 
        // but event.data.global is what we get from pointermove.

        // Transform to world if needed? 
        // Foundry's canvas.mousePosition is reliable.
        const worldPos = canvas.mousePosition;

        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        let cursor = "default";

        for (let id of this.selectedIds) {
            const item = levelData.find(i => i.id === id);
            if (!item || (item.shapes && item.shapes.length > 0)) continue;

            const handleSize = 15; // Slightly larger for hover detection
            const hx = item.x + item.width - handleSize;
            const hy = item.y + item.height - handleSize;

            if (worldPos.x >= hx && worldPos.x <= item.x + item.width &&
                worldPos.y >= hy && worldPos.y <= item.y + item.height) {
                cursor = "nwse-resize";
                break;
            }
        }
        canvas.app.view.style.cursor = cursor;
    }

    /* ------------------------------------------- */
    /*  Logic Helpers                             */
    /* ------------------------------------------- */

    /**
     * Precise hit testing for multi-shape elements
     */
    _isHit(item, pos) {
        if (item.shapes && item.shapes.length > 0) {
            return item.shapes.some(s =>
                pos.x >= s.x && pos.x <= s.x + s.width &&
                pos.y >= s.y && pos.y <= s.y + s.height
            );
        }
        return pos.x >= item.x && pos.x <= item.x + item.width &&
            pos.y >= item.y && pos.y <= item.y + item.height;
    }

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
            const { BulkElementConfig } = await import('./apps/bulk-config.js');
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
                            // Logic for visibility toggle
                            if (updates.isHidden === "visible") return { ...i, isHidden: false };
                            if (updates.isHidden === "hidden") return { ...i, isHidden: true };
                            if (updates.isHidden === "toggle") return { ...i, isHidden: !i.isHidden };
                        }
                        if (updates.img !== undefined) {
                            return { ...i, img: updates.img };
                        }
                        return { ...i, ...updates };
                    });
                });
            }).render(true);
            return;
        }

        // SINGLE ITEM CONFIG
        const { ElementConfig } = await import('./apps/element-config.js');
        new ElementConfig(item, async (updates, mode) => {
            if (mode === "bringToFront") {
                await this._bringSelectionToFront();
                return;
            }
            if (mode === "sendToBack") {
                await this._sendSelectionToBack();
                return;
            }
            await this._safeSave((current) => {
                return current.map(i => i.id === item.id ? { ...i, ...updates } : i);
            });
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

            // Find clicked element (Precise hit testing)
            const clickedItem = levelData.slice().reverse().find(i => this._isHit(i, origin));

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
                    // Only reset if it's a new selection
                    if (!this.selectedIds.includes(clickedItem.id)) {
                        this.selectedIds = [clickedItem.id];
                    }
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

    /** @inheritdoc */
    _canDragLeftStart(user, event) {
        return true;
    }

    /** @inheritdoc */
    async _onDragLeftStart(event) {
        const tool = game.activeTool;
        if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
            console.log("Jump'n'Run | Drag Start. Active Tool:", tool);
        }

        const drawTools = ["platform", "spike", "start", "checkpoint", "ladder", "plate", "gate", "crumble", "portal"];

        // Guard: proper tool selected?
        if (tool !== "select" && !drawTools.includes(tool)) return;

        // CRITICAL FIX: Only call super (default selection logic) if we are in select mode
        if (tool === "select") {
            const { origin } = event.interactionData;
            this._dragStartMouse = { x: origin.x, y: origin.y };

            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

            // 1. RESIZE CHECK (Only if not multi-shape)
            let resizeCandidate = null;
            for (let id of this.selectedIds) {
                const item = levelData.find(i => i.id === id);
                if (!item || (item.shapes && item.shapes.length > 0)) continue;

                const handleSize = 20;
                const hx = item.x + item.width - handleSize;
                const hy = item.y + item.height - handleSize;

                if (origin.x >= hx && origin.x <= item.x + item.width &&
                    origin.y >= hy && origin.y <= item.y + item.height) {
                    resizeCandidate = item;
                    break;
                }
            }

            if (resizeCandidate) {
                this.isResizing = true;
                this.resizeTarget = resizeCandidate;
                this.resizeStart = {
                    x: origin.x,
                    y: origin.y,
                    w: resizeCandidate.width,
                    h: resizeCandidate.height
                };
                return;
            }

            // 2. DRAG CHECK
            // Find clicked element (Precise)
            const clickedItem = levelData.slice().reverse().find(i => this._isHit(i, origin));

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
                this._dragStartPixiPositions = new Map();

                for (let id of this.selectedIds) {
                    const item = levelData.find(i => i.id === id);
                    if (item) this.dragStartPositions[id] = { x: item.x, y: item.y };
                }

                // Store start position for EVERY PIXI child of selected items
                for (let child of this.children) {
                    if (child.levelItemId && this.selectedIds.includes(child.levelItemId)) {
                        this._dragStartPixiPositions.set(child, { x: child.x, y: child.y });
                    }
                }

                return; // CRITICAL: Return here to prevent super._onDragLeftStart (Selection Box)
            }

            // 3. SELECTION BOX (Empty Space)
            await super._onDragLeftStart(event);
            return;
        }

        // DRAWING LOGIC (No super call needed/wanted)
        const origin = event.interactionData.origin;
        // console.log("Jump'n'Run | Creating Preview at", origin);
        this.preview = this.addChild(new PIXI.Graphics());
        this.preview.position.set(origin.x, origin.y);
    }

    async _onDragLeftMove(event) {
        // RESIZING
        if (this.isResizing && this.resizeTarget) {
            const mouse = canvas.mousePosition;
            const gridSize = canvas.grid.size || 100;

            let dx = mouse.x - this.resizeStart.x;
            let dy = mouse.y - this.resizeStart.y;

            let newW = this.resizeStart.w + dx;
            let newH = this.resizeStart.h + dy;

            const isShift = event.data.originalEvent.shiftKey;
            if (isShift) {
                const snap = gridSize / 2;
                newW = Math.max(snap, Math.round(newW / snap) * snap);
                newH = Math.max(snap, Math.round(newH / snap) * snap);
            } else {
                newW = Math.max(16, newW);
                newH = Math.max(16, newH);
            }

            // OPTIMISTIC VISUALS
            for (let c of this.children) {
                if (c.levelItemId === this.resizeTarget.id) {
                    c.width = newW;
                    c.height = newH;
                    // Also update resize handle or border if we were drawing them specially
                    // but drawLevel re-draws selection border based on width/height, 
                    // which we are mutating on the PIXI object directly.
                }
            }
            return;
        }

        if (game.activeTool === "select") {
            if (this.isDraggingSelection && this.dragStartPositions && this._dragStartMouse && this._dragStartPixiPositions) {
                const mouse = canvas.mousePosition;
                const dx = mouse.x - this._dragStartMouse.x;
                const dy = mouse.y - this._dragStartMouse.y;

                const isShift = event.data?.originalEvent?.shiftKey;
                const gridSize = canvas.grid.size || 100;
                const snap = gridSize / 2;

                for (let child of this.children) {
                    if (child.levelItemId && this.selectedIds.includes(child.levelItemId)) {
                        const pixiStart = this._dragStartPixiPositions.get(child);
                        if (pixiStart) {
                            let nextX = pixiStart.x + dx;
                            let nextY = pixiStart.y + dy;

                            if (isShift) {
                                nextX = Math.round(nextX / snap) * snap;
                                nextY = Math.round(nextY / snap) * snap;
                            }

                            child.x = nextX;
                            child.y = nextY;
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
            const mouse = canvas.mousePosition;
            const gridSize = canvas.grid.size || 100;

            let dx = mouse.x - this.resizeStart.x;
            let dy = mouse.y - this.resizeStart.y;
            let newW = this.resizeStart.w + dx;
            let newH = this.resizeStart.h + dy;

            const isShift = event.data.originalEvent.shiftKey;
            if (isShift) {
                const snap = gridSize / 2;
                newW = Math.max(snap, Math.round(newW / snap) * snap);
                newH = Math.max(snap, Math.round(newH / snap) * snap);
            } else {
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

                        // Calculate actual final delta for THIS item (to move shapes too)
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

        await this._safeSave((current) => {
            return [...current, newItem];
        });

        this.clearPreview();
        // Drawing happens automatically via Flag update hook in main.js
    }

    /**
     * Render the level data to the canvas
     */
    /**
     * Render the level data to the canvas
     */
    drawLevel() {
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        // Track existing children to reuse or remove
        const previousChildren = new Map();
        const previousBorders = [];
        for (const child of this.children) {
            if (child.levelItemId) {
                if (child.isSelectionBorder) previousBorders.push(child);
                else previousChildren.set(child.levelItemId, child);
            }
        }

        // Clear all children EXCEPT preview
        this.removeChildren();
        previousBorders.forEach(b => b.destroy());
        if (this.preview) this.addChild(this.preview);

        for (let item of levelData) {
            const isHidden = item.isHidden;
            const isGM = game.user.isGM;
            let alpha = 1.0;
            let shouldRender = true;

            if (isHidden) {
                if (isGM) alpha = 0.3;
                else shouldRender = false;
            }

            // --- HITBOX VISIBILITY SETTING ---
            const showHitboxes = game.settings.get("geanos-jump-n-run-editor", "showHitboxesToPlayers");
            if (!isGM && !showHitboxes && !item.img) {
                alpha = 0; // Completely transparent for players if no image
            }

            if (!shouldRender) continue;

            const hasShapes = item.shapes && item.shapes.length > 0;
            const imgPath = item.img;
            const isTiled = item.isTiled;
            let displayObject = previousChildren.get(item.id);
            const needsRecreation = !displayObject ||
                (imgPath && isTiled && !(displayObject instanceof PIXI.TilingSprite)) ||
                (imgPath && !isTiled && (displayObject instanceof PIXI.TilingSprite || !(displayObject instanceof PIXI.Sprite))) ||
                (!imgPath && !(displayObject instanceof PIXI.Graphics));

            if (needsRecreation) {
                if (displayObject) displayObject.destroy({ children: true });
                if (imgPath) {
                    // Safety check: Ensure it's a valid path (has extension or slash) to avoid loading IDs
                    const isCandidatePath = imgPath.includes(".") || imgPath.includes("/");
                    if (!isCandidatePath) {
                        if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
                            console.warn(`Jump'n'Run | Invalid Asset Path ignored: ${imgPath}`);
                        }
                        imgPath = null;
                        continue; // Skip loading this texture, but keep drawing the rest of the level
                    }

                    const texture = PIXI.Texture.from(imgPath);
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
            }

            // Update Properties and Reset Animation Offsets
            displayObject.x = item.x;
            displayObject.y = item.y;
            displayObject.width = item.width;
            displayObject.height = item.height;
            displayObject.alpha = alpha;
            displayObject.visible = true;

            // Critical: Reset stored animation base positions to the new item.x/y
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
                let mask = displayObject.getChildByName("jnr-mask");
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
                const mask = displayObject.getChildByName("jnr-mask");
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

    /**
     * Draw only the outer edges of a union of rectangles
     */
    _drawUnionOutline(graphics, shapes, offsetX, offsetY) {
        for (let s of shapes) {
            const edges = [
                { x1: s.x, y1: s.y, x2: s.x + s.width, y2: s.y, type: 'h' }, // top
                { x1: s.x + s.width, y1: s.y, x2: s.x + s.width, y2: s.y + s.height, type: 'v' }, // right
                { x1: s.x, y1: s.y + s.height, x2: s.x + s.width, y2: s.y + s.height, type: 'h' }, // bottom
                { x1: s.x, y1: s.y, x2: s.x, y2: s.y + s.height, type: 'v' } // left
            ];

            for (let e of edges) {
                // We will maintain a list of active intervals on this edge [0, 1]
                let intervals = [{ start: 0, end: 1 }];

                for (let other of shapes) {
                    if (s === other) continue;

                    // Expand 'other' slightly to handle precision issues
                    const eps = 0.5; // Larger epsilon for robust grid alignment
                    const ox = other.x - eps;
                    const oy = other.y - eps;
                    const ow = other.width + eps * 2;
                    const oh = other.height + eps * 2;

                    // Find if/where the edge intersects the 'other' rectangle
                    let intersectStart = null;
                    let intersectEnd = null;

                    if (e.type === 'h') {
                        // Horizontal edge: check if y matches and x overlaps
                        if (e.y1 >= oy && e.y1 <= oy + oh) {
                            intersectStart = Math.max(0, (ox - e.x1) / (e.x2 - e.x1));
                            intersectEnd = Math.min(1, (ox + ow - e.x1) / (e.x2 - e.x1));
                        }
                    } else {
                        // Vertical edge: check if x matches and y overlaps
                        if (e.x1 >= ox && e.x1 <= ox + ow) {
                            intersectStart = Math.max(0, (oy - e.y1) / (e.y2 - e.y1));
                            intersectEnd = Math.min(1, (oy + oh - e.y1) / (e.y2 - e.y1));
                        }
                    }

                    if (intersectStart !== null && intersectEnd !== null && intersectStart < intersectEnd) {
                        // Subtract [intersectStart, intersectEnd] from all current intervals
                        const nextIntervals = [];
                        for (let interval of intervals) {
                            if (intersectEnd <= interval.start || intersectStart >= interval.end) {
                                // No overlap
                                nextIntervals.push(interval);
                            } else {
                                // Split interval
                                if (intersectStart > interval.start) {
                                    nextIntervals.push({ start: interval.start, end: intersectStart });
                                }
                                if (intersectEnd < interval.end) {
                                    nextIntervals.push({ start: intersectEnd, end: interval.end });
                                }
                            }
                        }
                        intervals = nextIntervals;
                    }
                }

                // Draw remaining visible segments
                for (let seg of intervals) {
                    graphics.moveTo(e.x1 + (e.x2 - e.x1) * seg.start - offsetX, e.y1 + (e.y2 - e.y1) * seg.start - offsetY);
                    graphics.lineTo(e.x1 + (e.x2 - e.x1) * seg.end - offsetX, e.y1 + (e.y2 - e.y1) * seg.end - offsetY);
                }
            }
        }
    }

    updateVisuals(gateStates) {
        if (!gateStates || gateStates.size === 0) return;

        // Optimization: Use a cached item map if possible, but children already have levelItemId
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        const itemMap = new Map(levelData.map(i => [i.id, i]));

        for (let child of this.children) {
            const id = child.levelItemId;
            if (!id || !gateStates.has(id)) continue;

            // SNAPSHOT Fix: If dragging or resizing, do not override from animation
            if (this.isDraggingSelection && this.selectedIds.includes(id)) continue;
            if (this.isResizing && this.resizeTarget?.id === id) continue;

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
}
