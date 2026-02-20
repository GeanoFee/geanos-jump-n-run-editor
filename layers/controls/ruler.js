/**
 * @typedef {Object} RulerMeasurementSegment
 * @property {Ray} ray                      The Ray which represents the point-to-point line segment
 * @property {PreciseText} label            The text object used to display a label for this segment
 * @property {number} distance              The measured distance of the segment
 * @property {number} cost                  The measured cost of the segment
 * @property {number} cumulativeDistance    The cumulative measured distance of this segment and the segments before it
 * @property {number} cumulativeCost        The cumulative measured cost of this segment and the segments before it
 * @property {boolean} history              Is this segment part of the measurement history?
 * @property {boolean} first                Is this segment the first one after the measurement history?
 * @property {boolean} last                 Is this segment the last one?
 * @property {object} animation             Animation options passed to {@link TokenDocument#update}
 */

/**
 * @typedef {object} RulerMeasurementHistoryWaypoint
 * @property {number} x            The x-coordinate of the waypoint
 * @property {number} y            The y-coordinate of the waypoint
 * @property {boolean} teleport    Teleported to from the previous waypoint this waypoint?
 * @property {number} cost         The cost of having moved from the previous waypoint to this waypoint
 */

/**
 * @typedef {RulerMeasurementHistoryWaypoint[]} RulerMeasurementHistory
 */

/**
 * The Ruler - used to measure distances and trigger movements
 */
class Ruler extends PIXI.Container {
  /**
   * The Ruler constructor.
   * @param {User} [user=game.user]          The User for whom to construct the Ruler instance
   * @param {object} [options]               Additional options
   * @param {ColorSource} [options.color]    The color of the ruler (defaults to the color of the User)
   */
  constructor(user=game.user, {color}={}) {
    super();

    /**
     * Record the User which this Ruler references
     * @type {User}
     */
    this.user = user;

    /**
     * The ruler name - used to differentiate between players
     * @type {string}
     */
    this.name = `Ruler.${user.id}`;

    /**
     * The ruler color - by default the color of the active user
     * @type {Color}
     */
    this.color = Color.from(color ?? this.user.color);

    /**
     * The Ruler element is a Graphics instance which draws the line and points of the measured path
     * @type {PIXI.Graphics}
     */
    this.ruler = this.addChild(new PIXI.Graphics());

    /**
     * The Labels element is a Container of Text elements which label the measured path
     * @type {PIXI.Container}
     */
    this.labels = this.addChild(new PIXI.Container());
  }

  /* -------------------------------------------- */

  /**
   * The possible Ruler measurement states.
   * @enum {number}
   */
  static get STATES() {
    return Ruler.#STATES;
  }

