import { registerSettings, JumpNRunSceneConfig } from './config.js';
import { JumpNRunLayer } from './layer.js';
import { PhysicsEngine } from './physics.js';
import { PlatformerPlayer } from './player.js';
import { NetworkCoordinator } from './network.js';
import { ParallaxHandler } from './parallax.js';
import { registerMattIntegration } from './integration/matt.js';

let physics = new PhysicsEngine();
let playerControllers = new Map();
let gameRunning = false;
let network = new NetworkCoordinator();
let parallax = new ParallaxHandler();

Hooks.once('init', () => {
    console.log('Foundry Jump\'n\'Run | Initializing module');
    registerSettings();
    JumpNRunSceneConfig.init();

    CONFIG.Canvas.layers.jumpnrun = {
        layerClass: JumpNRunLayer,
        group: "interface"
    };
});

Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls.push({
        name: "jumpnrun",
        title: "Jump'n'Run Tools",
        icon: "fas fa-running",
        layer: "jumpnrun",
        tools: [
            { name: "select", title: "Select Elements", icon: "fas fa-mouse-pointer" },
            { name: "platform", title: "Draw Platform", icon: "fas fa-square" },
            { name: "spike", title: "Draw Spikes", icon: "fas fa-skull" },
            { name: "start", title: "Draw Start Point (Blue)", icon: "fas fa-flag-checkered" },
            { name: "checkpoint", title: "Draw Checkpoint (Yellow)", icon: "fas fa-flag" },
            { name: "ladder", title: "Draw Ladder (Orange)", icon: "fas fa-bars" },
            { name: "plate", title: "Draw Pressure Plate (Gray)", icon: "fas fa-minus-square" },
            { name: "gate", title: "Draw Gate/Door (Iron)", icon: "fas fa-dungeon" },
            { name: "crumble", title: "Draw Crumbling Floor (Brown)", icon: "fas fa-cube" },
            { name: "portal", title: "Draw Portal (Purple)", icon: "fas fa-dungeon" },
            { name: "potion", title: "Draw Healing Potion (Pink)", icon: "fas fa-flask" },
            {
                name: "clear",
                title: "Clear Level",
                icon: "fas fa-trash",
                onClick: () => {
                    Dialog.confirm({
                        title: "Clear Level",
                        content: "Are you sure?",
                        yes: () => canvas.scene.unsetFlag("foundry-jump-n-run", "levelData")
                    });
                },
                button: true
            }
        ]
    });
});

Hooks.once('ready', () => {
    console.log('Foundry Jump\'n\'Run | Ready');

    // Initialize Network Coordinator
    try {
        network.init();
    } catch (e) {
        console.error("Jump'n'Run: Network Init Failed", e);
        ui.notifications.error("Jump'n'Run: Network Failed!");
    }



    game.jumpnrun = {
        controllers: playerControllers,
        physics: physics,
        network: network
    };

    registerMattIntegration();


});

Hooks.on("canvasReady", (canvas) => {
    // Consolidated Canvas Ready Hook

    // Safety Cleanup first
    playerControllers.forEach(c => c.destroy());
    playerControllers.clear();

    const layer = canvas.jumpnrun;
    if (!layer) {
        console.error("Jump'n'Run: Layer MISSING from Canvas!");
        return;
    }

    layer.network = network; // Attach Network Coordinator

    const isJnr = canvas.scene?.getFlag("foundry-jump-n-run", "enable");

    if (isJnr) {
        console.log("Jump'n'Run: Activating on Scene");
        gameRunning = true;
        layer.drawLevel();
        parallax.refresh();

        if (canvas.tokens) {
            canvas.tokens.placeables.forEach(t => ensureController(t));
        }
    } else {
        // Ensure module is dormant
        gameRunning = false;
        // Optionally clear the layer if it had remnants (shouldn't if new scene)
        if (layer.children.length > 0) layer.removeChildren();
        if (parallax.container && parallax.container.visible) parallax.container.visible = false;
    }
});

Hooks.on("canvasTearDown", () => {
    playerControllers.forEach(c => c.destroy());
    playerControllers.clear();
    gameRunning = false;
    parallax.destroy();
});

Hooks.on("updateTile", async (tileDoc, change, options, userId) => {
    if (!canvas.ready || !game.user.isGM) return;
    // Only run if module is active on this scene to save perf
    if (!gameRunning) return;

    if (!("x" in change) && !("y" in change) && !("width" in change) && !("height" in change)) return;

    const levelData = canvas.scene.getFlag("foundry-jump-n-run", "levelData") || [];
    const linkedItem = levelData.find(i => i.linkedTileId === tileDoc.id);

    if (linkedItem) {
        const newData = levelData.map(i => {
            if (i.id === linkedItem.id) {
                return {
                    ...i,
                    x: change.x ?? i.x,
                    y: change.y ?? i.y,
                    width: change.width ?? i.width,
                    height: change.height ?? i.height
                };
            }
            return i;
        });

        await canvas.scene.setFlag("foundry-jump-n-run", "levelData", newData);
        if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
        ui.notifications.info("Jump'n'Run Hitbox synced with Tile");
    }
});

