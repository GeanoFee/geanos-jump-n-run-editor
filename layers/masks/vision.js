/**
 * @typedef {object} _CanvasVisionContainerSight
 * @property {PIXI.LegacyGraphics} preview    FOV that should not be committed to fog exploration.
 */

/**
 * The sight part of {@link CanvasVisionContainer}.
 * The blend mode is MAX_COLOR.
 * @typedef {PIXI.LegacyGraphics & _CanvasVisionContainerSight} CanvasVisionContainerSight
 */

/**
 * @typedef {object} _CanvasVisionContainerLight
 * @property {PIXI.LegacyGraphics} preview    FOV that should not be committed to fog exploration.
 * @property {SpriteMesh} cached              The sprite with the texture of FOV of cached light sources.
 * @property {PIXI.LegacyGraphics & {preview: PIXI.LegacyGraphics}} mask
 *   The light perception polygons of vision sources and the FOV of vision sources that provide vision.
 */

/**
 * The light part of {@link CanvasVisionContainer}.
 * The blend mode is MAX_COLOR.
 * @typedef {PIXI.LegacyGraphics & _CanvasVisionContainerLight} CanvasVisionContainerLight
 */

/**
 * @typedef {object} _CanvasVisionContainerDarkness
 * @property {PIXI.LegacyGraphics} darkness    Darkness source erasing fog of war.
 */

/**
 * The sight part of {@link CanvasVisionContainer}.
 * The blend mode is ERASE.
 * @typedef {PIXI.LegacyGraphics & _CanvasVisionContainerDarkness} CanvasVisionContainerDarkness
 */

/**
 * The sight part of {@link CanvasVisionContainer}.
 * The blend mode is MAX_COLOR.
 * @typedef {PIXI.LegacyGraphics & _CanvasVisionContainerSight} CanvasVisionContainerSight
 */

/**
 * @typedef {object} _CanvasVisionContainer
 * @property {CanvasVisionContainerLight} light       Areas visible because of light sources and light perception.
 * @property {CanvasVisionContainerSight} sight       Areas visible because of FOV of vision sources.
 * @property {CanvasVisionContainerDarkness} darkness Areas erased by darkness sources.
 */

/**
 * The currently visible areas.
 * @typedef {PIXI.Container & _CanvasVisionContainer} CanvasVisionContainer
 */

/**
 * The vision mask which contains the current line-of-sight texture.
 * @category - Canvas
 */
class CanvasVisionMask extends CachedContainer {

  /** @override */
  static textureConfiguration = {
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    format: PIXI.FORMATS.RED,
    multisample: PIXI.MSAA_QUALITY.NONE
  };

  /** @override */
  clearColor = [0, 0, 0, 0];

  /** @override */
  autoRender = false;

  /**
   * The current vision Container.
   * @type {CanvasVisionContainer}
   */
  vision;

  /**
   * The BlurFilter which applies to the vision mask texture.
   * This filter applies a NORMAL blend mode to the container.
   * @type {AlphaBlurFilter}
   */
  blurFilter;

  /* -------------------------------------------- */

  /**
   * Create the BlurFilter for the VisionMask container.
   * @returns {AlphaBlurFilter}
   */
  #createBlurFilter() {
    // Initialize filters properties
    this.filters ??= [];
    this.filterArea = null;

    // Check if the canvas blur is disabled and return without doing anything if necessary
    const b = canvas.blur;
    this.filters.findSplice(f => f === this.blurFilter);
    if ( !b.enabled ) return;

    // Create the new filter
    const f = this.blurFilter = new b.blurClass(b.strength, b.passes, PIXI.Filter.defaultResolution, b.kernels);
    f.blendMode = PIXI.BLEND_MODES.NORMAL;
    this.filterArea = canvas.app.renderer.screen;
    this.filters.push(f);
    return canvas.addBlurFilter(this.blurFilter);
  }

  /* -------------------------------------------- */

  async draw() {
    this.#createBlurFilter();
  }

  /* -------------------------------------------- */

  /**
   * Initialize the vision mask with the los and the fov graphics objects.
   * @param {PIXI.Container} vision         The vision container to attach
   * @returns {CanvasVisionContainer}
   */
  attachVision(vision) {
    return this.vision = this.addChild(vision);
  }

  /* -------------------------------------------- */

  /**
   * Detach the vision mask from the cached container.
   * @returns {CanvasVisionContainer} The detached vision container.
   */
  detachVision() {
    const vision = this.vision;
    this.removeChild(vision);
    this.vision = undefined;
    return vision;
  }

  /* -------------------------------------------- */
  /*  Deprecations and Compatibility              */
  /* -------------------------------------------- */

  /**
   * @deprecated since v11
   * @ignore
   */
  get filter() {
    foundry.utils.logCompatibilityWarning("CanvasVisionMask#filter has been renamed to blurFilter.", {since: 11, until: 13});
    return this.blurFilter;
  }

  /**
   * @deprecated since v11
   * @ignore
   */
  set filter(f) {
    foundry.utils.logCompatibilityWarning("CanvasVisionMask#filter has been renamed to blurFilter.", {since: 11, until: 13});
    this.blurFilter = f;
  }
}
