/**
 * @typedef {Object} CanvasHistory
 * @property {string} type    The type of operation stored as history (create, update, delete)
 * @property {Object[]} data  The data corresponding to the action which may later be un-done
 */

/**
 * @typedef {Object} PlaceablesLayerOptions
 * @property {boolean} controllableObjects  Can placeable objects in this layer be controlled?
 * @property {boolean} rotatableObjects     Can placeable objects in this layer be rotated?
 * @property {boolean} confirmDeleteKey     Confirm placeable object deletion with a dialog?
 * @property {PlaceableObject} objectClass  The class used to represent an object on this layer.
 * @property {boolean} quadtree             Does this layer use a quadtree to track object positions?
 */

/**
 * A subclass of Canvas Layer which is specifically designed to contain multiple PlaceableObject instances,
 * each corresponding to an embedded Document.
 * @category - Canvas
 */
class PlaceablesLayer extends InteractionLayer {

  /**
   * Sort order for placeables belonging to this layer.
   * @type {number}
   */
  static SORT_ORDER = 0;

  /**
   * Placeable Layer Objects
   * @type {PIXI.Container|null}
   */
  objects = null;

  /**
   * Preview Object Placement
   */
  preview = null;

  /**
   * Keep track of history so that CTRL+Z can undo changes
   * @type {CanvasHistory[]}
   */
  history = [];

  /**
   * Keep track of an object copied with CTRL+C which can be pasted later
   * @type {PlaceableObject[]}
   */
  _copy = [];

  /**
   * A Quadtree which partitions and organizes Walls into quadrants for efficient target identification.
   * @type {Quadtree|null}
   */
  quadtree = this.options.quadtree ? new CanvasQuadtree() : null;

  /* -------------------------------------------- */
  /*  Attributes                                  */
  /* -------------------------------------------- */

