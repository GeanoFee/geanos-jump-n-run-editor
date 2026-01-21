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
        const jnrFlags = canvas.scene.flags["foundry-jump-n-run"] || {};

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
        // We return to canvas.background (Layer 0).
        // To avoid being hidden by the opaque background color, we set a positive zIndex.
        // To avoid covering tokens (Layer 100+), we are safe because we are in the Background Layer.

        const parentTarget = canvas.background || canvas.stage;

        if (parentTarget && this.container.parent !== parentTarget) {
            parentTarget.addChild(this.container);
            if (parentTarget.sortableChildren !== undefined) parentTarget.sortableChildren = true;
            this.container.zIndex = 100; // Above Backgound Color (0), inside Background Layer (Behind Tokens)
        }
    }

    /**
     * Update loop (Ticker)
     */
    update() {
        if (!canvas.ready) return; // Prevent crash during scene switch
        if (!this.sprite || !this.container || this.container.destroyed) return;
        if (!this.container.visible) return;

        // 1. Keep Container Pinned to Screen (Camera)
        // Camera Center (Pivot)
        const pivot = canvas.stage.pivot;
        const screen = canvas.app.screen;

        // World Coordinates of Top-Left Corner of Screen
        // Note: canvas.stage.scale.x handles zoom level.
        const scale = canvas.stage.scale.x;

        const worldScreenWidth = screen.width / scale;
        const worldScreenHeight = screen.height / scale;

        const left = pivot.x - (worldScreenWidth / 2);
        const top = pivot.y - (worldScreenHeight / 2);

        this.container.position.set(left, top);

        // 2. Resize Sprite to Match Screen (in World Units)
        this.sprite.width = worldScreenWidth;
        this.sprite.height = worldScreenHeight;

        // 3. Scale? canvas.background is scaled by stage. So 1.0 is correct.

        // 4. Parallax Shift
        // We shift the texture coordinate based on World Position (Pivot).
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
