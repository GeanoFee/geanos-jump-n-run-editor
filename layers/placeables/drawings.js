/**
 * The DrawingsLayer subclass of PlaceablesLayer.
 * This layer implements a container for drawings.
 * @category - Canvas
 */
class DrawingsLayer extends PlaceablesLayer {

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "drawings",
      controllableObjects: true,
      rotatableObjects: true,
      zIndex: 500
    });
  }

  /** @inheritdoc */
  static documentName = "Drawing";

  /**
   * The named game setting which persists default drawing configuration for the User
   * @type {string}
   */
  static DEFAULT_CONFIG_SETTING = "defaultDrawingConfig";

  /**
   * The collection of drawing objects which are rendered in the interface.
   * @type {Collection<string, Drawing>}
   */
  graphics = new foundry.utils.Collection();

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /** @inheritdoc */
  get hud() {
    return canvas.hud.drawing;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return DrawingsLayer.name;
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /** @override */
  getSnappedPoint(point) {
    const M = CONST.GRID_SNAPPING_MODES;
    const size = canvas.dimensions.size;
    return canvas.grid.getSnappedPoint(point, canvas.forceSnapVertices ? {mode: M.VERTEX} : {
      mode: M.CENTER | M.VERTEX | M.CORNER | M.SIDE_MIDPOINT,
      resolution: size >= 128 ? 8 : (size >= 64 ? 4 : 2)
    });
  }

  /* -------------------------------------------- */

  /**
   * Render a configuration sheet to configure the default Drawing settings
   */
  configureDefault() {
    const defaults = game.settings.get("core", DrawingsLayer.DEFAULT_CONFIG_SETTING);
    const d = DrawingDocument.fromSource(defaults);
    new DrawingConfig(d, {configureDefault: true}).render(true);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _deactivate() {
    super._deactivate();
    this.objects.visible = true;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _draw(options) {
    await super._draw(options);
    this.objects.visible = true;
  }

  /* -------------------------------------------- */

  /**
   * Get initial data for a new drawing.
   * Start with some global defaults, apply user default config, then apply mandatory overrides per tool.
   * @param {Point} origin      The initial coordinate
   * @returns {object}          The new drawing data
   */
  _getNewDrawingData(origin) {
    const tool = game.activeTool;

    // Get saved user defaults
    const defaults = game.settings.get("core", this.constructor.DEFAULT_CONFIG_SETTING) || {};
    const userColor = game.user.color.css;
    const data = foundry.utils.mergeObject(defaults, {
      fillColor: userColor,
      strokeColor: userColor,
      fontFamily: CONFIG.defaultFontFamily
    }, {overwrite: false, inplace: false});

    // Mandatory additions
    delete data._id;
    data.x = origin.x;
    data.y = origin.y;
    data.sort = Math.max(this.getMaxSort() + 1, 0);
    data.author = game.user.id;
    data.shape = {};

    // Information toggle
    const interfaceToggle = ui.controls.controls.find(c => c.layer === "drawings").tools.find(t => t.name === "role");
    data.interface = interfaceToggle.active;

    // Tool-based settings
    switch ( tool ) {
      case "rect":
        data.shape.type = Drawing.SHAPE_TYPES.RECTANGLE;
        data.shape.width = 1;
        data.shape.height = 1;
        break;
      case "ellipse":
        data.shape.type = Drawing.SHAPE_TYPES.ELLIPSE;
        data.shape.width = 1;
        data.shape.height = 1;
        break;
      case "polygon":
        data.shape.type = Drawing.SHAPE_TYPES.POLYGON;
        data.shape.points = [0, 0];
        data.bezierFactor = 0;
        break;
      case "freehand":
        data.shape.type = Drawing.SHAPE_TYPES.POLYGON;
        data.shape.points = [0, 0];
        data.bezierFactor = data.bezierFactor ?? 0.5;
        break;
      case "text":
        data.shape.type = Drawing.SHAPE_TYPES.RECTANGLE;
        data.shape.width = 1;
        data.shape.height = 1;
        data.fillColor = "#ffffff";
        data.fillAlpha = 0.10;
        data.strokeColor = "#ffffff";
        data.text ||= "";
        break;
    }

    // Return the cleaned data
    return DrawingDocument.cleanData(data);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  _onClickLeft(event) {
    const {preview, drawingsState, destination} = event.interactionData;

    // Continue polygon point placement
    if ( (drawingsState >= 1) && preview.isPolygon ) {
      preview._addPoint(destination, {snap: !event.shiftKey, round: true});
      preview._chain = true; // Note that we are now in chain mode
      return preview.refresh();
    }

    // Standard left-click handling
    super._onClickLeft(event);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onClickLeft2(event) {
    const {drawingsState, preview} = event.interactionData;

    // Conclude polygon placement with double-click
    if ( (drawingsState >= 1) && preview.isPolygon ) {
      event.interactionData.drawingsState = 2;
      return;
    }

    // Standard double-click handling
    super._onClickLeft2(event);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftStart(event) {
    super._onDragLeftStart(event);
    const interaction = event.interactionData;

    // Snap the origin to the grid
    const isFreehand = game.activeTool === "freehand";
    if ( !event.shiftKey && !isFreehand ) {
      interaction.origin = this.getSnappedPoint(interaction.origin);
    }

    // Create the preview object
    const cls = getDocumentClass("Drawing");
    let document;
    try {
      document = new cls(this._getNewDrawingData(interaction.origin), {parent: canvas.scene});
    }
    catch(e) {
      if ( e instanceof foundry.data.validation.DataModelValidationError ) {
        ui.notifications.error("DRAWING.JointValidationErrorUI", {localize: true});
      }
      throw e;
    }
    const drawing = new this.constructor.placeableClass(document);
    interaction.preview = this.preview.addChild(drawing);
    interaction.drawingsState = 1;
    drawing.draw();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftMove(event) {
    const {preview, drawingsState} = event.interactionData;
    if ( !preview || preview._destroyed ) return;
    if ( preview.parent === null ) { // In theory this should never happen, but rarely does
      this.preview.addChild(preview);
    }
    if ( drawingsState >= 1 ) {
      preview._onMouseDraw(event);
      const isFreehand = game.activeTool === "freehand";
      if ( !preview.isPolygon || isFreehand ) event.interactionData.drawingsState = 2;
    }
  }

  /* -------------------------------------------- */

  /**
   * Handling of mouse-up events which conclude a new object creation after dragging
   * @param {PIXI.FederatedEvent} event       The drag drop event
   * @private
   */
  _onDragLeftDrop(event) {
    const interaction = event.interactionData;

    // Snap the destination to the grid
    const isFreehand = game.activeTool === "freehand";
    if ( !event.shiftKey && !isFreehand ) {
      interaction.destination = this.getSnappedPoint(interaction.destination);
    }

    const {drawingsState, destination, origin, preview} = interaction;

    // Successful drawing completion
    if ( drawingsState === 2 ) {
      const distance = Math.hypot(Math.max(destination.x, origin.x) - preview.x,
        Math.max(destination.y, origin.x) - preview.y);
      const minDistance = distance >= (canvas.dimensions.size / 8);
      const completePolygon = preview.isPolygon && (preview.document.shape.points.length > 4);

      // Create a completed drawing
      if ( minDistance || completePolygon ) {
        event.interactionData.clearPreviewContainer = false;
        event.interactionData.drawingsState = 0;
        const data = preview.document.toObject(false);

        // Create the object
        preview._chain = false;
        const cls = getDocumentClass("Drawing");
        const createData = this.constructor.placeableClass.normalizeShape(data);
        cls.create(createData, {parent: canvas.scene}).then(d => {
          const o = d.object;
          o._creating = true;
          if ( game.activeTool !== "freehand" ) o.control({isNew: true});
        }).finally(() => this.clearPreviewContainer());
      }
    }

    // In-progress polygon
    if ( (drawingsState === 1) && preview.isPolygon ) {
      event.preventDefault();
      if ( preview._chain ) return;
      return this._onClickLeft(event);
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftCancel(event) {
    const preview = this.preview.children?.[0] || null;
    if ( preview?._chain ) {
      preview._removePoint();
      preview.refresh();
      if ( preview.document.shape.points.length ) return event.preventDefault();
    }
    event.interactionData.drawingsState = 0;
    super._onDragLeftCancel(event);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onClickRight(event) {
    const preview = this.preview.children?.[0] || null;
    if ( preview ) return canvas.mouseInteractionManager._dragRight = false;
    super._onClickRight(event);
  }

  /* -------------------------------------------- */
  /*  Deprecations and Compatibility              */
  /* -------------------------------------------- */

  /**
   * @deprecated since v12
   * @ignore
   */
  get gridPrecision() {
    // eslint-disable-next-line no-unused-expressions
    super.gridPrecision;
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) return 0;
    return canvas.dimensions.size >= 128 ? 16 : 8;
  }
}
