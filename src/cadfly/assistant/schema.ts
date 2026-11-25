import { COMMANDS } from "../language/commands";

/**
 * The JSON Schema that every answer from the model must match, built from the
 * list of commands so it stays in step with them.
 */

/** A JSON Schema, as plain data. */
export type JsonSchema = Record<string, unknown>;

/** The longest a field value may be */
const MAX_TEXT = 80;
/**
 * The most ops one answer may hold, so a runaway answer stays bounded (the
 * length of block text is bounded by the answer's token limit)
 */
export const MAX_OPS = 24;
/** The most block ids one `wrap` op may list */
const MAX_IDS = 24;
/** The longest the sentence for the person (`reply`) may be */
const MAX_REPLY = 400;
/** The longest a block id may be: `b123`, with room to spare */
const MAX_ID = 12;
/** The longest the name of a script, or of the script to add to, may be */
const MAX_SCRIPT_NAME = 40;
/** The longest the inputs of a script may be: `x, y, size` */
const MAX_SCRIPT_INPUTS = 80;
/** The longest the one-line holder of a `wrap` may be: `transform x=10 z=20` */
const MAX_HOLDER = 200;

/**
 * The JSON Schema of an answer from the model: `{ ops: [...], reply: "..." }`.
 * New blocks are written as block text, a plain string, so the schema is small
 * whatever the blocks are: which block takes which field is checked when an
 * edit is applied, with a message that says what is wrong, and a mistake goes
 * through the repair round. (Describing every block in the schema made it grow
 * with each new block until Google's service refused it.)
 */
export function answerSchema(): JsonSchema {
  const id = { type: "string", maxLength: MAX_ID };
  // no maxLength here: a long one is expanded into the grammar a local model is held to, and llama.cpp refuses a big one
  const blocks = { type: "string" };
  // the fields a `set` may name: every field of every block, and the two switches that are not fields (the eye and the power switch)
  const paramIds = [...new Set([...COMMANDS.flatMap((c) => c.params.map((p) => p.id)), "hidden", "disabled"])];
  /** The schema of one kind of op: its name, its other properties, and which of them are required (default: all) */
  const op = (name: string, extra: Record<string, JsonSchema> = {}, required = Object.keys(extra)): JsonSchema => ({
    type: "object",
    properties: { op: { enum: [name] }, ...extra },
    required: ["op", ...required],
    additionalProperties: false,
  });
  return {
    type: "object",
    properties: {
      ops: {
        type: "array",
        maxItems: MAX_OPS,
        items: {
          anyOf: [
            op("append", { blocks, to: { type: "string", maxLength: MAX_SCRIPT_NAME } }, ["blocks"]),
            op("script", { name: { type: "string", maxLength: MAX_SCRIPT_NAME }, inputs: { type: "string", maxLength: MAX_SCRIPT_INPUTS }, blocks }, ["name"]),
            op("insert_after", { block: id, blocks }),
            op("insert_into", { block: id, blocks }),
            op("set", { block: id, field: { enum: paramIds }, value: { type: "string", maxLength: MAX_TEXT } }),
            op("wrap", { blocks: { type: "array", items: id, maxItems: MAX_IDS }, holder: { type: "string", maxLength: MAX_HOLDER }, with: blocks }, ["blocks", "holder"]),
            op("unwrap", { block: id }),
            op("delete", { block: id }),
            op("clear"),
          ],
        },
      },
      reply: { type: "string", maxLength: MAX_REPLY },
    },
    required: ["ops", "reply"],
    additionalProperties: false,
  };
}
