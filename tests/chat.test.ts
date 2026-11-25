import { describe, expect, test } from "vitest";
import { GeminiError } from "../src/cadfly/assistant/gemini";
import { describeFailure } from "../src/cadfly/ui/chat";
import { isWorking, newChatState } from "../src/cadfly/ui/chat/state";

/**
 * What the person is told when the model could not start or answer, and what the
 * chat knows at any moment.
 */

describe("telling the person what went wrong", () => {
  test("a Google failure starts with a capital and ends with one full stop", () => {
    expect(describeFailure(new GeminiError("could not reach Google (offline)", 0, undefined, "network"))).toBe("Could not reach Google (offline).");
    expect(describeFailure(new GeminiError("Google did not accept this API key.", 400, undefined, "badKey"))).toBe("Google did not accept this API key.");
  });

  test("a graphics card that was lost is said to be the driver's trouble, however the message spaces it", () => {
    for (const text of ["GPU device lost", "Device_lost: oops"]) expect(describeFailure(new Error(text))).toMatch(/^The graphics card stopped responding/);
  });

  test("the sampler bug, a missing adapter, too little memory and a failed download each have their own advice", () => {
    expect(describeFailure(new Error("Grammar matcher rejected the newly sampled token"))).toMatch(/known WebLLM bug/);
    expect(describeFailure(new Error("Unable to find a compatible GPU"))).toMatch(/No usable graphics adapter/);
    expect(describeFailure(new Error("out of memory"))).toMatch(/Not enough graphics memory/);
    expect(describeFailure(new Error("Failed to fetch"))).toMatch(/Could not download the model/);
  });

  test("anything else is passed on", () => {
    expect(describeFailure(new Error("it broke"))).toBe("Something went wrong: it broke");
  });
});

describe("what the chat knows", () => {
  test("a new chat is closed, showing how to get a model, with nothing running and nothing said", () => {
    expect(newChatState()).toEqual({ open: false, view: "setup", request: { kind: "idle" }, history: [] });
  });

  test("a request is working exactly when it has a way to stop it, and each chat has a state of its own", () => {
    const state = newChatState();
    expect(isWorking(state)).toBe(false);
    state.request = { kind: "working", abort: new AbortController() };
    expect(isWorking(state)).toBe(true);
    state.request.abort.abort();
    expect(state.request.abort.signal.aborted).toBe(true);
    expect(isWorking(newChatState())).toBe(false);
    expect(newChatState().history).not.toBe(newChatState().history);
  });
});