Hooks.on("updateScene", (scene, change, options, userId) => {
    if (scene.id !== canvas.scene?.id) return;

    // Check if Jump'n'Run flags changed
    if (change.flags && change.flags["foundry-jump-n-run"]) {
        const flags = change.flags["foundry-jump-n-run"];

        // Use loose check for enablement flip or general flag updates
        const isJnr = canvas.scene.getFlag("foundry-jump-n-run", "enable");

        if (flags.enable !== undefined) {
            // State Changed
            if (isJnr) {
                // Enabled just now
                gameRunning = true;
                if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
                parallax.refresh();
                if (canvas.tokens) canvas.tokens.placeables.forEach(t => ensureController(t));
            } else {
                // Disabled just now
                gameRunning = false;
                playerControllers.forEach(c => c.destroy());
                playerControllers.clear();
                parallax.destroy();
                if (canvas.jumpnrun) canvas.jumpnrun.removeChildren();
            }
            return;
        }

        // If not enabling/disabling, only update if enabled
        if (isJnr && gameRunning) {
            if (flags.levelData || flags.showHitboxesToPlayers !== undefined) {
                if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
            }
            // Optimization: Only refresh parallax if related flags changed
            if (flags.bgTexture !== undefined || flags.bgParallaxFactor !== undefined || flags.bgOpacity !== undefined) {
                parallax.refresh();
            }
        }
    }
});

Hooks.on("userConnected", (user, connected) => {
    if (!game.user.isGM) return;
    if (!gameRunning) return; // Ignore if not J'n'R scene

    // Debounce slightly to ensure 'active' status is propagated
    setTimeout(() => {
        playerControllers.forEach(controller => {
            controller.reevaluateAuthority();
        });
    }, 500);
});

Hooks.on("createToken", (tokenDoc, options, userId) => {
    if (!gameRunning) return;
    if (tokenDoc.parent.id !== canvas.scene?.id) return;

    if (!tokenDoc.object) {
        setTimeout(() => {
            if (canvas.tokens.get(tokenDoc.id)) ensureController(canvas.tokens.get(tokenDoc.id));
        }, 100);
        return;
    }
    ensureController(tokenDoc.object);
});

Hooks.on("deleteToken", (tokenDoc) => {
    if (playerControllers.has(tokenDoc.id)) {
        playerControllers.get(tokenDoc.id).destroy();
        playerControllers.delete(tokenDoc.id);
    }
});


// --------------------------------------------------------------------------
// GAME LOOP
// --------------------------------------------------------------------------

PIXI.Ticker.shared.add((dt) => {
    try {
        if (!gameRunning) return;
        if (!canvas.ready) return;

        const levelData = canvas.scene.getFlag("foundry-jump-n-run", "levelData") || [];

        physics.updateGlobal(dt, levelData);
        if (canvas.jumpnrun) canvas.jumpnrun.updateVisuals(physics.gateStates);

        parallax.update();

        for (const [id, controller] of playerControllers) {
            if (!controller.token || !controller.token.actor) {
                playerControllers.delete(id);
                continue;
            }

            controller.handleInput();
            if (!controller.isRemote) {
                physics.updatePlayer(controller, dt, levelData);
            }

            controller.updateVisuals();

            if (!controller.isRemote) {
                if (controller.onLadder !== controller._lastOnLadder) {
                    controller._lastOnLadder = controller.onLadder;
                    controller.syncNetwork(true);
                } else {
                    controller.syncNetwork(false);
                }
            }
        }

    } catch (e) {
        console.error("Jump'n'Run GameLoop Error:", e);
        gameRunning = false;
        ui.notifications.error("Jump'n'Run Error: " + e.message);
        playerControllers.forEach(c => c.destroy());
        playerControllers.clear();
    }
});


// --------------------------------------------------------------------------
// UTILS
// --------------------------------------------------------------------------

function ensureController(token) {
    if (!token.actor) return;
    const isJnr = canvas.scene.getFlag("foundry-jump-n-run", "enable");
    if (!isJnr) return;

    if (playerControllers.has(token.id)) return;

    try {
        const pc = new PlatformerPlayer(token, network);

        const gravity = canvas.scene.getFlag("foundry-jump-n-run", "gravity");
        const speed = canvas.scene.getFlag("foundry-jump-n-run", "moveSpeed");
        if (gravity) physics.gravity = parseFloat(gravity);
        if (speed) pc.moveSpeed = parseFloat(speed);

        playerControllers.set(token.id, pc);
        gameRunning = true;
    } catch (err) {
        console.error("Jump'n'Run: Failed to create controller", err);
    }
}