  static #STATES = Object.freeze({
    INACTIVE: 0,
    STARTING: 1,
    MEASURING: 2,
    MOVING: 3
  });

  /* -------------------------------------------- */

  /**
   * Is the ruler ready for measure?
   * @type {boolean}
   */
  static get canMeasure() {
    return (game.activeTool === "ruler") || game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL);
  }

  /* -------------------------------------------- */

  /**
   * The current destination point at the end of the measurement
   * @type {Point|null}
   */
  destination = null;

  /* -------------------------------------------- */

  /**
   * The origin point of the measurement, which is the first waypoint.
   * @type {Point|null}
   */
  get origin() {
    return this.waypoints.at(0) ?? null;
  }

  /* -------------------------------------------- */

  /**
   * This Array tracks individual waypoints along the ruler's measured path.
   * The first waypoint is always the origin of the route.
   * @type {Point[]}
   */
  waypoints = [];

  /* -------------------------------------------- */

  /**
   * The array of most recently computed ruler measurement segments
   * @type {RulerMeasurementSegment[]}
   */
  segments = [];

  /* -------------------------------------------- */

  /**
   * The measurement history.
   * @type {RulerMeasurementHistory}
   */
  get history() {
    return this.#history;
  }

  #history = [];

  /* -------------------------------------------- */

  /**
   * The computed total distance of the Ruler.
   * @type {number}
   */
  totalDistance = 0;

  /* -------------------------------------------- */

  /**
   * The computed total cost of the Ruler.
   * @type {number}
   */
  totalCost = 0;

  /* -------------------------------------------- */

  /**
   * The current state of the Ruler (one of {@link Ruler.STATES}).
   * @type {number}
   */
  get state() {
    return this._state;
  }

  /**
   * The current state of the Ruler (one of {@link Ruler.STATES}).
   * @type {number}
   * @protected
   */
  _state = Ruler.STATES.INACTIVE;

  /* -------------------------------------------- */

  /**
   * Is the Ruler being actively used to measure distance?
   * @type {boolean}
   */
  get active() {
    return this.state !== Ruler.STATES.INACTIVE;
  }

  /* -------------------------------------------- */

  /**
   * Get a GridHighlight layer for this Ruler
   * @type {GridHighlight}
   */
  get highlightLayer() {
    return canvas.interface.grid.highlightLayers[this.name] || canvas.interface.grid.addHighlightLayer(this.name);
  }

  /* -------------------------------------------- */

  /**
   * The Token that is moved by the Ruler.
   * @type {Token|null}
   */
  get token() {
    return this.#token;
  }

  #token = null;

  /* -------------------------------------------- */
  /*  Ruler Methods                               */
  /* -------------------------------------------- */

  /**
   * Clear display of the current Ruler
   */
  clear() {
    this._state = Ruler.STATES.INACTIVE;
    this.#token = null;
    this.destination = null;
    this.waypoints = [];
    this.segments = [];
    this.#history = [];
    this.totalDistance = 0;
    this.totalCost = 0;
    this.ruler.clear();
    this.labels.removeChildren().forEach(c => c.destroy());
    canvas.interface.grid.clearHighlightLayer(this.name);
  }

  /* -------------------------------------------- */

  /**
   * Measure the distance between two points and render the ruler UI to illustrate it
   * @param {Point} destination                        The destination point to which to measure
   * @param {object} [options]                         Additional options
   * @param {boolean} [options.snap=true]              Snap the destination?
   * @param {boolean} [options.force=false]            If not forced and the destination matches the current destination
   *                                                   of this ruler, no measuring is done and nothing is returned
   * @returns {RulerMeasurementSegment[]|void}         The array of measured segments if measured
   */
  measure(destination, {snap=true, force=false}={}) {
    if ( this.state !== Ruler.STATES.MEASURING ) return;

    // Compute the measurement destination, segments, and distance
    const d = this._getMeasurementDestination(destination, {snap});
    if ( this.destination && (d.x === this.destination.x) && (d.y === this.destination.y) && !force ) return;
    this.destination = d;
    this.segments = this._getMeasurementSegments();
    this._computeDistance();
    this._broadcastMeasurement();

    // Draw the ruler graphic
    this.ruler.clear();
    this._drawMeasuredPath();

    // Draw grid highlight
    this.highlightLayer.clear();
    for ( const segment of this.segments ) this._highlightMeasurementSegment(segment);
    return this.segments;
  }

  /* -------------------------------------------- */

  /**
   * Get the measurement origin.
   * @param {Point} point                    The waypoint
   * @param {object} [options]               Additional options
   * @param {boolean} [options.snap=true]    Snap the waypoint?
   * @protected
   */
  _getMeasurementOrigin(point, {snap=true}={}) {
    if ( this.token && snap ) {
      if ( canvas.grid.isGridless ) return this.token.getCenterPoint();
      const snapped = this.token.getSnappedPosition();
      const dx = this.token.document.x - Math.round(snapped.x);
      const dy = this.token.document.y - Math.round(snapped.y);
      const center = canvas.grid.getCenterPoint({x: point.x - dx, y: point.y - dy});
      return {x: center.x + dx, y: center.y + dy};
    }
    return snap ? canvas.grid.getCenterPoint(point) : {x: point.x, y: point.y};
  }

  /* -------------------------------------------- */

  /**
   * Get the destination point. By default the point is snapped to grid space centers.
   * @param {Point} point                    The point coordinates
   * @param {object} [options]               Additional options
   * @param {boolean} [options.snap=true]    Snap the point?
   * @returns {Point}                        The snapped destination point
   * @protected
   */
  _getMeasurementDestination(point, {snap=true}={}) {
    return snap ? canvas.grid.getCenterPoint(point) : {x: point.x, y: point.y};
  }

  /* -------------------------------------------- */

  /**
   * Translate the waypoints and destination point of the Ruler into an array of Ray segments.
   * @returns {RulerMeasurementSegment[]} The segments of the measured path
   * @protected
   */
  _getMeasurementSegments() {
    const segments = [];
    const path = this.history.concat(this.waypoints.concat([this.destination]));
    for ( let i = 1; i < path.length; i++ ) {
      const label = this.labels.children.at(i - 1) ?? this.labels.addChild(new PreciseText("", CONFIG.canvasTextStyle));
      const ray = new Ray(path[i - 1], path[i]);
      segments.push({
        ray,
        teleport: (i < this.history.length) ? path[i].teleport : (i === this.history.length) && (ray.distance > 0),
        label,
        distance: 0,
        cost: 0,
        cumulativeDistance: 0,
        cumulativeCost: 0,
        history: i <= this.history.length,
        first: i === this.history.length + 1,
        last: i === path.length - 1,
        animation: {}
      });
    }
    if ( this.labels.children.length > segments.length ) {
      this.labels.removeChildren(segments.length).forEach(c => c.destroy());
    }
    return segments;
  }

  /* -------------------------------------------- */

  /**
   * Handle the start of a Ruler measurement workflow
   * @param {Point} origin                   The origin
   * @param {object} [options]               Additional options
   * @param {boolean} [options.snap=true]    Snap the origin?
   * @param {Token|null} [options.token]     The token that is moved (defaults to {@link Ruler#_getMovementToken})
   * @protected
   */
  _startMeasurement(origin, {snap=true, token}={}) {
    if ( this.state !== Ruler.STATES.INACTIVE ) return;
    this.clear();
    this._state = Ruler.STATES.STARTING;
    this.#token = token !== undefined ? token : this._getMovementToken(origin);
    this.#history = this._getMeasurementHistory() ?? [];
    this._addWaypoint(origin, {snap});
    canvas.hud.token.clear();
  }

  /* -------------------------------------------- */

  /**
   * Handle the conclusion of a Ruler measurement workflow
   * @protected
   */
  _endMeasurement() {
    if ( this.state !== Ruler.STATES.MEASURING ) return;
    this.clear();
    this._broadcastMeasurement();
  }

  /* -------------------------------------------- */

  /**
   * Handle the addition of a new waypoint in the Ruler measurement path
   * @param {Point} point                    The waypoint
   * @param {object} [options]               Additional options
   * @param {boolean} [options.snap=true]    Snap the waypoint?
   * @protected
   */
  _addWaypoint(point, {snap=true}={}) {
    if ( (this.state !== Ruler.STATES.STARTING) && (this.state !== Ruler.STATES.MEASURING ) ) return;
    const waypoint = this.state === Ruler.STATES.STARTING
      ? this._getMeasurementOrigin(point, {snap})
      : this._getMeasurementDestination(point, {snap});
    this.waypoints.push(waypoint);
    this._state = Ruler.STATES.MEASURING;
    this.measure(this.destination ?? point, {snap, force: true});
  }

  /* -------------------------------------------- */

  /**
   * Handle the removal of a waypoint in the Ruler measurement path
   * @protected
   */
  _removeWaypoint() {
    if ( (this.state !== Ruler.STATES.STARTING) && (this.state !== Ruler.STATES.MEASURING ) ) return;
    if ( (this.state === Ruler.STATES.MEASURING) && (this.waypoints.length > 1) ) {
      this.waypoints.pop();
      this.measure(this.destination, {snap: false, force: true});
    }
    else this._endMeasurement();
  }

  /* -------------------------------------------- */

  /**
   * Get the cost function to be used for Ruler measurements.
   * @returns {GridMeasurePathCostFunction|void}
   * @protected
   */
  _getCostFunction() {}

  /* -------------------------------------------- */

  /**
   * Compute the distance of each segment and the total distance of the measured path.
   * @protected
   */
  _computeDistance() {
    let path = [];
    if ( this.segments.length ) path.push(this.segments[0].ray.A);
    for ( const segment of this.segments ) {
      const {x, y} = segment.ray.B;
      path.push({x, y, teleport: segment.teleport});
    }
    const measurements = canvas.grid.measurePath(path, {cost: this._getCostFunction()}).segments;
    this.totalDistance = 0;
    this.totalCost = 0;
    for ( let i = 0; i < this.segments.length; i++ ) {
      const segment = this.segments[i];
      const distance = measurements[i].distance;
      const cost = segment.history ? this.history.at(i + 1)?.cost ?? 0 : measurements[i].cost;
      this.totalDistance += distance;
      this.totalCost += cost;
      segment.distance = distance;
      segment.cost = cost;
      segment.cumulativeDistance = this.totalDistance;
      segment.cumulativeCost = this.totalCost;
    }
  }

  /* -------------------------------------------- */

  /**
   * Get the text label for a segment of the measured path
   * @param {RulerMeasurementSegment} segment
   * @returns {string}
   * @protected
   */
  _getSegmentLabel(segment) {
    if ( segment.teleport ) return "";
    const units = canvas.grid.units;
    let label = `${Math.round(segment.distance * 100) / 100}`;
    if ( units ) label += ` ${units}`;
    if ( segment.last ) {
      label += ` [${Math.round(this.totalDistance * 100) / 100}`;
      if ( units ) label += ` ${units}`;
      label += "]";
    }
    return label;
  }

  /* -------------------------------------------- */

  /**
   * Draw each segment of the measured path.
   * @protected
   */
  _drawMeasuredPath() {
    const paths = [];
    let path = null;
    for ( const segment of this.segments ) {
      const ray = segment.ray;
      if ( ray.distance !== 0 ) {
        if ( segment.teleport ) path = null;
        else {
          if ( !path || (path.history !== segment.history) ) {
            path = {points: [ray.A], history: segment.history};
            paths.push(path);
          }
          path.points.push(ray.B);
        }
      }

      // Draw Label
      const label = segment.label;
      if ( label ) {
        const text = this._getSegmentLabel(segment, /** @deprecated since v12 */ this.totalDistance);
        label.text = text;
        label.alpha = segment.last ? 1.0 : 0.5;
        label.visible = !!text && (ray.distance !== 0);
        label.anchor.set(0.5, 0.5);
        let {sizeX, sizeY} = canvas.grid;
        if ( canvas.grid.isGridless ) sizeX = sizeY = 6; // The radius of the waypoints
        const pad = 8;
        const offsetX = (label.width + (2 * pad) + sizeX) / Math.abs(2 * ray.dx);
        const offsetY = (label.height + (2 * pad) + sizeY) / Math.abs(2 * ray.dy);
        label.position = ray.project(1 + Math.min(offsetX, offsetY));
      }
    }
    const points = paths.map(p => p.points).flat();

    // Draw segments
    if ( points.length === 1 ) {
      this.ruler.beginFill(0x000000, 0.5, true).drawCircle(points[0].x, points[0].y, 3).endFill();
      this.ruler.beginFill(this.color, 0.25, true).drawCircle(points[0].x, points[0].y, 2).endFill();
    } else {
      const dashShader = new PIXI.smooth.DashLineShader();
      for ( const {points, history} of paths ) {
        this.ruler.lineStyle({width: 6, color: 0x000000, alpha: 0.5, shader: history ? dashShader : null,
          join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND});
        this.ruler.drawPath(points);
        this.ruler.lineStyle({width: 4, color: this.color, alpha: 0.25, shader: history ? dashShader : null,
          join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND});
        this.ruler.drawPath(points);
      }
    }

    // Draw waypoints
    this.ruler.beginFill(this.color, 0.25, true).lineStyle(2, 0x000000, 0.5);
    for ( const {x, y} of points ) this.ruler.drawCircle(x, y, 6);
    this.ruler.endFill();
  }

  /* -------------------------------------------- */

  /**
   * Highlight the measurement required to complete the move in the minimum number of discrete spaces
   * @param {RulerMeasurementSegment} segment
   * @protected
   */
  _highlightMeasurementSegment(segment) {
    if ( segment.teleport ) return;
    for ( const offset of canvas.grid.getDirectPath([segment.ray.A, segment.ray.B]) ) {
      const {x: x1, y: y1} = canvas.grid.getTopLeftPoint(offset);
      canvas.interface.grid.highlightPosition(this.name, {x: x1, y: y1, color: this.color});
    }
  }

  /* -------------------------------------------- */
  /*  Token Movement Execution                    */
  /* -------------------------------------------- */

  /**
   * Determine whether a SPACE keypress event entails a legal token movement along a measured ruler
   * @returns {Promise<boolean>}  An indicator for whether a token was successfully moved or not. If True the
   *                              event should be prevented from propagating further, if False it should move on
   *                              to other handlers.
   */
  async moveToken() {
    if ( this.state !== Ruler.STATES.MEASURING ) return false;
    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", {localize: true});
      return false;
    }

    // Get the Token which should move
    const token = this.token;
    if ( !token ) return false;

    // Verify whether the movement is allowed
    let error;
    try {
      if ( !this._canMove(token) ) error = "RULER.MovementNotAllowed";
    } catch(err) {
      error = err.message;
    }
    if ( error ) {
      ui.notifications.error(error, {localize: true});
      return false;
    }

    // Animate the movement path defined by each ray segments
    this._state = Ruler.STATES.MOVING;
    await this._preMove(token);
    await this._animateMovement(token);
    await this._postMove(token);

    // Clear the Ruler
    this._state = Ruler.STATES.MEASURING;
    this._endMeasurement();
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Acquire a Token, if any, which is eligible to perform a movement based on the starting point of the Ruler
   * @param {Point} origin    The origin of the Ruler
   * @returns {Token|null}    The Token that is to be moved, if any
   * @protected
   */
  _getMovementToken(origin) {
    let tokens = canvas.tokens.controlled;
    if ( !tokens.length && game.user.character ) tokens = game.user.character.getActiveTokens();
    for ( const token of tokens ) {
      if ( !token.visible || !token.shape ) continue;
      const {x, y} = token.document;
      for ( let dx = -1; dx <= 1; dx++ ) {
        for ( let dy = -1; dy <= 1; dy++ ) {
          if ( token.shape.contains(origin.x - x + dx, origin.y - y + dy) ) return token;
        }
      }
    }
    return null;
  }

  /* -------------------------------------------- */

  /**
   * Get the current measurement history.
   * @returns {RulerMeasurementHistory|void}    The current measurement history, if any
   * @protected
   */
  _getMeasurementHistory() {}

  /* -------------------------------------------- */

  /**
   * Create the next measurement history from the current history and current Ruler state.
   * @returns {RulerMeasurementHistory}    The next measurement history
   * @protected
   */
  _createMeasurementHistory() {
    if ( !this.segments.length ) return [];
    const origin = this.segments[0].ray.A;
    return this.segments.reduce((history, s) => {
      if ( s.ray.distance === 0 ) return history;
      history.push({x: s.ray.B.x, y: s.ray.B.y, teleport: s.teleport, cost: s.cost});
      return history;
    }, [{x: origin.x, y: origin.y, teleport: false, cost: 0}]);
  }

  /* -------------------------------------------- */

  /**
   * Test whether a Token is allowed to execute a measured movement path.
   * @param {Token} token       The Token being tested
   * @returns {boolean}         Whether the movement is allowed
   * @throws                    A specific Error message used instead of returning false
   * @protected
   */
  _canMove(token) {
    const canUpdate = token.document.canUserModify(game.user, "update");
    if ( !canUpdate ) throw new Error("RULER.MovementNoPermission");
    if ( token.document.locked ) throw new Error("RULER.MovementLocked");
    const hasCollision = this.segments.some(s => {
      return token.checkCollision(s.ray.B, {origin: s.ray.A, type: "move", mode: "any"});
    });
    if ( hasCollision ) throw new Error("RULER.MovementCollision");
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Animate piecewise Token movement along the measured segment path.
   * @param {Token} token           The Token being animated
   * @returns {Promise<void>}       A Promise which resolves once all animation is completed
   * @protected
   */
  async _animateMovement(token) {
    const wasPaused = game.paused;

    // Determine offset of the initial origin relative to the snapped Token's top-left.
    // This is important to position the token relative to the ruler origin for non-1x1 tokens.
    const origin = this.segments[this.history.length].ray.A;
    const dx = token.document.x - origin.x;
    const dy = token.document.y - origin.y;

    // Iterate over each measured segment
    let priorDest = undefined;
    for ( const segment of this.segments ) {
      if ( segment.history || (segment.ray.distance === 0) ) continue;
      const r = segment.ray;
      const {x, y} = token.document._source;

      // Break the movement if the game is paused
      if ( !wasPaused && game.paused ) break;

      // Break the movement if Token is no longer located at the prior destination (some other change override this)
      if ( priorDest && ((x !== priorDest.x) || (y !== priorDest.y)) ) break;

      // Commit the movement and update the final resolved destination coordinates
      const adjustedDestination = {x: Math.round(r.B.x + dx), y: Math.round(r.B.y + dy)};
      await this._animateSegment(token, segment, adjustedDestination);
      priorDest = adjustedDestination;
    }
  }

  /* -------------------------------------------- */

  /**
   * Update Token position and configure its animation properties for the next leg of its animation.
   * @param {Token} token                         The Token being updated
   * @param {RulerMeasurementSegment} segment     The measured segment being moved
   * @param {Point} destination                   The adjusted destination coordinate
   * @param {object} [updateOptions]              Additional options to configure the `TokenDocument` update
   * @returns {Promise<void>}                     A Promise that resolves once the animation for this segment is done
   * @protected
   */
  async _animateSegment(token, segment, destination, updateOptions={}) {
    let name;
    if ( segment.animation?.name === undefined ) name = token.animationName;
    else name ||= Symbol(token.animationName);
    const {x, y} = token.document._source;
    await token.animate({x, y}, {name, duration: 0});
    foundry.utils.mergeObject(
      updateOptions,
      {teleport: segment.teleport, animation: {...segment.animation, name}},
      {overwrite: false}
    );
    await token.document.update(destination, updateOptions);
    await CanvasAnimation.getAnimation(name)?.promise;
  }

  /* -------------------------------------------- */

  /**
   * An method which can be extended by a subclass of Ruler to define custom behaviors before a confirmed movement.
   * @param {Token} token       The Token that will be moving
   * @returns {Promise<void>}
   * @protected
   */
  async _preMove(token) {}

  /* -------------------------------------------- */

  /**
   * An event which can be extended by a subclass of Ruler to define custom behaviors before a confirmed movement.
   * @param {Token} token       The Token that finished moving
   * @returns {Promise<void>}
   * @protected
   */
  async _postMove(token) {}

  /* -------------------------------------------- */
  /*  Saving and Loading
  /* -------------------------------------------- */

  /**
   * A throttled function that broadcasts the measurement data.
   * @type {function()}
   */
  #throttleBroadcastMeasurement = foundry.utils.throttle(this.#broadcastMeasurement.bind(this), 100);

  /* -------------------------------------------- */

  /**
   * Broadcast Ruler measurement.
   */
  #broadcastMeasurement() {
    game.user.broadcastActivity({ruler: this.active ? this._getMeasurementData() : null});
  }

  /* -------------------------------------------- */

  /**
   * Broadcast Ruler measurement if its User is the connected client.
   * The broadcast is throttled to 100ms.
   * @protected
   */
  _broadcastMeasurement() {
    if ( !this.user.isSelf || !game.user.hasPermission("SHOW_RULER") ) return;
    this.#throttleBroadcastMeasurement();
  }

  /* -------------------------------------------- */

  /**
   * @typedef {object} RulerMeasurementData
   * @property {number} state                       The state ({@link Ruler#state})
   * @property {string|null} token                  The token ID ({@link Ruler#token})
   * @property {RulerMeasurementHistory} history    The measurement history ({@link Ruler#history})
   * @property {Point[]} waypoints                  The waypoints ({@link Ruler#waypoints})
   * @property {Point|null} destination             The destination ({@link Ruler#destination})
   */

  /**
   * Package Ruler data to an object which can be serialized to a string.
   * @returns {RulerMeasurementData}
   * @protected
   */
  _getMeasurementData() {
    return foundry.utils.deepClone({
      state: this.state,
      token: this.token?.id ?? null,
      history: this.history,
      waypoints: this.waypoints,
      destination: this.destination
    });
  }

  /* -------------------------------------------- */

  /**
   * Update a Ruler instance using data provided through the cursor activity socket
   * @param {RulerMeasurementData|null} data   Ruler data with which to update the display
   */
  update(data) {
    if ( !data || (data.state === Ruler.STATES.INACTIVE) ) return this.clear();
    this._state = data.state;
    this.#token = canvas.tokens.get(data.token) ?? null;
    this.#history = data.history;
    this.waypoints = data.waypoints;
    this.measure(data.destination, {snap: false, force: true});
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers
  /* -------------------------------------------- */

  /**
   * Handle the beginning of a new Ruler measurement workflow
   * @see {Canvas.#onDragLeftStart}
   * @param {PIXI.FederatedEvent} event   The drag start event
   * @protected
   * @internal
   */
  _onDragStart(event) {
    this._startMeasurement(event.interactionData.origin, {snap: !event.shiftKey});
    if ( this.token && (this.state === Ruler.STATES.MEASURING) ) this.token.document.locked = true;
  }

  /* -------------------------------------------- */

  /**
   * Handle left-click events on the Canvas during Ruler measurement.
   * @see {Canvas._onClickLeft}
   * @param {PIXI.FederatedEvent} event   The pointer-down event
   * @protected
   * @internal
   */
  _onClickLeft(event) {
    const isCtrl = event.ctrlKey || event.metaKey;
    if ( !isCtrl ) return;
    this._addWaypoint(event.interactionData.origin, {snap: !event.shiftKey});
  }

  /* -------------------------------------------- */

  /**
   * Handle right-click events on the Canvas during Ruler measurement.
   * @see {Canvas._onClickRight}
   * @param {PIXI.FederatedEvent} event   The pointer-down event
   * @protected
   * @internal
   */
  _onClickRight(event) {
    const token = this.token;
    const isCtrl = event.ctrlKey || event.metaKey;
    if ( isCtrl ) this._removeWaypoint();
    else this._endMeasurement();
    if ( this.active ) canvas.mouseInteractionManager._dragRight = false;
    else {
      if ( token ) token.document.locked = token.document._source.locked;
      canvas.mouseInteractionManager.cancel(event);
    }
  }

  /* -------------------------------------------- */

  /**
   * Continue a Ruler measurement workflow for left-mouse movements on the Canvas.
   * @see {Canvas.#onDragLeftMove}
   * @param {PIXI.FederatedEvent} event   The mouse move event
   * @protected
   * @internal
   */
  _onMouseMove(event) {
    const destination = event.interactionData.destination;
    if ( !canvas.dimensions.rect.contains(destination.x, destination.y) ) return;
    this.measure(destination, {snap: !event.shiftKey});
  }

  /* -------------------------------------------- */

  /**
   * Conclude a Ruler measurement workflow by releasing the left-mouse button.
   * @see {Canvas.#onDragLeftDrop}
   * @param {PIXI.FederatedEvent} event   The pointer-up event
   * @protected
   * @internal
   */
  _onMouseUp(event) {
    if ( !this.active ) return;
    const isCtrl = event.ctrlKey || event.metaKey;
    if ( isCtrl || (this.waypoints.length > 1) ) event.preventDefault();
    else {
      if ( this.token ) this.token.document.locked = this.token.document._source.locked;
      this._endMeasurement();
      canvas.mouseInteractionManager.cancel(event);
    }
  }

  /* -------------------------------------------- */

  /**
   * Move the Token along the measured path when the move key is pressed.
   * @param {KeyboardEventContext} context
   * @protected
   * @internal
   */
  _onMoveKeyDown(context) {
    if ( this.token ) this.token.document.locked = this.token.document._source.locked;
    // noinspection ES6MissingAwait
    this.moveToken();
    if ( this.state !== Ruler.STATES.MEASURING ) canvas.mouseInteractionManager.cancel();
  }
}
