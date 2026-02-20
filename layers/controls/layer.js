
/**
 * A CanvasLayer for displaying UI controls which are overlayed on top of other layers.
 *
 * We track three types of events:
 * 1) Cursor movement
 * 2) Ruler measurement
 * 3) Map pings
 */
class ControlsLayer extends InteractionLayer {
  constructor() {
    super();

    // Always interactive even if disabled for doors controls
    this.interactiveChildren = true;

    /**
     * A container of DoorControl instances
     * @type {PIXI.Container}
     */
    this.doors = this.addChild(new PIXI.Container());

    /**
     * A container of cursor interaction elements.
     * Contains cursors, rulers, interaction rectangles, and pings
     * @type {PIXI.Container}
     */
    this.cursors = this.addChild(new PIXI.Container());
    this.cursors.eventMode = "none";
    this.cursors.mask = canvas.masks.canvas;

    /**
     * Ruler tools, one per connected user
     * @type {PIXI.Container}
     */
    this.rulers = this.addChild(new PIXI.Container());
    this.rulers.eventMode = "none";

    /**
     * A graphics instance used for drawing debugging visualization
     * @type {PIXI.Graphics}
     */
    this.debug = this.addChild(new PIXI.Graphics());
    this.debug.eventMode = "none";
  }

  /**
   * The Canvas selection rectangle
   * @type {PIXI.Graphics}
   */
  select;

  /**
   * A mapping of user IDs to Cursor instances for quick access
   * @type {Record<string, Cursor>}
   */
  _cursors = {};

  /**
   * A mapping of user IDs to Ruler instances for quick access
   * @type {Record<string, Ruler>}
   * @private
   */
  _rulers = {};

  /**
   * The positions of any offscreen pings we are tracking.
   * @type {Record<string, Point>}
   * @private
   */
  _offscreenPings = {};

  /* -------------------------------------------- */

