const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BulkElementConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "jump-n-run-bulk-config",
        classes: ["jump-n-run", "config-sheet"],
        position: {
            width: 400,
            height: "auto"
        },
        actions: {
            filePicker: BulkElementConfig._onFilePicker,
            applyImage: BulkElementConfig._onApplyImage,
            setVisibility: BulkElementConfig._onSetVisibility,
            merge: BulkElementConfig._onMerge,
            bringToFront: BulkElementConfig._onBringToFront,
            sendToBack: BulkElementConfig._onSendToBack
        }
    };

    static PARTS = {
        main: {
            template: "modules/geanos-jump-n-run-editor/templates/bulk-config.hbs"
        }
    };

    /**
     * @param {number} count - Number of selected items
     * @param {Function} saveCallback - Callback(updates)
     */
    constructor(count, saveCallback) {
        super({ window: { title: `Configure ${count} Elements` } });
        this.count = count;
        this.saveCallback = saveCallback; // (updates, mode) => Promise
    }

    async _prepareContext(options) {
        return {
            count: this.count
        };
    }

    static async _onFilePicker(event, target) {
        const input = target.closest(".form-group").querySelector("input");
        const type = target.dataset.type || "image";

        const fp = new foundry.applications.apps.FilePicker({
            type: type,
            current: input.value,
            callback: path => {
                input.value = path;
            }
        });
        fp.browse();
    }

    static async _onApplyImage(event, target) {
        const form = this.element;
        const input = form.querySelector('input[name="img"]');
        const path = input.value;

        if (path && this.saveCallback) {
            await this.saveCallback({ img: path });
            ui.notifications.info("Image updated for selected elements.");
        }
    }

    static async _onSetVisibility(event, target) {
        const mode = target.dataset.val; // 'visible', 'hidden', 'toggle'

        if (this.saveCallback) {
            // We pass a special update function or signal
            // Since saveCallback is generic, let's define a protocol
            await this.saveCallback({ isHidden: mode }, "visibility");
            ui.notifications.info(`Visibility updated: ${mode}`);
        }
    }

    static async _onMerge(event, target) {
        if (this.saveCallback) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Merge Elements" },
                content: `<p>Merge ${this.count} elements into a single multi-shape element?</p>
                          <p><b>Note:</b> They must all be of the same type (e.g. all Platforms).</p>`,
                rejectClose: false
            });

            if (confirmed) {
                await this.saveCallback(null, "merge");
                this.close();
            }
        }
    }

    static async _onBringToFront(event, target) {
        if (this.saveCallback) {
            await this.saveCallback(null, "bringToFront");
            this.close();
        }
    }

    static async _onSendToBack(event, target) {
        if (this.saveCallback) {
            await this.saveCallback(null, "sendToBack");
            this.close();
        }
    }
}
