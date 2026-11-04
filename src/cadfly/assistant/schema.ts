import { COMMANDS } from "../language/commands";

export type JsonSchema = Record<string, unknown>;

/** The longest a name, an expression, or a field value may be */
const MAX_TEXT = 80;
/** How many ops or ids one reply may hold, so a runaway reply stays bounded (the length of block text is bounded by the reply's token limit) */
const MAX_OPS = 24;
const MAX_IDS = 24;
const MAX_REPLY = 400;

/**
 * The JSON Schema of a reply from the model: `{ ops: [...], reply: "..." }`. New blocks are written as block text
 * (see blocktext.ts), a plain string, so the schema is small whatever the blocks are: which block takes which field
 * is checked when an edit is applied, with a message that says what is wrong, and a mistake goes through the repair
 * round. (Describing every block in the schema made it grow with each new block until Google's service refused it.)
 */
export function replySchema(): JsonSchema {
  const id = { type: "string", maxLength: 12 };
  // no maxLength here: a long one is expanded into the grammar a local model is held to, and llama.cpp refuses a big one
  const blocks = { type: "string" };
  const paramIds = [...new Set([...COMMANDS.flatMap((c) => c.params.map((p) => p.id)), "hidden", "disabled"])];
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
            op("append", { blocks }),
            op("insert_after", { block: id, blocks }),
            op("insert_into", { block: id, blocks }),
            op("set", { block: id, field: { enum: paramIds }, value: { type: "string", maxLength: MAX_TEXT } }),
            op("wrap", { blocks: { type: "array", items: id, maxItems: MAX_IDS }, holder: { type: "string", maxLength: 200 }, with: blocks }, ["blocks", "holder"]),
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
