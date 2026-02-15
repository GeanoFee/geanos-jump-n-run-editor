const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ElementConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        tag: "form",
        id: "jump-n-run-element-config",
        classes: ["jump-n-run", "config-sheet"],
        position: {
            width: 400,
            height: "auto"
        },
        actions: {
            filePicker: ElementConfig._onFilePicker,
            save: ElementConfig._onSave
        }
    };

    static PARTS = {
        main: {
            template: "modules/geanos-jump-n-run-editor/templates/element-config.hbs"
        }
    };

    /**
     * @param {object} item - The level data item being edited
     * @param {Function} saveCallback - Function to call on save (takes updates object)
     */
    constructor(item, saveCallback) {
        super({ window: { title: `Configure ${item.type}` } });
        this.item = item;
        this.saveCallback = saveCallback;
    }

    async _prepareContext(options) {
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

    static async _onSave(event, target) {
        // V13: FormDataExtended is namespaced or we can use standard FormData + expandObject
        // The deprecation warning suggested foundry.applications.ux.FormDataExtended
        const formData = new foundry.applications.ux.FormDataExtended(this.element).object;

        // Convert checkbox "on" to boolean if needed, though FormDataExtended usually handles boolean inputs well 
        // if they are actual checkboxes.
        // We'll trust FormDataExtended but do safe casting where logic demands.

        const updates = {
            img: formData.img,
            isTiled: formData.isTiled,
            isHidden: formData.isHidden,
            isSemiPermeable: formData.isSemiPermeable,
            targetId: formData.targetId,
            duration: parseInt(formData.duration) || 0
        };

        if (this.saveCallback) {
            await this.saveCallback(updates);
        }
        this.close();
    }

    /* ------------------------------------------- */
    /*  Template                                   */
    /* ------------------------------------------- */

    // We can use a template string here since we don't have a file loader for this specific module setup yet,
    // or we can register a partial. For a simple module, overriding _renderHTML is also an option, 
    // but HandlebarsMixin expects a template path. 
    // Let's assume we can't easily add a new .hbs file without registering it. 
    // We will cheat slightly and overwrite _renderHTML to parse a string, OR we just use a data URI?
    // Actually, in V12/V13, we can just return a string from a helper if needed, but the mixin enforces templates.
    // 
    // workaround: create a minimal template file? No, user didn't ask for that.
    // Let's implement `_renderHTML` manually to avoid the mixin requirement if strictly needed, 
    // OR we just define the 'parts' as an array of templates.
    // 
    // Actually, ApplicationV2 doesn't *require* HandlebarsMixin. We can just use it directly.
    // But HandlebarsMixin is convenient.
    // 
    // Let's define the parts and use a template we write to a file?
    // User asked to "Update module", so creating new files is fine.
    // BUT I cannot easily "create" a .hbs file and ensure Foundry loads it without verifying the server side.
    // I will write the template to `templates/element-config.hbs` and register it in `main.js` if needed, 
    // or just pass the path.

    // Changing approach: I will not use HandlebarsMixin for simplicity of avoiding file I/O for templates if possible,
    // BUT Handlebars is standard. I'll write the hbs file.
}

// Wait, I submitted the code above without the template property.
// I will rewrite this file content below to include the `parts` property and then creating the template file.
