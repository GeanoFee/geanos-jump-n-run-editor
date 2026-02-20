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
        const doc = app.document || app.object;
        const flags = doc.getFlag("geanos-jump-n-run-editor", "") || {};
        const enabled = flags.enable || false;

        // V13+ Compatibility: html might be an HTMLElement, not jQuery
        const element = (html instanceof HTMLElement) ? html : html[0];

        // STRATEGY CHANGE: Injecting into a custom tab proved unreliable due to V13 Sheet Controllers.
        // Moving settings to the bottom of the "Grid" tab for reliable access.

        const gridTab = element.querySelector('.tab[data-tab="grid"]');
        if (!gridTab) {
            console.warn("Jump'n'Run | Could not find Grid tab to inject settings.");
            return;
        }

        const contentStr = `
        <fieldset class="jump-n-run-settings">
            <legend><i class="fas fa-running"></i> Jump'n'Run Configuration</legend>
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
        </fieldset>`;

        // Inject content
        const div = document.createElement("div");
        div.innerHTML = contentStr;
        const settingsBlock = div.firstElementChild;
        gridTab.appendChild(settingsBlock);

        // Re-bind listeners on the new content
        const rangeInput = settingsBlock.querySelector('input[type="range"]');
        if (rangeInput) {
            rangeInput.addEventListener('input', (event) => {
                const span = event.target.nextElementSibling;
                if (span && span.classList.contains('range-value')) span.textContent = event.target.value;
            });
        }

        // Bind File Picker
        if (typeof foundry.applications.apps.FilePicker !== "undefined") {
            const pickers = settingsBlock.querySelectorAll('button.file-picker[data-target^="flags.geanos-jump-n-run-editor"]');
            pickers.forEach(btn => {
                btn.addEventListener('click', ev => {
                    const target = btn.dataset.target;
                    const input = settingsBlock.querySelector(`[name="${target}"]`);
                    const current = input ? input.value : "";
                    new foundry.applications.apps.FilePicker({
                        type: "image",
                        current: current,
                        callback: path => { if (input) input.value = path; }
                    }).browse();
                });
            });
        }
    }
}
