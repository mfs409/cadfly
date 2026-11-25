import type { Flat, Kernel, Solid } from "../geometry/kernel";
import { BlockArgs, Env, type Overlay, type Part, ProgramError, Scope, toProblem } from "./env";
import { RESERVED } from "../geometry/expr";
import { MAX_BUILT_BLOCKS, commandById } from "./commands";
import { allBlocks } from "./program";
import type { StlFiles } from "./files";
import { BUILD, type Block, type Problem, type Program, type Shape, isFlat } from "./types";

/**
 * Running a program: setting the globals, then building the blocks of `build`
 * (and of the scripts they use) into shapes, and merging what was built into a
 * picture and something to export (`runProgram`).
 */

/**
 * One shape at the top of the program: what is drawn, and what the block calls
 * it
 */
export interface ShownShape {
  /** The id of the top-level block that made it */
  id: string;
  /** What to call it */
  name: string;
  /**
   * What is drawn: the solid, or for a flat shape a thin slab of it lying on
   * the ground
   */
  solid: Solid;
  /**
   * For a flat shape: the shape itself (which is drawn, but is not part of the
   * export)
   */
  flat?: Flat;
  /**
   * The sketch of a hidden extrude or revolve, drawn in its place: not part of
   * the export or the shapes' sizes
   */
  preview?: boolean;
  /**
   * Only the outline is drawn (the pieces a flat shape is put together from,
   * one above another): not a shape of its own
   */
  piece?: boolean;
}

/** What running a program gives */
export interface RunResult {
  /**
   * The shapes at the top of the program that built, in order (hidden ones are
   * not here)
   */
  shapes: ShownShape[];
  /**
   * The 3D shapes at the top of `build` whose blocks have their eye shut, in
   * order: built, but left out of the picture and of `combined`. An export can
   * ask for them.
   */
  hiddenShapes: ShownShape[];
  /**
   * The solids merged: what an export writes. Null if there are none to show
   * (flat shapes are not exported).
   */
  combined: Solid | null;
  /**
   * Only when asked for (`runProgram`'s `withHidden`): the solids merged with
   * the hidden shapes. Null if there are none, or when not asked for.
   */
  combinedWithHidden: Solid | null;
  /** The flat shapes merged, if there are any */
  flat: Flat | null;
  /**
   * For each empty faces section (by block id): the faces its solid's hull
   * would have, which the "hull" button fills it with
   */
  hullFaces: Record<string, number[][]>;
  /** The corners and faces of solids to draw in the 3D view */
  overlays: Overlay[];
  /** What each measure block found (by block id): the variables it set */
  measurements: Record<string, Record<string, number>>;
  /** The first thing that went wrong, if anything did */
  problem?: Problem;
}

/**
 * How thick a flat shape is drawn, in mm: enough to see (and to be a solid); it
 * is never part of the export
 */
const FLAT_THICKNESS = 0.2;

/**
 * Build one block: a shape, a solid or a flat one (or null, for nothing:
 * `set!`, and an `if` with nothing in the branch that is taken). A hidden
 * block's shape is given too. Errors name the block that caused them: this throws a ProgramError
 * for anything that goes wrong, including an unknown kind of block, a block
 * that belongs inside another, and a program that has built more than
 * `MAX_BUILT_BLOCKS` blocks.
 *
 * @param env What the program has built and set so far.
 * @param block The block to build.
 */
function makeShape(env: Env, block: Block): Shape | null {
  const def = commandById(block.kind);
  if (!def) throw new ProgramError(block.id, `unknown block: ${block.kind}`);
  if (def.piece) throw new ProgramError(block.id, `a ${def.word} block belongs inside another block`);
  if (++env.blocksBuilt > MAX_BUILT_BLOCKS) throw new ProgramError(block.id, `the program has built more than ${MAX_BUILT_BLOCKS} blocks: check how many times it repeats`);
  try {
    const args = new BlockArgs(env, block, def);
    if (def.run) {
      def.run(env, args);
      return null;
    }
    if (!def.make) throw new ProgramError(block.id, `a ${def.word} block cannot be run`);
    const overlaysFrom = env.overlays.length;
    let kids: Shape[] = [];
    if (def.buildsInner) {
      const loop = def.loop?.(env, args);
      if (!loop) kids = buildAll(env, block.inner ?? []);
      else {
        // the counter is its own variable for each pass, and gone afterwards
        for (let pass = 0; pass < loop.times; pass++) {
          env.inNewScope(() => {
            env.scope.set(loop.counter, pass);
            kids.push(...buildAll(env, block.inner ?? []));
          });
        }
      }
    }
    // everything inside has its eye shut: nothing to work on, which is not a
    // mistake (what the shapes inside drew is still moved, below)
    const nothing = def.buildsInner && !kids.length && (block.inner ?? []).some((k) => k.hidden === true && commandById(k.kind)?.make);
    const made = nothing ? null : def.make(env, args, kids);
    // the points and faces that were drawn for the shapes inside: a block that
    // moves its contents moves them too, and a hidden block has none
    if (block.hidden === true) {
      // what the shapes inside drew goes with them, but a hidden extrude or
      // revolve keeps its own sketch
      const own = env.overlays.splice(overlaysFrom).filter((o) => o.kind === "sketch" && o.blockId === block.id);
      env.overlays.push(...own);
    }
    else if (def.moveOverlays && block.disabled !== true) {
      const added: Overlay[] = [];
      def.moveOverlays(args, env.overlays.slice(overlaysFrom), (o) => added.push(o));
      env.overlays.push(...added);
    }
    return made;
  } catch (e) {
    // errors from the geometry helpers know nothing about blocks
    throw e instanceof ProgramError ? e : new ProgramError(block.id, (e as Error).message);
  }
}

