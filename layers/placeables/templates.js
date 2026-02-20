/**
 * This Canvas Layer provides a container for MeasuredTemplate objects.
 * @category - Canvas
 */
class TemplateLayer extends PlaceablesLayer {

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "templates",
      rotatableObjects: true,
      zIndex: 400
    });
  }

  /** @inheritdoc */
  static documentName = "MeasuredTemplate";

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return TemplateLayer.name;
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _deactivate() {
    super._deactivate();
    this.objects.visible = true;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);
    this.objects.visible = true;
  }

  /* -------------------------------------------- */

  /**
   * Register game settings used by the TemplatesLayer
   */
  static registerSettings() {
    game.settings.register("core", "gridTemplates", {
      name: "TEMPLATE.GridTemplatesSetting",
      hint: "TEMPLATE.GridTemplatesSettingHint",
      scope: "world",
      config: true,
      type: new foundry.data.fields.BooleanField({initial: false}),
      onChange: () => {
        if ( canvas.ready ) canvas.templates.draw();
      }
    });
    game.settings.register("core", "coneTemplateType", {
      name: "TEMPLATE.ConeTypeSetting",
      hint: "TEMPLATE.ConeTypeSettingHint",
      scope: "world",
      config: true,
      type: new foundry.data.fields.StringField({required: true, blank: false, initial: "round", choices: {
        round: "TEMPLATE.ConeTypeRound",
        flat: "TEMPLATE.ConeTypeFlat"
      }}),
      onChange: () => {
        if ( canvas.ready ) canvas.templates.draw();
      }
    });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftStart(event) {
    super._onDragLeftStart(event);
    const interaction = event.interactionData;

    // Snap the origin to the grid
    if ( !event.shiftKey ) interaction.origin = this.getSnappedPoint(interaction.origin);

    // Create a pending MeasuredTemplateDocument
    const tool = game.activeTool;
    const previewData = {
      user: game.user.id,
      t: tool,
      x: interaction.origin.x,
      y: interaction.origin.y,
      sort: Math.max(this.getMaxSort() + 1, 0),
      distance: 1,
      direction: 0,
      fillColor: game.user.color || "#FF0000",
      hidden: event.altKey
    };
    const defaults = CONFIG.MeasuredTemplate.defaults;
    if ( tool === "cone") previewData.angle = defaults.angle;
    else if ( tool === "ray" ) previewData.width = (defaults.width * canvas.dimensions.distance);
    const cls = getDocumentClass("MeasuredTemplate");
    const doc = new cls(previewData, {parent: canvas.scene});

    // Create a preview MeasuredTemplate object
    const template = new this.constructor.placeableClass(doc);
    interaction.preview = this.preview.addChild(template);
    template.draw();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftMove(event) {
    const interaction = event.interactionData;

    // Snap the destination to the grid
    if ( !event.shiftKey ) interaction.destination = this.getSnappedPoint(interaction.destination);

    // Compute the ray
    const {origin, destination, preview} = interaction;
    const ray = new Ray(origin, destination);
    let distance;

    // Grid type
    if ( game.settings.get("core", "gridTemplates") ) {
      distance = canvas.grid.measurePath([origin, destination]).distance;
    }

    // Euclidean type
    else {
      const ratio = (canvas.dimensions.size / canvas.dimensions.distance);
      distance = ray.distance / ratio;
    }

    // Update the preview object
    preview.document.direction = Math.normalizeDegrees(Math.toDegrees(ray.angle));
    preview.document.distance = distance;
    preview.renderFlags.set({refreshShape: true});
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onMouseWheel(event) {

    // Determine whether we have a hovered template?
    const template = this.hover;
    if ( !template || template.isPreview ) return;

    // Determine the incremental angle of rotation from event data
    const snap = event.shiftKey ? 15 : 5;
    const delta = snap * Math.sign(event.delta);
    return template.rotate(template.document.direction + delta, snap);
  }
}
