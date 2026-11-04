import type { ChatBackend, GenerateRequest } from "../src/cadfly/assistant/backend";

/** A backend that answers from a list, for tests. Each answer is the text, or a function of the request. */
export class ScriptedBackend implements ChatBackend {
  readonly calls: GenerateRequest[] = [];
  private next = 0;

  constructor(private replies: (string | ((request: GenerateRequest) => string))[]) {}

  async generate(request: GenerateRequest): Promise<string> {
    this.calls.push(request);
    if (request.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const reply = this.replies[this.next++];
    if (reply === undefined) throw new Error("the scripted backend ran out of replies");
    return typeof reply === "function" ? reply(request) : reply;
  }
}
