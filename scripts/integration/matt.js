export function registerMattIntegration() {
    if (game.ready) {
        initMatt();
    } else {
        Hooks.once('ready', initMatt);
    }
}

function initMatt() {
    const mattModule = game.modules.get('monks-active-tiles');
    if (!mattModule?.active) return;

    // API Reference: game.MonksActiveTiles (Class with static methods)
    const MATT = game.MonksActiveTiles;
    if (!MATT) return;

    console.log("Jump'n'Run | Registering MATT Integration...");

    // --- TRIGGERS ---
    // MATT.triggerModes is a static getter returning a hardcoded object.
    // We must monkey-patch it to inject our triggers into the "When" dropdown.

    const triggers = {
        "onPlayerDeath": "Jump'n'Run: Player Death",
        "onHealthChange": "Jump'n'Run: Health Change",
        "onPortalUse": "Jump'n'Run: Portal Use",
        "onCheckpointReached": "Jump'n'Run: Checkpoint Reached",
        "onItemCollect": "Jump'n'Run: Item Collected",
        "onWallJump": "Jump'n'Run: Wall Jump"
    };

    const descriptor = Object.getOwnPropertyDescriptor(MATT, "triggerModes");
    if (descriptor && descriptor.get) {
        const originalGet = descriptor.get;
        Object.defineProperty(MATT, "triggerModes", {
            get: function () {
                const modes = originalGet.call(this);
                Object.assign(modes, triggers);
                return modes;
            },
            configurable: true
        });
    }

    // --- ACTIONS ---
    // Register the Module Namespace as a Group so Actions can belong to it
    MATT.registerTileGroup("geanos-jump-n-run-editor", "Jump'n'Run");

    MATT.registerTileAction("geanos-jump-n-run-editor", "reset_hearts", {
        name: "Reset Hearts",
        category: "JumpNRun",
        icon: "fas fa-heart",
        fn: async (context) => {
            const tokens = context.tokens || [];
            const token = tokens[0]; // operate on the first token (usually the triggering one)

            if (!token) return;

            // MATT passes TokenDocuments potentially, or Placeables.
            const tokenId = token.id || token.document?.id;

            const controller = game.jumpnrun?.controllers?.get(tokenId);

            if (controller) {
                controller.hearts = controller.maxHearts;
                controller.updateVisuals();
                ui.notifications.info("Hearts Reset!");
            }
        }
    });

    MATT.registerTileAction("geanos-jump-n-run-editor", "modify_hearts", {
        name: "Modify Hearts",
        category: "JumpNRun",
        icon: "fas fa-heart-broken",
        settings: [
            {
                id: "amount",
                name: "Amount",
                type: "number",
                default: -1,
                hint: "Positive to heal, negative to damage."
            }
        ],
        fn: async (context) => {
            const tokens = context.tokens || [];
            const token = tokens[0];
            if (!token) return;

            const tokenId = token.id || token.document?.id;
            const controller = game.jumpnrun?.controllers?.get(tokenId);

            // context.action.data contains the settings values
            const amount = context.action?.data?.amount || -1;

            if (controller) {
                if (amount < 0) controller.takeDamage(Math.abs(amount));
                else controller.heal(amount);
            }
        }
    });

    MATT.registerTileAction("geanos-jump-n-run-editor", "toggle_gravity", {
        name: "Toggle Gravity",
        category: "Jump'n'Run",
        icon: "fas fa-globe",
        limit: "scene",
        fn: async (context) => {
            const current = canvas.scene.getFlag("geanos-jump-n-run-editor", "gravity") || "1.0";
            const newVal = (parseFloat(current) === 0) ? "1.0" : "0.0";
            await canvas.scene.setFlag("geanos-jump-n-run-editor", "gravity", newVal);
        }
    });

    // --- HOOK LISTENER ---
    // Listen for our own internal hooks and forward them to MATT
    // 'jnr-trigger' event is called from player.js/physics.js
    Hooks.on('jnr-trigger', (eventName, token, data) => {
        if (!token) return;

        const tiles = canvas.tiles.placeables;

        for (const tile of tiles) {
            const mattData = tile.document.flags["monks-active-tiles"];
            if (!mattData || !mattData.active) continue;

            // Check if the tile is configured to trigger on our event
            // loosen check: MATT might store it as ",onWallJump"
            if (mattData.trigger && mattData.trigger.includes(eventName)) {

                // Invoke MATT's trigger method on the tile
                // MATT monkey-patches the TileDocument (not the Placeable)
                const target = tile.document || tile;

                if (typeof target.trigger === 'function') {
                    // Pass Token Document explicitly
                    const tokenDoc = token.document || token;

                    target.trigger({
                        tokens: [tokenDoc],
                        method: eventName,
                        ...data
                    });
                }
            }
        }
    });
}
