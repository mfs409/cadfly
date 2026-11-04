import Ajv from "ajv";
import { describe, expect, test } from "vitest";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import { opsAsText } from "../src/cadfly/assistant/ops";
import { replySchema } from "../src/cadfly/assistant/schema";
import { COMMANDS } from "../src/cadfly/language/commands";

const ajv = new Ajv({ strict: false });
const check = ajv.compile(replySchema());
const reply = (ops: unknown[], text = "ok") => ({ ops, reply: text });

describe("the reply schema", () => {
  test("it is a valid JSON Schema, and a small one however many blocks there are", () => {
    expect(ajv.validateSchema(replySchema())).toBe(true);
    expect(JSON.stringify(replySchema()).length).toBeLessThan(3000);
  });

  test("every kind of op is accepted, with new blocks as text", () => {
    const ops = [
      { op: "append", blocks: "box w=10" },
      { op: "insert_after", block: "b1", blocks: "sphere r=3\nbox" },
      { op: "insert_into", block: "b2", blocks: "circle r=2 hole" },
      { op: "set", block: "b1", field: "w", value: "40" },
      { op: "wrap", blocks: ["b1"], holder: "transform z=20" },
      { op: "wrap", blocks: ["b1", "b2"], holder: "placeAgainst axis=z", with: "box w=10" },
      { op: "unwrap", block: "b1" },
      { op: "delete", block: "b1" },
      { op: "clear" },
    ];
    for (const o of ops) expect(check(reply([o])), JSON.stringify(o)).toBe(true);
    expect(check(reply([]))).toBe(true);
  });

  test("every worked example is a reply the schema accepts", () => {
    for (const ex of WORKED_EXAMPLES) expect(check({ ops: opsAsText(ex.ops), reply: ex.reply }), ex.user).toBe(true);
  });

  test("things the model should not be able to say are rejected", () => {
    const bad: unknown[] = [
      { reply: "no ops" },
      { ops: [] },
      { ops: [], reply: "x", extra: 1 },
      reply([{ op: "teleport" }]),
      reply([{ op: "append" }]),
      reply([{ op: "append", blocks: 5 }]),
      reply([{ op: "append", blocks: [{ kind: "box" }] }]), // blocks are text, not objects
      reply([{ op: "set", block: "b1", field: "colour", value: "red" }]),
      reply([{ op: "set", block: "b1", field: "w", value: 5 }]),
      reply([{ op: "delete" }]),
      reply([{ op: "clear", block: "b1" }]),
      reply([{ op: "wrap", blocks: "b1", holder: "transform" }]), // blocks is a list of ids
      reply([{ op: "wrap", blocks: ["b1"] }]), // the holder is needed
      reply([{ op: "unwrap" }]),
      reply(new Array(25).fill({ op: "clear" })),
      reply([{ op: "set", block: "b1", field: "w", value: "x".repeat(200) }]),
    ];
    for (const b of bad) expect(check(b), JSON.stringify(b).slice(0, 80)).toBe(false);
  });

  test("a field name the model may set is one that some block has", () => {
    const fields = (replySchema() as { properties: { ops: { items: { anyOf: { properties: { field?: { enum: string[] } } }[] } } } }).properties.ops.items.anyOf.find((o) => o.properties.field)!.properties.field!.enum;
    expect(new Set(fields)).toEqual(new Set([...COMMANDS.flatMap((c) => c.params.map((p) => p.id)), "hidden", "disabled"])); // and the eye and the power switch
  });
});
