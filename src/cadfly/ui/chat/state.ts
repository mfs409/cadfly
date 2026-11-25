import type { Turn } from "../../assistant/prompt";

/**
 * What the chat knows at any moment, as one record: whether its panel is open,
 * what the panel shows, whether a request is running, and the conversation so
 * far.
 */

/** What the open panel shows: how to get a model, or the conversation with it */
export type View = "setup" | "conversation";

/** Whether a request is being answered; while it is, the way to stop it is kept here */
export type Request = { kind: "idle" } | { kind: "working"; abort: AbortController };

/** The state of the chat */
export interface ChatState {
  /** Is the panel open above the bar? */
  open: boolean;
  /** What the panel shows when it is open */
  view: View;
  /** Is a request being answered right now? */
  request: Request;
  /**
   * The conversation so far, handed back to the assistant with each request so
   * a follow-up like "make it bigger" means something.
   */
  history: Turn[];
}

/** A chat that is closed, showing how to get a model, with nothing running and nothing said */
export const newChatState = (): ChatState => ({ open: false, view: "setup", request: { kind: "idle" }, history: [] });

/**
 * Is a request being answered right now?
 *
 * @param s The state.
 */
export const isWorking = (s: ChatState): boolean => s.request.kind === "working";
