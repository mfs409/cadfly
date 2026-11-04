/** A message to or from the model */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  /** The JSON Schema the reply must match; a backend that can enforce it should */
  schema: object;
  /** The most the model may write */
  maxTokens: number;
  signal?: AbortSignal;
}

/**
 * Anything that can turn messages into a reply: a model running in the
 * browser, a hosted one, or a script for testing. It returns the reply text
 * (JSON, matching the schema).
 */
export interface ChatBackend {
  generate(request: GenerateRequest): Promise<string>;
}
