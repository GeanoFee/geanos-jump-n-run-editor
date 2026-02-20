/**
 * The Walls canvas layer which provides a container for Wall objects within the rendered Scene.
 * @category - Canvas
 */
class WallsLayer extends PlaceablesLayer {

  /**
   * A graphics layer used to display chained Wall selection
   * @type {PIXI.Graphics}
   */
  chain = null;

  /**
   * Track whether we are currently within a chained placement workflow
   * @type {boolean}
   */
  _chain = false;

  /**
   * Track the most recently created or updated wall data for use with the clone tool
   * @type {Object|null}
   * @private
   */
  _cloneType = null;

  /**
   * Reference the last interacted wall endpoint for the purposes of chaining
   * @type {{point: PointArray}}
   * @private
   */
  last = {
    point: null
  };

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "walls",
      controllableObjects: true,
      zIndex: 700
    });
  }

  /** @inheritdoc */
  static documentName = "Wall";

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return WallsLayer.name;
  }

  /* -------------------------------------------- */

  /**
   * The grid used for snapping.
   * It's the same as canvas.grid except in the gridless case where this is the square version of the gridless grid.
   * @type {BaseGrid}
   */
  #grid = canvas.grid;

  /* -------------------------------------------- */

  /**
   * An Array of Wall instances in the current Scene which act as Doors.
   * @type {Wall[]}
   */
  get doors() {
    return this.objects.children.filter(w => w.document.door > CONST.WALL_DOOR_TYPES.NONE);
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /** @override */
  getSnappedPoint(point) {
    const M = CONST.GRID_SNAPPING_MODES;
    const size = canvas.dimensions.size;
    return this.#grid.getSnappedPoint(point, canvas.forceSnapVertices ? {mode: M.VERTEX} : {
      mode: M.CENTER | M.VERTEX | M.CORNER | M.SIDE_MIDPOINT,
      resolution: size >= 128 ? 8 : (size >= 64 ? 4 : 2)
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    this.#grid = canvas.grid.isGridless ? new foundry.grid.SquareGrid({size: canvas.grid.size}) : canvas.grid;
    await super._draw(options);
    this.chain = this.addChildAt(new PIXI.Graphics(), 0);
    this.last = {point: null};
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _deactivate() {
    super._deactivate();
    this.chain?.clear();
  }

  /* -------------------------------------------- */

  /**
   * Given a point and the coordinates of a wall, determine which endpoint is closer to the point
   * @param {Point} point         The origin point of the new Wall placement
   * @param {Wall} wall           The existing Wall object being chained to
   * @returns {PointArray}        The [x,y] coordinates of the starting endpoint
   */
  static getClosestEndpoint(point, wall) {
    const c = wall.coords;
    const a = [c[0], c[1]];
    const b = [c[2], c[3]];

    // Exact matches
    if ( a.equals([point.x, point.y]) ) return a;
    else if ( b.equals([point.x, point.y]) ) return b;

    // Closest match
    const da = Math.hypot(point.x - a[0], point.y - a[1]);
    const db = Math.hypot(point.x - b[0], point.y - b[1]);
    return da < db ? a : b;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  releaseAll(options) {
    if ( this.chain ) this.chain.clear();
    return super.releaseAll(options);
  }

  /* -------------------------------------------- */

  /** @override */
  _pasteObject(copy, offset, options) {
    const c = copy.document.c;
    const dx = Math.round(offset.x);
    const dy = Math.round(offset.y);
    const a = {x: c[0] + dx, y: c[1] + dy};
    const b = {x: c[2] + dx, y: c[3] + dy};
    const data = copy.document.toObject();
    delete data._id;
    data.c = [a.x, a.y, b.x, b.y];
    return data;
  }

  /* -------------------------------------------- */

  /**
   * Pan the canvas view when the cursor position gets close to the edge of the frame
   * @param {MouseEvent} event    The originating mouse movement event
   * @param {number} x            The x-coordinate
   * @param {number} y            The y-coordinate
   * @private
   */
  _panCanvasEdge(event, x, y) {

    // Throttle panning by 20ms
    const now = Date.now();
    if ( now - (event.interactionData.panTime || 0) <= 100 ) return;
    event.interactionData.panTime = now;

    // Determine the amount of shifting required
    const pad = 50;
    const shift = 500 / canvas.stage.scale.x;

    // Shift horizontally
    let dx = 0;
    if ( x < pad ) dx = -shift;
    else if ( x > window.innerWidth - pad ) dx = shift;

    // Shift vertically
    let dy = 0;
    if ( y < pad ) dy = -shift;
    else if ( y > window.innerHeight - pad ) dy = shift;

    // Enact panning
    if (( dx || dy ) && !this._panning ) {
      return canvas.animatePan({x: canvas.stage.pivot.x + dx, y: canvas.stage.pivot.y + dy, duration: 100});
    }
  }

  /* -------------------------------------------- */

  /**
   * Get the wall endpoint coordinates for a given point.
   * @param {Point} point                    The candidate wall endpoint.
   * @param {object} [options]
   * @param {boolean} [options.snap=true]    Snap to the grid?
   * @returns {[x: number, y: number]}       The wall endpoint coordinates.
   * @internal
   */
  _getWallEndpointCoordinates(point, {snap=true}={}) {
    if ( snap ) point = this.getSnappedPoint(point);
    return [point.x, point.y].map(Math.round);
  }

  /* -------------------------------------------- */

  /**
   * The Scene Controls tools provide several different types of prototypical Walls to choose from
   * This method helps to translate each tool into a default wall data configuration for that type
   * @param {string} tool     The active canvas tool
   * @private
   */
  _getWallDataFromActiveTool(tool) {

    // Using the clone tool
    if ( tool === "clone" && this._cloneType ) return this._cloneType;

    // Default wall data
    const wallData = {
      light: CONST.WALL_SENSE_TYPES.NORMAL,
      sight: CONST.WALL_SENSE_TYPES.NORMAL,
      sound: CONST.WALL_SENSE_TYPES.NORMAL,
      move: CONST.WALL_SENSE_TYPES.NORMAL
    };

    // Tool-based wall restriction types
    switch ( tool ) {
      case "invisible":
        wallData.sight = wallData.light = wallData.sound = CONST.WALL_SENSE_TYPES.NONE; break;
      case "terrain":
        wallData.sight = wallData.light = wallData.sound = CONST.WALL_SENSE_TYPES.LIMITED; break;
      case "ethereal":
        wallData.move = wallData.sound = CONST.WALL_SENSE_TYPES.NONE; break;
      case "doors":
        wallData.door = CONST.WALL_DOOR_TYPES.DOOR; break;
      case "secret":
        wallData.door = CONST.WALL_DOOR_TYPES.SECRET; break;
      case "window":
        const d = canvas.dimensions.distance;
        wallData.sight = wallData.light = CONST.WALL_SENSE_TYPES.PROXIMITY;
        wallData.threshold = {light: 2 * d, sight: 2 * d, attenuation: true};
        break;
    }
    return wallData;
  }

  /* -------------------------------------------- */

  /**
   * Identify the interior enclosed by the given walls.
   * @param {Wall[]} walls        The walls that enclose the interior.
   * @returns {PIXI.Polygon[]}    The polygons of the interior.
   * @license MIT
   */
  identifyInteriorArea(walls) {

    // Build the graph from the walls
    const vertices = new Map();
    const addEdge = (a, b) => {
      let v = vertices.get(a.key);
      if ( !v ) vertices.set(a.key, v = {X: a.x, Y: a.y, key: a.key, neighbors: new Set(), visited: false});
      let w = vertices.get(b.key);
      if ( !w ) vertices.set(b.key, w = {X: b.x, Y: b.y, key: b.key, neighbors: new Set(), visited: false});
      if ( v !== w ) {
        v.neighbors.add(w);
        w.neighbors.add(v);
      }
    };
    for ( const wall of walls ) {
      const edge = wall.edge;
      const a = new foundry.canvas.edges.PolygonVertex(edge.a.x, edge.a.y);
      const b = new foundry.canvas.edges.PolygonVertex(edge.b.x, edge.b.y);
      if ( a.key === b.key ) continue;
      if ( edge.intersections.length === 0 ) addEdge(a, b);
      else {
        const p = edge.intersections.map(i => foundry.canvas.edges.PolygonVertex.fromPoint(i.intersection));
        p.push(a, b);
        p.sort((v, w) => (v.x - w.x) || (v.y - w.y));
        for ( let k = 1; k < p.length; k++ ) {
          const a = p[k - 1];
          const b = p[k];
          if ( a.key === b.key ) continue;
          addEdge(a, b);
        }
      }
    }

    // Find the boundary paths of the interior that enclosed by the walls
    const paths = [];
    while ( vertices.size !== 0 ) {
      let start;
      for ( const vertex of vertices.values() ) {
        vertex.visited = false;
        if ( !start || (start.X > vertex.X) || ((start.X === vertex.X) && (start.Y > vertex.Y)) ) start = vertex;
      }
      if ( start.neighbors.size >= 2 ) {
        const path = [];
        let current = start;
        let previous = {X: current.X - 1, Y: current.Y - 1};
        for ( ;; ) {
          current.visited = true;
          const x0 = previous.X;
          const y0 = previous.Y;
          const x1 = current.X;
          const y1 = current.Y;
          let next;
          for ( const vertex of current.neighbors ) {
            if ( vertex === previous ) continue;
            if ( (vertex !== start) && vertex.visited ) continue;
            if ( !next ) {
              next = vertex;
              continue;
            }
            const x2 = next.X;
            const y2 = next.Y;
            const a1 = ((y0 - y1) * (x2 - x1)) + ((x1 - x0) * (y2 - y1));
            const x3 = vertex.X;
            const y3 = vertex.Y;
            const a2 = ((y0 - y1) * (x3 - x1)) + ((x1 - x0) * (y3 - y1));
            if ( a1 < 0 ) {
              if ( a2 >= 0 ) continue;
            } else if ( a1 > 0 ) {
              if ( a2 < 0 ) {
                next = vertex;
                continue;
              }
              if ( a2 === 0 ) {
                const b2 = ((x3 - x1) * (x0 - x1)) + ((y3 - y1) * (y0 - y1)) > 0;
                if ( !b2 ) next = vertex;
                continue;
              }
            } else {
              if ( a2 < 0 ) {
                next = vertex;
                continue;
              }
              const b1 = ((x2 - x1) * (x0 - x1)) + ((y2 - y1) * (y0 - y1)) > 0;
              if ( a2 > 0) {
                if ( b1 ) next = vertex;
                continue;
              }
              const b2 = ((x3 - x1) * (x0 - x1)) + ((y3 - y1) * (y0 - y1)) > 0;
              if ( b1 && !b2 ) next = vertex;
              continue;
            }
            const c = ((y1 - y2) * (x3 - x1)) + ((x2 - x1) * (y3 - y1));
            if ( c > 0 ) continue;
            if ( c < 0 ) {
              next = vertex;
              continue;
            }
            const d1 = ((x2 - x1) * (x2 - x1)) + ((y2 - y1) * (y2 - y1));
            const d2 = ((x3 - x1) * (x3 - x1)) + ((y3 - y1) * (y3 - y1));
            if ( d2 < d1 ) next = vertex;
          }
          if (next) {
            path.push(current);
            previous = current;
            current = next;
            if ( current === start ) break;
          } else {
            current = path.pop();
            if ( !current ) {
              previous = undefined;
              break;
            }
            previous = path.length ? path[path.length - 1] : {X: current.X - 1, Y: current.Y - 1};
          }
        }
        if ( path.length !== 0 ) {
          paths.push(path);
          previous = path[path.length - 1];
          for ( const vertex of path ) {
            previous.neighbors.delete(vertex);
            if ( previous.neighbors.size === 0 ) vertices.delete(previous.key);
            vertex.neighbors.delete(previous);
            previous = vertex;
          }
          if ( previous.neighbors.size === 0 ) vertices.delete(previous.key);
        }
      }
      for ( const vertex of start.neighbors ) {
        vertex.neighbors.delete(start);
        if ( vertex.neighbors.size === 0 ) vertices.delete(vertex.key);
      }
      vertices.delete(start.key);
    }

    // Unionize the paths
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    clipper.Execute(ClipperLib.ClipType.ctUnion, paths, ClipperLib.PolyFillType.pftPositive,
      ClipperLib.PolyFillType.pftEvenOdd);

    // Convert the paths to polygons
    return paths.map(path => {
      const points = [];
      for ( const point of path ) points.push(point.X, point.Y);
      return new PIXI.Polygon(points);
    });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftStart(event) {
    this.clearPreviewContainer();
    const interaction = event.interactionData;
    const origin = interaction.origin;
    interaction.wallsState = WallsLayer.CREATION_STATES.NONE;
    interaction.clearPreviewContainer = true;

    // Create a pending WallDocument
    const data = this._getWallDataFromActiveTool(game.activeTool);
    const snap = !event.shiftKey;
    const isChain = this._chain || game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL);
    const pt = (isChain && this.last.point) ? this.last.point : this._getWallEndpointCoordinates(origin, {snap});
    data.c = pt.concat(pt);
    const cls = getDocumentClass("Wall");
    const doc = new cls(data, {parent: canvas.scene});

    // Create the preview Wall object
    const wall = new this.constructor.placeableClass(doc);
    interaction.wallsState = WallsLayer.CREATION_STATES.POTENTIAL;
    interaction.preview = wall;
    return wall.draw();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftMove(event) {
    const interaction = event.interactionData;
    const {preview, destination} = interaction;
    const states = WallsLayer.CREATION_STATES;
    if ( !preview || preview._destroyed
      || [states.NONE, states.COMPLETED].includes(interaction.wallsState) ) return;
    if ( preview.parent === null ) this.preview.addChild(preview); // Should happen the first time it is moved
    const snap = !event.shiftKey;
    preview.document.updateSource({
      c: preview.document.c.slice(0, 2).concat(this._getWallEndpointCoordinates(destination, {snap}))
    });
    preview.refresh();
    interaction.wallsState = WallsLayer.CREATION_STATES.CONFIRMED;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftDrop(event) {
    const interaction = event.interactionData;
    const {wallsState, destination, preview} = interaction;
    const states = WallsLayer.CREATION_STATES;

    // Check preview and state
    if ( !preview || preview._destroyed || (interaction.wallsState === states.NONE) ) {
      return;
    }

    // Prevent default to allow chaining to continue
    if ( game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.CONTROL) ) {
      event.preventDefault();
      this._chain = true;
      if ( wallsState < WallsLayer.CREATION_STATES.CONFIRMED ) return;
    } else this._chain = false;

    // Successful wall completion
    if ( wallsState === WallsLayer.CREATION_STATES.CONFIRMED ) {
      interaction.wallsState = WallsLayer.CREATION_STATES.COMPLETED;

      // Get final endpoint location
      const snap = !event.shiftKey;
      let dest = this._getWallEndpointCoordinates(destination, {snap});
      const coords = preview.document.c.slice(0, 2).concat(dest);
      preview.document.updateSource({c: coords});

      const clearPreviewAndChain = () => {
        this.clearPreviewContainer();

        // Maybe chain
        if ( this._chain ) {
          interaction.origin = {x: dest[0], y: dest[1]};
          this._onDragLeftStart(event);
        }
      };

      // Ignore walls which are collapsed
      if ( (coords[0] === coords[2]) && (coords[1] === coords[3]) ) {
        clearPreviewAndChain();
        return;
      }

      interaction.clearPreviewContainer = false;

      // Create the Wall
      this.last = {point: dest};
      const cls = getDocumentClass(this.constructor.documentName);
      cls.create(preview.document.toObject(), {parent: canvas.scene}).finally(clearPreviewAndChain);
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftCancel(event) {
    this._chain = false;
    this.last = {point: null};
    super._onDragLeftCancel(event);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onClickRight(event) {
    if ( event.interactionData.wallsState > WallsLayer.CREATION_STATES.NONE ) return this._onDragLeftCancel(event);
  }

  /* -------------------------------------------- */
  /*  Deprecations and Compatibility              */
  /* -------------------------------------------- */

  /**
   * @deprecated since v11
   * @ignore
   */
  checkCollision(ray, options={}) {
    const msg = "WallsLayer#checkCollision is obsolete."
      + "Prefer calls to testCollision from CONFIG.Canvas.polygonBackends[type]";
    foundry.utils.logCompatibilityWarning(msg, {since: 11, until: 13});
    return CONFIG.Canvas.losBackend.testCollision(ray.A, ray.B, options);
  }

  /**
   * @deprecated since v11
   * @ignore
   */
  highlightControlledSegments() {
    foundry.utils.logCompatibilityWarning("The WallsLayer#highlightControlledSegments function is deprecated in favor"
      + "of calling wall.renderFlags.set(\"refreshHighlight\") on individual Wall objects", {since: 11, until: 13});
    for ( const w of this.placeables ) w.renderFlags.set({refreshHighlight: true});
  }

  /**
   * @deprecated since v12
   * @ignore
   */
  initialize() {
    foundry.utils.logCompatibilityWarning("WallsLayer#initialize is deprecated in favor of Canvas#edges#initialize",
      {since: 12, until: 14});
    return canvas.edges.initialize();
  }

  /**
   * @deprecated since v12
   * @ignore
   */
  identifyInteriorWalls() {
    foundry.utils.logCompatibilityWarning("WallsLayer#identifyInteriorWalls has been deprecated. "
      + "It has no effect anymore and there's no replacement.", {since: 12, until: 14});
  }

  /**
   * @deprecated since v12
   * @ignore
   */
  identifyWallIntersections() {
    foundry.utils.logCompatibilityWarning("WallsLayer#identifyWallIntersections is deprecated in favor of"
      + " foundry.canvas.edges.Edge.identifyEdgeIntersections and has no effect.", {since: 12, until: 14});
  }
}

