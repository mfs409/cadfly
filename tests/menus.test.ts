import { describe, expect, test } from "vitest";
import { EXAMPLES, exampleById } from "../src/cadfly/examples";
import type { Example } from "../src/cadfly/examples/types";
import { allBlocks, createEmptyProgram } from "../src/cadfly/language/program";
import type { Program } from "../src/cadfly/language/types";
import { addExampleToProject, exampleCards, modeCards } from "../src/cadfly/ui/menus";
import { UI_MODES, modeByName, offers } from "../src/cadfly/ui/modes";
import { blk } from "./helpers/blocks";

/**
 * What the Mode and Examples overlays list, and what adding an example to a
 * project does.
 */

describe("the list of modes", () => {
  test("every mode is a card with its description, and the mode in force is the one marked", () => {
    const cards = modeCards(UI_MODES, "Builder");
    expect(cards.map((c) => c.name)).toEqual(UI_MODES.map((m) => m.name));
    expect(cards.filter((c) => c.current).map((c) => c.name)).toEqual(["Builder"]);
    for (const card of cards) expect(card.description.length).toBeGreaterThan(20);
  });

  test("a name that is no mode marks none", () => {
    expect(modeCards(UI_MODES, "Nope").some((c) => c.current)).toBe(false);
  });
});

describe("the list of examples", () => {
  test("a mode lists only the examples that use blocks it offers, in the examples' order, and a bigger mode lists more", () => {
    let before: string[] = [];
    for (const m of UI_MODES) {
      const ids = exampleCards(EXAMPLES, m.spec).map((c) => c.id);
      for (const id of ids) for (const block of allBlocks(exampleById(id)!.program)) expect(offers(m.spec, block.kind), `${m.name}: ${id} uses ${block.kind}`).toBe(true);
      expect(ids, m.name).toEqual(EXAMPLES.map((e) => e.id).filter((id) => ids.includes(id)));
      for (const id of before) expect(ids, `${m.name} keeps ${id}`).toContain(id);
      before = ids;
    }
    expect(before).toHaveLength(EXAMPLES.length);
  });

  test("each card says what the example shows", () => {
    const card = exampleCards(EXAMPLES, undefined).find((c) => c.id === "hinge")!;
    expect(card).toMatchObject({ name: "Hinge", description: exampleById("hinge")!.description });
  });
});

describe("adding an example to a project", () => {
  const first = modeByName("First steps");
  const everything = modeByName("Everything");
  const project = (): Program => [{ id: "s1", name: "build", blocks: [blk("b1", "box", { w: "10", d: "10", h: "10" })] }];
  const simple = (): Example => ({ id: "pin", name: "Pin", description: "A pin.", program: [{ id: "s1", name: "build", blocks: [blk("b1", "cylinder", { r: "4", h: "20" })] }] });

  test("where scripts are not offered, a build-only example goes straight into build", () => {
    const outcome = addExampleToProject(project(), {}, simple(), first);
    if ("refused" in outcome) throw new Error(outcome.refused);
    expect(outcome.program).toHaveLength(1);
    expect(outcome.program[0].blocks.map((b) => b.kind)).toEqual(["box", "cylinder"]);
    expect(outcome.notice).toContain("Pin");
    expect(outcome.notice).toContain("A pin.");
  });

  test("where scripts are offered, it is a script that build uses, and the notice says so", () => {
    const outcome = addExampleToProject(project(), {}, simple(), everything);
    if ("refused" in outcome) throw new Error(outcome.refused);
    expect(outcome.program.map((s) => s.name)).toEqual(["build", "pin"]);
    expect(outcome.notice).toContain("A pin.");
    expect(outcome.notice).toContain("script pin");
  });

  test("an example that needs a file the project lacks is refused, with the reason, and nothing is returned to use", () => {
    const needs: Example = { ...simple(), program: [{ id: "s1", name: "build", blocks: [blk("b1", "import", { file: "gear.stl" })] }] };
    const outcome = addExampleToProject(project(), {}, needs, everything);
    expect(outcome).toEqual({ refused: "The Pin example was not added: it needs the STL file gear.stl, which this project does not have." });
    expect("program" in addExampleToProject(project(), { "gear.stl": "x" }, needs, everything)).toBe(true);
  });

  test("the project given is not changed, and a blank project works", () => {
    const before = project();
    const copy = structuredClone(before);
    addExampleToProject(before, {}, simple(), everything);
    expect(before).toEqual(copy);
    const outcome = addExampleToProject(createEmptyProgram(), {}, exampleById("hinge")!, everything);
    expect("program" in outcome).toBe(true);
  });
});