  /** @override */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "controls",
      zIndex: 1000
    });
  }

  /* -------------------------------------------- */
  /*  Properties and Public Methods               */
  /* -------------------------------------------- */

  /**
   * A convenience accessor to the Ruler for the active game user
   * @type {Ruler}
   */
  get ruler() {
    return this.getRulerForUser(game.user.id);
  }

  /* -------------------------------------------- */

  /**
   * Get the Ruler display for a specific User ID
   * @param {string} userId
   * @returns {Ruler|null}
   */
  getRulerForUser(userId) {
    return this._rulers[userId] || null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);

    // Create additional elements
    this.drawCursors();
    this.drawRulers();
    this.drawDoors();
    this.select = this.cursors.addChild(new PIXI.Graphics());

    // Adjust scale
    const d = canvas.dimensions;
    this.hitArea = d.rect;
  }

  /* -------------------------------------------- */

  /** @override */
  async _tearDown(options) {
    this._cursors = {};
    this._rulers = {};
    this.doors.removeChildren();
    this.cursors.removeChildren();
    this.rulers.removeChildren();
    this.debug.clear();
    this.debug.debugText?.removeChildren().forEach(c => c.destroy({children: true}));
  }

  /* -------------------------------------------- */

  /**
   * Draw the cursors container
   */
  drawCursors() {
    for ( let u of game.users.filter(u => u.active && !u.isSelf ) ) {
      this.drawCursor(u);
    }
  }

  /* -------------------------------------------- */

  /**
   * Create and add Ruler graphics instances for every game User.
   */
  drawRulers() {
    const cls = CONFIG.Canvas.rulerClass;
    for (let u of game.users) {
      let ruler = this.getRulerForUser(u.id);
      if ( !ruler ) ruler = this._rulers[u.id] = new cls(u);
      this.rulers.addChild(ruler);
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw door control icons to the doors container.
   */
  drawDoors() {
    for ( const wall of canvas.walls.placeables ) {
      if ( wall.isDoor ) wall.createDoorControl();
    }
  }

  /* -------------------------------------------- */

  /**
   * Draw the select rectangle given an event originated within the base canvas layer
   * @param {Object} coords   The rectangle coordinates of the form {x, y, width, height}
   */
  drawSelect({x, y, width, height}) {
    const s = this.select.clear();
    s.lineStyle(3, 0xFF9829, 0.9).drawRect(x, y, width, height);
  }

  /* -------------------------------------------- */

  /** @override */
  _deactivate() {
    this.interactiveChildren = true;
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers
  /* -------------------------------------------- */

  /**
   * Handle mousemove events on the game canvas to broadcast activity of the user's cursor position
   */
  _onMouseMove() {
    if ( !game.user.hasPermission("SHOW_CURSOR") ) return;
    game.user.broadcastActivity({cursor: canvas.mousePosition});
  }

  /* -------------------------------------------- */

  /**
   * Handle pinging the canvas.
   * @param {PIXI.FederatedEvent}   event   The triggering canvas interaction event.
   * @param {PIXI.Point}            origin  The local canvas coordinates of the mousepress.
   * @protected
   */
  _onLongPress(event, origin) {
    const isCtrl = game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL);
    const isTokenLayer = canvas.activeLayer instanceof TokenLayer;
    if ( !game.user.hasPermission("PING_CANVAS") || isCtrl || !isTokenLayer ) return;
    canvas.currentMouseManager.cancel(event);    // Cancel drag workflow
    return canvas.ping(origin);
  }

  /* -------------------------------------------- */

  /**
   * Handle the canvas panning to a new view.
   * @protected
   */
  _onCanvasPan() {
    for ( const [name, position] of Object.entries(this._offscreenPings) ) {
      const { ray, intersection } = this._findViewportIntersection(position);
      if ( intersection ) {
        const { x, y } = canvas.canvasCoordinatesFromClient(intersection);
        const ping = CanvasAnimation.getAnimation(name).context;
        ping.x = x;
        ping.y = y;
        ping.rotation = Math.normalizeRadians(ray.angle + (Math.PI * 1.5));
      } else CanvasAnimation.terminateAnimation(name);
    }
  }

  /* -------------------------------------------- */
  /*  Methods
  /* -------------------------------------------- */

  /**
   * Create and draw the Cursor object for a given User
   * @param {User} user   The User document for whom to draw the cursor Container
   */
  drawCursor(user) {
    if ( user.id in this._cursors ) {
      this._cursors[user.id].destroy({children: true});
      delete this._cursors[user.id];
    }
    return this._cursors[user.id] = this.cursors.addChild(new Cursor(user));
  }

  /* -------------------------------------------- */

  /**
   * Update the cursor when the user moves to a new position
   * @param {User} user         The User for whom to update the cursor
   * @param {Point} position    The new cursor position
   */
  updateCursor(user, position) {
    if ( !this.cursors ) return;
    const cursor = this._cursors[user.id] || this.drawCursor(user);

    // Ignore cursors on other Scenes
    if ( ( position === null ) || (user.viewedScene !== canvas.scene.id) ) {
      if ( cursor ) cursor.visible = false;
      return;
    }

    // Show the cursor in its currently tracked position
    cursor.refreshVisibility(user);
    cursor.target = {x: position.x || 0, y: position.y || 0};
  }

  /* -------------------------------------------- */

  /**
   * Update display of an active Ruler object for a user given provided data
   * @param {User} user                              The User for whom to update the ruler
   * @param {RulerMeasurementData|null} rulerData    Data which describes the new ruler measurement to display
   */
  updateRuler(user, rulerData) {

    // Ignore rulers for users who are not permitted to share
    if ( (user === game.user) || !user.hasPermission("SHOW_RULER") ) return;

    // Update the Ruler display for the user
    const ruler = this.getRulerForUser(user.id);
    ruler?.update(rulerData);
  }

  /* -------------------------------------------- */

  /**
   * Handle a broadcast ping.
   * @see {@link Ping#drawPing}
   * @param {User} user                 The user who pinged.
   * @param {Point} position            The position on the canvas that was pinged.
   * @param {PingData} [data]           The broadcast ping data.
   * @returns {Promise<boolean>}        A promise which resolves once the Ping has been drawn and animated
   */
  async handlePing(user, position, {scene, style="pulse", pull=false, zoom=1, ...pingOptions}={}) {
    if ( !canvas.ready || (canvas.scene?.id !== scene) || !position ) return;
    if ( pull && (user.isGM || user.isSelf) ) {
      await canvas.animatePan({
        x: position.x,
        y: position.y,
        scale: Math.min(CONFIG.Canvas.maxZoom, zoom),
        duration: CONFIG.Canvas.pings.pullSpeed
      });
    } else if ( canvas.isOffscreen(position) ) this.drawOffscreenPing(position, { style: "arrow", user });
    if ( game.settings.get("core", "photosensitiveMode") ) style = CONFIG.Canvas.pings.types.PULL;
    return this.drawPing(position, { style, user, ...pingOptions });
  }

  /* -------------------------------------------- */

  /**
   * Draw a ping at the edge of the viewport, pointing to the location of an off-screen ping.
   * @see {@link Ping#drawPing}
   * @param {Point} position                The coordinates of the off-screen ping.
   * @param {PingOptions} [options]         Additional options to configure how the ping is drawn.
   * @param {string} [options.style=arrow]  The style of ping to draw, from CONFIG.Canvas.pings.
   * @param {User} [options.user]           The user who pinged.
   * @returns {Promise<boolean>}            A promise which resolves once the Ping has been drawn and animated
   */
  async drawOffscreenPing(position, {style="arrow", user, ...pingOptions}={}) {
    const { ray, intersection } = this._findViewportIntersection(position);
    if ( !intersection ) return;
    const name = `Ping.${foundry.utils.randomID()}`;
    this._offscreenPings[name] = position;
    position = canvas.canvasCoordinatesFromClient(intersection);
    if ( game.settings.get("core", "photosensitiveMode") ) pingOptions.rings = 1;
    const animation = this.drawPing(position, { style, user, name, rotation: ray.angle, ...pingOptions });
    animation.finally(() => delete this._offscreenPings[name]);
    return animation;
  }

  /* -------------------------------------------- */

  /**
   * Draw a ping on the canvas.
   * @see {@link Ping#animate}
   * @param {Point} position                The position on the canvas that was pinged.
   * @param {PingOptions} [options]         Additional options to configure how the ping is drawn.
   * @param {string} [options.style=pulse]  The style of ping to draw, from CONFIG.Canvas.pings.
   * @param {User} [options.user]           The user who pinged.
   * @returns {Promise<boolean>}            A promise which resolves once the Ping has been drawn and animated
   */
  async drawPing(position, {style="pulse", user, ...pingOptions}={}) {
    const cfg = CONFIG.Canvas.pings.styles[style] ?? CONFIG.Canvas.pings.styles.pulse;
    const options = {
      duration: cfg.duration,
      color: cfg.color ?? user?.color,
      size: canvas.dimensions.size * (cfg.size || 1)
    };
    const ping = new cfg.class(position, foundry.utils.mergeObject(options, pingOptions));
    this.cursors.addChild(ping);
    return ping.animate();
  }

  /* -------------------------------------------- */

  /**
   * Given off-screen coordinates, determine the closest point at the edge of the viewport to these coordinates.
   * @param {Point} position                                     The off-screen coordinates.
   * @returns {{ray: Ray, intersection: LineIntersection|null}}  The closest point at the edge of the viewport to these
   *                                                             coordinates and a ray cast from the centre of the
   *                                                             screen towards it.
   * @private
   */
  _findViewportIntersection(position) {
    let { clientWidth: w, clientHeight: h } = document.documentElement;
    // Accommodate the sidebar.
    if ( !ui.sidebar._collapsed ) w -= ui.sidebar.options.width + 10;
    const [cx, cy] = [w / 2, h / 2];
    const ray = new Ray({x: cx, y: cy}, canvas.clientCoordinatesFromCanvas(position));
    const bounds = [[0, 0, w, 0], [w, 0, w, h], [w, h, 0, h], [0, h, 0, 0]];
    const intersections = bounds.map(ray.intersectSegment.bind(ray));
    const intersection = intersections.find(i => i !== null);
    return { ray, intersection };
  }
}
