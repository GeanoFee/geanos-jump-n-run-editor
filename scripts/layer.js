/**
 * Custom Layer for Jump'n'Run elements (Platforms, Spikes, etc.)
 */
import { JumpNRunSceneConfig } from './config.js';
import { ElementConfig } from './apps/element-config.js';
import { BulkElementConfig } from './apps/bulk-config.js';

export class JumpNRunLayer extends foundry.canvas.layers.InteractionLayer {
    constructor() {
        super();
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
        if (canvas.dimensions) {
            this.hitArea = canvas.dimensions.rect;
            if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
                console.log("Jump'n'Run | Set HitArea:", this.hitArea);
            }
        } else {
            console.warn("Jump'n'Run | Canvas Dimensions Missing during Activate!");
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
        }, true);
    }

    /** @inheritdoc */
    deactivate() {
        super.deactivate();
        this.isJumpNRunActive = false;
        this.interactive = false;
        this.clearPreview();
        if (this._onKeyDownWrapper) window.removeEventListener('keydown', this._onKeyDownWrapper, true);
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

    async _onClickLeft(event) {
        super._onClickLeft(event);

        // Wait, InteractionLayer HAS _onDoubleClickLeft!
    }

    async _onDoubleClickLeft(event) {
        const tool = game.activeTool;
        if (tool !== "select") return;

        const { origin } = event.interactionData;
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        // Find clicked item
        const item = levelData.slice().reverse().find(rect =>
            origin.x >= rect.x && origin.x <= rect.x + rect.width &&
            origin.y >= rect.y && origin.y <= rect.y + rect.height
        );

        if (!item) return;

        // BULK EDIT LOGIC
        if (this.selectedIds && this.selectedIds.includes(item.id) && this.selectedIds.length > 1) {
            const count = this.selectedIds.length;
            new BulkElementConfig(count, async (updates) => {
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
        new ElementConfig(item, async (updates) => {
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

            // Find clicked element (Reverse to find top-most)
            const clickedItem = levelData.slice().reverse().find(rect =>
                origin.x >= rect.x && origin.x <= rect.x + rect.width &&
                origin.y >= rect.y && origin.y <= rect.y + rect.height
            );

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
            await super._onDragLeftStart(event);

            const origin = event.interactionData.origin;
            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

            const clickedItem = levelData.slice().reverse().find(rect =>
                origin.x >= rect.x && origin.x <= rect.x + rect.width &&
                origin.y >= rect.y && origin.y <= rect.y + rect.height
            );

            if (clickedItem && this.selectedIds.includes(clickedItem.id)) {
                this.isDraggingSelection = true;
                this.dragStartPositions = {};
                for (let id of this.selectedIds) {
                    const item = levelData.find(i => i.id === id);
                    if (item) this.dragStartPositions[id] = { x: item.x, y: item.y };
                }
                return;
            }
            return;
        }

        // DRAWING LOGIC (No super call needed/wanted)
        const origin = event.interactionData.origin;
        // console.log("Jump'n'Run | Creating Preview at", origin);
        this.preview = this.addChild(new PIXI.Graphics());
        this.preview.position.set(origin.x, origin.y);
    }

    async _onDragLeftMove(event) {
        if (game.activeTool === "select") {
            if (this.isDraggingSelection && this.dragStartPositions) {
                const { destination, origin } = event.interactionData;
                const dx = destination.x - origin.x;
                const dy = destination.y - origin.y;

                for (let child of this.children) {
                    if (child.levelItemId && this.selectedIds.includes(child.levelItemId)) {
                        const start = this.dragStartPositions[child.levelItemId];
                        if (start) {
                            child.x = start.x + dx;
                            child.y = start.y + dy;
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

        // COMMIT SELECTION MOVE
        if (tool === "select" && this.isDraggingSelection) {
            this.isDraggingSelection = false;
            const { destination, origin } = event.interactionData;
            const dx = destination.x - origin.x;
            const dy = destination.y - origin.y;

            if (dx === 0 && dy === 0) return;

            await this._safeSave((current) => {
                return current.map(i => {
                    if (this.selectedIds.includes(i.id)) {
                        return { ...i, x: i.x + dx, y: i.y + dy };
                    }
                    return i;
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
    drawLevel() {
        this.removeChildren();
        if (this.preview) this.addChild(this.preview);
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];

        for (let item of levelData) {
            const isHidden = item.isHidden;
            const isGM = game.user.isGM;
            let alpha = 1.0;
            let shouldRender = true;

            if (isHidden) {
                if (isGM) alpha = 0.3;
                else shouldRender = false;
            }

            if (!shouldRender) continue;

            let imgPath = item.img;
            let isTiled = item.isTiled;

            if (imgPath) {
                if (isTiled) {
                    const texture = PIXI.Texture.from(imgPath);
                    const s = new PIXI.TilingSprite(texture, item.width, item.height);
                    s.x = item.x;
                    s.y = item.y;
                    s.alpha = alpha;
                    s.levelItemId = item.id;
                    this.addChild(s);
                } else {
                    const s = PIXI.Sprite.from(imgPath);
                    s.x = item.x;
                    s.y = item.y;
                    s.width = item.width;
                    s.height = item.height;
                    s.alpha = alpha;
                    s.levelItemId = item.id;
                    this.addChild(s);
                }
            } else {
                const g = new PIXI.Graphics();
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

                g.beginFill(color, 0.5 * alpha);
                g.drawRect(0, 0, item.width, item.height);
                g.endFill();
                g.x = item.x;
                g.y = item.y;
                g.levelItemId = item.id;
                this.addChild(g);
            }

            if (this.selectedIds && this.selectedIds.includes(item.id)) {
                const border = new PIXI.Graphics();
                border.lineStyle(2, 0xFF9900, 1.0);
                border.drawRect(0, 0, item.width, item.height);
                border.x = item.x;
                border.y = item.y;
                border.levelItemId = item.id;
                this.addChild(border);
            }
        }
    }

    updateVisuals(gateStates) {
        if (!gateStates) return;
        const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
        const itemMap = new Map(levelData.map(i => [i.id, i]));

        for (let child of this.children) {
            if (child.levelItemId && gateStates.has(child.levelItemId)) {
                const state = gateStates.get(child.levelItemId);
                if (child.originalY === undefined) child.originalY = child.y;
                child.y = child.originalY + state.offset;

                const item = itemMap.get(child.levelItemId);
                if (item && item.type === "spike") {
                    if (child.originalHeight === undefined) child.originalHeight = child.height;
                    const newHeight = Math.max(0, child.originalHeight - state.offset);
                    if (child.height !== newHeight) child.height = newHeight;
                }
            }
        }
    }
}
