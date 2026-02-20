/**
 * @typedef {Object} AmbientSoundPlaybackConfig
 * @property {Sound} sound              The Sound node which should be controlled for playback
 * @property {foundry.canvas.sources.PointSoundSource} source  The SoundSource which defines the area of effect
 *                                                             for the sound
 * @property {AmbientSound} object      An AmbientSound object responsible for the sound, or undefined
 * @property {Point} listener           The coordinates of the closest listener or undefined if there is none
 * @property {number} distance          The minimum distance between a listener and the AmbientSound origin
 * @property {boolean} muffled          Is the closest listener muffled
 * @property {boolean} walls            Is playback constrained or muffled by walls?
 * @property {number} volume            The final volume at which the Sound should be played
 */

/**
 * This Canvas Layer provides a container for AmbientSound objects.
 * @category - Canvas
 */
class SoundsLayer extends PlaceablesLayer {

  /**
   * Track whether to actively preview ambient sounds with mouse cursor movements
   * @type {boolean}
   */
  livePreview = false;

  /**
   * A mapping of ambient audio sources which are active within the rendered Scene
   * @type {Collection<string,foundry.canvas.sources.PointSoundSource>}
   */
  sources = new foundry.utils.Collection();

  /**
   * Darkness change event handler function.
   * @type {_onDarknessChange}
   */
  #onDarknessChange;

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, {
      name: "sounds",
      zIndex: 900
    });
  }

  /** @inheritdoc */
  static documentName = "AmbientSound";

  /* -------------------------------------------- */

  /** @inheritdoc */
  get hookName() {
    return SoundsLayer.name;
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
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
    this.stopAll();
    canvas.environment.removeEventListener("darknessChange", this.#onDarknessChange);
    this.#onDarknessChange = undefined;
    return super._tearDown(options);
  }

  /* -------------------------------------------- */

  /** @override */
  _activate() {
    super._activate();
    for ( const p of this.placeables ) p.renderFlags.set({refreshField: true});
  }

  /* -------------------------------------------- */

  /**
   * Initialize all AmbientSound sources which are present on this layer
   */
  initializeSources() {
    for ( let sound of this.placeables ) {
      sound.initializeSoundSource();
    }
    for ( let sound of this.preview.children ) {
      sound.initializeSoundSource();
    }
  }

  /* -------------------------------------------- */

  /**
   * Update all AmbientSound effects in the layer by toggling their playback status.
   * Sync audio for the positions of tokens which are capable of hearing.
   * @param {object} [options={}]   Additional options forwarded to AmbientSound synchronization
   */
  refresh(options={}) {
    if ( !this.placeables.length ) return;
    for ( const sound of this.placeables ) sound.source.refresh();
    if ( game.audio.locked ) {
      return game.audio.pending.push(() => this.refresh(options));
    }
    const listeners = this.getListenerPositions();
    this._syncPositions(listeners, options);
  }

  /* -------------------------------------------- */

  /**
   * Preview ambient audio for a given mouse cursor position
   * @param {Point} position      The cursor position to preview
   */
  previewSound(position) {
    if ( !this.placeables.length || game.audio.locked ) return;
    return this._syncPositions([position], {fade: 50});
  }

  /* -------------------------------------------- */

  /**
   * Terminate playback of all ambient audio sources
   */
  stopAll() {
    this.placeables.forEach(s => s.sync(false));
  }

  /* -------------------------------------------- */

  /**
   * Get an array of listener positions for Tokens which are able to hear environmental sound.
   * @returns {Point[]}
   */
  getListenerPositions() {
    const listeners = canvas.tokens.controlled.map(token => token.center);
    if ( !listeners.length && !game.user.isGM ) {
      for ( const token of canvas.tokens.placeables ) {
        if ( token.actor?.isOwner && token.isVisible ) listeners.push(token.center);
      }
    }
    return listeners;
  }

  /* -------------------------------------------- */

  /**
   * Sync the playing state and volume of all AmbientSound objects based on the position of listener points
   * @param {Point[]} listeners     Locations of listeners which have the capability to hear
   * @param {object} [options={}]   Additional options forwarded to AmbientSound synchronization
   * @protected
   */
  _syncPositions(listeners, options) {
    if ( !this.placeables.length || game.audio.locked ) return;
    /** @type {Record<string, Partial<AmbientSoundPlaybackConfig>>} */
    const paths = {};
    for ( const /** @type {AmbientSound} */ object of this.placeables ) {
      const {path, easing, volume, walls} = object.document;
      if ( !path ) continue;
      const {sound, source} = object;

      // Track a singleton record per unique audio path
      paths[path] ||= {sound, source, object, volume: 0};
      const config = paths[path];
      if ( !config.sound && sound ) Object.assign(config, {sound, source, object}); // First defined Sound

      // Identify the closest listener to each sound source
      if ( !object.isAudible || !source.active ) continue;
      for ( let l of listeners ) {
        const v = volume * source.getVolumeMultiplier(l, {easing});
        if ( v > config.volume ) {
          Object.assign(config, {source, object, listener: l, volume: v, walls});
          config.sound ??= sound; // We might already have defined Sound
        }
      }
    }

    // Compute the effective volume for each sound path
    for ( const config of Object.values(paths) ) {
      this._configurePlayback(config);
      config.object.sync(config.volume > 0, config.volume, {...options, muffled: config.muffled});
    }
  }


  /* -------------------------------------------- */

  /**
   * Configure playback by assigning the muffled state and final playback volume for the sound.
   * This method should mutate the config object by assigning the volume and muffled properties.
   * @param {AmbientSoundPlaybackConfig} config
   * @protected
   */
  _configurePlayback(config) {
    const {source, walls} = config;

    // Inaudible sources
    if ( !config.listener ) {
      config.volume = 0;
      return;
    }

    // Muffled by walls
    if ( !walls ) {
      if ( config.listener.equals(source) ) return false; // GM users listening to the source
      const polygonCls = CONFIG.Canvas.polygonBackends.sound;
      const x = polygonCls.testCollision(config.listener, source, {mode: "first", type: "sound"});
      config.muffled = x && (x._distance < 1); // Collided before reaching the source
    }
    else config.muffled = false;
  }

  /* -------------------------------------------- */

  /**
   * Actions to take when the darkness level of the Scene is changed
   * @param {PIXI.FederatedEvent} event
   * @internal
   */
  _onDarknessChange(event) {
    const {darknessLevel, priorDarknessLevel} = event.environmentData;
    for ( const sound of this.placeables ) {
      const {min, max} = sound.document.darkness;
      if ( darknessLevel.between(min, max) === priorDarknessLevel.between(min, max) ) continue;
      sound.initializeSoundSource();
      if ( this.active ) sound.renderFlags.set({refreshState: true});
    }
  }

  /* -------------------------------------------- */

  /**
   * Play a one-shot Sound originating from a predefined point on the canvas.
   * The sound plays locally for the current client only.
   * To play a sound for all connected clients use SoundsLayer#emitAtPosition.
   *
   * @param {string} src                                  The sound source path to play
   * @param {Point} origin                                The canvas coordinates from which the sound originates
   * @param {number} radius                               The radius of effect in distance units
   * @param {object} options                              Additional options which configure playback
   * @param {number} [options.volume=1.0]                   The maximum volume at which the effect should be played
   * @param {boolean} [options.easing=true]                 Should volume be attenuated by distance?
   * @param {boolean} [options.walls=true]                  Should the sound be constrained by walls?
   * @param {boolean} [options.gmAlways=true]               Should the sound always be played for GM users regardless
   *                                                        of actively controlled tokens?
   * @param {AmbientSoundEffect} [options.baseEffect]       A base sound effect to apply to playback
   * @param {AmbientSoundEffect} [options.muffledEffect]    A muffled sound effect to apply to playback, a sound may
   *                                                        only be muffled if it is not constrained by walls
   * @param {Partial<PointSourceData>} [options.sourceData]   Additional data passed to the SoundSource constructor
   * @param {SoundPlaybackOptions} [options.playbackOptions]  Additional options passed to Sound#play
   * @returns {Promise<foundry.audio.Sound|null>}         A Promise which resolves to the played Sound, or null
   *
   * @example Play the sound of a trap springing
   * ```js
   * const src = "modules/my-module/sounds/spring-trap.ogg";
   * const origin = {x: 5200, y: 3700};  // The origin point for the sound
   * const radius = 30;                  // Audible in a 30-foot radius
   * await canvas.sounds.playAtPosition(src, origin, radius);
   * ```
   *
   * @example A Token casts a spell
   * ```js
   * const src = "modules/my-module/sounds/spells-sprite.ogg";
   * const origin = token.center;         // The origin point for the sound
   * const radius = 60;                   // Audible in a 60-foot radius
   * await canvas.sounds.playAtPosition(src, origin, radius, {
   *   walls: false,                      // Not constrained by walls with a lowpass muffled effect
   *   muffledEffect: {type: "lowpass", intensity: 6},
   *   sourceData: {
   *     angle: 120,                      // Sound emitted at a limited angle
   *     rotation: 270                    // Configure the direction of sound emission
   *   }
   *   playbackOptions: {
   *     loopStart: 12,                   // Audio sprite timing
   *     loopEnd: 16,
   *     fade: 300,                      // Fade-in 300ms
   *     onended: () => console.log("Do something after the spell sound has played")
   *   }
   * });
   * ```
   */
  async playAtPosition(src, origin, radius, {volume=1, easing=true, walls=true, gmAlways=true,
    baseEffect, muffledEffect, sourceData, playbackOptions}={}) {

    // Construct a Sound and corresponding SoundSource
    const sound = new foundry.audio.Sound(src, {context: game.audio.environment});
    const source = new CONFIG.Canvas.soundSourceClass({object: null});
    source.initialize({
      x: origin.x,
      y: origin.y,
      radius: canvas.dimensions.distancePixels * radius,
      walls,
      ...sourceData
    });
    /** @type {Partial<AmbientSoundPlaybackConfig>} */
    const config = {sound, source, listener: undefined, volume: 0, walls};

    // Identify the closest listener position
    const listeners = (gmAlways && game.user.isGM) ? [origin] : this.getListenerPositions();
    for ( const l of listeners ) {
      const v = volume * source.getVolumeMultiplier(l, {easing});
      if ( v > config.volume ) Object.assign(config, {listener: l, volume: v});
    }

    // Configure playback volume and muffled state
    this._configurePlayback(config);
    if ( !config.volume ) return null;

    // Load the Sound and apply special effects
    await sound.load();
    const sfx = CONFIG.soundEffects;
    let effect;
    if ( config.muffled && (muffledEffect?.type in sfx) ) {
      const muffledCfg = sfx[muffledEffect.type];
      effect = new muffledCfg.effectClass(sound.context, muffledEffect);
    }
    if ( !effect && (baseEffect?.type in sfx) ) {
      const baseCfg = sfx[baseEffect.type];
      effect = new baseCfg.effectClass(sound.context, baseEffect);
    }
    if ( effect ) sound.effects.push(effect);

    // Initiate sound playback
    await sound.play({...playbackOptions, loop: false, volume: config.volume});
    return sound;
  }

  /* -------------------------------------------- */

  /**
   * Emit playback to other connected clients to occur at a specified position.
   * @param {...*} args           Arguments passed to SoundsLayer#playAtPosition
   * @returns {Promise<void>}     A Promise which resolves once playback for the initiating client has completed
   */
  async emitAtPosition(...args) {
    game.socket.emit("playAudioPosition", args);
    return this.playAtPosition(...args);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Handle mouse cursor movements which may cause ambient audio previews to occur
   */
  _onMouseMove() {
    if ( !this.livePreview ) return;
    if ( canvas.tokens.active && canvas.tokens.controlled.length ) return;
    this.previewSound(canvas.mousePosition);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftStart(event) {
    super._onDragLeftStart(event);
    const interaction = event.interactionData;

    // Snap the origin to the grid
    if ( !event.shiftKey ) interaction.origin = this.getSnappedPoint(interaction.origin);

    // Create a pending AmbientSoundDocument
    const cls = getDocumentClass("AmbientSound");
    const doc = new cls({type: "l", ...interaction.origin}, {parent: canvas.scene});

    // Create the preview AmbientSound object
    const sound = new this.constructor.placeableClass(doc);
    interaction.preview = this.preview.addChild(sound);
    interaction.soundState = 1;
    this.preview._creating = false;
    sound.draw();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftMove(event) {
    const {destination, soundState, preview, origin} = event.interactionData;
    if ( soundState === 0 ) return;
    const radius = Math.hypot(destination.x - origin.x, destination.y - origin.y);
    preview.document.updateSource({radius: radius / canvas.dimensions.distancePixels});
    preview.initializeSoundSource();
    preview.renderFlags.set({refreshState: true});
    event.interactionData.soundState = 2;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftDrop(event) {
    // Snap the destination to the grid
    const interaction = event.interactionData;
    if ( !event.shiftKey ) interaction.destination = this.getSnappedPoint(interaction.destination);
    const {soundState, destination, origin, preview} = interaction;
    if ( soundState !== 2 ) return;

    // Render the preview sheet for confirmation
    const radius = Math.hypot(destination.x - origin.x, destination.y - origin.y);
    if ( radius < (canvas.dimensions.size / 2) ) return;
    preview.document.updateSource({radius: radius / canvas.dimensions.distancePixels});
    preview.initializeSoundSource();
    preview.renderFlags.set({refreshState: true});
    preview.sheet.render(true);
    this.preview._creating = true;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragLeftCancel(event) {
    if ( this.preview._creating ) return;
    return super._onDragLeftCancel(event);
  }

  /* -------------------------------------------- */

  /**
   * Handle PlaylistSound document drop data.
   * @param {DragEvent} event  The drag drop event
   * @param {object} data      The dropped transfer data.
   */
  async _onDropData(event, data) {
    const playlistSound = await PlaylistSound.implementation.fromDropData(data);
    if ( !playlistSound ) return false;
    let origin;
    if ( (data.x === undefined) || (data.y === undefined) ) {
      const coords = this._canvasCoordinatesFromDrop(event, {center: false});
      if ( !coords ) return false;
      origin = {x: coords[0], y: coords[1]};
    } else {
      origin = {x: data.x, y: data.y};
    }
    if ( !event.shiftKey ) origin = this.getSnappedPoint(origin);
    if ( !canvas.dimensions.rect.contains(origin.x, origin.y) ) return false;
    const soundData = {
      path: playlistSound.path,
      volume: playlistSound.volume,
      x: origin.x,
      y: origin.y,
      radius: canvas.dimensions.distance * 2
    };
    return this._createPreview(soundData, {top: event.clientY - 20, left: event.clientX + 40});
  }
}
