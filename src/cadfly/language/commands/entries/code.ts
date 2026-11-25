/**
 * The commands of the Code tab: setting a variable, repeating, choosing with
 * `if` and `else`, using a script, and measuring.
 *
 * Each entry is the whole definition of one block, as a `CommandDef`.
 */

import { evaluateExpr, ExprError } from "../../../geometry/expr";
import { ProgramError, inputNames, splitValues } from "../../env";
import { BUILD } from "../../types";
import { expr, text, merged, mergedSolid } from "../helpers";
import { SHAPES } from "../types";
import type { CommandEntry } from "../types";
import { blankBlock } from "../lookup";

/**
 * A script may be used inside another this many levels deep: it stops a script
 * that uses itself with no way to stop
 */
const MAX_SCRIPT_DEPTH = 16;

/** One block may repeat at most this many times */
const MAX_PASSES = 1000;

/**
 * The commands of the Code tab, in the order of the palette within the tab.
 */
export const codeEntries: readonly CommandEntry[] = [
  /**
   * Sets a variable to a number. It builds no shape: `run` works out the value
   * when the block is reached, so the blocks after it see the variable (in a
   * global script, every script sees it). The name may not be a reserved word.
   */
  {
    id: "set",
    hint: "a number variable, like width",
    plain: true,
    word: "set",
    category: "code",
    params: [{ id: "name", label: "", type: { kind: "var" }, default: "width" }, expr("value", "=", "40")],
    run: (env, a) => {
      const name = a.variableName("name");
      env.scope.set(name, a.num("value"));
    },
  },

  /**
   * Builds what is inside once for each pass and merges the results. `loop`
   * gives the counter (a variable that exists only inside the block, and is 0,
   * 1, 2, ... in turn) and the number of passes, which must be a whole number
   * up to `MAX_PASSES`. The repeating is done when the program runs. Builds nothing if there is
   * nothing inside.
   */
  {
    id: "repeat",
    hint: "builds what is inside again and again, counting 0, 1, 2, ... in the counter variable; results are merged",
    short: "repeats what is inside, counting 0, 1, 2... in the counter variable",
    word: "repeat",
    category: "code",
    params: [expr("times", "", "3"), { id: "counter", label: "times, counting with", type: { kind: "var" }, default: "i" }],
    inner: SHAPES,
    buildsInner: true,
    loop: (_env, a) => {
      const times = a.num("times");
      if (!Number.isInteger(times) || times < 0) a.fail("times", `must be a whole number, 0 or more (it is ${times})`);
      if (times > MAX_PASSES) a.fail("times", `is too many: at most ${MAX_PASSES} passes of one block`);
      return { counter: a.variableName("counter"), times };
    },
    make: (env, a, kids) => (kids.length ? merged(env, a, kids) : null),
  },

  /**
   * Builds the shapes inside when the condition is true, and the shapes of its
   * else block when it is false. It chooses before building, so the branch not
   * taken is never built and may be wrong, or never end, without harm. The
   * condition must be a yes/no. An if may have only one
   * else.
   */
  {
    id: "if",
    hint: "builds the shapes inside only when the condition is true: a comparison like i % 2 == 0, or true or false; an else block inside holds what is built when it is false",
    short: "builds the shapes inside when the condition is true; its else block when it is false",
    word: "if",
    category: "code",
    params: [expr("condition", "", "true")],
    inner: [...SHAPES, "else"],
    starter: (nextId) => [blankBlock("else", nextId())], // an if starts with its else, empty
    make: (env, a) => {
      const inside = a.block.inner ?? [];
      const elses = inside.filter((k) => k.kind === "else");
      if (elses.length > 1) throw new ProgramError(elses[1].id, "an if can have only one else");
      // only the branch that is taken is built: the other may be wrong (or
      // never end) without harm
      const chosen = a.truth("condition") ? inside.filter((k) => k.kind !== "else") : (elses[0]?.inner ?? []);
      const kids = chosen.length ? env.buildBlocks(chosen) : [];
      return kids.length ? merged(env, a, kids) : null;
    },
  },
  /** The part of an if that is built when its condition is false */
  {
    id: "else",
    hint: "inside an if: holds what is built when the condition is false",
    plain: true,
    word: "else",
    category: "code",
    piece: true,
    partOf: "an if",
    params: [],
    inner: SHAPES,
  },

  /**
   * Builds a named script (a function), giving each of its inputs the value
   * written for it (`values`: "40, 10", each an expression worked out here,
   * where the script is used). The script sees the global variables and its own
   * inputs and variables, and nothing of the blocks around this one: its inputs
   * win over the globals. A problem inside the script is reported on the block
   * that has it, with which use led to it. Scripts using scripts are limited to
   * `MAX_SCRIPT_DEPTH` levels, to stop a script that uses itself.
   */
  {
    id: "use",
    hint: 'builds a named script with a value for each of its inputs, like values="40, 10"',
    short: "builds a script, like values=\"40, 10\"",
    word: "use",
    category: "code",
    params: [text("name", "", "script"), text("values", "with", "")],
    make: (env, a) => {
      const name = a.variableName("name");
      const script = env.scripts.get(name);
      if (!script) a.fail("name", `there is no script called "${name}"` + (name === BUILD ? " that can be used (build runs by itself)" : ""));
      let inputs: string[];
      try {
        inputs = inputNames(script!.inputs ?? "");
      } catch (e) {
        return a.fail("name", `the inputs of the script ${name} are not right: ${(e as Error).message}`);
      }
      const given = splitValues(a.text("values"));
      if (given.length !== inputs.length) {
        a.fail("values", `${name} needs ${inputs.length} value${inputs.length === 1 ? "" : "s"}${inputs.length ? ` (${inputs.join(", ")})` : ""} but got ${given.length}`);
      }
      const numbers = given.map((v, i) => {
        try {
          return evaluateExpr(v, env.scope);
        } catch (e) {
          if (e instanceof ExprError) return a.fail("values", `value ${i + 1} (${v}): ${e.message}`);
          throw e;
        }
      });
      if (env.useDepth >= MAX_SCRIPT_DEPTH) a.fail("name", `the script "${name}" is being used more than ${MAX_SCRIPT_DEPTH} levels deep: does it have a way to stop?`);
      env.useDepth++;
      try {
        // the script sees the globals and its own inputs (which win), not the
        // variables of the blocks that use it
        const kids = env.inScope(env.globals.child(), () => {
          inputs.forEach((n, i) => env.scope.set(n, numbers[i]));
          return env.buildBlocks(script!.blocks);
        });
        return kids.length ? merged(env, a, kids) : null;
      } catch (e) {
        // say which use led to a problem inside the script, once (the
        // innermost use)
        if (e instanceof ProgramError && !/\(when script /.test(e.message)) throw new ProgramError(e.blockId, `${e.message} (when script ${name} was used with ${given.join(", ") || "no values"})`);
        throw e;
      } finally {
        env.useDepth--;
      }
    },
  },

  /**
   * Builds the shapes inside, passes them through, and sets variables from
   * their bounding box: name_w, name_d, name_h (the size) and name_x0 name_x1
   * name_y0 name_y1 name_z0 name_z1 (the edges), rounded to 9 places. They are
   * set after the inside is built, so they are for the blocks below this one.
   * What it found is kept for the "?" on the block (`env.measured`).
   */
  {
    id: "measure",
    hint: "builds the shapes inside and sets name_w, name_d, name_h (size) and name_x0 name_x1 name_y0 name_y1 name_z0 name_z1 (edges)",
    short: "sets name_w, name_d, name_h and name_x0..name_z1 (size, edges)",
    word: "measure",
    category: "code",
    params: [{ id: "name", label: "as", type: { kind: "var" }, default: "part" }],
    inner: SHAPES,
    buildsInner: true,
    observer: true,
    make: (env, a, kids) => {
      const name = a.variableName("name");
      const shape = mergedSolid(env, a, kids);
      const { min, max } = shape.bounds();
      const sizes: [string, number][] = [["w", max[0] - min[0]], ["d", max[1] - min[1]], ["h", max[2] - min[2]], ["x0", min[0]], ["x1", max[0]], ["y0", min[1]], ["y1", max[1]], ["z0", min[2]], ["z1", max[2]]];
      // set here, after the inside has been built: the blocks below this one
      // can use them
      const found: Record<string, number> = {};
      for (const [suffix, value] of sizes) {
        found[`${name}_${suffix}`] = Math.round(value * 1e9) / 1e9;
        env.scope.set(`${name}_${suffix}`, found[`${name}_${suffix}`]);
      }
      // for the "?" on the block, which shows them
      env.measured.set(a.block.id, found);
      return shape;
    },
  },
];
