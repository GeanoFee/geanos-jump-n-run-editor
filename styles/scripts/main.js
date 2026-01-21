import { registerSettings, JumpNRunSceneConfig } from './config.js';
import { JumpNRunLayer } from './layer.js';
import { PhysicsEngine } from './physics.js';
import { PlatformerPlayer } from './player.js';
import { NetworkCoordinator } from './network.js';
import { ParallaxHandler } from './parallax.js';

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

    // console.log("Jump'n'Run: Game Loop Registered");

    // Network Init is safest in 'ready', so we don't do it here anymore.
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

Hooks.on("canvasReady", (canvas) => {
    const layer = canvas.jumpnrun;
    if (layer) {
        layer.drawLevel();
        console.log("Jump'n'Run: Layer Active & Ready");
        parallax.refresh();
    } else {
        console.error("Jump'n'Run: Layer MISSING from Canvas!");
    }
});

Hooks.once('ready', () => {
    console.log('Foundry Jump\'n\'Run | Ready');
    // ui.notifications.info("Jump'n'Run: Ready! (SocketLib Mode)");

    // Initialize Network Coordinator
    try {
        network.init();
        if (!game.user.isGM) {
            // console.log("Jump'n'Run | Player Client Connected");
        }
    } catch (e) {
        console.error("Jump'n'Run: Network Init Failed", e);
        ui.notifications.error("Jump'n'Run: Network Failed!");
    }

    if (game.user.isGM) {
        window.addEventListener("keydown", (e) => {
            if (e.key === "F5") {
                game.socket.emit("module.foundry-jump-n-run", { op: "reload" });
                console.log("Jump'n'Run | Triggering Group Reload...");
            }
        });
    }

    game.jumpnrun = {
        controllers: playerControllers,
        physics: physics,
        network: network
    };

    registerMattIntegration();

    // LOCKVIEW COMPATIBILITY PATCH
    // LockView crashes if 'userSettingsOverrides' is empty/default (bug in LockView).
    // We proactively fix this setting to ensure the module works.
    if (game.modules.get("LockView")?.active) {
        const overrides = game.settings.get("LockView", "userSettingsOverrides");
        if (!Array.isArray(overrides) || overrides.length < 5 || !overrides[4]) {
            console.log("Jump'n'Run | Applying LockView Compatibility Patch (Fixing corrupted settings)...");
            const newOverrides = [
                { role: 0, enable: false, viewbox: false, control: false },
                { role: 1, enable: false, viewbox: false, control: false },
                { role: 2, enable: false, viewbox: false, control: false },
                { role: 3, enable: false, viewbox: false, control: false },
                { role: 4, enable: false, viewbox: false, control: true } // GM
            ];
            game.settings.set("LockView", "userSettingsOverrides", newOverrides);
        }
    }
});

Hooks.on("updateTile", async (tileDoc, change, options, userId) => {
    if (!canvas.ready || !game.user.isGM) return;
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
    if (change.flags && change.flags["foundry-jump-n-run"]) {
        if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
        parallax.refresh();
    }
});

Hooks.on("canvasTearDown", () => {
    playerControllers.forEach(c => c.destroy());
    playerControllers.clear();
    gameRunning = false;
    parallax.destroy();
});

let lastOnLadder = false;

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

Hooks.on("createToken", (tokenDoc, options, userId) => {
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

Hooks.on("canvasReady", (canvas) => {
    const layer = canvas.jumpnrun;
    if (layer) layer.drawLevel();
    playerControllers.forEach(c => c.destroy());
    playerControllers.clear();
    const isJnr = canvas.scene.getFlag("foundry-jump-n-run", "enable");
    if (isJnr) {
        gameRunning = true;
        if (canvas.tokens) {
            canvas.tokens.placeables.forEach(t => ensureController(t));
        }
    } else {
        gameRunning = false;
    }
});

Hooks.on("controlToken", (token, controlled) => { });

Hooks.on("userConnected", (user, connected) => {
    if (!game.user.isGM) return;
    // Debounce slightly to ensure 'active' status is propagated
    setTimeout(() => {
        // console.log(`Jump'n'Run: User ${user.name} ${connected ? "Connected" : "Disconnected"}. Re-evaluating Authority...`);
        playerControllers.forEach(controller => {
            controller.reevaluateAuthority();
        });
    }, 500);
});

import { registerMattIntegration } from './integration/matt.js';

Hooks.on("updateScene", (scene, change, options, userId) => {
    if (scene.id !== canvas.scene?.id) return;
    if (change.flags && change.flags["foundry-jump-n-run"]) {
        const flags = change.flags["foundry-jump-n-run"];
        // Only redraw if structural data changes. State data (gates/crumbles) is handled by the ticker.
        if (flags.levelData || flags.enable !== undefined || flags.showHitboxesToPlayers !== undefined) {
            if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
        }
    }
});
