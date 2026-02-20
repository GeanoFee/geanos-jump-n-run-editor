/**
 * Configuration and Settings
 */

export function registerSettings() {
    game.settings.register("geanos-jump-n-run-editor", "showHitboxesToPlayers", {
        name: "Show Hitboxes to Players",
        hint: "If enabled, players will see the colored rectangles for platforms and hazards. Disable this to seamlessly integrate with background art.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        onChange: () => {
            if (canvas.jumpnrun) canvas.jumpnrun.drawLevel();
        }
    });

    game.settings.register("geanos-jump-n-run-editor", "cameraFollow", {
        name: "Camera Follow",
        hint: "Automatically center the camera on your controlled token during movement.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("geanos-jump-n-run-editor", "debugMode", {
        name: "Debug Mode",
        hint: "Enable visual debugging for physics bodies.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
    });

    // --- HEALTH SYSTEM SETTINGS ---
    game.settings.register("geanos-jump-n-run-editor", "healthMode", {
        name: "Health Mode",
        hint: "Choose between retro hearts or syncing with the character sheet HP.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "retro": "Retro Hearts Life Bar",
            "sheet": "Character Sheet Life Bar"
        },
        default: "retro",
        onChange: () => {
            if (canvas.jumpnrun) {
                if (canvas.jumpnrun.player) {
                    canvas.jumpnrun.player.refreshHealthMetadata();
                    canvas.jumpnrun.player._updateHeartDisplay();
                }
                canvas.jumpnrun.drawLevel();
            }
        }
    });

    game.settings.register("geanos-jump-n-run-editor", "retroHearts", {
        name: "Retro Hearts Count",
        hint: "The starting number of hearts for tokens in Retro Hearts Life Bar mode.",
        scope: "world",
        config: true,
        type: Number,
        default: 3,
        onChange: () => {
            if (canvas.jumpnrun && canvas.jumpnrun.player) {
                canvas.jumpnrun.player.refreshHealthMetadata();
                canvas.jumpnrun.player._updateHeartDisplay();
            }
        }
    });

    game.settings.register("geanos-jump-n-run-editor", "healthPath", {
        name: "Character HP Path",
        hint: "The data path to the token's current HP (e.g. system.attributes.hp.value for dnd5e).",
        scope: "world",
        config: true,
        type: String,
        default: "system.attributes.hp.value"
    });

    game.settings.register("geanos-jump-n-run-editor", "maxHealthPath", {
        name: "Character Max HP Path",
        hint: "The data path to the token's max HP (e.g. system.attributes.hp.max for dnd5e).",
        scope: "world",
        config: true,
        type: String,
        default: "system.attributes.hp.max"
    });

    game.settings.register("geanos-jump-n-run-editor", "spikeDamage", {
        name: "Spike Damage",
        hint: "Amount of health lost when hitting a spike hazard.",
        scope: "world",
        config: true,
        type: Number,
        default: 1
    });

    game.settings.register("geanos-jump-n-run-editor", "fallDamage", {
        name: "Fall Damage",
        hint: "Amount of health lost when falling from a great height or out of bounds.",
        scope: "world",
        config: true,
        type: Number,
        default: 1
    });

    // --- JUMP SYSTEM SETTINGS ---
    game.settings.register("geanos-jump-n-run-editor", "jumpMode", {
        name: "Jump Mode",
        hint: "Choose between a fixed jump height or scaling based on a character attribute.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "fixed": "Generalized Jump Height",
            "attribute": "Character Sheet Jump Height"
        },
        default: "fixed",
        onChange: () => {
            if (canvas.jumpnrun && canvas.jumpnrun.player) {
                canvas.jumpnrun.player.refreshJumpMetadata();
            }
        }
    });

    game.settings.register("geanos-jump-n-run-editor", "maxJumpHeight", {
        name: "Max Jump Height",
        hint: "The maximum height a token can jump in grid units (e.g., 2.0).",
        scope: "world",
        config: true,
        type: Number,
        default: 1.25,
        onChange: () => {
            if (canvas.jumpnrun && canvas.jumpnrun.player) {
                canvas.jumpnrun.player.refreshJumpMetadata();
            }
        }
    });

    game.settings.register("geanos-jump-n-run-editor", "jumpPath", {
        name: "Jump Attribute Path",
        hint: "The data path to the attribute used for scaling (e.g., system.abilities.str.value).",
        scope: "world",
        config: true,
        type: String,
        default: "system.abilities.str.value",
        onChange: () => {
            if (canvas.jumpnrun && canvas.jumpnrun.player) {
                canvas.jumpnrun.player.refreshJumpMetadata();
            }
        }
    });

    game.settings.register("geanos-jump-n-run-editor", "maxAttributeValue", {
        name: "Max Attribute Value",
        hint: "The attribute value that corresponds to the Max Jump Height (e.g., 20).",
        scope: "world",
        config: true,
        type: Number,
        default: 20,
        onChange: () => {
            if (canvas.jumpnrun && canvas.jumpnrun.player) {
                canvas.jumpnrun.player.refreshJumpMetadata();
            }
        }
    });
}

