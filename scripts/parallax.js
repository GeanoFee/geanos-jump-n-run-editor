/**
 * Handles the Parallax Background logic
 */
export class ParallaxHandler {
    constructor() {
        this.container = new PIXI.Container();
        this.container.zIndex = -9999;
        this.container.visible = false; // Hidden until loaded

        this.sprite = null;
        this.texturePath = null;
        this.parallaxFactor = 0.2;
        this.opacity = 1.0;
    }

    /**
     * Called when scene updates or initializes
     */
    async refresh() {
        // console.log("Jump'n'Run | Parallax Refresh Called");
        const jnrFlags = canvas.scene.flags["geanos-jump-n-run-editor"] || {};

        const newTexture = jnrFlags.bgTexture;
        const newFactor = jnrFlags.bgParallaxFactor !== undefined ? parseFloat(jnrFlags.bgParallaxFactor) : 0.2;
        const newOpacity = jnrFlags.bgOpacity !== undefined ? parseFloat(jnrFlags.bgOpacity) : 1.0;

        this.parallaxFactor = newFactor;
        this.opacity = newOpacity;
        this.container.alpha = this.opacity;

        // Texture Change?
        if (newTexture !== this.texturePath) {
            console.log("Jump'n'Run | Loading Parallax Texture:", newTexture);
            this.texturePath = newTexture;

            // Remove old
            if (this.sprite) {
                this.sprite.destroy();
                this.sprite = null;
            }

            if (newTexture) {
                try {
                    const texture = await loadTexture(newTexture);
                    if (texture) {
                        this.sprite = new PIXI.TilingSprite(texture, canvas.dimensions.width, canvas.dimensions.height);
                        this.container.addChild(this.sprite);
                        this.container.visible = true;
                        console.log("Jump'n'Run | Parallax Texture Loaded & Sprite Created");
                    }
                } catch (e) {
                    console.error("Jump'n'Run | Failed to load texture:", e);
                }
            } else {
                this.container.visible = false;
            }
        }

        // PARENTING STRATEGY:
        // Try canvas.background (v10/v11). If not, canvas.stage (v9/Universal).
        // If destroyed, recreate? No, constructor made it. If destroyed, we are in trouble.
        // Let's ensure we aren't using a destroyed container.
        if (this.container.destroyed) {
            this.container = new PIXI.Container();
            this.container.zIndex = -9999;
            if (this.sprite) {
                this.container.addChild(this.sprite);
            }
        }

        // PARENTING STRATEGY:
        // 1. canvas.primary.parent (The container holding the main BG image) - BEST
        // 2. Search canvas.layers

        let parentTarget = null;
        if (canvas.primary && canvas.primary.parent) {
            parentTarget = canvas.primary.parent;
        } else if (canvas.background) {
            parentTarget = canvas.background;
        } else if (canvas.layers) {
            parentTarget = canvas.layers.find(l =>
                (l.options && l.options.name === "background") ||
                (l.constructor && l.constructor.name === "BackgroundLayer")
            );
        }

        if (parentTarget) {
            if (this.container.parent !== parentTarget) {
                console.log(`Jump'n'Run | Attaching Parallax to ${parentTarget.constructor.name} (z:4000)`);

                parentTarget.addChild(this.container);

                // Ensure sorting
                if (parentTarget.sortableChildren !== undefined) {
                    parentTarget.sortableChildren = true;
                }

                // Z-INDEX
                // We use a high zIndex to ensure we are ABOVE the standard background color/image
                // but since we are inside the BackgroundLayer (Index 0 of Stage), we stay BELOW Tiles/Tokens.
                this.container.zIndex = 4000;

                if (typeof parentTarget.sortChildren === "function") parentTarget.sortChildren();
            }
        } else {
            if (!this._warnedMissingLayer) {
                console.error("Jump'n'Run | CRITICAL: Could not find Background Layer via canvas.primary or canvas.layers");
                this._warnedMissingLayer = true;
            }
        }
    }

    /**
     * Update loop (Ticker)
     */
    update() {
        if (!canvas.ready) return;
        if (!this.sprite || !this.container || this.container.destroyed) return;

        // Retry attachment if orphaned
        if (!this.container.parent && this.container.visible) {
            this.refresh();
            return;
        }

        if (!this.container.visible) return;

        // WAR: Enforce Z-Index
        if (this.container.zIndex !== 4000) this.container.zIndex = 4000;

        // 1. Keep Container Pinned to Screen (Camera)
        const pivot = canvas.stage.pivot;
        const screen = canvas.app.screen;
        const scale = canvas.stage.scale.x;

        const worldScreenWidth = screen.width / scale;
        const worldScreenHeight = screen.height / scale;

        const left = pivot.x - (worldScreenWidth / 2);
        const top = pivot.y - (worldScreenHeight / 2);

        this.container.position.set(left, top);

        // 2. Resize Sprite to Match Screen
        this.sprite.width = worldScreenWidth;
        this.sprite.height = worldScreenHeight;

        // 4. Parallax Shift
        this.sprite.tilePosition.x = -pivot.x * this.parallaxFactor;
        this.sprite.tilePosition.y = -pivot.y * this.parallaxFactor;
    }

    destroy() {
        if (this.container && !this.container.destroyed) {
            if (this.container.parent) {
                this.container.parent.removeChild(this.container);
            }
            this.container.destroy({ children: true });
        }
        this.sprite = null;
        this.texturePath = null;
    }
}