/**
 * Build one block, as `makeShape` does, but a hidden block is built like any
 * other (so its problems show) and gives nothing to what is around it.
 *
 * @param env What the program has built and set so far.
 * @param block The block to build.
 */
function build(env: Env, block: Block): Shape | null {
  const made = makeShape(env, block);
  return block.hidden === true ? null : made;
}

/**
 * Build the blocks of a list one after another, handing each shape to `emit`
 * (with the block that made it). A block that makes nothing is not handed on.
 */
function buildList(env: Env, blocks: Block[], emit: (block: Block, shape: Shape) => void) {
  for (const block of blocks) {
    const shape = build(env, block);
    if (shape) emit(block, shape);
  }
}

/**
 * Build a list of blocks inside another block: variables set in there stay in
 * there. Gives the shapes they made, in order.
 */
function buildAll(env: Env, blocks: Block[]): Shape[] {
  return buildParts(env, blocks).map((p) => p.shape);
}

/**
 * Like `buildAll`, and gives what each shape is called as well.
 *
 * @param env What the program has built and set so far.
 * @param blocks The blocks to build.
 */
function buildParts(env: Env, blocks: Block[]): Part[] {
  return env.inNewScope(() => {
    const out: Part[] = [];
    buildList(env, blocks, (block, shape) => out.push({ name: labelOf(block), shape }));
    return out;
  });
}

/**
 * What to call a shape: its own name, else the name of the shape inside it (a
 * holder of one), else what kind of block it is
 */
function labelOf(block: Block): string {
  if (block.kind === "use") return String(block.args.name ?? "").trim() || "script";
  // an if with an else is not called after what is in its first branch: which
  // branch is built is not what it is
  if (block.kind === "if" && (block.inner ?? []).some((k) => k.kind === "else" && k.inner?.length)) return "if";
  const named = commandById(block.kind)?.params.find((p) => p.type.kind === "caption");
  const own = String(block.args[named?.id ?? ""] ?? "").trim();
  if (own) return own;
  // the pieces drawn inside an extrude are not what it is called
  const inside = (block.inner ?? []).filter((b) => commandById(b.kind)?.make && !commandById(b.kind)?.sketch);
  return inside.length === 1 ? labelOf(inside[0]) : block.kind;
}

/** The id of the first block of the program: what a problem that is not about any block is named after */
function firstBlockId(program: Program): string {
  return allBlocks(program)[0]?.id ?? "";
}

/**
 * Run the global scripts: each on its own, starting with no variables, so that
 * a global can use another only from the same script, below the block that
 * sets it. What they set goes to `env.globals`, which every script sees. Throws
 * a ProgramError for a block that is not a `set`, for a name that two global
 * scripts both set, and for a block that uses a variable that another global
 * script sets.
 */
