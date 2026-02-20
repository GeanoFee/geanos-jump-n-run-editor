/**
 * The grid mesh data.
 * @typedef {object} GridMeshData
 * @property {number} type        The type of the grid (see {@link CONST.GRID_TYPES})
 * @property {number} width       The width of the grid in pixels
 * @property {number} height      The height of the grid in pixels
 * @property {number} size        The size of a grid space in pixels
 * @property {number} thickness   The thickness of the grid lines in pixels
 * @property {number} color       The color of the grid
 * @property {number} alpha       The alpha of the grid
 */

/**
 * The grid mesh, which uses the {@link GridShader} to render the grid.
 */
class GridMesh extends QuadMesh {

  /**
   * The grid mesh constructor.
   * @param {typeof GridShader} [shaderClass=GridShader]    The shader class
   */
  constructor(shaderClass=GridShader) {
    super(shaderClass);
    this.width = 0;
    this.height = 0;
    this.alpha = 0;
    this.renderable = false;
  }

  /* -------------------------------------------- */

  /**
   * The data of this mesh.
   * @type {GridMeshData}
   */
  data = {
    type: CONST.GRID_TYPES.GRIDLESS,
    width: 0,
    height: 0,
    size: 0,
    thickness: 1,
    color: 0,
    alpha: 1
  };

  /* -------------------------------------------- */

  /**
   * Initialize and update the mesh given the (partial) data.
   * @param {Partial<GridMeshData>} data    The (partial) data.
   * @returns {this}
   */
  initialize(data) {
    // Update the data
    this._initialize(data);

    // Update the width, height, and alpha
    const d = this.data;
    this.width = d.width;
    this.height = d.height;
    this.alpha = d.alpha;
    // Don't render if gridless or the thickness isn't positive positive
    this.renderable = (d.type !== CONST.GRID_TYPES.GRIDLESS) && (d.thickness > 0);

    return this;
  }

  /* -------------------------------------------- */

  /**
   * Initialize the data of this mesh given the (partial) data.
   * @param {Partial<GridMeshData>} data    The (partial) data.
   * @protected
   */
  _initialize(data) {
    const d = this.data;
    if ( data.type !== undefined ) d.type = data.type;
    if ( data.width !== undefined ) d.width = data.width;
    if ( data.height !== undefined ) d.height = data.height;
    if ( data.size !== undefined ) d.size = data.size;
    if ( data.thickness !== undefined ) d.thickness = data.thickness;
    if ( data.color !== undefined ) {
      const color = Color.from(data.color);
      d.color = color.valid ? color.valueOf() : 0;
    }
    if ( data.alpha !== undefined ) d.alpha = data.alpha;
  }
}

