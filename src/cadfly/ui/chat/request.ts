import { type AssistantState, type Checker, ask } from "../../assistant/assistant";
import { GEMINI_BUDGET, GeminiError } from "../../assistant/gemini";
import { answerSchema } from "../../assistant/schema";
import { ERROR_TEXT, GO_BUTTON, MUTED, QUIET_BUTTON, WARNING_TEXT, el } from "../dom";
import { answerSection, promptSection, triesSection } from "../insight";
import { isStale } from "../rules";
import { describeFailure } from "./failure";
import type { ChatHost } from "./host";
import { type Settings, buttonCss } from "./settings";
import { type ChatState, isWorking } from "./state";

/**
 * Asking: sending what is typed to the model and showing what comes back, with
 * Apply and Reject when answers are reviewed first, and an Undo when they are
 * not. It keeps the conversation, forgets answers that were not applied, and
 * never applies an answer over blocks that changed after it was asked for.
 */

/** What a model that enforces the schema as it writes is given (Google's service uses its own copy of it) */
const LOCAL_SCHEMA = answerSchema();

/** What the person is told when the blocks changed after an answer was made for them, so it cannot be applied */
const STALE_MESSAGE = "The blocks changed since this was proposed, so it was not applied. Ask again.";

/** The parts of the chat that a request reads and writes */
export interface RequestParts {
  host: ChatHost;
  state: ChatState;
  settings: Settings;
  /** Where what is typed goes */
  input: HTMLTextAreaElement;
  /** The Send button, which says Stop while a request runs */
  send: HTMLButtonElement;
  /** The checkbox that makes answers wait for Apply */
  reviewBox: HTMLInputElement;
  /** Add a message to the conversation; gives the bubble so it can be recolored or added to */
  bubble(who: "me" | "bot", text: string): HTMLElement;
  /** Open the conversation panel */
  openPanel(): void;
  /** Look again at what the panel shows */
  refreshView(): void;
}

/**
 * Send what is typed to the model and show the reply. The reply says what
 * changed, with Apply and Reject when answers are reviewed first (otherwise
 * it is applied and has an Undo), what is wrong with the result if anything,
 * and the details of how the answer was made. Does nothing while a request is
 * running or if nothing is typed. A key that Google will not accept is
 * forgotten. If the request fails or is stopped, what was typed is put back so
 * it can be sent again or changed. An answer that is not applied (rejected, or
 * refused because the blocks changed) is taken out of the conversation, so the
 * model is not later shown something that never happened.
 *
 * @param parts The parts of the chat this works on.
 */
export async function sendMessage(parts: RequestParts) {
  const { host, state, settings, input, send, reviewBox, bubble } = parts;
  const text = input.value.trim();
  const checker: Checker | undefined = host.checker();
  if (!text || isWorking(state)) return;
  if (!checker) {
    bubble("bot", "The 3D engine is still loading. Try again in a moment.").style.color = MUTED;
    return;
  }
  input.value = "";
  /** Put what was typed back, unless something else has been typed since. */
  const restoreText = () => {
    if (!input.value) input.value = text;
  };
  parts.openPanel(); // the conversation opens above the bar
  bubble("me", text);
  const waiting = bubble("bot", "Thinking...");
  waiting.style.color = MUTED;
  const abort = new AbortController();
  state.request = { kind: "working", abort };
  send.textContent = "Stop";
  const before = host.program();
  const assistantState: AssistantState = { program: before, problem: host.problem(), history: state.history, files: host.files(), mode: host.uiMode() };
  const { backend, google } = settings.backend();
  try {
    const out = await ask(backend, checker, assistantState, text, { signal: abort.signal, schema: LOCAL_SCHEMA, ...(google ? { budget: GEMINI_BUDGET } : {}) });
    state.history = out.history;
    /** The exchange this answer added to the conversation (a failed request adds none). */
    const turn = out.ok ? out.history[out.history.length - 1] : undefined;
    /** Take this answer out of the conversation: it was not applied. */
    const forgetTurn = () => {
      if (turn) state.history = state.history.filter((t) => t !== turn);
    };
    waiting.remove();
    const message = bubble("bot", out.reply);
    if (!out.ok) {
      message.style.color = ERROR_TEXT;
      restoreText();
    }
    if (out.changeLog.length) {
      const list = el("ul", `margin:4px 0 0;padding-left:18px;color:${MUTED}`);
      for (const c of out.changeLog) list.append(el("li", "", c));
      message.append(list);
      const buttons = el("div", "margin-top:6px;display:flex;gap:6px;align-items:center");
      message.append(buttons);
      const applied = out.program;
      /** Make the change, and offer to take it back (only if nothing has changed since: otherwise Undo here would take back something else) */
      const applyNow = () => {
        host.apply(applied);
        const undo = el("button", buttonCss(QUIET_BUTTON) + ";padding:2px 10px", "Undo");
        // Undo only if the blocks are still the ones this change made.
        undo.onclick = () => {
          if (host.program() !== applied) {
            undo.textContent = "Changed since";
            undo.disabled = true;
            return;
          }
          host.undo();
          undo.textContent = "Undone";
          undo.disabled = true;
        };
        buttons.replaceChildren(undo);
      };
      /** Apply the answer, but only if the blocks are still the ones it was made for. */
      const applyIfCurrent = () => {
        if (isStale(before, host.program())) {
          forgetTurn();
          buttons.replaceChildren(el("span", `color:${MUTED};font-size:12px`, STALE_MESSAGE));
        } else applyNow();
      };
      if (!reviewBox.checked) applyIfCurrent();
      else {
        // the blocks have not changed yet: this is only what the AI proposes
        const proposal = el("span", `color:${WARNING_TEXT};font-size:12px`, "Proposed. The blocks have not changed yet.");
        const apply = el("button", buttonCss(GO_BUTTON) + ";padding:2px 12px", "Apply");
        const reject = el("button", buttonCss(QUIET_BUTTON) + ";padding:2px 12px", "Reject");
        apply.onclick = applyIfCurrent;
        // Reject: leave the blocks as they are.
        reject.onclick = () => {
          forgetTurn();
          buttons.replaceChildren(el("span", `color:${MUTED};font-size:12px`, "Rejected. Nothing changed."));
        };
        buttons.replaceChildren(apply, reject, proposal);
      }
    }
    if (out.problem) message.append(el("div", `color:${WARNING_TEXT};margin-top:4px`, `One block has a problem: ${out.problem.message}`));
    // a look inside, for learning how it works
    message.append(promptSection(out), answerSection(out));
    const tries = triesSection(out);
    if (tries) message.append(tries);
  } catch (e) {
    waiting.remove();
    restoreText();
    if ((e as Error).name === "AbortError") bubble("bot", "Stopped.").style.color = MUTED;
    else {
      bubble("bot", describeFailure(e as Error)).style.color = ERROR_TEXT;
      // a key Google does not accept is no use: forget it and go back to the settings
      if (e instanceof GeminiError && e.kind === "badKey") {
        settings.rejectKey(describeFailure(e as Error));
        parts.refreshView();
      }
    }
  }
  state.request = { kind: "idle" };
  send.textContent = "Send";
  input.focus();
}

/**
 * Stop the request that is running, if one is.
 *
 * @param state The state of the chat.
 */
export function stopRequest(state: ChatState) {
  if (state.request.kind === "working") state.request.abort.abort();
}
