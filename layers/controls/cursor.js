/**
 * A single Mouse Cursor
 * @type {PIXI.Container}
 */
class Cursor extends PIXI.Container {
  constructor(user) {
    super();
    this.target = {x: 0, y: 0};
    this.draw(user);
  }

  /**
   * To know if this cursor is animated
   * @type {boolean}
   */
  #animating;

  /* -------------------------------------------- */

  /**
   * Update visibility and animations
   * @param {User} user  The user
   */
  refreshVisibility(user) {
    const v = this.visible = !user.isSelf && user.hasPermission("SHOW_CURSOR");

    if ( v && !this.#animating ) {
      canvas.app.ticker.add(this._animate, this);
      this.#animating = true; // Set flag to true when animation is added
    } else if ( !v && this.#animating ) {
      canvas.app.ticker.remove(this._animate, this);
      this.#animating = false; // Set flag to false when animation is removed
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw the user's cursor as a small dot with their user name attached as text
   */
  draw(user) {

    // Cursor dot
    const d = this.addChild(new PIXI.Graphics());
    d.beginFill(user.color, 0.35).lineStyle(1, 0x000000, 0.5).drawCircle(0, 0, 6);

    // Player name
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize = 14;
    let n = this.addChild(new PreciseText(user.name, style));
    n.x -= n.width / 2;
    n.y += 10;

    // Refresh
    this.refreshVisibility(user);
  }

  /* -------------------------------------------- */

  /**
   * Move an existing cursor to a new position smoothly along the animation loop
   */
  _animate() {
    const dy = this.target.y - this.y;
    const dx = this.target.x - this.x;
    if ( Math.abs( dx ) + Math.abs( dy ) < 10 ) return;
    this.x += dx / 10;
    this.y += dy / 10;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  destroy(options) {
    if ( this.#animating ) {
      canvas.app.ticker.remove(this._animate, this);
      this.#animating = false;
    }
    super.destroy(options);
  }
}
