export class PlatformerPlayer {
    constructor(token, networkCoordinator) {
        try {
            this.token = token;
            this.network = networkCoordinator; // Store reference

            // AUTHORITY LOGIC
            this.reevaluateAuthority();
            // console.log(`Jump'n'Run: Controller for ${token.name} (${token.id}) created. isRemote=${this.isRemote} (Owner: ${token.isOwner}, Master Logic: ${isMaster})`);


            // Physics state
            this.x = token.document?.x ?? token.x ?? 0;
            this.y = token.document?.y ?? token.y ?? 0;
            this.vx = 0;
            this.vy = 0;
            this.width = (typeof token.w === 'number') ? token.w : 100;
            this.height = (typeof token.h === 'number') ? token.h : 100;

            this.grounded = false;
            this.fallPeakY = this.y;
            this.facingRight = true;
            this.teleportCooldown = 0;
            this.dead = false;
            this.lastCheckpoint = null;
            this.onLadder = false;
            this.touchingWallLeft = false;
            this.touchingWallRight = false;
            this.coyoteTimer = 0;
            this.wallCoyoteLeft = 0;
            this.wallCoyoteRight = 0;
            this.lastInputTime = 0;
            this.riding = null;

            // --- NETWORK STATE ---
            this.networkBuffer = []; // For Slaves: [ {t, x, y, ...}, ... ]
            this.lastBroadcastTime = 0;
            this.dbSaveTimer = 0;

            // Sync Initial Server State
            if (this.token.document) {
                this._lastServerX = this.token.document.x;
                this._lastServerY = this.token.document.y;
            }

            // Params
            this.moveSpeed = 5;
            this.jumpForce = -15;

            // Input State
            this.keys = {
                up: false, down: false, left: false, right: false, jump: false
            };
            this.keys = {
                up: false, down: false, left: false, right: false, jump: false
            };
            this.manualPanActive = false; // "Sticky" manual pan state
            this.manualPanActive = false; // "Sticky" manual pan state
            this.facingRight = true;
            this.jumpBufferTime = 0; // Input Buffering

            // Register with Network Coordinator
            // Use passed instance via arg, or fallback to global if missing
            if (this.network) {
                this.network.registerController(token.id, (data) => this.onNetworkUpdate(data));
            } else if (game.jumpnrun?.network) {
                game.jumpnrun.network.registerController(token.id, (data) => this.onNetworkUpdate(data));
                this.network = game.jumpnrun.network;
            }

            // Listen for hard token updates (Teleports/GM Drags)
            if (!this._onTokenUpdate) {
                this._onTokenUpdate = (document, change, options, userId) => {
                    if (!this.token || !this.token.document) return;
                    if (document.id !== this.token.document.id) return;

                    // Prevent Manual Drags: If I (the user) initiated this update, ignore it.
                    // Physics/Scripts should update this.x directly.
                    // GM Authority updates (Teleports) come from another user.
                    if (userId === game.user.id && !game.user.isGM) return;

                    const dx = (change.x ?? this.x) - this.x;
                    const dy = (change.y ?? this.y) - this.y;

                    if (Math.abs(dx) > 50 || Math.abs(dy) > 50) {
                        this.x = change.x ?? this.x;
                        this.y = change.y ?? this.y;
                        this.vx = 0;
                        this.vy = 0;
                        this.networkBuffer = [];
                    }
                };
                Hooks.on("updateToken", this._onTokenUpdate);
            }

            if (!this.isRemote) {
                this._setupInput();
            }

            // Life System
            this.maxHearts = 3;
            this.hearts = this.maxHearts;
            this.invulnerableUntil = 0;
            this.heartContainer = new PIXI.Container();
            this.token.addChild(this.heartContainer);

        } catch (err) {
            console.error("Jump'n'Run: Critical Constructor Error", err);
            this.destroy();
            throw err;
        }
    }

    _setupInput() {
        const handleKeyDown = (e) => {
            if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || document.activeElement.isContentEditable)) return;