export class JumpNRunSceneConfig {
    static init() {
        Hooks.on("renderSceneConfig", this._onRenderSceneConfig.bind(this));
    }

    /**
     * @param {SceneConfig} app 
     * @param {JQuery} html 
     * @param {object} data 
     */
    static _onRenderSceneConfig(app, html, data) {
        const flags = app.object.flags["geanos-jump-n-run-editor"] || {};
        const enabled = flags.enable || false;

        // Locate the "Grid" tab to insert our settings after, or just at the end of the form
        // We'll create a new tab for "Jump'n'Run"

        // 1. Add the tab navigation item
        const tabNav = html.find('nav.sheet-tabs.tabs');
        tabNav.append('<a class="item" data-tab="jumpnrun"><i class="fas fa-running"></i> Jump\'n\'Run</a>');

        // 2. Add the tab content
        const content = `
        <div class="tab" data-tab="jumpnrun">
            <div class="form-group">
                <label>Enable Jump'n'Run Mode</label>
                <div class="form-fields">
                    <input type="checkbox" name="flags.geanos-jump-n-run-editor.enable" ${enabled ? "checked" : ""}>
                </div>
                <p class="notes">Turn this scene into a platformer level.</p>
            </div>
            <div class="form-group">
                <label>Gravity Force</label>
                <div class="form-fields">
                    <input type="number" name="flags.geanos-jump-n-run-editor.gravity" step="0.1" value="${flags.gravity || 1.0}">
                </div>
            </div>
            <div class="form-group">
                <label>Movement Speed</label>
                <div class="form-fields">
                    <input type="number" name="flags.geanos-jump-n-run-editor.moveSpeed" step="1" value="${flags.moveSpeed || 5}">
                </div>
            </div>
            <hr>
            <div class="form-group">
                <label>Background Texture (Tiled)</label>
                <div class="form-fields">
                    <div style="display:flex; flex:1; gap: 5px;">
                        <input type="text" name="flags.geanos-jump-n-run-editor.bgTexture" value="${flags.bgTexture || ""}">
                        <button type="button" class="file-picker" data-type="image" data-target="flags.geanos-jump-n-run-editor.bgTexture" title="Browse Files" style="flex:0 0 40px"><i class="fas fa-file-import fa-fw"></i></button>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label>Parallax Factor (0 = Static, 1 = Move with World)</label>
                <div class="form-fields">
                    <input type="number" name="flags.geanos-jump-n-run-editor.bgParallaxFactor" step="0.05" min="0" max="1.0" value="${flags.bgParallaxFactor !== undefined ? flags.bgParallaxFactor : 0.2}">
                </div>
                <p class="notes">How strongly the background moves with the camera.</p>
            </div>
            <div class="form-group">
                <label>Background Opacity</label>
                <div class="form-fields">
                    <input type="range" name="flags.geanos-jump-n-run-editor.bgOpacity" min="0" max="1" step="0.05" value="${flags.bgOpacity !== undefined ? flags.bgOpacity : 1.0}">
                    <span class="range-value">${flags.bgOpacity !== undefined ? flags.bgOpacity : 1.0}</span>
                </div>
            </div>
        </div>`;

        // Insert after the last tab content
        html.find('footer.sheet-footer').before(content);

        // Range slider value update listener
        html.find('input[type="range"]').on('input', event => {
            $(event.currentTarget).next('.range-value').text(event.currentTarget.value);
        });

        // Bind File Picker (since we injected it dynamically)
        if (typeof FilePicker !== "undefined") {
            html.find('button.file-picker[data-target^="flags.geanos-jump-n-run-editor"]').click(ev => {
                const btn = ev.currentTarget;
                const target = btn.dataset.target;
                const current = html.find(`[name="${target}"]`).val();
                new FilePicker({
                    type: "image",
                    current: current,
                    callback: path => html.find(`[name="${target}"]`).val(path)
                }).browse();
            });
        }

        // Activate tabs logic is handled by Foundry usually, but if we inject late we might need to notify or just let it be.
        // Usually modifying the HTML in render hook works fine for tabs if standard classes are used.
    }
}
