/**
 * Configuration and Settings
 */

export function registerSettings() {
    game.settings.register("foundry-jump-n-run", "showHitboxesToPlayers", {
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

    game.settings.register("foundry-jump-n-run", "cameraFollow", {
        name: "Camera Follow",
        hint: "Automatically center the camera on your controlled token during movement.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register("foundry-jump-n-run", "debugMode", {
        name: "Debug Mode",
        hint: "Enable visual debugging for physics bodies.",
        scope: "client",
        config: true,
        type: Boolean,
        default: false
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
        const flags = app.object.flags["foundry-jump-n-run"] || {};
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
                    <input type="checkbox" name="flags.foundry-jump-n-run.enable" ${enabled ? "checked" : ""}>
                </div>
                <p class="notes">Turn this scene into a platformer level.</p>
            </div>
            <div class="form-group">
                <label>Gravity Force</label>
                <div class="form-fields">
                    <input type="number" name="flags.foundry-jump-n-run.gravity" step="0.1" value="${flags.gravity || 1.0}">
                </div>
            </div>
            <div class="form-group">
                <label>Movement Speed</label>
                <div class="form-fields">
                    <input type="number" name="flags.foundry-jump-n-run.moveSpeed" step="1" value="${flags.moveSpeed || 5}">
                </div>
            </div>
            <hr>
            <div class="form-group">
                <label>Background Texture (Tiled)</label>
                <div class="form-fields">
                    <div style="display:flex; flex:1; gap: 5px;">
                        <input type="text" name="flags.foundry-jump-n-run.bgTexture" value="${flags.bgTexture || ""}">
                        <button type="button" class="file-picker" data-type="image" data-target="flags.foundry-jump-n-run.bgTexture" title="Browse Files" style="flex:0 0 40px"><i class="fas fa-file-import fa-fw"></i></button>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label>Parallax Factor (0 = Static, 1 = Move with World)</label>
                <div class="form-fields">
                    <input type="number" name="flags.foundry-jump-n-run.bgParallaxFactor" step="0.05" min="0" max="1.0" value="${flags.bgParallaxFactor !== undefined ? flags.bgParallaxFactor : 0.2}">
                </div>
                <p class="notes">How strongly the background moves with the camera.</p>
            </div>
            <div class="form-group">
                <label>Background Opacity</label>
                <div class="form-fields">
                    <input type="range" name="flags.foundry-jump-n-run.bgOpacity" min="0" max="1" step="0.05" value="${flags.bgOpacity !== undefined ? flags.bgOpacity : 1.0}">
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
            html.find('button.file-picker[data-target^="flags.foundry-jump-n-run"]').click(ev => {
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
