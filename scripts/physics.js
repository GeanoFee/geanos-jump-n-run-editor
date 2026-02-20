export class PhysicsEngine {
    constructor() {
        this.gravity = 1.0;
        this.terminalVelocity = 20;
        this.gateStates = new Map(); // id -> { isOpen, timer, yOffset }
        this.accumulator = 0; // Time Accumulator for Fixed Step
    }

    // Helper to get/init gate state
    getGateState(gate) {
        if (!this.gateStates.has(gate.id)) {
            this.gateStates.set(gate.id, {
                isOpen: false,
                timer: 0,
                offset: 0, // 0 = closed, -height = open (moves up)
                targetOffset: 0
            });
        }
        return this.gateStates.get(gate.id);
    }

    /**
     * Update Global World State (Gates, spikes, crumbles)
     * Should be called ONCE per frame
     */
    updateGlobal(dt, levelData) {
        const now = game.time.serverTime;

        for (let item of levelData) {

            // --- GATES (Moving Platforms) ---
            if (item.type === "gate") {
                const state = this.getGateState(item);
                const activeGates = canvas.scene.getFlag("geanos-jump-n-run-editor", "activeGates") || {};

                // Determine if Open
                let shouldBeOpen = false;
                if (activeGates[item.id]) {
                    // Debug Logging for Sync Issues
                    if (game.settings.get("geanos-jump-n-run-editor", "debugMode")) {
                        // console.log(`JNR Gate Debug | ID: ${item.id} | Now: ${now} | Expiry: ${activeGates[item.id]} | Open? ${now < activeGates[item.id]}`);
                    }

                    if (now < activeGates[item.id]) {
                        shouldBeOpen = true;
                    }
                }

                // Animation Logic (Lerp)
                // Improved Sync: If heavily desynced (start up), snap?
                // For now, simpler lerp is robust enough for visual smoothing.
                const targetOffset = shouldBeOpen ? -item.height : 0;
                const speed = 2; // pixel per frame
                const oldOffset = state.offset;

                if (state.offset > targetOffset) {
                    state.offset = Math.max(targetOffset, state.offset - speed);
                } else if (state.offset < targetOffset) {
                    state.offset = Math.min(targetOffset, state.offset + speed);
                }
                state.delta = state.offset - oldOffset;
            }

            // --- CRUMBLE TILES ---
            if (item.type === "crumble") {
                const state = this.getGateState(item);
                const activeCrumbles = canvas.scene.getFlag("geanos-jump-n-run-editor", "activeCrumbles") || {};

                if (activeCrumbles[item.id]) {
                    const startedAt = activeCrumbles[item.id];
                    const duration = item.duration || 500;
                    const elapsed = now - startedAt;

                    if (elapsed > duration) {
                        // FALLING
                        const frames = (elapsed - duration) / 16.666;
                        const fallDist = 0.5 * this.gravity * frames * frames;
                        state.offset = fallDist;
                    } else {
                        // WIGGLE
                        state.offset = (Math.random() - 0.5) * 4;
                    }

                    // RESPAWN LOGIC (3s after fall)
                    if (elapsed > duration + 3000) {
                        if (!this._isResetting) this._isResetting = {};
                        if (!this._isResetting[item.id]) {
                            this._isResetting[item.id] = true;
                            // console.log(`Jump'n'Run | Respawning Crumble Tile ${item.id}`);
                            canvas.scene.unsetFlag("geanos-jump-n-run-editor", `activeCrumbles.${item.id}`).then(() => {
                                delete this._isResetting[item.id];
                                if (this._lastCrumbleTrigger) delete this._lastCrumbleTrigger[item.id];
                            });
                        }
                    }
                } else {
                    state.offset = 0;
                }
                state.delta = state.offset - (state.lastOffset || 0);
                state.lastOffset = state.offset;
            }

            // --- ANIMATED SPIKES (Time Based) ---
            if (item.type === "spike") {
                const state = this.getGateState(item);

                // global cycle: 6000ms
                // 0-2700: Safe (Retracted)
                // 2700-3000: Extending
                // 3000-5700: Active (Extended)
                // 5700-6000: Retracting

                const cycle = now % 6000;

                let targetOffset = 0;
                const fullRetract = item.height;

                if (cycle < 2700) {
                    state.isSafe = true;
                    targetOffset = fullRetract;
                } else if (cycle < 3000) {
                    state.isSafe = false;
                    const p = (cycle - 2700) / 300;
                    targetOffset = fullRetract * (1 - p);
                } else if (cycle < 5700) {
                    state.isSafe = false;
                    targetOffset = 0;
                } else {
                    state.isSafe = false;
                    const p = (cycle - 5700) / 300;
                    targetOffset = fullRetract * p;
                }

                // STATIC OVERRIDE
                if (item.isStatic) {
                    state.isSafe = false;
                    targetOffset = 0;
                }

                state.offset = targetOffset;
                state.delta = 0;
            }

            // --- PRESSURE PLATES ---
            if (item.type === "plate") {
                const state = this.getGateState(item);
                const isPressed = state.lastPressed && (now - state.lastPressed < 100);
                const targetOffset = isPressed ? 8 : 0; // Squish 8px

                if (state.offset < targetOffset) state.offset = Math.min(targetOffset, state.offset + 2);
                else if (state.offset > targetOffset) state.offset = Math.max(targetOffset, state.offset - 2);
            }
        }
    }

    /**
     * Update physics for a specific player
     */
    updatePlayer(player, dt, levelData) {
        if (player.accumulator === undefined) player.accumulator = 0;
        player.accumulator += Math.min(dt, 5.0);

        if (player.prevX === undefined) player.prevX = player.x;
        if (player.prevY === undefined) player.prevY = player.y;

        while (player.accumulator >= 1.0) {
            player.prevX = player.x;
            player.prevY = player.y;
            this.step(player, 1.0, levelData);
            player.accumulator -= 1.0;
        }

        player.alpha = player.accumulator;
    }

    /**
     * Internal Physics Step (Executed at fixed 60hz)
     */
    step(player, dt, levelData) {

        // LIFT LOGIC (Platform Moving)
        if (player.riding) {
            const gate = levelData.find(i => i.id === player.riding);
            if (gate) {
                const state = this.getGateState(gate);
                if (state.delta) {
                    player.y += state.delta;
                    if (player.prevY !== undefined) player.prevY += state.delta;
                    // Note: We move Y. X doesn't generally change for Gates (Vertical).
                }
            } else {
                player.riding = null; // Platform gone
            }
        }

        if (player.teleportCooldown > 0) player.teleportCooldown--;

        // Gravity
        if (!player.onLadder) {
            player.vy += this.gravity * dt;
        }
        if (player.vy > this.terminalVelocity) player.vy = this.terminalVelocity;

        let nextX = player.x + player.vx * dt;
        let nextY = player.y + player.vy * dt;

        player.onLadder = false;
        player.touchingWallLeft = false;
        player.touchingWallRight = false;
        player.pressingPlate = null;

        // HORIZONTAL COLLISION
        for (let rect of levelData) {
            let checkRect = { ...rect };
            if (rect.type === "gate" || rect.type === "crumble" || rect.type === "spike" || rect.type === "plate") {
                const state = this.getGateState(rect);
                checkRect.y += state.offset;
            }

            if (this.checkCollision({ x: nextX, y: player.y, width: player.width, height: player.height }, checkRect)) {

                // Triggers
                if (rect.type === "start" || rect.type === "checkpoint") {
                    player.checkTrigger(rect);
                    continue;
                }
                if (rect.type === "ladder") {
                    player.onLadder = true;
                    continue;
                }
                if (rect.type === "plate") {
                    continue;
                }
                if (rect.type === "spike") {
                    const state = this.gateStates.get(rect.id);
                    let isSafe = false;
                    if (state && state.isSafe) isSafe = true;
                    if (isSafe) continue;

                    if (player.takeDamage(1)) {
                        player.vy = -10;
                        nextY = player.y + player.vy * dt;
                    }
                    continue;
                }
                if (rect.type === "potion") {
                    if (!this._consumedPotions) this._consumedPotions = new Set();
                    if (this._consumedPotions.has(rect.id)) continue;

                    if (player.heal(1)) {
                        this._consumedPotions.add(rect.id);
                        Hooks.call('jnr-trigger', 'onItemCollect', player.token, { id: rect.id, type: "potion" });

                        // PERMISSION HANDLING:
                        // Only GM can modify scene flags to remove the item permanently.
                        if (game.user.isGM) {
                            const currentData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
                            const newData = currentData.filter(i => i.id !== rect.id);
                            canvas.scene.setFlag("geanos-jump-n-run-editor", "levelData", newData).then(() => {
                                if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
                            });
                        } else {
                            // Request GM to remove it
                            if (canvas.jumpnrun && canvas.jumpnrun.network && canvas.jumpnrun.network.socket) {
                                canvas.jumpnrun.network.socket.executeAsGM("consumePotion", {
                                    sceneId: canvas.scene.id,
                                    potionId: rect.id
                                });
                            }
                        }
                    }
                    continue;
                }
                if (rect.type === "portal") {
                    if (!player.keys.jump) continue;
                    if (player.teleportCooldown > 0) continue;
                    if (rect.targetId) {
                        const target = levelData.find(i => i.id === rect.targetId);
                        if (target) {
                            player.x = target.x;
                            player.y = target.y;
                            player.vx = 0;
                            player.vy = 0;
                            player.teleportCooldown = 60;
                            player.prevX = target.x;
                            player.prevY = target.y;
                            player.fallPeakY = target.y;
                            player.grounded = false;
                            Hooks.call('jnr-trigger', 'onPortalUse', player.token, { from: rect.id, to: target.id });
                            return;
                        }
                    }
                    continue;
                }

                // Wall Collision
                if (player.vx < 0) player.touchingWallLeft = true;
                if (player.vx > 0) player.touchingWallRight = true;
                player.vx = 0;
                nextX = player.x;
                break;
            }
        }

        // VERTICAL COLLISION
        let onGround = false;
        for (let rect of levelData) {
            let checkRect = { ...rect };
            if (rect.type === "gate" || rect.type === "crumble" || rect.type === "spike" || rect.type === "plate") {
                const state = this.getGateState(rect);
                checkRect.y += state.offset;
            }

            if (this.checkCollision({ x: nextX, y: nextY, width: player.width, height: player.height }, checkRect)) {

                if (["start", "checkpoint", "ladder", "portal"].includes(rect.type)) {
                    if (rect.type === "ladder") player.onLadder = true;
                    if (rect.type === "start" || rect.type === "checkpoint") player.checkTrigger(rect);
                    continue;
                }

                if (rect.type === "spike") {
                    const state = this.gateStates.get(rect.id);
                    if (state && state.isSafe) continue;
                    if (player.takeDamage(1)) {
                        player.vy = -10;
                        nextY = player.y + player.vy * dt;
                    }
                    continue;
                }
                if (rect.type === "potion") continue;

                // Semi-Permeable Check
                if (checkRect.isSemiPermeable) {
                    if (player.vy >= 0 && player.keys.down) continue;
                    if (player.vy < 0 && player.keys.jump) continue;
                }

                // Solid
                if (player.vy >= 0) {
                    // Floor
                    const targetY = checkRect.y - player.height;
                    const penetration = (player.y + player.height) - checkRect.y;
                    const threshold = 24;

                    if (penetration <= threshold) {
                        if (targetY < nextY) {
                            nextY = targetY;
                            onGround = true;
                            if (rect.type === "gate") player.riding = rect.id;
                            if (rect.type === "crumble") this.triggerCrumble(rect.id);
                            if (rect.type === "plate") {
                                if (rect.targetId) this.triggerGate(rect.targetId, rect.duration || 1000);
                                const state = this.getGateState(rect);
                                state.lastPressed = game.time.serverTime;
                                player.pressingPlate = rect.id; // Track for Network Sync
                            }
                            player.vy = 0;
                        }
                    }
                } else if (player.vy < 0) {
                    // Ceiling
                    const targetY = checkRect.y + checkRect.height;
                    if (targetY > nextY) {
                        nextY = targetY;
                        player.vy = 0;
                    }
                }
            }
        }

        player.x = nextX;
        player.y = nextY;

        // Landed Logic
        if (onGround && !player.grounded) {
            if (player.fallPeakY !== undefined) {
                const fallDist = player.y - player.fallPeakY;
                const gridSize = canvas.grid.size || 100;
                if (fallDist > 3 * gridSize) {
                    // console.log("Jump'n'Run | Fall Damage!", fallDist);
                    player.takeDamage(1);
                }
            }
            player.fallPeakY = player.y;
        }

        player.grounded = onGround;
        if (!onGround) {
            player.riding = null;
            if (player.fallPeakY === undefined || player.y < player.fallPeakY) {
                player.fallPeakY = player.y;
            }
            if (player.onLadder) player.fallPeakY = player.y;
        } else {
            player.fallPeakY = player.y;
        }

        if (player.y > canvas.dimensions.height) {
            player.die();
            return;
        }

        // Anti-Stuck
        if (!player.dead) {
            for (let rect of levelData) {
                if (["start", "checkpoint", "ladder", "potion", "plate", "spike", "portal"].includes(rect.type)) continue;
                if (rect.isSemiPermeable) continue;

                let checkRect = { ...rect };
                if (rect.type === "gate" || rect.type === "crumble") {
                    const state = this.getGateState(rect);
                    checkRect.y += state.offset;
                    if (player.riding === rect.id) continue;
                }

                const shrink = 2;
                if (this.checkCollision({
                    x: player.x + shrink,
                    y: player.y + shrink,
                    width: player.width - (shrink * 2),
                    height: player.height - (shrink * 2)
                }, checkRect)) {
                    // console.log("Player Stuck, dying.");
                    player.die();
                    return;
                }
            }
        }
    }

    checkCollision(rect1, item) {
        const checkOverlap = (r1, r2) => {
            let xMargin = 0.1; // Reduced margin for tighter merging
            let r1x = r1.x + xMargin;
            let r1w = r1.width - (xMargin * 2);
            return (r1x < r2.x + r2.width &&
                r1x + r1w > r2.x &&
                r1.y < r2.y + r2.height &&
                r1.y + r1.height > r2.y);
        };

        if (item.shapes && item.shapes.length > 0) {
            // Elements might be moving/animating. 
            // We find the offset by comparing current bounding box with shape origins.
            let minX = Infinity, minY = Infinity;
            for (let s of item.shapes) {
                minX = Math.min(minX, s.x);
                minY = Math.min(minY, s.y);
            }
            const dx = item.x - minX;
            const dy = item.y - minY;

            return item.shapes.some(s => checkOverlap(rect1, {
                x: s.x + dx,
                y: s.y + dy,
                width: s.width,
                height: s.height
            }));
        }

        return checkOverlap(rect1, item);
    }

    triggerCrumble(id) {
        if (!this._lastCrumbleTrigger) this._lastCrumbleTrigger = {};
        if (this._lastCrumbleTrigger[id]) return;

        const activeCrumbles = canvas.scene.getFlag("geanos-jump-n-run-editor", "activeCrumbles") || {};
        if (activeCrumbles[id]) {
            this._lastCrumbleTrigger[id] = activeCrumbles[id];
            return;
        }

        this._lastCrumbleTrigger[id] = game.time.serverTime;

        if (game.jumpnrun && game.jumpnrun.network && game.jumpnrun.network.socket) {
            game.jumpnrun.network.socket.executeAsGM("crumble", { id: id });
        } else if (game.user.isGM) {
            // Fallback if network not ready (local GM)
            canvas.scene.setFlag("geanos-jump-n-run-editor", `activeCrumbles.${id}`, game.time.serverTime);
        }
    }

    triggerGate(gateId, duration) {
        if (!this._lastTrigger) this._lastTrigger = {};
        const now = game.time.serverTime;
        const last = this._lastTrigger[gateId] || 0;
        if (now - last < 200) return;

        this._lastTrigger[gateId] = now;

        if (game.jumpnrun && game.jumpnrun.network && game.jumpnrun.network.socket) {
            game.jumpnrun.network.socket.executeAsGM("gateTrigger", { id: gateId, duration: duration });
        } else if (game.user.isGM) {
            const expiry = now + duration;
            canvas.scene.setFlag("geanos-jump-n-run-editor", `activeGates.${gateId}`, expiry);
        }
    }
}
