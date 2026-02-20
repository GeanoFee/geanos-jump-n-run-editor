/**
 * The Lighting Layer which ambient light sources as part of the CanvasEffectsGroup.
 * @category - Canvas
 */
class LightingLayer extends PlaceablesLayer {

  /** @inheritdoc */
  static documentName = "AmbientLight";

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "lighting",
      rotatableObjects: true,
      zIndex: 900
    });
  }

  /**
   * Darkness change event handler function.
   * @type {_onDarknessChange}
   */
  #onDarknessChange;

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return LightingLayer.name;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);
    this.#onDarknessChange = this._onDarknessChange.bind(this);
    canvas.environment.addEventListener("darknessChange", this.#onDarknessChange);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _tearDown(options) {
    canvas.environment.removeEventListener("darknessChange", this.#onDarknessChange);
    this.#onDarknessChange = undefined;
    return super._tearDown(options);
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /**
   * Refresh the fields of all the ambient lights on this scene.
   */
  refreshFields() {
    if ( !this.active ) return;
    for ( const ambientLight of this.placeables ) {
      ambientLight.renderFlags.set({refreshField: true});
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _activate() {
    super._activate();
    for ( const p of this.placeables ) p.renderFlags.set({refreshField: true});
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _canDragLeftStart(user, event) {
    // Prevent creating a new light if currently previewing one.
    if ( this.preview.children.length ) {
      ui.notifications.warn("CONTROLS.ObjectConfigured", { localize: true });
      return false;
    }
    return super._canDragLeftStart(user, event);
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftStart(event) {
    super._onDragLeftStart(event);
    const interaction = event.interactionData;

    // Snap the origin to the grid
    if ( !event.shiftKey ) interaction.origin = this.getSnappedPoint(interaction.origin);

    // Create a pending AmbientLightDocument
    const cls = getDocumentClass("AmbientLight");
    const doc = new cls(interaction.origin, {parent: canvas.scene});

    // Create the preview AmbientLight object
    const preview = new this.constructor.placeableClass(doc);

    // Updating interaction data
    interaction.preview = this.preview.addChild(preview);
    interaction.lightsState = 1;

    // Prepare to draw the preview
    preview.draw();
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftMove(event) {
    const {destination, lightsState, preview, origin} = event.interactionData;
    if ( lightsState === 0 ) return;

    // Update the light radius
    const radius = Math.hypot(destination.x - origin.x, destination.y - origin.y);

    // Update the preview object data
    preview.document.config.dim = radius * (canvas.dimensions.distance / canvas.dimensions.size);
    preview.document.config.bright = preview.document.config.dim / 2;

    // Refresh the layer display
    preview.initializeLightSource();
    preview.renderFlags.set({refreshState: true});

    // Confirm the creation state
    event.interactionData.lightsState = 2;
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftCancel(event) {
    super._onDragLeftCancel(event);
    canvas.effects.refreshLighting();
    event.interactionData.lightsState = 0;
  }

  /* -------------------------------------------- */

  /** @override */
  _onMouseWheel(event) {

    // Identify the hovered light source
    const light = this.hover;
    if ( !light || light.isPreview || (light.document.config.angle === 360) ) return;

    // Determine the incremental angle of rotation from event data
    const snap = event.shiftKey ? 15 : 3;
    const delta = snap * Math.sign(event.delta);
    return light.rotate(light.document.rotation + delta, snap);
  }

  /* -------------------------------------------- */

  /**
   * Actions to take when the darkness level of the Scene is changed
   * @param {PIXI.FederatedEvent} event
   * @internal
   */
  _onDarknessChange(event) {
    const {darknessLevel, priorDarknessLevel} = event.environmentData;
    for ( const light of this.placeables ) {
      const {min, max} = light.document.config.darkness;
      if ( darknessLevel.between(min, max) === priorDarknessLevel.between(min, max) ) continue;
      light.initializeLightSource();
      if ( this.active ) light.renderFlags.set({refreshState: true});
    }
  }
}