            let handled = false;
            // Use e.code
            if (e.code === "KeyW" || e.code === "ArrowUp") {
                if (!e.repeat) {
                    this.keys.jump = true;
                    this.jumpBufferTime = game.time.serverTime; // Buffer Jump
                }
                handled = true;
            }
            if (e.code === "KeyS" || e.code === "ArrowDown") { if (!e.repeat) this.keys.down = true; handled = true; }
            if (e.code === "KeyA" || e.code === "ArrowLeft") { if (!e.repeat) this.keys.left = true; handled = true; }
            if (e.code === "KeyD" || e.code === "ArrowRight") { if (!e.repeat) this.keys.right = true; handled = true; }

            if (handled) {
                if (this.token.controlled) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };

        const handleKeyUp = (e) => {
            if (e.code === "KeyW" || e.code === "ArrowUp") this.keys.jump = false;
            if (e.code === "KeyS" || e.code === "ArrowDown") this.keys.down = false;
            if (e.code === "KeyA" || e.code === "ArrowLeft") this.keys.left = false;
            if (e.code === "KeyD" || e.code === "ArrowRight") this.keys.right = false;
        };

        const handleMouseDown = (e) => {
            if (e.button === 2) this.manualPanActive = true;
        };
        // We don't need mouseUp to clear it anymore (it clears on movement)

        window.addEventListener('keydown', handleKeyDown, { capture: true });
        window.addEventListener('keyup', handleKeyUp, { capture: true });
        window.addEventListener('mousedown', handleMouseDown);

