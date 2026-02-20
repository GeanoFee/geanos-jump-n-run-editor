
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
        const form = this.element[0];
        const input = form.querySelector('input[name="img"]');
        const path = input.value;

        if (path && this.saveCallback) {
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
