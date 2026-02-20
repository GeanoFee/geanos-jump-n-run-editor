/**
 * The Tokens Container.
 * @category - Canvas
 */
class TokenLayer extends PlaceablesLayer {

  /**
   * The current index position in the tab cycle
   * @type {number|null}
   * @private
   */
  _tabIndex = null;

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "tokens",
      controllableObjects: true,
      rotatableObjects: true,
      zIndex: 200
    });
  }

  /** @inheritdoc */
  static documentName = "Token";

  /* -------------------------------------------- */

  /**
   * The set of tokens that trigger occlusion (a union of {@link CONST.TOKEN_OCCLUSION_MODES}).
   * @type {number}
   */
  set occlusionMode(value) {
    this.#occlusionMode = value;
    canvas.perception.update({refreshOcclusion: true});
  }

  get occlusionMode() {
    return this.#occlusionMode;
  }

  #occlusionMode;

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return TokenLayer.name;
  }

  /* -------------------------------------------- */
  /*  Properties
  /* -------------------------------------------- */

  /**
   * Token objects on this layer utilize the TokenHUD
   */
  get hud() {
    return canvas.hud.token;
  }

  /**
   * An Array of tokens which belong to actors which are owned
   * @type {Token[]}
   */
  get ownedTokens() {
    return this.placeables.filter(t => t.actor && t.actor.isOwner);
  }

  /* -------------------------------------------- */
  /*  Methods
  /* -------------------------------------------- */

  /** @override */
  getSnappedPoint(point) {
    const M = CONST.GRID_SNAPPING_MODES;
    return canvas.grid.getSnappedPoint(point, {mode: M.TOP_LEFT_CORNER, resolution: 1});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);
    this.objects.visible = true;
    // Reset the Tokens layer occlusion mode for the Scene
    const M = CONST.TOKEN_OCCLUSION_MODES;
    this.#occlusionMode = game.user.isGM ? M.CONTROLLED | M.HOVERED | M.HIGHLIGHTED : M.OWNED;
    canvas.app.ticker.add(this._animateTargets, this);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _tearDown(options) {
    this.concludeAnimation();
    return super._tearDown(options);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _activate() {
    super._activate();
    if ( canvas.controls ) canvas.controls.doors.visible = true;
    this._tabIndex = null;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _deactivate() {
    super._deactivate();
    this.objects.visible = true;
    if ( canvas.controls ) canvas.controls.doors.visible = false;
  }

  /* -------------------------------------------- */

  /** @override */
  _pasteObject(copy, offset, {hidden=false, snap=true}={}) {
    const {x, y} = copy.document;
    let position = {x: x + offset.x, y: y + offset.y};
    if ( snap ) position = copy.getSnappedPosition(position);
    const d = canvas.dimensions;
    position.x = Math.clamp(position.x, 0, d.width - 1);
    position.y = Math.clamp(position.y, 0, d.height - 1);
    const data = copy.document.toObject();
    delete data._id;
    data.x = position.x;
    data.y = position.y;
    data.hidden ||= hidden;
    return data;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _getMovableObjects(ids, includeLocked) {
    const ruler = canvas.controls.ruler;
    if ( ruler.state === Ruler.STATES.MEASURING ) return [];
    const tokens = super._getMovableObjects(ids, includeLocked);
    if ( ruler.token ) tokens.findSplice(token => token === ruler.token);
    return tokens;
  }

  /* -------------------------------------------- */

  /**
   * Target all Token instances which fall within a coordinate rectangle.
   *
   * @param {object} rectangle                      The selection rectangle.
   * @param {number} rectangle.x                    The top-left x-coordinate of the selection rectangle
   * @param {number} rectangle.y                    The top-left y-coordinate of the selection rectangle
   * @param {number} rectangle.width                The width of the selection rectangle
   * @param {number} rectangle.height               The height of the selection rectangle
   * @param {object} [options]                      Additional options to configure targeting behaviour.
   * @param {boolean} [options.releaseOthers=true]  Whether or not to release other targeted tokens
   * @returns {number}                              The number of Token instances which were targeted.
   */
  targetObjects({x, y, width, height}, {releaseOthers=true}={}) {
    const user = game.user;

    // Get the set of targeted tokens
    const targets = new Set();
    const rectangle = new PIXI.Rectangle(x, y, width, height);
    for ( const token of this.placeables ) {
      if ( !token.visible || token.document.isSecret ) continue;
      if ( token._overlapsSelection(rectangle) ) targets.add(token);
    }

    // Maybe release other targets
    if ( releaseOthers ) {
      for ( const token of user.targets ) {
        if ( targets.has(token) ) continue;
        token.setTarget(false, {releaseOthers: false, groupSelection: true});
      }
    }

    // Acquire targets for tokens which are not yet targeted
    for ( const token of targets ) {
      if ( user.targets.has(token) ) continue;
      token.setTarget(true, {releaseOthers: false, groupSelection: true});
    }

    // Broadcast the target change
    user.broadcastActivity({targets: user.targets.ids});

    // Return the number of targeted tokens
    return user.targets.size;
  }

  /* -------------------------------------------- */

  /**
   * Cycle the controlled token by rotating through the list of Owned Tokens that are available within the Scene
   * Tokens are currently sorted in order of their TokenID
   *
   * @param {boolean} forwards  Which direction to cycle. A truthy value cycles forward, while a false value
   *                            cycles backwards.
   * @param {boolean} reset     Restart the cycle order back at the beginning?
   * @returns {Token|null}       The Token object which was cycled to, or null
   */
  cycleTokens(forwards, reset) {
    let next = null;
    if ( reset ) this._tabIndex = null;
    const order = this._getCycleOrder();

    // If we are not tab cycling, try and jump to the currently controlled or impersonated token
    if ( this._tabIndex === null ) {
      this._tabIndex = 0;

      // Determine the ideal starting point based on controlled tokens or the primary character
      let current = this.controlled.length ? order.find(t => this.controlled.includes(t)) : null;
      if ( !current && game.user.character ) {
        const actorTokens = game.user.character.getActiveTokens();
        current = actorTokens.length ? order.find(t => actorTokens.includes(t)) : null;
      }
      current = current || order[this._tabIndex] || null;

      // Either start cycling, or cancel
      if ( !current ) return null;
      next = current;
    }

    // Otherwise, cycle forwards or backwards
    else {
      if ( forwards ) this._tabIndex = this._tabIndex < (order.length - 1) ? this._tabIndex + 1 : 0;
      else this._tabIndex = this._tabIndex > 0 ? this._tabIndex - 1 : order.length - 1;
      next = order[this._tabIndex];
      if ( !next ) return null;
    }

    // Pan to the token and control it (if possible)
    canvas.animatePan({x: next.center.x, y: next.center.y, duration: 250});
    next.control();
    return next;
  }

  /* -------------------------------------------- */

  /**
   * Get the tab cycle order for tokens by sorting observable tokens based on their distance from top-left.
   * @returns {Token[]}
   * @private
   */
  _getCycleOrder() {
    const observable = this.placeables.filter(token => {
      if ( game.user.isGM ) return true;
      if ( !token.actor?.testUserPermission(game.user, "OBSERVER") ) return false;
      return !token.document.hidden;
    });
    observable.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    return observable;
  }

  /* -------------------------------------------- */

  /**
   * Immediately conclude the animation of any/all tokens
   */
  concludeAnimation() {
    this.placeables.forEach(t => t.stopAnimation());
    canvas.app.ticker.remove(this._animateTargets, this);
  }

  /* -------------------------------------------- */

  /**
   * Animate targeting arrows on targeted tokens.
   * @private
   */
  _animateTargets() {
    if ( !game.user.targets.size ) return;
    if ( this._t === undefined ) this._t = 0;
    else this._t += canvas.app.ticker.elapsedMS;
    const duration = 2000;
    const pause = duration * .6;
    const fade = (duration - pause) * .25;
    const minM = .5; // Minimum margin is half the size of the arrow.
    const maxM = 1; // Maximum margin is the full size of the arrow.
    // The animation starts with the arrows halfway across the token bounds, then move fully inside the bounds.
    const rm = maxM - minM;
    const t = this._t % duration;
    let dt = Math.max(0, t - pause) / (duration - pause);
    dt = CanvasAnimation.easeOutCircle(dt);
    const m = t < pause ? minM : minM + (rm * dt);
    const ta = Math.max(0, t - duration + fade);
    const a = 1 - (ta / fade);

    for ( const t of game.user.targets ) {
      t._refreshTarget({
        margin: m,
        alpha: a,
        color: CONFIG.Canvas.targeting.color,
        size: CONFIG.Canvas.targeting.size
      });
    }
  }

  /* -------------------------------------------- */

  /**
   * Provide an array of Tokens which are eligible subjects for tile occlusion.
   * By default, only tokens which are currently controlled or owned by a player are included as subjects.
   * @returns {Token[]}
   * @protected
   * @internal
   */
  _getOccludableTokens() {
    const M = CONST.TOKEN_OCCLUSION_MODES;
    const mode = this.occlusionMode;
    if ( (mode & M.VISIBLE) || ((mode & M.HIGHLIGHTED) && this.highlightObjects) ) {
      return this.placeables.filter(t => t.visible);
    }
    const tokens = new Set();
    if ( (mode & M.HOVERED) && this.hover ) tokens.add(this.hover);
    if ( mode & M.CONTROLLED ) this.controlled.forEach(t => tokens.add(t));
    if ( mode & M.OWNED ) this.ownedTokens.filter(t => !t.document.hidden).forEach(t => tokens.add(t));
    return Array.from(tokens);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  storeHistory(type, data) {
    super.storeHistory(type, type === "update" ? data.map(d => {
      // Clean actorData and delta updates from the history so changes to those fields are not undone.
      d = foundry.utils.deepClone(d);
      delete d.actorData;
      delete d.delta;
      delete d._regions;
      return d;
    }) : data);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Handle dropping of Actor data onto the Scene canvas
   * @private
   */
  async _onDropActorData(event, data) {

    // Ensure the user has permission to drop the actor and create a Token
    if ( !game.user.can("TOKEN_CREATE") ) {
      return ui.notifications.warn("You do not have permission to create new Tokens!");
    }

    // Acquire dropped data and import the actor
    let actor = await Actor.implementation.fromDropData(data);
    if ( !actor.isOwner ) {
      return ui.notifications.warn(`You do not have permission to create a new Token for the ${actor.name} Actor.`);
    }
    if ( actor.compendium ) {
      const actorData = game.actors.fromCompendium(actor);
      actor = await Actor.implementation.create(actorData, {fromCompendium: true});
    }

    // Prepare the Token document
    const td = await actor.getTokenDocument({
      hidden: game.user.isGM && event.altKey,
      sort: Math.max(this.getMaxSort() + 1, 0)
    }, {parent: canvas.scene});

    // Set the position of the Token such that its center point is the drop position before snapping
    const t = this.createObject(td);
    let position = t.getCenterPoint({x: 0, y: 0});
    position.x = data.x - position.x;
    position.y = data.y - position.y;
    if ( !event.shiftKey ) position = t.getSnappedPosition(position);
    t.destroy({children: true});
    td.updateSource(position);

    // Validate the final position
    if ( !canvas.dimensions.rect.contains(td.x, td.y) ) return false;

    // Submit the Token creation request and activate the Tokens layer (if not already active)
    this.activate();
    return td.constructor.create(td, {parent: canvas.scene});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClickLeft(event) {
    let tool = game.activeTool;

    // If Control is being held, we always want the Tool to be Ruler
    if ( game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL) ) tool = "ruler";
    switch ( tool ) {
      // Clear targets if Left Click Release is set
      case "target":
        if ( game.settings.get("core", "leftClickRelease") ) {
          game.user.updateTokenTargets([]);
          game.user.broadcastActivity({targets: []});
        }
        break;

      // Place Ruler waypoints
      case "ruler":
        return canvas.controls.ruler._onClickLeft(event);
    }

    // If we don't explicitly return from handling the tool, use the default behavior
    super._onClickLeft(event);
  }

  /* -------------------------------------------- */

  /** @override */
  _onMouseWheel(event) {

    // Prevent wheel rotation during dragging
    if ( this.preview.children.length ) return;

    // Determine the incremental angle of rotation from event data
    const snap = canvas.grid.isHexagonal ? (event.shiftKey ? 60 : 30) : (event.shiftKey ? 45 : 15);
    const delta = snap * Math.sign(event.delta);
    return this.rotateMany({delta, snap});
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
    return 1; // Snap tokens to top-left
  }

  /* -------------------------------------------- */

  /**
   * @deprecated since v12
   * @ignore
   */
  async toggleCombat(state=true, combat=null, {token=null}={}) {
    foundry.utils.logCompatibilityWarning("TokenLayer#toggleCombat is deprecated in favor of"
      + " TokenDocument.implementation.createCombatants and TokenDocument.implementation.deleteCombatants", {since: 12, until: 14});
    const tokens = this.controlled.map(t => t.document);
    if ( token && !token.controlled && (token.inCombat !== state) ) tokens.push(token.document);
    if ( state ) return TokenDocument.implementation.createCombatants(tokens, {combat});
    else return TokenDocument.implementation.deleteCombatants(tokens, {combat});
  }
}
