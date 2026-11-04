import type { Flat, Kernel, Solid } from "../geometry/kernel";
import { Args, Env, type Overlay, ProgramError, toProblem } from "./env";
import { MAX_STEPS, commandById } from "./commands";
import { runOrder } from "./edit";
import type { Files } from "./files";
import { type Block, type Problem, type Program, type Shape, isFlat } from "./types";

/**
 * Running a program: building each block, in order, into shapes, and merging
 * what was built into a picture and something to export (`runProgram`).
 */

/**
 * One shape at the top of the program: what is drawn, and what the block calls
 * it
 */
export interface ShownShape {
  /** The id of the top-level block that made it */
  id: string;
  /** What to call it: see `labelOf` */
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
   * The solids merged: what an export writes. Null if there are none to show
   * (flat shapes are not exported).
   */
  combined: Solid | null;
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
 * Build one block: a shape, a solid or a flat one (or null, for nothing: `set`,
 * a hidden block, and an `if` with nothing in the branch that is taken). Errors
 * name the block that caused them: this throws a ProgramError for anything that
 * goes wrong, including an unknown kind of block, a block that belongs inside
 * another, and a program that has built more than `MAX_STEPS` blocks.
 *
 * @param env What the program has built and set so far.
 * @param block The block to build.
 */
function build(env: Env, block: Block): Shape | null {
  const def = commandById(block.kind);
  if (!def) throw new ProgramError(block.id, `unknown block: ${block.kind}`);
  if (def.piece) throw new ProgramError(block.id, `a ${def.word} block belongs inside another block`);
  if (++env.steps > MAX_STEPS) throw new ProgramError(block.id, `the program has built more than ${MAX_STEPS} blocks: check how many times it repeats`);
  try {
    const args = new Args(env, block, def);
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
          env.scoped(() => {
            env.vars.set(loop.counter, pass);
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
    // a hidden block is built like any other (so its problems show), but gives
    // nothing to what is around it
    return block.hidden === true ? null : made;
  } catch (e) {
    // errors from the geometry helpers know nothing about blocks
    throw e instanceof ProgramError ? e : new ProgramError(block.id, (e as Error).message);
  }
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
  return env.scoped(() => {
    const out: Shape[] = [];
    buildList(env, blocks, (_block, solid) => out.push(solid));
    return out;
  });
}

/**
 * What to call a shape: its own name, else the name of the shape inside it (a
 * holder of one), else what kind of block it is
 */
function labelOf(block: Block): string {
  if (block.kind === "use") return String(block.args.name ?? "").trim() || "part";
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

/**
 * Run a program: build each block at the top, in turn (in the order `runOrder`
 * gives). The program stops at the first block that cannot do its job, and says
 * which block that was; the shapes before it are still built, so there is a
 * picture to show. Never throws: what went wrong is in the result's `problem`.
 *
 * @param kernel The kernel to build with.
 * @param program The blocks to run.
 * @param files The STL files the project carries, by name, for import blocks.
 */
export function runProgram(kernel: Kernel, program: Program, files: Files = {}): RunResult {
  const env = new Env(kernel);
  env.files = files;
  env.buildBlocks = (blocks) => buildAll(env, blocks);
  const shapes: ShownShape[] = [];
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
    buildList(env, runOrder(program), (block, shape) => {
      if (!isFlat(shape)) return void shapes.push({ id: block.id, name: labelOf(block), solid: shape });
      if (shape.hole) throw new ProgramError(block.id, "a hole cuts a piece out of the pieces beside it: put it in the same block as the piece it cuts, or use subtract");
      // each flat shape is a little thicker than the one before, so that one
      // on top of another is seen on top instead of fighting it for the same
      // place
      const lift = 1 + flatCount++ * 0.3;
      const name = labelOf(block);
      showWithPieces(
        { id: block.id, name, solid: kernel.extrudeFlat(shape.flat, FLAT_THICKNESS * lift), flat: shape.flat },
        (shape.pieces ?? []).map((f, i) => kernel.extrudeFlat(f, FLAT_THICKNESS * (lift + 0.3 + i * 0.3))),
      );
    });
  } catch (e) {
    problem = toProblem(e, program[0]?.id ?? "");
  }
  // the sketches of hidden extrudes and revolves are drawn too
  for (const o of env.overlays) {
    if (o.kind === "sketch") showWithPieces({ id: o.blockId, name: "sketch", solid: o.solid, preview: true }, o.pieces);
  }
  let combined: Solid | null = null;
  let flat: Flat | null = null;
  try {
    const solids = shapes.filter((s) => !s.flat && !s.preview && !s.piece).map((s) => s.solid);
    combined = solids.length ? solids.reduce((a, b) => kernel.union(a, b)) : null;
    const flats = shapes.flatMap((s) => (s.flat ? [s.flat] : []));
    flat = flats.length ? flats.reduce((a, b) => kernel.flatUnion(a, b)) : null;
  } catch (e) {
    problem ??= { blockId: program[0]?.id ?? "", message: (e as Error).message };
  }
  return { shapes, combined, flat, overlays: env.overlays, hullFaces: Object.fromEntries(env.hullFaces), measurements: Object.fromEntries(env.measured), problem };
}
