/**
 * A layer of background alteration effects which change the appearance of the primary group render texture.
 * @category - Canvas
 */
class CanvasDarknessEffects extends CanvasLayer {
  constructor() {
    super();
    this.sortableChildren = true;
  }

  /* -------------------------------------------- */

  /**
   * Clear coloration effects container
   */
  clear() {
    this.removeChildren();
  }

  /* -------------------------------------------- */

  /** @override */
  async _draw(options) {
    this.filter = VoidFilter.create();
    this.filter.blendMode = PIXI.BLEND_MODES.NORMAL;
    this.filterArea = canvas.app.renderer.screen;
    this.filters = [this.filter];
  }
}