        this._onKeyDown = handleKeyDown;
        this._onKeyUp = handleKeyUp;
        this._onMouseDown = handleMouseDown;
    }

    onNetworkUpdate(data) {
        if (!this.isRemote) return;

        // Push to buffer
        this.networkBuffer.push({
            t: data.t || game.time.serverTime,
            x: data.x,
            y: data.y,
            vx: data.vx,
            vy: data.vy,
            facingRight: data.facingRight,
            riding: data.riding,
            relX: data.relX,
            relY: data.relY
        });



        if (this.networkBuffer.length > 20) {
            this.networkBuffer.shift();
        }

        // Immediate State Update (Non-interpolated)
        if (data.hearts !== undefined) this.hearts = data.hearts;

        // Pressure Plate Sync (Visuals)
        if (data.pressingPlate) {
            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
            const plate = levelData.find(i => i.id === data.pressingPlate);
            if (plate && game.jumpnrun?.physics) {
                const state = game.jumpnrun.physics.getGateState(plate);
                state.lastPressed = game.time.serverTime; // Keep it alive
            }
        }
    }

    handleInput() {
        if (this.dead) return;
        if (this.isRemote) {
            this.vx = 0;
            return;
        }

        const isControlled = this.token.controlled;
        if (!isControlled) {
            this.vx = 0;
            return;
        }

        // Horizontal
        if (this.keys.left) {
            this.vx = -this.moveSpeed;
            this.facingRight = false;
            this.lastInputTime = game.time.serverTime;
        } else if (this.keys.right) {
            this.vx = this.moveSpeed;
            this.facingRight = true;
            this.lastInputTime = game.time.serverTime;
        } else {
            this.vx = 0;
        }

        // Snap Camera back on Movement
        if (this.manualPanActive) {
            if (this.vx !== 0 || this.vy !== 0 || this.keys.jump) {
                this.manualPanActive = false;
            }
        }

        if (this.onLadder) {
            if (this.keys.jump) { this.vy = -this.moveSpeed; this.lastInputTime = game.time.serverTime; }
            else if (this.keys.down) { this.vy = this.moveSpeed; this.lastInputTime = game.time.serverTime; }
            else this.vy = 0;
            return;
        }

        // Coyote Time Update
        if (this.grounded) {
            this.coyoteTimer = 10;
        } else {
            if (this.coyoteTimer > 0) this.coyoteTimer--;
        }

        // Wall Coyote
        if (this.touchingWallLeft) this.wallCoyoteLeft = 10;
        else if (this.wallCoyoteLeft > 0) this.wallCoyoteLeft--;
        if (this.touchingWallRight) this.wallCoyoteRight = 10;
        else if (this.wallCoyoteRight > 0) this.wallCoyoteRight--;

        // Jump
        if (this.grounded) this.lastWallJumpSide = null;

        // Jump Logic (Buffered)
        const now = game.time.serverTime;
        const jumpPressed = this.keys.jump || (now - this.jumpBufferTime < 150); // 150ms buffer

        if (jumpPressed) {
            this.lastInputTime = game.time.serverTime;
            if (this.grounded || this.coyoteTimer > 0) {
                this.vy = this.jumpForce;
                this.grounded = false;
                this.coyoteTimer = 0;
                this.jumpBufferTime = 0; // Consume Buffer
            } else {
                if ((this.touchingWallLeft || this.wallCoyoteLeft > 0) && this.lastWallJumpSide !== "left") {
                    this.vy = this.jumpForce;
                    this.vx = this.moveSpeed;
                    this.touchingWallLeft = false;
                    this.wallCoyoteLeft = 0;
                    this.lastWallJumpSide = "left";
                    this.fallPeakY = this.y;
                    this.jumpBufferTime = 0; // Consume Buffer
                    Hooks.call('jnr-trigger', 'onWallJump', this.token, { side: "left" });
                } else if ((this.touchingWallRight || this.wallCoyoteRight > 0) && this.lastWallJumpSide !== "right") {
                    this.vy = this.jumpForce;
                    this.vx = -this.moveSpeed;
                    this.touchingWallRight = false;
                    this.wallCoyoteRight = 0;
                    this.lastWallJumpSide = "right";
                    this.fallPeakY = this.y;
                    this.jumpBufferTime = 0; // Consume Buffer
                    Hooks.call('jnr-trigger', 'onWallJump', this.token, { side: "right" });
                }
            }
        }

        // Variable Jump Height (Short Hop)
        // If moving up (vy < 0) and jump key is released, reduce velocity
        if (this.vy < -4 && !this.keys.jump) {
            this.vy *= 0.6;
        }
    }

    checkTrigger(rect) {
        if (this.isRemote) return;
        if (!this.lastCheckpoint || this.lastCheckpoint.id !== rect.id) {
            this.lastCheckpoint = { x: rect.x, y: rect.y, id: rect.id };
            ui.notifications.info("Checkpoint Reached!");
            Hooks.call('jnr-trigger', 'onCheckpointReached', this.token, { id: rect.id });
        }
    }

    die() {
        if (this.dead) return;
        this.dead = true;
        this.hearts = 0;
        ui.notifications.warn("You died!");
        Hooks.call('jnr-trigger', 'onPlayerDeath', this.token, {});
        this.vx = 0;
        this.vy = 0;
        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        this.respawnTimer = setTimeout(() => { this.respawn(); }, 2000);
    }

    takeDamage(amount = 1) {
        if (this.isRemote) return false;
        if (this.dead) return false;
        if (game.time.serverTime < this.invulnerableUntil) return false;

        this.hearts = Math.max(0, this.hearts - amount);
        this.invulnerableUntil = game.time.serverTime + 1000;

        Hooks.call('jnr-trigger', 'onHealthChange', this.token, { hearts: this.hearts, max: this.maxHearts, delta: -amount });

        if (this.visualClone) {
            this.visualClone.tint = 0xFF0000;
            setTimeout(() => {
                if (this.visualClone && this.token && this.token.mesh)
                    this.visualClone.tint = this.token.mesh.tint || 0xFFFFFF;
            }, 200);
        }

        if (this.hearts <= 0) {
            this.die();
        }
        return true;
    }

    heal(amount = 1) {
        if (this.isRemote) return false;
        if (this.dead) return false;
        if (this.hearts >= this.maxHearts) return false;

        this.hearts = Math.min(this.maxHearts, this.hearts + amount);
        ui.notifications.info("Healed!");
        Hooks.call('jnr-trigger', 'onHealthChange', this.token, { hearts: this.hearts, max: this.maxHearts, delta: amount });

        if (this.visualClone) {
            this.visualClone.tint = 0x00FF00;
            setTimeout(() => {
                if (this.visualClone && this.token && this.token.mesh)
                    this.visualClone.tint = this.token.mesh.tint || 0xFFFFFF;
            }, 200);
        }
        return true;
    }

    respawn(soft = false) {
        if (this.isRemote) return;
        if (!soft) {
            this.hearts = this.maxHearts;
            this.invulnerableUntil = 0;
        }

        if (!this.dead && !soft) return;
        this.dead = false;
        this.vx = 0;
        this.vy = 0;

        if (!this.lastCheckpoint) {
            const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
            const startPoint = levelData.find(i => i.type === "start");
            if (startPoint) {
                this.lastCheckpoint = { x: startPoint.x, y: startPoint.y, id: startPoint.id };
            }
        }

        if (this.lastCheckpoint) {
            this.x = this.lastCheckpoint.x;
            this.y = this.lastCheckpoint.y;
            this.token.document.update({ x: this.x, y: this.y }, { animate: false });
        }
        ui.notifications.info("Respawned!");
    }

    updateVisuals() {
        if (!this.token) return;
        if (!this.token.mesh || this.token.mesh._destroyed) return;

        let renderX = this.x;
        let renderY = this.y;

        if (this.isRemote) {
            // --- SLAVE INTERPOLATION ---
            const now = game.time.serverTime;
            const renderTime = now - 100; // 100ms buffering logic

            while (this.networkBuffer.length > 2 && this.networkBuffer[1].t < renderTime) {
                this.networkBuffer.shift();
            }

            if (this.networkBuffer.length >= 2 && this.networkBuffer[0].t <= renderTime && this.networkBuffer[1].t >= renderTime) {
                const p0 = this.networkBuffer[0];
                const p1 = this.networkBuffer[1];
                const total = p1.t - p0.t;
                const elapsed = renderTime - p0.t;
                const alpha = elapsed / total;

                // RELATIVE SYNC LOGIC
                const ridingId = p1.riding || p0.riding;

                let targetX0 = p0.x;
                let targetY0 = p0.y;
                let targetX1 = p1.x;
                let targetY1 = p1.y;

                // Helper to get platform pos
                const getPlatformPos = (id) => {
                    if (!game.jumpnrun?.physics) return null;
                    const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
                    const item = levelData.find(i => i.id === id);
                    if (!item) return null;
                    const state = game.jumpnrun.physics.getGateState(item);
                    if (!state) return null;
                    // Current visual position of gate
                    return { x: item.x, y: item.y + state.offset };
                };

                if (ridingId) {
                    const platPos = getPlatformPos(ridingId);
                    if (platPos) {
                        if (p0.riding === ridingId && p0.relX !== undefined) {
                            targetX0 = platPos.x + p0.relX;
                            targetY0 = platPos.y + p0.relY;
                        }
                        if (p1.riding === ridingId && p1.relX !== undefined) {
                            targetX1 = platPos.x + p1.relX;
                            targetY1 = platPos.y + p1.relY;
                        }
                    }
                }

                renderX = targetX0 + (targetX1 - targetX0) * alpha;
                renderY = targetY0 + (targetY1 - targetY0) * alpha;
                this.facingRight = p1.facingRight;

                this.x = renderX;
                this.y = renderY;
            } else if (this.networkBuffer.length > 0) {
                const last = this.networkBuffer[this.networkBuffer.length - 1];
                renderX = last.x;
                renderY = last.y;
                if (last.facingRight !== undefined) this.facingRight = last.facingRight;
                this.x = renderX;
                this.y = renderY;
            }

        } else {
            // --- MASTER LERP ---
            if (this.prevX !== undefined && this.alpha !== undefined) {
                const alpha = this.alpha;
                renderX = this.prevX * (1 - alpha) + this.x * alpha;
                renderY = this.prevY * (1 - alpha) + this.y * alpha;
            }
        }

        // Apply to Token
        this.token.x = renderX;
        this.token.y = renderY;
        if (this.token.position) this.token.position.set(renderX, renderY);

        // Override Animation
        if (!this.token._jnrOriginalAnimate) {
            this.token._jnrOriginalAnimate = this.token.animateMovement;
            this.token.animateMovement = async function (...args) { return; };
        }
        if (this.token.stopAnimation) this.token.stopAnimation();

        // Ghosting Fix (Property Injection)
        if (this.token.document) {
            const descX = Object.getOwnPropertyDescriptor(this.token.document, 'x');
            if (!descX || descX.value !== undefined || descX.writable) {
                Object.defineProperty(this.token.document, 'x', {
                    get: () => this.x,
                    set: (val) => { },
                    configurable: true,
                    enumerable: true
                });
            }
            const descY = Object.getOwnPropertyDescriptor(this.token.document, 'y');
            if (!descY || descY.value !== undefined || descY.writable) {
                Object.defineProperty(this.token.document, 'y', {
                    get: () => this.y,
                    set: (val) => { },
                    configurable: true,
                    enumerable: true
                });
            }
        }

        // --- INTERNAL VISUAL CLONE ---
        if (this.token.mesh) {
            if (!this.visualClone) {
                this.visualClone = new PIXI.Sprite();
                this.visualClone.anchor.set(0.5);
                this.visualClone.eventMode = 'none';
                this.token.addChildAt(this.visualClone, 0);
            }

            if (this.visualClone.texture !== this.token.mesh.texture) {
                this.visualClone.texture = this.token.mesh.texture;
            }
            this.visualClone.width = this.token.mesh.width;
            this.visualClone.height = this.token.mesh.height;

            const scaleX = Math.abs(this.token.mesh.scale.x) * (this.facingRight ? 1 : -1);
            const scaleY = this.token.mesh.scale.y;

            this.visualClone.scale.set(scaleX, scaleY);
            if (!this._tempTint) {
                this.visualClone.tint = this.token.mesh.tint || 0xFFFFFF;
            }

            this.visualClone.alpha = 1;
            this.visualClone.position.set(this.token.w / 2, this.token.h / 2);

            this.token.mesh.alpha = 0;
            this.token.mesh.visible = true;
        }

        this._updateHeartDisplay();

        // CAMERA FOLLOW
        // CAMERA FOLLOW
        const cameraFollow = game.settings.get("geanos-jump-n-run-editor", "cameraFollow");
        if (this.token.controlled && cameraFollow && !this.manualPanActive) {
            // SMOOTH DAMPING (Lerp)
            // Instead of snapping hard (alpha 1.0), we drift towards the target (alpha 0.08)
            // This replicates the feel of smooth camera modules.

            const currentX = canvas.stage.pivot.x;
            const currentY = canvas.stage.pivot.y;
            const targetX = this.x;
            const targetY = this.y;

            // Simple Lerp
            const factor = 0.08;
            const newX = currentX + (targetX - currentX) * factor;
            const newY = currentY + (targetY - currentY) * factor;

            // Only pan if difference is noticeable (prevents micro-jitter)
            if (Math.abs(newX - currentX) > 0.5 || Math.abs(newY - currentY) > 0.5) {
                canvas.pan({ x: newX, y: newY });
            }
        }
    }

    _updateHeartDisplay() {
        if (!this.heartContainer) return;
        this.heartContainer.removeChildren();
        // if (this.isRemote) return; // Removed to allow seeing others' hearts

        const heartSize = 16;
        const spacing = 4;
        const totalWidth = (heartSize * this.maxHearts) + (spacing * (this.maxHearts - 1));
        const startX = (this.token.w - totalWidth) / 2;
        const yPos = -20;

        for (let i = 0; i < this.maxHearts; i++) {
            const heart = new PIXI.Graphics();
            if (i < this.hearts) {
                heart.beginFill(0xFF0000);
            } else {
                heart.beginFill(0x330000);
                heart.lineStyle(2, 0xFF0000);
            }
            heart.moveTo(0, heartSize / 4);
            heart.bezierCurveTo(0, 0, heartSize / 2, 0, heartSize / 2, heartSize / 4);
            heart.bezierCurveTo(heartSize / 2, 0, heartSize, 0, heartSize, heartSize / 4);
            heart.bezierCurveTo(heartSize, heartSize / 2, heartSize / 2, heartSize * 0.75, heartSize / 2, heartSize);
            heart.bezierCurveTo(heartSize / 2, heartSize * 0.75, 0, heartSize / 2, 0, heartSize / 4);
            heart.endFill();
            heart.x = startX + i * (heartSize + spacing);
            heart.y = yPos;
            this.heartContainer.addChild(heart);
        }
    }

    syncNetwork(immediate = false) {
        if (this.isRemote) return;

        // 1. VOLATILE SOCKET BROADCAST (30hz)
        const now = game.time.serverTime;
        if (now - this.lastBroadcastTime > 30) {
            // Updated to use this.network directly
            if (this.network) {

                let relX, relY, ridingId;
                if (this.riding) {
                    const levelData = canvas.scene.getFlag("geanos-jump-n-run-editor", "levelData") || [];
                    const plat = levelData.find(i => i.id === this.riding);
                    if (plat) {
                        const state = game.jumpnrun?.physics?.getGateState(plat);
                        const platY = plat.y + (state ? state.offset : 0);

                        ridingId = this.riding;
                        relX = this.x - plat.x;
                        relY = this.y - platY;
                    }
                }

                this.network.broadcastUpdate({
                    id: this.token.id,
                    x: this.x,
                    y: this.y,
                    vx: this.vx,
                    vy: this.vy,
                    facingRight: this.facingRight,
                    riding: ridingId, // Optional
                    relX: relX,       // Optional
                    relY: relY,       // Optional
                    relX: relX,       // Optional
                    relY: relY,       // Optional
                    hearts: this.hearts, // Added for Sync
                    pressingPlate: this.pressingPlate // Added for Plate Visual Sync
                });
            } else {
                console.warn("JNR Player: Network not available for broadcast!");
            }
            this.lastBroadcastTime = now;
        }

        // 2. DATABASE PERSISTENCE
        const isStopped = Math.abs(this.vx) < 0.1 && Math.abs(this.vy) < 0.1;
        const timeSinceSave = now - this.dbSaveTimer;

        let shouldSave = false;
        if (isStopped && timeSinceSave > 2000) shouldSave = true;
        if (timeSinceSave > 5000) shouldSave = true;

        if (shouldSave) {
            if (this.token.document) {
                this.dbSaveTimer = now;
                const dist = Math.abs(this.token.document.x - this.x) + Math.abs(this.token.document.y - this.y);
                if (dist > 1) {
                    this.token.document.update({ x: Math.round(this.x), y: Math.round(this.y) }, { animate: false });
                }
            }
        }
    }

    reevaluateAuthority() {
        if (!this.token || !this.token.actor) return;

        let isMaster = this.token.isOwner;

        // GM Deference: If I am GM, look for other active owners
        // We defer to ANY active owner who is not myself (if I am also an owner, which GM usually is)
        if (game.user.isGM && isMaster) {
            const otherActiveOwners = game.users.filter(u => !u.isGM && u.active && this.token.actor.testUserPermission(u, "OWNER"));

            if (otherActiveOwners.length > 0) {
                isMaster = false;
                // console.log(`Jump'n'Run: GM Yielded Authority for ${this.token.name} to ${otherActiveOwners[0].name}`);
            }
        }

        const wasRemote = this.isRemote;
        this.isRemote = !isMaster;

        // If switching Mode
        if (wasRemote !== this.isRemote) {
            if (this.isRemote) {
                // Became Slave
                this.vx = 0;
                this.vy = 0;
            } else {
                // Became Master
                this._setupInput();
            }
            // console.log(`Jump'n'Run: Authority Changed for ${this.token.name}. isMaster? ${!this.isRemote}`);
        }
    }

    destroy() {
        if (this.heartContainer) this.heartContainer.destroy({ children: true });
        if (this.visualClone) this.visualClone.destroy();

        if (this.token) {
            this.token.alpha = 1;
            this.token.visible = true;
            if (this.token._jnrOriginalAnimate) {
                this.token.animateMovement = this.token._jnrOriginalAnimate;
                delete this.token._jnrOriginalAnimate;
            }
            if (this.token._jnrOriginalRefresh) {
                this.token.refresh = this.token._jnrOriginalRefresh;
                delete this.token._jnrOriginalRefresh;
            }
            if (this.token.document) {
                delete this.token.document.x;
                delete this.token.document.y;
            }
        }

        if (this._onTokenUpdate) Hooks.off("updateToken", this._onTokenUpdate);
        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown, { capture: true });
        if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp, { capture: true });
        if (this._onMouseDown) window.removeEventListener('mousedown', this._onMouseDown);

        if (this.network) {
            this.network.unregisterController(this.token.id);
        }
    }
}
