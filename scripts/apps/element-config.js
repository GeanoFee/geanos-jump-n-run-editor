
export class ElementConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "jump-n-run-element-config",
            title: "Configure Element",
            template: "modules/geanos-jump-n-run-editor/templates/element-config.hbs",
            width: 400,
            classes: ["jump-n-run", "config-sheet"],
            closeOnSubmit: true
        });
    }

    constructor(item, saveCallback) {
        super(item);
        this.item = item;
        this.saveCallback = saveCallback;
    }

    getData() {
        return {
            item: this.item,
            isPlatform: this.item.type === "platform",
            isPlate: this.item.type === "plate",
            isCrumble: this.item.type === "crumble",
            isPortal: this.item.type === "portal",
            isSpike: this.item.type === "spike",
            isGate: this.item.type === "gate"
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('[data-action="filePicker"]').click(this._onFilePicker.bind(this));

        // Manual Submit for Button
        html.find('[data-action="save"]').click(event => {
            event.preventDefault();
            this.submit();
        });

        html.find('[data-action="bringToFront"]').click(this.closeWithAction.bind(this, "bringToFront"));
        html.find('[data-action="sendToBack"]').click(this.closeWithAction.bind(this, "sendToBack"));
    }

    async _updateObject(event, formData) {
        const updates = {
            img: formData.img,
            isTiled: formData.isTiled,
            isHidden: formData.isHidden,
            isSemiPermeable: formData.isSemiPermeable,
            targetId: formData.targetId,
            duration: parseInt(formData.duration) || 0,
            isStatic: formData.isStatic
        };

        if (this.saveCallback) {
            await this.saveCallback(updates);
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
