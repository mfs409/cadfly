/**
 * What the assistant needs from a model: messages in, an answer out. Anything
 * that can do that, whether a model in the browser, a hosted one, or a script
 * that answers from a list, can stand in.
 */

/** A message to or from the model */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One call to a model. */
export interface GenerateRequest {
  messages: ChatMessage[];
  /** The JSON Schema the answer must match; a backend that can enforce it should */
  schema: object;
  /** The most the model may write */
  maxTokens: number;
  signal?: AbortSignal;
}

/** Anything that can turn messages into an answer: the answer's text (JSON, matching the schema). */
export interface ChatBackend {
  generate(request: GenerateRequest): Promise<string>;
}
