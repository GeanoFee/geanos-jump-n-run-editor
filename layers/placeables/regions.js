/**
 * The Regions Container.
 * @category - Canvas
 */
class RegionLayer extends PlaceablesLayer {

  /** @inheritDoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "regions",
      controllableObjects: true,
      confirmDeleteKey: true,
      quadtree: false,
      zIndex: 100,
      zIndexActive: 600
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  static documentName = "Region";

  /* -------------------------------------------- */

  /**
   * The method to sort the Regions.
   * @type {Function}
   */
  static #sortRegions = function() {
    for ( let i = 0; i < this.children.length; i++ ) {
      this.children[i]._lastSortedIndex = i;
    }
    this.children.sort((a, b) => (a.zIndex - b.zIndex)
      || (a.top - b.top)
      || (a.bottom - b.bottom)
      || (a._lastSortedIndex - b._lastSortedIndex));
    this.sortDirty = false;
  };

  /* -------------------------------------------- */

  /** @inheritDoc */
  get hookName() {
    return RegionLayer.name;
  }

  /* -------------------------------------------- */

  /**
   * The RegionLegend application of this RegionLayer.
   * @type {foundry.applications.ui.RegionLegend}
   */
  get legend() {
    return this.#legend ??= new foundry.applications.ui.RegionLegend();
  }

  #legend;

  /* -------------------------------------------- */

  /**
   * The graphics used to draw the highlighted shape.
   * @type {PIXI.Graphics}
   */
  #highlight;

  /* -------------------------------------------- */

  /**
   * The graphics used to draw the preview of the shape that is drawn.
   * @type {PIXI.Graphics}
   */
  #preview;

  /* -------------------------------------------- */

  /**
   * Draw shapes as holes?
   * @type {boolean}
   * @internal
   */
  _holeMode = false;

  /* -------------------------------------------- */
  /*  Methods
  /* -------------------------------------------- */

  /** @inheritDoc */
  _activate() {
    super._activate();
    // noinspection ES6MissingAwait
    this.legend.render({force: true});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _deactivate() {
    super._deactivate();
    this.objects.visible = true;
    // noinspection ES6MissingAwait
    this.legend.close({animate: false});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  storeHistory(type, data) {
    super.storeHistory(type, type === "update" ? data.map(d => {
      if ( "behaviors" in d ) {
        d = foundry.utils.deepClone(d);
        delete d.behaviors;
      }
      return d;
    }) : data);
  }

  /* -------------------------------------------- */

  /** @override */
  copyObjects() {
    return []; // Prevent copy & paste
  }

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

  /** @override */
  getZIndex() {
    return this.active ? this.options.zIndexActive : this.options.zIndex;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);
    this.objects.sortChildren = RegionLayer.#sortRegions;
    this.objects.visible = true;
    this.#highlight = this.addChild(new PIXI.Graphics());
    this.#highlight.eventMode = "none";
    this.#highlight.visible = false;
    this.#preview = this.addChild(new PIXI.Graphics());
    this.#preview.eventMode = "none";
    this.#preview.visible = false;
    this.filters = [VisionMaskFilter.create()];
    this.filterArea = canvas.app.screen;
  }

  /* -------------------------------------------- */

  /**
   * Highlight the shape or clear the highlight.
   * @param {foundry.data.BaseShapeData|null} data    The shape to highlight, or null to clear the highlight
   * @internal
   */
  _highlightShape(data) {
    this.#highlight.clear();
    this.#highlight.visible = false;
    if ( !data ) return;
    this.#highlight.visible = true;
    this.#highlight.lineStyle({
      width: CONFIG.Canvas.objectBorderThickness,
      color: 0x000000,
      join: PIXI.LINE_JOIN.ROUND,
      shader: new PIXI.smooth.DashLineShader()
    });
    const shape = foundry.canvas.regions.RegionShape.create(data);
    shape._drawShape(this.#highlight);
  }

  /* -------------------------------------------- */

  /**
   * Refresh the preview shape.
   * @param {PIXI.FederatedEvent} event
   */
  #refreshPreview(event) {
    this.#preview.clear();
    this.#preview.lineStyle({
      width: CONFIG.Canvas.objectBorderThickness,
      color: 0x000000,
      join: PIXI.LINE_JOIN.ROUND,
      cap: PIXI.LINE_CAP.ROUND,
      alignment: 0.75
    });
    this.#preview.beginFill(event.interactionData.drawingColor, 0.5);
    this.#drawPreviewShape(event);
    this.#preview.endFill();
    this.#preview.lineStyle({
      width: CONFIG.Canvas.objectBorderThickness / 2,
      color: CONFIG.Canvas.dispositionColors.CONTROLLED,
      join: PIXI.LINE_JOIN.ROUND,
      cap: PIXI.LINE_CAP.ROUND,
      alignment: 1
    });
    this.#drawPreviewShape(event);
  }

  /* -------------------------------------------- */

  /**
   * Draw the preview shape.
   * @param {PIXI.FederatedEvent} event
   */
  #drawPreviewShape(event) {
    const data = this.#createShapeData(event);
    if ( !data ) return;
    switch ( data.type ) {
      case "rectangle": this.#preview.drawRect(data.x, data.y, data.width, data.height); break;
      case "circle": this.#preview.drawCircle(data.x, data.y, data.radius); break;
      case "ellipse": this.#preview.drawEllipse(data.x, data.y, data.radiusX, data.radiusY); break;
      case "polygon":
        const polygon = new PIXI.Polygon(data.points);
        if ( !polygon.isPositive ) polygon.reverseOrientation();
        this.#preview.drawPath(polygon.points);
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * Create the shape data.
   * @param {PIXI.FederatedEvent} event
   * @returns {object|void}
   */
  #createShapeData(event) {
    let data;
    switch ( event.interactionData.drawingTool ) {
      case "rectangle": data = this.#createRectangleData(event); break;
      case "ellipse": data = this.#createCircleOrEllipseData(event); break;
      case "polygon": data = this.#createPolygonData(event); break;
    }
    if ( data ) {
      data.elevation = {
        bottom: Number.isFinite(this.legend.elevation.bottom) ? this.legend.elevation.bottom : null,
        top: Number.isFinite(this.legend.elevation.top) ? this.legend.elevation.top : null
      };
      if ( this._holeMode ) data.hole = true;
      return data;
    }
  }

  /* -------------------------------------------- */

  /**
   * Create the rectangle shape data.
   * @param {PIXI.FederatedEvent} event
   * @returns {object|void}
   */
  #createRectangleData(event) {
    const {origin, destination} = event.interactionData;
    let dx = Math.abs(destination.x - origin.x);
    let dy = Math.abs(destination.y - origin.y);
    if ( event.altKey ) dx = dy = Math.min(dx, dy);
    let x = origin.x;
    let y = origin.y;
    if ( event.ctrlKey || event.metaKey ) {
      x -= dx;
      y -= dy;
      dx *= 2;
      dy *= 2;
    } else {
      if ( origin.x > destination.x ) x -= dx;
      if ( origin.y > destination.y ) y -= dy;
    }
    if ( (dx === 0) || (dy === 0) ) return;
    return {type: "rectangle", x, y, width: dx, height: dy, rotation: 0};
  }

  /* -------------------------------------------- */

  /**
   * Create the circle or ellipse shape data.
   * @param {PIXI.FederatedEvent} event
   * @returns {object|void}
   */
  #createCircleOrEllipseData(event) {
    const {origin, destination} = event.interactionData;
    let dx = Math.abs(destination.x - origin.x);
    let dy = Math.abs(destination.y - origin.y);
    if ( event.altKey ) dx = dy = Math.min(dx, dy);
    let x = origin.x;
    let y = origin.y;
    if ( !(event.ctrlKey || event.metaKey) ) {
      if ( origin.x > destination.x ) x -= dx;
      if ( origin.y > destination.y ) y -= dy;
      dx /= 2;
      dy /= 2;
      x += dx;
      y += dy;
    }
    if ( (dx === 0) || (dy === 0) ) return;
    return event.altKey
      ? {type: "circle", x, y, radius: dx}
      : {type: "ellipse", x, y, radiusX: dx, radiusY: dy, rotation: 0};
  }

  /* -------------------------------------------- */

  /**
   * Create the polygon shape data.
   * @param {PIXI.FederatedEvent} event
   * @returns {object|void}
   */
  #createPolygonData(event) {
    let {destination, points, complete} = event.interactionData;
    if ( !complete ) points = [...points, destination.x, destination.y];
    else if ( points.length < 6 ) return;
    return {type: "polygon", points};
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClickLeft(event) {
    const interaction = event.interactionData;

    // Continue polygon point placement
    if ( interaction.drawingTool === "polygon" ) {
      const {destination, points} = interaction;
      const point = !event.shiftKey ? this.getSnappedPoint(destination) : destination;

      // Clicking on the first point closes the shape
      if ( (point.x === points.at(0)) && (point.y === points.at(1)) ) {
        interaction.complete = true;
      }

      // Don't add the point if it is equal to the last one
      else if ( (point.x !== points.at(-2)) || (point.y !== points.at(-1)) ) {
        interaction.points.push(point.x, point.y);
        this.#refreshPreview(event);
      }
      return;
    }

    // If one of the drawing tools is selected, prevent left-click-to-release
    if ( ["rectangle", "ellipse", "polygon"].includes(game.activeTool) ) return;

    // Standard left-click handling
    super._onClickLeft(event);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClickLeft2(event) {
    const interaction = event.interactionData;

    // Conclude polygon drawing with a double-click
    if ( interaction.drawingTool === "polygon" ) {
      interaction.complete = true;
      return;
    }

    // Standard double-click handling
    super._onClickLeft2(event);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _canDragLeftStart(user, event) {
    if ( !super._canDragLeftStart(user, event) ) return false;
    if ( !["rectangle", "ellipse", "polygon"].includes(game.activeTool) ) return false;
    if ( this.controlled.length > 1 ) {
      ui.notifications.error("REGION.NOTIFICATIONS.DrawingMultipleRegionsControlled", {localize: true});
      return false;
    }
    if ( this.controlled.at(0)?.document.locked ) {
      ui.notifications.warn(game.i18n.format("CONTROLS.ObjectIsLocked", {
        type: game.i18n.localize(RegionDocument.metadata.label)}));
      return false;
    }
    return true;
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftStart(event) {
    const interaction = event.interactionData;
    if ( !event.shiftKey ) interaction.origin = this.getSnappedPoint(interaction.origin);

    // Set drawing tool
    interaction.drawingTool = game.activeTool;
    interaction.drawingRegion = this.controlled.at(0);
    interaction.drawingColor = interaction.drawingRegion?.document.color
      ?? Color.from(RegionDocument.schema.fields.color.getInitialValue({}));

    // Initialize the polygon points with the origin
    if ( interaction.drawingTool === "polygon" ) {
      const point = interaction.origin;
      interaction.points = [point.x, point.y];
    }
    this.#refreshPreview(event);
    this.#preview.visible = true;
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftMove(event) {
    const interaction = event.interactionData;
    if ( !interaction.drawingTool ) return;
    if ( !event.shiftKey ) interaction.destination = this.getSnappedPoint(interaction.destination);
    this.#refreshPreview(event);
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftDrop(event) {
    const interaction = event.interactionData;
    if ( !interaction.drawingTool ) return;
    if ( !event.shiftKey ) interaction.destination = this.getSnappedPoint(interaction.destination);

    // In-progress polygon drawing
    if ( (interaction.drawingTool === "polygon") && (interaction.complete !== true) ) {
      event.preventDefault();
      return;
    }

    // Clear preview and refresh Regions
    this.#preview.clear();
    this.#preview.visible = false;

    // Create the shape from the preview
    const shape = this.#createShapeData(event);
    if ( !shape ) return;

    // Add the shape to controlled Region or create a new Region if none is controlled
    const region = interaction.drawingRegion;
    if ( region ) {
      if ( !region.document.locked ) region.document.update({shapes: [...region.document.shapes, shape]});
    } else RegionDocument.implementation.create({
      name: RegionDocument.implementation.defaultName({parent: canvas.scene}),
      color: interaction.drawingColor,
      shapes: [shape]
    }, {parent: canvas.scene, renderSheet: true}).then(r => r.object.control({releaseOthers: true}));
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftCancel(event) {
    const interaction = event.interactionData;
    if ( !interaction.drawingTool ) return;

    // Remove point from in-progress polygon drawing
    if ( (interaction.drawingTool === "polygon") && (interaction.complete !== true) ) {
      interaction.points.splice(-2, 2);
      if ( interaction.points.length ) {
        event.preventDefault();
        this.#refreshPreview(event);
        return;
      }
    }

    // Clear preview and refresh Regions
    this.#preview.clear();
    this.#preview.visible = false;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClickRight(event) {
    const interaction = event.interactionData;
    if ( interaction.drawingTool ) return canvas.mouseInteractionManager._dragRight = false;
    super._onClickRight(event);
  }
}
