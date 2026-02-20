/**
 * A PlaceablesLayer designed for rendering the visual Scene for a specific vertical cross-section.
 * @category - Canvas
 */
class TilesLayer extends PlaceablesLayer {

  /** @inheritdoc */
  static documentName = "Tile";

  /* -------------------------------------------- */
  /*  Layer Attributes                            */
  /* -------------------------------------------- */

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "tiles",
      zIndex: 300,
      controllableObjects: true,
      rotatableObjects: true
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return TilesLayer.name;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hud() {
    return canvas.hud.tile;
  }

  /* -------------------------------------------- */

  /**
   * An array of Tile objects which are rendered within the objects container
   * @type {Tile[]}
   */
  get tiles() {
    return this.objects?.children || [];
  }

  /* -------------------------------------------- */

  /** @override */
  *controllableObjects() {
    const foreground = ui.controls.control.foreground ?? false;
    for ( const placeable of super.controllableObjects() ) {
      const overhead = placeable.document.elevation >= placeable.document.parent.foregroundElevation;
      if ( overhead === foreground ) yield placeable;
    }
  }

  /* -------------------------------------------- */
  /*  Layer Methods                               */
  /* -------------------------------------------- */

  /** @inheritDoc */
  getSnappedPoint(point) {
    if ( canvas.forceSnapVertices ) return canvas.grid.getSnappedPoint(point, {mode: CONST.GRID_SNAPPING_MODES.VERTEX});
    return super.getSnappedPoint(point);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _tearDown(options) {
    for ( const tile of this.tiles ) {
      if ( tile.isVideo ) {
        game.video.stop(tile.sourceElement);
      }
    }
    return super._tearDown(options);
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftStart(event) {
    super._onDragLeftStart(event);
    const interaction = event.interactionData;

    // Snap the origin to the grid
    if ( !event.shiftKey ) interaction.origin = this.getSnappedPoint(interaction.origin);

    // Create the preview
    const tile = this.constructor.placeableClass.createPreview(interaction.origin);
    interaction.preview = this.preview.addChild(tile);
    this.preview._creating = false;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftMove(event) {
    const interaction = event.interactionData;

    // Snap the destination to the grid
    if ( !event.shiftKey ) interaction.destination = this.getSnappedPoint(interaction.destination);

    const {destination, tilesState, preview, origin} = interaction;
    if ( tilesState === 0 ) return;

    // Determine the drag distance
    const dx = destination.x - origin.x;
    const dy = destination.y - origin.y;
    const dist = Math.min(Math.abs(dx), Math.abs(dy));

    // Update the preview object
    preview.document.width = (event.altKey ? dist * Math.sign(dx) : dx);
    preview.document.height = (event.altKey ? dist * Math.sign(dy) : dy);
    preview.renderFlags.set({refreshSize: true});

    // Confirm the creation state
    interaction.tilesState = 2;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftDrop(event) {
    // Snap the destination to the grid
    const interaction = event.interactionData;
    if ( !event.shiftKey ) interaction.destination = this.getSnappedPoint(interaction.destination);

    const { tilesState, preview } = interaction;
    if ( tilesState !== 2 ) return;
    const doc = preview.document;

    // Re-normalize the dropped shape
    const r = new PIXI.Rectangle(doc.x, doc.y, doc.width, doc.height).normalize();
    preview.document.updateSource(r);

    // Require a minimum created size
    if ( Math.hypot(r.width, r.height) < (canvas.dimensions.size / 2) ) return;

    // Render the preview sheet for confirmation
    preview.sheet.render(true, {preview: true});
    this.preview._creating = true;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftCancel(event) {
    if ( this.preview._creating ) return;
    return super._onDragLeftCancel(event);
  }

  /* -------------------------------------------- */

  /**
   * Handle drop events for Tile data on the Tiles Layer
   * @param {DragEvent} event     The concluding drag event
   * @param {object} data         The extracted Tile data
   * @private
   */
  async _onDropData(event, data) {
    if ( !data.texture?.src ) return;
    if ( !this.active ) this.activate();

    // Get the data for the tile to create
    const createData = await this._getDropData(event, data);

    // Validate that the drop position is in-bounds and snap to grid
    if ( !canvas.dimensions.rect.contains(createData.x, createData.y) ) return false;

    // Create the Tile Document
    const cls = getDocumentClass(this.constructor.documentName);
    return cls.create(createData, {parent: canvas.scene});
  }

  /* -------------------------------------------- */

  /**
   * Prepare the data object when a new Tile is dropped onto the canvas
   * @param {DragEvent} event     The concluding drag event
   * @param {object} data         The extracted Tile data
   * @returns {object}            The prepared data to create
   */
  async _getDropData(event, data) {

    // Determine the tile size
    const tex = await loadTexture(data.texture.src);
    const ratio = canvas.dimensions.size / (data.tileSize || canvas.dimensions.size);
    data.width = tex.baseTexture.width * ratio;
    data.height = tex.baseTexture.height * ratio;

    // Determine the elevation
    const foreground = ui.controls.controls.find(c => c.layer === "tiles").foreground;
    data.elevation = foreground ? canvas.scene.foregroundElevation : 0;
    data.sort = Math.max(this.getMaxSort() + 1, 0);
    foundry.utils.setProperty(data, "occlusion.mode", foreground
      ? CONST.OCCLUSION_MODES.FADE : CONST.OCCLUSION_MODES.NONE);

    // Determine the final position and snap to grid unless SHIFT is pressed
    data.x = data.x - (data.width / 2);
    data.y = data.y - (data.height / 2);
    if ( !event.shiftKey ) {
      const {x, y} = this.getSnappedPoint(data);
      data.x = x;
      data.y = y;
    }

    // Create the tile as hidden if the ALT key is pressed
    if ( event.altKey ) data.hidden = true;
    return data;
  }

  /* -------------------------------------------- */
  /*  Deprecations and Compatibility              */
  /* -------------------------------------------- */

  /**
   * @deprecated since v12
   * @ignore
   */
  get roofs() {
    const msg = "TilesLayer#roofs has been deprecated without replacement.";
    foundry.utils.logCompatibilityWarning(msg, {since: 12, until: 14});
    return this.placeables.filter(t => t.isRoof);
  }

  /* -------------------------------------------- */

  /**
   * @deprecated since v11
   * @ignore
   */
  get textureDataMap() {
    const msg = "TilesLayer#textureDataMap has moved to TextureLoader.textureBufferDataMap";
    foundry.utils.logCompatibilityWarning(msg, {since: 11, until: 13});
    return TextureLoader.textureBufferDataMap;
  }

  /* -------------------------------------------- */

  /**
   * @deprecated since v11
   * @ignore
   */
  get depthMask() {
    const msg = "TilesLayer#depthMask is deprecated without replacement. Use canvas.masks.depth instead";
    foundry.utils.logCompatibilityWarning(msg, {since: 12, until: 14});
    return canvas.masks.depth;
  }
}