function runGlobals(env: Env, program: Program) {
  // the first global script to set each name owns it
  const owner = new Map<string, number>();
  /** The name a `set` block sets, or nothing for any other block. */
  const nameOf = (block: Block) => (block.kind === "set" ? new BlockArgs(env, block, commandById("set")!).text("name") : "");
  program.forEach((script, i) => {
    if (script.name !== undefined) return;
    for (const block of script.blocks) if (block.kind === "set" && !owner.has(nameOf(block))) owner.set(nameOf(block), i);
  });
  program.forEach((script, i) => {
    if (script.name !== undefined) return;
    const own = new Scope();
    env.inScope(own, () => {
      for (const block of script.blocks) {
        if (block.kind !== "set") throw new ProgramError(block.id, `a ${commandById(block.kind)?.word ?? block.kind} block cannot be in a global script (only set blocks can)`);
        const name = nameOf(block);
        if (owner.get(name) !== i) throw new ProgramError(block.id, `"${name}" is already set by another global script: a global is set in only one script`);
        try {
          build(env, block);
        } catch (e) {
          // a value that uses a variable another global script sets: say what to do about it
          const used = String(block.args.value ?? "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
          const other = used.find((v) => !RESERVED.has(v) && !own.has(v) && owner.has(v) && owner.get(v) !== i);
          if (other !== undefined) throw new ProgramError(block.id, `"${other}" is set in another script, so this block cannot use it: put this block below the block that sets it, in the same script`);
          throw e;
        }
      }
    });
    for (const [name, value] of own.entries()) env.globals.set(name, value);
  });
}

/**
 * Run a program. First the global scripts set the variables that everybody
 * sees. Then the blocks of `build` are built, in turn; a `use` builds a named
 * script where it is used. The program stops at the first block that cannot do
 * its job, and says which block that was; the shapes
 * before it are still built, so there is a picture to show. A named script that
 * is never used is never run, so a problem in it is not seen. Never throws:
 * what went wrong is in the result's `problem`.
 *
 * @param kernel The kernel to build with.
 * @param program The scripts to run.
 * @param files The STL files the project carries, by name, for import blocks.
 * @param withHidden Also merge the hidden shapes with the others
 *                   (`combinedWithHidden`), for an export that includes them.
 */
export function runProgram(kernel: Kernel, program: Program, files: StlFiles = {}, withHidden = false): RunResult {
  const env = new Env(kernel);
  env.files = files;
  env.buildBlocks = (blocks) => buildAll(env, blocks);
  env.buildParts = (blocks) => buildParts(env, blocks);
  for (const script of program) if (script.name !== undefined && script.name !== BUILD && !env.scripts.has(script.name)) env.scripts.set(script.name, script);
  const shapes: ShownShape[] = [];
  const hiddenShapes: ShownShape[] = [];
  let flatCount = 0;
  let problem: Problem | undefined;

  /**
   * Show a shape, and then the outline of each piece it is put together from
   * (the solids given, one above another): a circle in the middle of a
   * rectangle is not a boundary of the joined shape
   */
  function showWithPieces(shape: ShownShape, pieces: Solid[]) {
    shapes.push(shape);
    const { flat: _flat, ...outline } = shape;
    for (const solid of pieces) shapes.push({ ...outline, solid, piece: true });
  }

  try {
    runGlobals(env, program);
    env.scope = env.globals.child();
    for (const block of program.find((s) => s.name === BUILD)?.blocks ?? []) {
      // a `use` at the top of build says what its script made, one shape at a time
      let parts: Part[] | undefined;
      if (block.kind === "use") env.partsOfUse = (made) => void (parts = made);
      let shape: Shape | null;
      try {
        shape = makeShape(env, block);
      } finally {
        env.partsOfUse = undefined;
      }
      if (!shape) continue;
      if (block.hidden === true) {
        if (!isFlat(shape)) hiddenShapes.push({ id: block.id, name: labelOf(block), solid: shape });
        continue;
      }
      if (parts && !isFlat(shape)) {
        for (const part of parts) shapes.push({ id: block.id, name: part.name, solid: part.shape as Solid });
        continue;
      }
      if (!isFlat(shape)) {
        shapes.push({ id: block.id, name: labelOf(block), solid: shape });
        continue;
      }
      if (shape.hole) throw new ProgramError(block.id, "a hole cuts a piece out of the pieces beside it: put it in the same block as the piece it cuts, or use subtract");
      // each flat shape is a little thicker than the one before, so that one
      // on top of another is seen on top instead of fighting it for the same
      // place
      const lift = 1 + flatCount++ * 0.3;
      const name = labelOf(block);
      showWithPieces(
        { id: block.id, name, solid: kernel.extrudeFlat(shape.flat, FLAT_THICKNESS * lift), flat: shape.flat },
        (shape.pieces.length > 1 ? shape.pieces : []).map((f, i) => kernel.extrudeFlat(f, FLAT_THICKNESS * (lift + 0.3 + i * 0.3))),
      );
    }
  } catch (e) {
    problem = toProblem(e, firstBlockId(program));
  }
  // the sketches of hidden extrudes and revolves are drawn too
  for (const o of env.overlays) {
    if (o.kind === "sketch") showWithPieces({ id: o.blockId, name: "sketch", solid: o.solid, preview: true }, o.pieces);
  }
  let combined: Solid | null = null;
  let combinedWithHidden: Solid | null = null;
  let flat: Flat | null = null;
  try {
    const solids = shapes.filter((s) => !s.flat && !s.preview && !s.piece).map((s) => s.solid);
    combined = solids.length ? solids.reduce((a, b) => kernel.union(a, b)) : null;
    const everything = withHidden ? [...solids, ...hiddenShapes.map((s) => s.solid)] : [];
    combinedWithHidden = everything.length ? everything.reduce((a, b) => kernel.union(a, b)) : null;
    const flats = shapes.flatMap((s) => (s.flat ? [s.flat] : []));
    flat = flats.length ? flats.reduce((a, b) => kernel.flatUnion(a, b)) : null;
  } catch (e) {
    problem ??= { blockId: firstBlockId(program), message: (e as Error).message };
  }
  return { shapes, hiddenShapes, combined, combinedWithHidden, flat, overlays: env.overlays, hullFaces: Object.fromEntries(env.hullFaces), measurements: Object.fromEntries(env.measured), problem };
}
