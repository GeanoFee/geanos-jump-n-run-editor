/**
 * The Notes Layer which contains Note canvas objects.
 * @category - Canvas
 */
class NotesLayer extends PlaceablesLayer {

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "notes",
      zIndex: 800
    });
  }

  /** @inheritdoc */
  static documentName = "Note";

  /**
   * The named core setting which tracks the toggled visibility state of map notes
   * @type {string}
   */
  static TOGGLE_SETTING = "notesDisplayToggle";

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return NotesLayer.name;
  }

  /* -------------------------------------------- */

  /** @override */
  interactiveChildren = game.settings.get("core", this.constructor.TOGGLE_SETTING);

  /* -------------------------------------------- */
  /*  Methods
  /* -------------------------------------------- */

  /** @override */
  _deactivate() {
    super._deactivate();
    const isToggled = game.settings.get("core", this.constructor.TOGGLE_SETTING);
    this.objects.visible = this.interactiveChildren = isToggled;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);
    const isToggled = game.settings.get("core", this.constructor.TOGGLE_SETTING);
    this.objects.visible ||= isToggled;
  }

  /* -------------------------------------------- */

  /**
   * Register game settings used by the NotesLayer
   */
  static registerSettings() {
    game.settings.register("core", this.TOGGLE_SETTING, {
      name: "Map Note Toggle",
      scope: "client",
      config: false,
      type: new foundry.data.fields.BooleanField({initial: false}),
      onChange: value => {
        if ( !canvas.ready ) return;
        const layer = canvas.notes;
        layer.objects.visible = layer.interactiveChildren = layer.active || value;
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Visually indicate in the Scene Controls that there are visible map notes present in the Scene.
   */
  hintMapNotes() {
    const hasVisibleNotes = this.placeables.some(n => n.visible);
    const i = document.querySelector(".scene-control[data-control='notes'] i");
    i.classList.toggle("fa-solid", !hasVisibleNotes);
    i.classList.toggle("fa-duotone", hasVisibleNotes);
    i.classList.toggle("has-notes", hasVisibleNotes);
  }

  /* -------------------------------------------- */

  /**
   * Pan to a given note on the layer.
   * @param {Note} note                      The note to pan to.
   * @param {object} [options]               Options which modify the pan operation.
   * @param {number} [options.scale=1.5]     The resulting zoom level.
   * @param {number} [options.duration=250]  The speed of the pan animation in milliseconds.
   * @returns {Promise<void>}                A Promise which resolves once the pan animation has concluded.
   */
  panToNote(note, {scale=1.5, duration=250}={}) {
    if ( !note ) return Promise.resolve();
    if ( note.visible && !this.active ) this.activate();
    return canvas.animatePan({x: note.x, y: note.y, scale, duration}).then(() => {
      if ( this.hover ) this.hover._onHoverOut(new Event("pointerout"));
      note._onHoverIn(new Event("pointerover"), {hoverOutOthers: true});
    });
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onClickLeft(event) {
    if ( game.activeTool !== "journal" ) return super._onClickLeft(event);

    // Capture the click coordinates
    const origin = event.getLocalPosition(canvas.stage);
    const {x, y} = canvas.grid.getCenterPoint(origin);

    // Render the note creation dialog
    const folders = game.journal.folders.filter(f => f.displayed);
    const title = game.i18n.localize("NOTE.Create");
    const html = await renderTemplate("templates/sidebar/document-create.html", {
      folders,
      name: game.i18n.localize("NOTE.Unknown"),
      hasFolders: folders.length >= 1,
      hasTypes: false,
      content: `
        <div class="form-group">
            <label style="display: flex;">
                <input type="checkbox" name="journal">
                ${game.i18n.localize("NOTE.CreateJournal")}
            </label>
        </div>
      `
    });
    let response;
    try {
      response = await Dialog.prompt({
        title,
        content: html,
        label: game.i18n.localize("NOTE.Create"),
        callback: html => {
          const form = html.querySelector("form");
          const fd = new FormDataExtended(form).object;
          if ( !fd.folder ) delete fd.folder;
          if ( fd.journal ) return JournalEntry.implementation.create(fd, {renderSheet: true});
          return fd.name;
        },
        render: html => {
          const form = html.querySelector("form");
          const folder = form.elements.folder;
          if ( !folder ) return;
          folder.disabled = true;
          form.elements.journal.addEventListener("change", event => {
            folder.disabled = !event.currentTarget.checked;
          });
        },
        options: {jQuery: false}
      });
    } catch(err) {
      return;
    }

    // Create a note for a created JournalEntry
    const noteData = {x, y};
    if ( response.id ) {
      noteData.entryId = response.id;
      const cls = getDocumentClass("Note");
      return cls.create(noteData, {parent: canvas.scene});
    }

    // Create a preview un-linked Note
    else {
      noteData.text = response;
      return this._createPreview(noteData, {top: event.clientY - 20, left: event.clientX + 40});
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle JournalEntry document drop data
   * @param {DragEvent} event   The drag drop event
   * @param {object} data       The dropped data transfer data
   * @protected
   */
  async _onDropData(event, data) {
    let entry;
    let origin;
    if ( (data.x === undefined) || (data.y === undefined) ) {
      const coords = this._canvasCoordinatesFromDrop(event, {center: false});
      if ( !coords ) return false;
      origin = {x: coords[0], y: coords[1]};
    } else {
      origin = {x: data.x, y: data.y};
    }
    if ( !event.shiftKey ) origin = this.getSnappedPoint(origin);
    if ( !canvas.dimensions.rect.contains(origin.x, origin.y) ) return false;
    const noteData = {x: origin.x, y: origin.y};
    if ( data.type === "JournalEntry" ) entry = await JournalEntry.implementation.fromDropData(data);
    if ( data.type === "JournalEntryPage" ) {
      const page = await JournalEntryPage.implementation.fromDropData(data);
      entry = page.parent;
      noteData.pageId = page.id;
    }
    if ( entry?.compendium ) {
      const journalData = game.journal.fromCompendium(entry);
      entry = await JournalEntry.implementation.create(journalData);
    }
    noteData.entryId = entry?.id;
    return this._createPreview(noteData, {top: event.clientY - 20, left: event.clientX + 40});
  }
}