  /**
   * Configuration options for the PlaceablesLayer.
   * @type {PlaceablesLayerOptions}
   */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      baseClass: PlaceablesLayer,
      controllableObjects: false,
      rotatableObjects: false,
      confirmDeleteKey: false,
      objectClass: CONFIG[this.documentName]?.objectClass,
      quadtree: true
    });
  }

  /* -------------------------------------------- */

  /**
   * A reference to the named Document type which is contained within this Canvas Layer.
   * @type {string}
   */
  static documentName;

  /**
   * Creation states affected to placeables during their construction.
   * @enum {number}
   */
  static CREATION_STATES = {
    NONE: 0,
    POTENTIAL: 1,
    CONFIRMED: 2,
    COMPLETED: 3
  };

  /* -------------------------------------------- */

  /**
   * Obtain a reference to the Collection of embedded Document instances within the currently viewed Scene
   * @type {Collection|null}
   */
  get documentCollection() {
    return canvas.scene?.getEmbeddedCollection(this.constructor.documentName) || null;
  }

  /* -------------------------------------------- */

  /**
   * Obtain a reference to the PlaceableObject class definition which represents the Document type in this layer.
   * @type {Function}
   */
  static get placeableClass() {
    return CONFIG[this.documentName].objectClass;
  }

  /* -------------------------------------------- */

  /**
   * If objects on this PlaceablesLayer have a HUD UI, provide a reference to its instance
   * @type {BasePlaceableHUD|null}
   */
  get hud() {
    return null;
  }

  /* -------------------------------------------- */

  /**
   * A convenience method for accessing the placeable object instances contained in this layer
   * @type {PlaceableObject[]}
   */
  get placeables() {
    if ( !this.objects ) return [];
    return this.objects.children;
  }

  /* -------------------------------------------- */

  /**
   * An Array of placeable objects in this layer which have the _controlled attribute
   * @returns {PlaceableObject[]}
   */
  get controlled() {
    return Array.from(this.#controlledObjects.values());
  }

  /* -------------------------------------------- */

  /**
   * Iterates over placeable objects that are eligible for control/select.
   * @yields A placeable object
   * @returns {Generator<PlaceableObject>}
   */
  *controllableObjects() {
    if ( !this.options.controllableObjects ) return;
    for ( const placeable of this.placeables ) {
      if ( placeable.visible ) yield placeable;
    }
  }

  /* -------------------------------------------- */

  /**
   * Track the set of PlaceableObjects on this layer which are currently controlled.
   * @type {Map<string,PlaceableObject>}
   */
  get controlledObjects() {
    return this.#controlledObjects;
  }

  /** @private */
  #controlledObjects = new Map();

  /* -------------------------------------------- */

  /**
   * Track the PlaceableObject on this layer which is currently hovered upon.
   * @type {PlaceableObject|null}
   */
  get hover() {
    return this.#hover;
  }

  set hover(object) {
    if ( object instanceof this.constructor.placeableClass ) this.#hover = object;
    else this.#hover = null;
  }

  #hover = null;

  /* -------------------------------------------- */

  /**
   * Track whether "highlight all objects" is currently active
   * @type {boolean}
   */
  highlightObjects = false;

  /* -------------------------------------------- */

  /**
   * Get the maximum sort value of all placeables.
   * @returns {number}    The maximum sort value (-Infinity if there are no objects)
   */
  getMaxSort() {
    let sort = -Infinity;
    const collection = this.documentCollection;
    if ( !collection?.documentClass.schema.has("sort") ) return sort;
    for ( const document of collection ) sort = Math.max(sort, document.sort);
    return sort;
  }

  /* -------------------------------------------- */

  /**
   * Send the controlled objects of this layer to the back or bring them to the front.
   * @param {boolean} front         Bring to front instead of send to back?
   * @returns {boolean}             Returns true if the layer has sortable object, and false otherwise
   * @internal
   */
  _sendToBackOrBringToFront(front) {
    const collection = this.documentCollection;
    const documentClass = collection?.documentClass;
    if ( !documentClass?.schema.has("sort") ) return false;
    if ( !this.controlled.length ) return true;

    // Determine to-be-updated objects and the minimum/maximum sort value of the other objects
    const toUpdate = [];
    let target = front ? -Infinity : Infinity;
    for ( const document of collection ) {
      if ( document.object?.controlled && !document.locked ) toUpdate.push(document);
      else target = (front ? Math.max : Math.min)(target, document.sort);
    }
    if ( !Number.isFinite(target) ) return true;
    target += (front ? 1 : -toUpdate.length);

    // Sort the to-be-updated objects by sort in ascending order
    toUpdate.sort((a, b) => a.sort - b.sort);

    // Update the to-be-updated objects
    const updates = toUpdate.map((document, i) => ({_id: document.id, sort: target + i}));
    canvas.scene.updateEmbeddedDocuments(documentClass.documentName, updates);
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Snaps the given point to grid. The layer defines the snapping behavior.
   * @param {Point} point    The point that is to be snapped
   * @returns {Point}        The snapped point
   */
  getSnappedPoint(point) {
    const M = CONST.GRID_SNAPPING_MODES;
    const grid = canvas.grid;
    return grid.getSnappedPoint(point, {
      mode: grid.isHexagonal && !this.options.controllableObjects
        ? M.CENTER | M.VERTEX
        : M.CENTER | M.VERTEX | M.CORNER | M.SIDE_MIDPOINT,
      resolution: 1
    });
  }

  /* -------------------------------------------- */
  /*  Rendering
  /* -------------------------------------------- */

  /**
   * Obtain an iterable of objects which should be added to this PlaceablesLayer
   * @returns {Document[]}
   */
  getDocuments() {
    return this.documentCollection || [];
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _draw(options) {
    await super._draw(options);

    // Create objects container which can be sorted
    this.objects = this.addChild(new PIXI.Container());
    this.objects.sortableChildren = true;
    this.objects.visible = false;
    const cls = getDocumentClass(this.constructor.documentName);
    if ( (cls.schema.get("elevation") instanceof foundry.data.fields.NumberField)
      && (cls.schema.get("sort") instanceof foundry.data.fields.NumberField) ) {
      this.objects.sortChildren = PlaceablesLayer.#sortObjectsByElevationAndSort;
    }
    this.objects.on("childAdded", obj => {
      if ( !(obj instanceof this.constructor.placeableClass) ) {
        console.error(`An object of type ${obj.constructor.name} was added to ${this.constructor.name}#objects. `
          + `The object must be an instance of ${this.constructor.placeableClass.name}.`);
      }
      if ( obj instanceof PlaceableObject ) obj._updateQuadtree();
    });
    this.objects.on("childRemoved", obj => {
      if ( obj instanceof PlaceableObject ) obj._updateQuadtree();
    });

    // Create preview container which is always above objects
    this.preview = this.addChild(new PIXI.Container());

    // Create and draw objects
    const documents = this.getDocuments();
    const promises = documents.map(doc => {
      const obj = doc._object = this.createObject(doc);
      this.objects.addChild(obj);
      return obj.draw();
    });

    // Wait for all objects to draw
    await Promise.all(promises);
    this.objects.visible = this.active;
  }

  /* -------------------------------------------- */

  /**
   * Draw a single placeable object
   * @param {ClientDocument} document     The Document instance used to create the placeable object
   * @returns {PlaceableObject}
   */
  createObject(document) {
    return new this.constructor.placeableClass(document);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _tearDown(options) {
    this.history = [];
    if ( this.options.controllableObjects ) {
      this.controlledObjects.clear();
    }
    if ( this.hud ) this.hud.clear();
    if ( this.quadtree ) this.quadtree.clear();
    this.objects = null;
    return super._tearDown(options);
  }

  /**
   * The method to sort the objects elevation and sort before sorting by the z-index.
   * @type {Function}
   */
  static #sortObjectsByElevationAndSort = function() {
    for ( let i = 0; i < this.children.length; i++ ) {
      this.children[i]._lastSortedIndex = i;
    }
    this.children.sort((a, b) => (a.document.elevation - b.document.elevation)
      || (a.document.sort - b.document.sort)
      || (a.zIndex - b.zIndex)
      || (a._lastSortedIndex - b._lastSortedIndex)
    );
    this.sortDirty = false;
  };

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /** @override */
  _activate() {
    this.objects.visible = true;
    this.placeables.forEach(l => l.renderFlags.set({refreshState: true}));
  }

  /* -------------------------------------------- */

  /** @override */
  _deactivate() {
    this.objects.visible = false;
    this.releaseAll();
    this.placeables.forEach(l => l.renderFlags.set({refreshState: true}));
    this.clearPreviewContainer();
  }

  /* -------------------------------------------- */

  /**
   * Clear the contents of the preview container, restoring visibility of original (non-preview) objects.
   */
  clearPreviewContainer() {
    if ( !this.preview ) return;
    this.preview.removeChildren().forEach(c => {
      c._onDragEnd();
      c.destroy({children: true});
    });
  }

  /* -------------------------------------------- */

  /**
   * Get a PlaceableObject contained in this layer by its ID.
   * Returns undefined if the object doesn't exist or if the canvas is not rendering a Scene.
   * @param {string} objectId   The ID of the contained object to retrieve
   * @returns {PlaceableObject}  The object instance, or undefined
   */
  get(objectId) {
    return this.documentCollection?.get(objectId)?.object || undefined;
  }

  /* -------------------------------------------- */

  /**
   * Acquire control over all PlaceableObject instances which are visible and controllable within the layer.
   * @param {object} options      Options passed to the control method of each object
   * @returns {PlaceableObject[]}  An array of objects that were controlled
   */
  controlAll(options={}) {
    if ( !this.options.controllableObjects ) return [];
    options.releaseOthers = false;
    for ( const placeable of this.controllableObjects() ) {
      placeable.control(options);
    }
    return this.controlled;
  }

  /* -------------------------------------------- */

  /**
   * Release all controlled PlaceableObject instance from this layer.
   * @param {object} options   Options passed to the release method of each object
   * @returns {number}         The number of PlaceableObject instances which were released
   */
  releaseAll(options={}) {
    let released = 0;
    for ( let o of this.placeables ) {
      if ( !o.controlled ) continue;
      o.release(options);
      released++;
    }
    return released;
  }

  /* -------------------------------------------- */

  /**
   * Simultaneously rotate multiple PlaceableObjects using a provided angle or incremental.
   * This executes a single database operation using Scene#updateEmbeddedDocuments.
   * @param {object} options                Options which configure how multiple objects are rotated
   * @param {number} [options.angle]            A target angle of rotation (in degrees) where zero faces "south"
   * @param {number} [options.delta]            An incremental angle of rotation (in degrees)
   * @param {number} [options.snap]             Snap the resulting angle to a multiple of some increment (in degrees)
   * @param {Array} [options.ids]               An Array of object IDs to target for rotation
   * @param {boolean} [options.includeLocked=false] Rotate objects whose documents are locked?
   * @returns {Promise<PlaceableObject[]>}  An array of objects which were rotated
   * @throws                                An error if an explicitly provided id is not valid
   */
  async rotateMany({angle, delta, snap, ids, includeLocked=false}={}) {
    if ( (angle ?? delta ?? null) === null ) {
      throw new Error("Either a target angle or relative delta must be provided.");
    }

    // Rotation is not permitted
    if ( !this.options.rotatableObjects ) return [];
    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", {localize: true});
      return [];
    }

    // Identify the objects requested for rotation
    const objects = this._getMovableObjects(ids, includeLocked);
    if ( !objects.length ) return objects;

    // Conceal any active HUD
    this.hud?.clear();

    // Commit updates to the Scene
    const updateData = objects.map(o => ({
      _id: o.id,
      rotation: o._updateRotation({angle, delta, snap})
    }));
    await canvas.scene.updateEmbeddedDocuments(this.constructor.documentName, updateData);
    return objects;
  }

  /* -------------------------------------------- */

  /**
   * Simultaneously move multiple PlaceableObjects via keyboard movement offsets.
   * This executes a single database operation using Scene#updateEmbeddedDocuments.
   * @param {object} options                  Options which configure how multiple objects are moved
   * @param {-1|0|1} [options.dx=0]             Horizontal movement direction
   * @param {-1|0|1} [options.dy=0]             Vertical movement direction
   * @param {boolean} [options.rotate=false]    Rotate the placeable to direction instead of moving
   * @param {string[]} [options.ids]            An Array of object IDs to target for movement.
   *                                            The default is the IDs of controlled objects.
   * @param {boolean} [options.includeLocked=false] Move objects whose documents are locked?
   * @returns {Promise<PlaceableObject[]>}    An array of objects which were moved during the operation
   * @throws                                  An error if an explicitly provided id is not valid
   */
  async moveMany({dx=0, dy=0, rotate=false, ids, includeLocked=false}={}) {
    if ( ![-1, 0, 1].includes(dx) ) throw new Error("Invalid argument: dx must be -1, 0, or 1");
    if ( ![-1, 0, 1].includes(dy) ) throw new Error("Invalid argument: dy must be -1, 0, or 1");
    if ( !dx && !dy ) return [];
    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", {localize: true});
      return [];
    }

    // Identify the objects requested for movement
    const objects = this._getMovableObjects(ids, includeLocked);
    if ( !objects.length ) return objects;

    // Define rotation angles
    const rotationAngles = {
      square: [45, 135, 225, 315],
      hexR: [30, 150, 210, 330],
      hexQ: [60, 120, 240, 300]
    };

    // Determine the rotation angle
    let offsets = [dx, dy];
    let angle = 0;
    if ( rotate ) {
      let angles = rotationAngles.square;
      const gridType = canvas.grid.type;
      if ( gridType >= CONST.GRID_TYPES.HEXODDQ ) angles = rotationAngles.hexQ;
      else if ( gridType >= CONST.GRID_TYPES.HEXODDR ) angles = rotationAngles.hexR;
      if (offsets.equals([0, 1])) angle = 0;
      else if (offsets.equals([-1, 1])) angle = angles[0];
      else if (offsets.equals([-1, 0])) angle = 90;
      else if (offsets.equals([-1, -1])) angle = angles[1];
      else if (offsets.equals([0, -1])) angle = 180;
      else if (offsets.equals([1, -1])) angle = angles[2];
      else if (offsets.equals([1, 0])) angle = 270;
      else if (offsets.equals([1, 1])) angle = angles[3];
    }

    // Conceal any active HUD
    this.hud?.clear();

    // Commit updates to the Scene
    const updateData = objects.map(obj => {
      let update = {_id: obj.id};
      if ( rotate ) update.rotation = angle;
      else foundry.utils.mergeObject(update, obj._getShiftedPosition(...offsets));
      return update;
    });
    await canvas.scene.updateEmbeddedDocuments(this.constructor.documentName, updateData);
    return objects;
  }

  /* -------------------------------------------- */

  /**
   * An internal helper method to identify the array of PlaceableObjects which can be moved or rotated.
   * @param {string[]} ids            An explicit array of IDs requested.
   * @param {boolean} includeLocked   Include locked objects which would otherwise be ignored?
   * @returns {PlaceableObject[]}     An array of objects which can be moved or rotated
   * @throws                          An error if any explicitly requested ID is not valid
   * @internal
   */
  _getMovableObjects(ids, includeLocked) {
    if ( ids instanceof Array ) return ids.reduce((arr, id) => {
      const object = this.get(id);
      if ( !object ) throw new Error(`"${id} is not a valid ${this.constructor.documentName} in the current Scene`);
      if ( includeLocked || !object.document.locked ) arr.push(object);
      return arr;
    }, []);
    return this.controlled.filter(object => includeLocked || !object.document.locked);
  }

  /* -------------------------------------------- */

  /**
   * Undo a change to the objects in this layer
   * This method is typically activated using CTRL+Z while the layer is active
   * @returns {Promise<Document[]>}     An array of documents which were modified by the undo operation
   */
  async undoHistory() {
    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", {localize: true});
      return [];
    }
    const type = this.constructor.documentName;
    if ( !this.history.length ) {
      ui.notifications.info(game.i18n.format("CONTROLS.EmptyUndoHistory", {
        type: game.i18n.localize(getDocumentClass(type).metadata.label)}));
      return [];
    }
    let event = this.history.pop();

    // Undo creation with deletion
    if ( event.type === "create" ) {
      const ids = event.data.map(d => d._id);
      const deleted = await canvas.scene.deleteEmbeddedDocuments(type, ids, {isUndo: true});
      if ( deleted.length !== 1 ) ui.notifications.info(game.i18n.format("CONTROLS.UndoCreateObjects",
        {count: deleted.length, type: game.i18n.localize(getDocumentClass(type).metadata.label)}));
      return deleted;
    }

    // Undo updates with update
    else if ( event.type === "update" ) {
      return canvas.scene.updateEmbeddedDocuments(type, event.data, {isUndo: true});
    }

    // Undo deletion with creation
    else if ( event.type === "delete" ) {
      const created = await canvas.scene.createEmbeddedDocuments(type, event.data, {isUndo: true, keepId: true});
      if ( created.length !== 1 ) ui.notifications.info(game.i18n.format("CONTROLS.UndoDeleteObjects",
        {count: created.length, type: game.i18n.localize(getDocumentClass(type).metadata.label)}));
      return created;
    }
  }

  /* -------------------------------------------- */

  /**
   * A helper method to prompt for deletion of all PlaceableObject instances within the Scene
   * Renders a confirmation dialogue to confirm with the requester that all objects will be deleted
   * @returns {Promise<Document[]>}    An array of Document objects which were deleted by the operation
   */
  async deleteAll() {
    const type = this.constructor.documentName;
    if ( !game.user.isGM ) {
      throw new Error(`You do not have permission to delete ${type} objects from the Scene.`);
    }
    const typeLabel = game.i18n.localize(getDocumentClass(type).metadata.label);
    return Dialog.confirm({
      title: game.i18n.localize("CONTROLS.ClearAll"),
      content: `<p>${game.i18n.format("CONTROLS.ClearAllHint", {type: typeLabel})}</p>`,
      yes: async () => {
        const deleted = await canvas.scene.deleteEmbeddedDocuments(type, [], {deleteAll: true});
        ui.notifications.info(game.i18n.format("CONTROLS.DeletedObjects",
          {count: deleted.length, type: typeLabel}));
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Record a new CRUD event in the history log so that it can be undone later
   * @param {string} type   The event type (create, update, delete)
   * @param {Object[]} data   The object data
   */
  storeHistory(type, data) {
    if ( data.every(d => !("_id" in d)) ) throw new Error("The data entries must contain the _id key");
    if ( type === "update" ) data = data.filter(d => Object.keys(d).length > 1); // Filter entries without changes
    if ( data.length === 0 ) return; // Don't store empty history data
    if ( this.history.length >= 10 ) this.history.shift();
    this.history.push({type, data});
  }

  /* -------------------------------------------- */

  /**
   * Copy currently controlled PlaceableObjects to a temporary Array, ready to paste back into the scene later
   * @returns {PlaceableObject[]}             The Array of copied PlaceableObject instances
   */
  copyObjects() {
    if ( this.options.controllableObjects ) this._copy = [...this.controlled];
    else if ( this.hover ) this._copy = [this.hover];
    else this._copy = [];
    const typeLabel = game.i18n.localize(getDocumentClass(this.constructor.documentName).metadata.label);
    ui.notifications.info(game.i18n.format("CONTROLS.CopiedObjects", {
      count: this._copy.length,
      type: typeLabel
    }));
    return this._copy;
  }

  /* -------------------------------------------- */

  /**
   * Paste currently copied PlaceableObjects back to the layer by creating new copies
   * @param {Point} position      The destination position for the copied data.
   * @param {object} [options]    Options which modify the paste operation
   * @param {boolean} [options.hidden=false]    Paste data in a hidden state, if applicable. Default is false.
   * @param {boolean} [options.snap=true]       Snap the resulting objects to the grid. Default is true.
   * @returns {Promise<Document[]>} An Array of created Document instances
   */
  async pasteObjects(position, {hidden=false, snap=true}={}) {
    if ( !this._copy.length ) return [];

    // Get the center of all copies
    const center = {x: 0, y: 0};
    for ( const copy of this._copy ) {
      const c = copy.center;
      center.x += c.x;
      center.y += c.y;
    }
    center.x /= this._copy.length;
    center.y /= this._copy.length;

    // Offset of the destination position relative to the center
    const offset = {x: position.x - center.x, y: position.y - center.y};

    // Iterate over objects
    const toCreate = [];
    for ( const copy of this._copy ) {
      toCreate.push(this._pasteObject(copy, offset, {hidden, snap}));
    }

    /**
     * A hook event that fires when any PlaceableObject is pasted onto the
     * Scene. Substitute the PlaceableObject name in the hook event to target a
     * specific PlaceableObject type, for example "pasteToken".
     * @function pastePlaceableObject
     * @memberof hookEvents
     * @param {PlaceableObject[]} copied The PlaceableObjects that were copied
     * @param {object[]} createData      The new objects that will be added to the Scene
     */
    Hooks.call(`paste${this.constructor.documentName}`, this._copy, toCreate);

    // Create all objects
    const created = await canvas.scene.createEmbeddedDocuments(this.constructor.documentName, toCreate);
    ui.notifications.info(game.i18n.format("CONTROLS.PastedObjects", {count: created.length,
      type: game.i18n.localize(getDocumentClass(this.constructor.documentName).metadata.label)}));
    return created;
  }

  /* -------------------------------------------- */

  /**
   * Get the data of the copied object pasted at the position given by the offset.
   * Called by {@link PlaceablesLayer#pasteObjects} for each copied object.
   * @param {PlaceableObject} copy              The copied object that is pasted
   * @param {Point} offset                      The offset relative from the current position to the destination
   * @param {object} [options]                  Options of {@link PlaceablesLayer#pasteObjects}
   * @param {boolean} [options.hidden=false]    Paste in a hidden state, if applicable. Default is false.
   * @param {boolean} [options.snap=true]       Snap to the grid. Default is true.
   * @returns {object}                          The update data
   * @protected
   */
  _pasteObject(copy, offset, {hidden=false, snap=true}={}) {
    const {x, y} = copy.document;
    let position = {x: x + offset.x, y: y + offset.y};
    if ( snap ) position = this.getSnappedPoint(position);
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

  /**
   * Select all PlaceableObject instances which fall within a coordinate rectangle.
   * @param {object} [options={}]
   * @param {number} [options.x]                     The top-left x-coordinate of the selection rectangle.
   * @param {number} [options.y]                     The top-left y-coordinate of the selection rectangle.
   * @param {number} [options.width]                 The width of the selection rectangle.
   * @param {number} [options.height]                The height of the selection rectangle.
   * @param {object} [options.releaseOptions={}]     Optional arguments provided to any called release() method.
   * @param {object} [options.controlOptions={}]     Optional arguments provided to any called control() method.
   * @param {object} [aoptions]                      Additional options to configure selection behaviour.
   * @param {boolean} [aoptions.releaseOthers=true]  Whether to release other selected objects.
   * @returns {boolean}       A boolean for whether the controlled set was changed in the operation.
   */
  selectObjects({x, y, width, height, releaseOptions={}, controlOptions={}}={}, {releaseOthers=true}={}) {
    if ( !this.options.controllableObjects ) return false;
    const oldSet = new Set(this.controlled);

    // Identify selected objects
    const newSet = new Set();
    const rectangle = new PIXI.Rectangle(x, y, width, height);
    for ( const placeable of this.controllableObjects() ) {
      if ( placeable._overlapsSelection(rectangle) ) newSet.add(placeable);
    }

    // Release objects that are no longer controlled
    const toRelease = oldSet.difference(newSet);
    if ( releaseOthers ) toRelease.forEach(placeable => placeable.release(releaseOptions));

    // Control objects that were not controlled before
    if ( foundry.utils.isEmpty(controlOptions) ) controlOptions.releaseOthers = false;
    const toControl = newSet.difference(oldSet);
    toControl.forEach(placeable => placeable.control(controlOptions));

    // Return a boolean for whether the control set was changed
    return (releaseOthers && (toRelease.size > 0)) || (toControl.size > 0);
  }

  /* -------------------------------------------- */

  /**
   * Update all objects in this layer with a provided transformation.
   * Conditionally filter to only apply to objects which match a certain condition.
   * @param {Function|object} transformation     An object of data or function to apply to all matched objects
   * @param {Function|null}  condition           A function which tests whether to target each object
   * @param {object} [options]                   Additional options passed to Document.update
   * @returns {Promise<Document[]>}              An array of updated data once the operation is complete
   */
  async updateAll(transformation, condition=null, options={}) {
    const hasTransformer = transformation instanceof Function;
    if ( !hasTransformer && (foundry.utils.getType(transformation) !== "Object") ) {
      throw new Error("You must provide a data object or transformation function");
    }
    const hasCondition = condition instanceof Function;
    const updates = this.placeables.reduce((arr, obj) => {
      if ( hasCondition && !condition(obj) ) return arr;
      const update = hasTransformer ? transformation(obj) : foundry.utils.deepClone(transformation);
      update._id = obj.id;
      arr.push(update);
      return arr;
    },[]);
    return canvas.scene.updateEmbeddedDocuments(this.constructor.documentName, updates, options);
  }

  /* -------------------------------------------- */

  /**
   * Get the world-transformed drop position.
   * @param {DragEvent} event
   * @param {object} [options]
   * @param {boolean} [options.center=true]  Return the coordinates of the center of the nearest grid element.
   * @returns {number[]|boolean}     Returns the transformed x, y coordinates, or false if the drag event was outside
   *                                 the canvas.
   * @protected
   */
  _canvasCoordinatesFromDrop(event, {center=true}={}) {
    let coords = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
    if ( center ) coords = canvas.grid.getCenterPoint(coords);
    if ( canvas.dimensions.rect.contains(coords.x, coords.y) ) return [coords.x, coords.y];
    return false;
  }

  /* -------------------------------------------- */

  /**
   * Create a preview of this layer's object type from a world document and show its sheet to be finalized.
   * @param {object} createData                     The data to create the object with.
   * @param {object} [options]                      Options which configure preview creation
   * @param {boolean} [options.renderSheet]           Render the preview object config sheet?
   * @param {number} [options.top]                    The offset-top position where the sheet should be rendered
   * @param {number} [options.left]                   The offset-left position where the sheet should be rendered
   * @returns {PlaceableObject}                     The created preview object
   * @internal
   */
  async _createPreview(createData, {renderSheet=true, top=0, left=0}={}) {
    const documentName = this.constructor.documentName;
    const cls = getDocumentClass(documentName);
    const document = new cls(createData, {parent: canvas.scene});
    if ( !document.canUserModify(game.user, "create") ) {
      return ui.notifications.warn(game.i18n.format("PERMISSION.WarningNoCreate", {document: documentName}));
    }

    const object = new CONFIG[documentName].objectClass(document);
    this.activate();
    this.preview.addChild(object);
    await object.draw();

    if ( renderSheet ) object.sheet.render(true, {top, left});
    return object;
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @override */
  _onClickLeft(event) {
    if ( !event.target.hasActiveHUD ) this.hud?.clear();
    if ( this.options.controllableObjects && game.settings.get("core", "leftClickRelease") && !this.hover ) {
      this.releaseAll();
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _canDragLeftStart(user, event) {
    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", {localize: true});
      return false;
    }
    return true;
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftStart(event) {
    this.clearPreviewContainer();
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftMove(event) {
    const preview = event.interactionData.preview;
    if ( !preview || preview._destroyed ) return;
    if ( preview.parent === null ) { // In theory this should never happen, but rarely does
      this.preview.addChild(preview);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftDrop(event) {
    const preview = event.interactionData.preview;
    if ( !preview || preview._destroyed ) return;
    event.interactionData.clearPreviewContainer = false;
    const cls = getDocumentClass(this.constructor.documentName);
    cls.create(preview.document.toObject(false), {parent: canvas.scene})
      .finally(() => this.clearPreviewContainer());
  }

  /* -------------------------------------------- */

  /** @override */
  _onDragLeftCancel(event) {
    if ( event.interactionData?.clearPreviewContainer !== false ) {
      this.clearPreviewContainer();
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onClickRight(event) {
    if ( !event.target.hasActiveHUD ) this.hud?.clear();
  }

  /* -------------------------------------------- */

  /** @override */
  _onMouseWheel(event) {

    // Prevent wheel rotation during dragging
    if ( this.preview.children.length ) return;

    // Determine the incremental angle of rotation from event data
    const snap = event.shiftKey ? (canvas.grid.isHexagonal ? 30 : 45) : 15;
    const delta = snap * Math.sign(event.delta);
    return this.rotateMany({delta, snap});
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDeleteKey(event) {
    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", {localize: true});
      return;
    }

    // Identify objects which are candidates for deletion
    const objects = this.options.controllableObjects ? this.controlled : (this.hover ? [this.hover] : []);
    if ( !objects.length ) return;

    // Restrict to objects which can be deleted
    const ids = objects.reduce((ids, o) => {
      const isDragged = (o.interactionState === MouseInteractionManager.INTERACTION_STATES.DRAG);
      if ( isDragged || o.document.locked || !o.document.canUserModify(game.user, "delete") ) return ids;
      if ( this.hover === o ) this.hover = null;
      ids.push(o.id);
      return ids;
    }, []);
    if ( ids.length ) {
      const typeLabel = game.i18n.localize(getDocumentClass(this.constructor.documentName).metadata.label);
      if ( this.options.confirmDeleteKey ) {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: {
            title: game.i18n.format("DOCUMENT.Delete", {type: typeLabel})
          },
          content: `<p>${game.i18n.localize("AreYouSure")}</p>`,
          rejectClose: false
        });
        if ( !confirmed ) return;
      }
      const deleted = await canvas.scene.deleteEmbeddedDocuments(this.constructor.documentName, ids);
      if ( deleted.length !== 1) ui.notifications.info(game.i18n.format("CONTROLS.DeletedObjects", {
        count: deleted.length, type: typeLabel}));
    }
  }

  /* -------------------------------------------- */
  /*  Deprecations and Compatibility              */
  /* -------------------------------------------- */

  /**
   * @deprecated since v12
   * @ignore
   */
  get gridPrecision() {
    const msg = "PlaceablesLayer#gridPrecision is deprecated. Use PlaceablesLayer#getSnappedPoint "
      + "instead of GridLayer#getSnappedPosition and PlaceablesLayer#gridPrecision.";
    foundry.utils.logCompatibilityWarning(msg, {since: 12, until: 14, once: true});
    const grid = canvas.grid;
    if ( grid.type === CONST.GRID_TYPES.GRIDLESS ) return 0;           // No snapping for gridless
    if ( grid.type === CONST.GRID_TYPES.SQUARE ) return 2;             // Corners and centers
    return this.options.controllableObjects ? 2 : 5;                   // Corners or vertices
  }

  /* -------------------------------------------- */

  /**
   * @deprecated since v11
   * @ignore
   */
  get _highlight() {
    const msg = "PlaceablesLayer#_highlight is deprecated. Use PlaceablesLayer#highlightObjects instead.";
    foundry.utils.logCompatibilityWarning(msg, {since: 11, until: 13});
    return this.highlightObjects;
  }

  /**
   * @deprecated since v11
   * @ignore
   */
  set _highlight(state) {
    const msg = "PlaceablesLayer#_highlight is deprecated. Use PlaceablesLayer#highlightObjects instead.";
    foundry.utils.logCompatibilityWarning(msg, {since: 11, until: 13});
    this.highlightObjects = !!state;
  }
}
