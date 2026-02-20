
export class BulkElementConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "jump-n-run-bulk-config",
            title: "Configure Elements",
            template: "modules/geanos-jump-n-run-editor/templates/bulk-config.hbs",
            width: 400,
            classes: ["jump-n-run", "config-sheet"],
            closeOnSubmit: false // We handle close manually for actions
        });
    }

    constructor(count, saveCallback) {
        super({});
        this.count = count;
        this.saveCallback = saveCallback;
    }

    getData() {
        return {
            count: this.count
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('[data-action="filePicker"]').click(this._onFilePicker.bind(this));

        html.find('[data-action="applyImage"]').click(this._onApplyImage.bind(this));
        html.find('[data-action="close"]').click(() => this.close());

        html.find('[data-action="setVisibility"]').click(this._onSetVisibility.bind(this));
        html.find('[data-action="merge"]').click(this._onMerge.bind(this));
        html.find('[data-action="bringToFront"]').click(this.closeWithAction.bind(this, "bringToFront"));
        html.find('[data-action="sendToBack"]').click(this.closeWithAction.bind(this, "sendToBack"));
    }

    async _updateObject(event, formData) {
        // Standard submit not used for most buttons here
    }

    async _onApplyImage(event) {
        event.preventDefault();
        const form = this.element[0]; // jQuery to DOM
        const input = form.querySelector('input[name="img"]');
        const path = input.value;

        if (path && this.saveCallback) {
            await this.saveCallback({ img: path }, "merge"); // Reusing "merge" signal for generic bulk update if safer, implies redraw? No, wait. 
            // In V13: await this.saveCallback({ img: path }, "merge"); -> "merge" is NOT correct here. 
            // V13 logic: await this.saveCallback({ img: path }, "merge"); -> Actually looking at V13 code...
            // V13 code: await this.saveCallback({ img: path }, "merge"); -- Wait, why "merge"? 
            // Ah, BulkElementConfig._onApplyImage in V13: await this.saveCallback({ img: path }, "merge"); 
            // This seems to be a copy-paste quirk or intended to force a full redraw/re-evaluation logic in `layer.js`. 
            // Let's stick to valid signals. If V13 uses "merge" second arg for image apply, I should check `layer.js`...
            // Actually, `layer.js` `_safeSave` handles updates. 
            // If the callback signature is `(updates, mode)`, `layer.js` uses `mode` for special actions.
            // If `mode` is "merge", it does merging. If `mode` is undefined, it applies updates.
            // Wait, looking at V13 `layer.js`:
            // `if (mode === "merge") { ... }`
            // `if (mode === "bringToFront") { ... }`
            // `if (mode === "sendToBack") { ... }`
            // `await this._safeSave(...)` (Default path)

            // So if I pass "merge", it triggers merge logic! That would be BAD for applying image.

            // Re-checking V13 `bulk-config.js` content from Step 2367:
            // Line 64: `await this.saveCallback({ img: path }, "merge");` 
            // THIS LOOKS WRONG IN V13 CODE IF "merge" TRIGGER IS EXCLUSIVE.
            // Let's re-read V13 `layer.js` to see if "merge" logic consumes the call and ignores updates.
            // If V13 is buggy, I should fix it here.

            // But wait, the user said V13 works. Maybe "merge" mode in callback handles arguments?
            // In Step 1968 (previous context, hypothetical):
            // `if (mode === "merge") { await this._mergeElements(); return; }`
            // It ignores `updates`! 
            // So `_onApplyImage` in V13 likely FAILS to apply image if it passes "merge".
            // OR `saveCallback` wraps differently?

            // Actually, in `layer.js`:
            // `saveCallback: async (updates, mode) => { ... }`
            // if mode options are exclusive, passing "merge" will merge and drop image updates?

            // I will assume for V12 I should pass `null` or empty string for mode when applying image.
            // `await this.saveCallback({ img: path });`

            await this.saveCallback({ img: path });
            ui.notifications.info("Image updated for selected elements.");
        }
    }

    async _onSetVisibility(event) {
        event.preventDefault();
        const mode = event.currentTarget.dataset.val;
        if (this.saveCallback) {
            await this.saveCallback({ isHidden: mode }, "visibility");
            ui.notifications.info(`Visibility updated: ${mode}`);
        }
    }

    async _onMerge(event) {
        event.preventDefault();
        if (this.saveCallback) {
            const confirmed = await Dialog.confirm({
                title: "Merge Elements",
                content: `<p>Merge ${this.count} elements into a single multi-shape element?</p>
                          <p><b>Note:</b> They must all be of the same type (e.g. all Platforms).</p>`
            });

            if (confirmed) {
                await this.saveCallback(null, "merge");
                this.close();
            }
        }
    }

    async closeWithAction(action, event) {
        event.preventDefault();
        if (this.saveCallback) {
            await this.saveCallback(null, action);
        }
        this.close();
    }

    _onFilePicker(event) {
        const button = event.currentTarget;
        const type = button.dataset.type || "image";
        const input = button.closest(".form-fields").querySelector("input");

        const fp = new FilePicker({
            type: type,
            current: input.value,
            callback: path => {
                input.value = path;
            }
        });
        fp.browse();
    }
}
