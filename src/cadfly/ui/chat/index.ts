import { ACCENT, INK, INPUT_BG, LINE, MUTED, PANEL, QUIET_BUTTON, el } from "../dom";
import { readStored, writeStored } from "../storage";
import type { Chat, ChatHost } from "./host";
import { sendMessage, stopRequest } from "./request";
import { buttonCss, createSettings } from "./settings";
import { isWorking, newChatState } from "./state";

/**
 * The assistant's bar along the bottom of the page and the panel that opens
 * above it. It owns the conversation: what the person typed, what came back,
 * the Apply, Reject and Undo buttons on a reply, and the set-up that comes
 * first, which is a Google key or the download of a model that runs on this
 * computer. The panel is made of page elements and calls the assistant through
 * the host it is given. It keeps the person's choices (provider, model, whether
 * to review answers) in the browser, and the key for as long as the page is open
 * unless the person asks for it to be remembered on this computer.
 */

export type { Chat, ChatHost } from "./host";
export { describeFailure } from "./failure";

/** Where the choice of whether answers are reviewed first is kept in the browser */
const REVIEW_KEY = "cadfly.review";

/**
 * The assistant: the bar along the bottom of the page, where the person types what they want and the blocks change. A panel opens
 * upward from it for the conversation, or, first, for how to get a model (a download of a gigabyte or more, or a key). The gear in the bar
 * is how to change the model or enter the key again. Each reply that changed something has an Undo.
 *
 * @param host What the chat needs from its page.
 */
export function createChat(host: ChatHost): Chat {
  const state = newChatState();
  const root = el("div", `position:fixed;display:flex;flex-direction:column;background:${PANEL};color:${INK};font:13px sans-serif;border-top:1px solid ${LINE};box-sizing:border-box;z-index:5`);
  // the 3D view underneath listens for the mouse; the panel is not part of it
  for (const type of ["pointerdown", "wheel", "keydown"]) root.addEventListener(type, (e) => e.stopPropagation());

  // the bar is always there: the title, what to type, Send, the settings gear, and a chevron that opens the conversation above it
  const bar = el("div", "display:flex;align-items:center;gap:8px;padding:6px 10px;flex:none;user-select:none");
  const title = el("span", "font-weight:bold;cursor:pointer", "Assistant");
  const chevron = el("button", `background:none;border:0;color:${MUTED};font:14px sans-serif;cursor:pointer;padding:2px 6px`, "▲");
  chevron.title = "Show or hide the conversation";
  const body = el("div", "display:none;flex-direction:column;height:min(340px,55vh);flex:none");
  root.append(body, bar);

  // ---- the conversation ----
  /** The conversation, one bubble after another. */
  const log = el("div", "flex:1;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px;min-height:0");
  const input = el("textarea", `flex:1;resize:none;height:34px;box-sizing:border-box;background:${INPUT_BG};color:${INK};border:1px solid ${LINE};border-radius:6px;padding:7px 8px;font:13px sans-serif`);
  input.placeholder = "e.g. a 40 by 30 plate with four holes (Enter to send)";
  const send = el("button", buttonCss(ACCENT), "Send");
  const menu = el("button", buttonCss(QUIET_BUTTON), "⚙ Model & key");
  menu.title = "Change the model, or enter the key again";
  bar.append(title, input, send, menu, chevron);
  // By default an answer is shown first and the person decides: the point is to see what the
  // assistant proposes. This is the checkbox that turns that off.
  const reviewBox = el("input");
  reviewBox.type = "checkbox";
  reviewBox.checked = readStored(REVIEW_KEY) !== "off";
  // Remember whether answers are reviewed before they are applied (the setting is stored only when
  // it is turned off).
  reviewBox.onchange = () => writeStored(REVIEW_KEY, reviewBox.checked ? "" : "off");
  const reviewRow = el("label", `display:flex;gap:6px;align-items:center;padding:0 12px 6px;color:${MUTED};font-size:12px;cursor:pointer`);
  reviewRow.append(reviewBox, document.createTextNode("Review the AI's answer before the blocks change"));
  const chat = el("div", "display:none;flex-direction:column;flex:1;min-height:0;width:min(960px,100%);align-self:center");
  chat.append(log, reviewRow);

  /**
   * Add a message to the conversation and scroll to it.
   *
   * @param who Which side said it: the person, or the assistant.
   * @param text What it says.
   * @returns The bubble, so the caller can recolor it or add to it.
   */
  const bubble = (who: "me" | "bot", text: string) => {
    const b = el("div", `align-self:${who === "me" ? "flex-end" : "flex-start"};max-width:88%;padding:6px 10px;border-radius:10px;line-height:1.4;white-space:pre-wrap;background:${who === "me" ? "#2f4f8a" : "#1e2a45"}`, text);
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  // ---- getting a model: from Google, or one that runs on this computer ----
  const settings = createSettings(host.model, {
    changed: () => void show(),
    say: (message) => (bubble("bot", message).style.color = MUTED),
  });
  body.append(settings.element, chat);

  /**
   * Open or close the conversation panel, and show what belongs in it (the
   * conversation, or the set-up) when it opens.
   */
  const setOpen = (open: boolean) => {
    state.open = open;
    body.style.display = open ? "flex" : "none";
    chevron.textContent = open ? "▼" : "▲";
    if (open) void show();
  };
  // Clicking the title or the chevron opens or closes the conversation.
  title.onclick = chevron.onclick = () => setOpen(!state.open);

  /** Show the conversation if a model is connected, else how to get one */
  async function show() {
    const { ready, who } = settings.sync();
    state.view = ready ? "conversation" : "setup";
    chat.style.display = state.view === "conversation" ? "flex" : "none";
    settings.element.style.display = state.view === "conversation" ? "none" : "flex";
    input.placeholder = ready ? `Describe a shape or a change (Enter to send) - ${who}` : "Set up the assistant first: open the settings with the gear";
    if (ready) return;
    await settings.showSetup();
  }

  /** What a request works with */
  const parts = { host, state, settings, input, send, reviewBox, bubble, openPanel: () => setOpen(true), refreshView: () => void show() };

  // The gear: go back to the set-up. The saved key stays, and Connect uses it.
  menu.onclick = async () => {
    if (isWorking(state)) return;
    await settings.reopen();
    setOpen(true);
  };
  // Send, or Stop while a request is running.
  send.onclick = () => (isWorking(state) ? stopRequest(state) : void sendMessage(parts));
  // Typing here before a model is set up opens the set-up.
  input.onfocus = () => {
    if (state.view === "setup" && !state.open) setOpen(true); // typing here before a model is set up opens the setup
  };
  // Enter sends; Shift+Enter makes a new line. Before a model is connected, Enter shows how to
  // connect one.
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (state.view === "setup") setOpen(true); // not connected yet: show how
      else void sendMessage(parts);
    }
  };

  return { element: root, open: () => setOpen(true), height: () => bar.offsetHeight + (state.open ? body.offsetHeight : 0) + 1 };
}
