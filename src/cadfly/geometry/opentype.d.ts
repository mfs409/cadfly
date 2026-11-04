/**
 * CADFly uses opentype.js 2.0, but opentype.js 2.0 does not have an official
 * @types package.  Fortunately, CADFly only uses a small subset of opentype.js,
 * so we can write "just enough" of a declaration to get typing support for what
 * we need, without having to write up everything.
 *
 * Note that the documentation is largely lifted from
 * <https://github.com/opentypejs/opentype.js>
 */
declare module "opentype.js" {
  /**
   * One step of a letter's outline, as a pen moving over a page:
   * - **M** Move To: Move to a new position. This creates a new contour.
   * - **L** Line To: Draw a line from the previous position to the given coordinate.
   * - **C** Curve To: Draw a bézier curve from the current position to the given coordinate.
   * - **Q** Quad To: Draw a quadratic bézier curve from the current position to the given coordinate.
   * - **Z** Close: Close the path. If stroked, this will draw a line from the first to the last point of the contour.
   *
   * A coordinate, like `x1`, is present only if a step needs it.
   */
  export interface PathCommand {
    type: "M" | "L" | "Q" | "C" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  /** The outline of a letter is a list of steps */
  export interface Path {
    /**
     * The path commands. Each command is a dictionary containing a type and
     * coordinates
     */
    commands: PathCommand[];
  }

  /** 
   * A Glyph is an individual mark that often corresponds to a character. Some
   * glyphs, such as ligatures, are a combination of many characters. Glyphs are
   * the basic building blocks of a font.
   */
  export interface Glyph {
    /** The width to advance the pen when drawing this glyph */
    advanceWidth?: number;
    /**
     * Get a scaled glyph Path object for use on a drawing context.
     *
     * @param x        Horizontal position of the glyph. (default: 0)
     * @param y        Vertical position of the baseline of the glyph. (default:
     *                 0)
     * @param fontSize Font size in pixels (default: 72).
     * @param options  {GlyphRenderOptions}, see Font.getPath()
     * @param font     a font object, needed for rendering COLR/CPAL fonts to
     *                 get the layers and colors
     */
    getPath(x: number, y: number, fontSize: number, options?: object, font?: Font): Path;
  }

  /** 
   * A Font represents a loaded OpenType font file. It contains a set of glyphs
   * and methods to draw text on a drawing context, or to get a path
   * representing the text.
   */
  export interface Font {
    /**
     * X/Y coordinates in fonts are stored as integers. This value determines
     * the size of the grid.
     * */
    unitsPerEm: number;
    /**
     * The number of the glyph that draws a character. 0 is the font's "missing
     * letter" box, so 0 means the font cannot draw it.
     */
    charToGlyphIndex(char: string): number;
    /** 
     * Convert the character to a Glyph object. Returns null if the glyph could
     * not be found. Note that this function assumes that there is a one-to-one
     * mapping between the given character and a glyph; for complex scripts,
     * this might not be the case.
     */
    charToGlyph(char: string): Glyph;
    /** 
     * Retrieve the value of the kerning pair between the left glyph (or its
     * index) and the right glyph (or its index). If no kerning pair is found,
     * return 0. The kerning value gets added to the advance width when
     * calculating the spacing between glyphs.
     */
    getKerningValue(left: Glyph, right: Glyph): number;
    /** The font's data tables, as far as they are declared here. */
    tables: {
      /**
       * What a variable font can vary: each axis (such as the weight, `wght`)
       * has a smallest, a default and a largest value. Absent in an ordinary
       * font. 
       */
      fvar?: { axes: { tag: string; minValue: number; defaultValue: number; maxValue: number }[] };
    };
    /**
     * The VariationManager handles variable font properties using the OpenType
     * font variation tables.
     */
    variation?: {
      /** 
       * Sets the variation coordinates to be used by default for rendering in
       * the font's default render options.
       *
       * @param instanceIdOrObject  Either the zero-based index of a variation
       *                            instance or an object mapping axis tags to
       *                            variation values.
       */
      set(coords: Record<string, number>): void;
      /**
       * Retrieves a transformed copy of a glyph based on the provided variation
       * coordinates, or the glyph itself if no variation was applied
       *
       * @param glyph   Glyph or index of glyph to transform.
       * @param coords  Variation coords object (or the variation coords in the
       *                font's defaultRenderOptions by default)
       */
      getTransform(glyph: Glyph, coords?: Record<string, number>): Glyph;
    };
  }

  /** Read a font from the bytes of a font file (.ttf, .otf or .woff) */
  export function parse(buffer: ArrayBuffer): Font;

  const opentype: { parse: typeof parse };
  export default opentype;
}
