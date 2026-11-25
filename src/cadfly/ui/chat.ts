import { type AssistantState, type Checker, ask } from "./assistant/assistant";
import type { ChatBackend } from "./assistant/backend";
import { GEMINI_BUDGET, GEMINI_DEFAULT_MODEL, GeminiBackend, GeminiError } from "./assistant/gemini";
import type { Turn } from "./assistant/prompt";
import { replySchema } from "./assistant/schema";
import type { Files } from "./language/files";
import type { ModeSpec } from "./language/modes";
import type { Problem, Program } from "./language/types";
import { INK, LINE, MUTED, PANEL, el, readStored, writeStored } from "./view/dom";
import { promptSection, replySection, triesSection } from "./insight";
import { type LocalModel, MODELS, webGpuProblem } from "./llm";

/** What the chat needs to know about the app, and what it may do to it */
export interface ChatHost {
  model: LocalModel;
  program(): Program;
  problem(): Problem | undefined;
  /** Builds a program to see whether it works, once the 3D engine has loaded */
  checker(): Checker | undefined;
  /** The STL files the project has */
  files(): Files;
  /** How much of each block the person is offered: the assistant may add only those */
  uiMode(): ModeSpec | undefined;
  /** Replace the program, as one step that Undo takes back */
  apply(next: Program): void;
  /** Take back the last step */
  undo(): void;
}

export interface Chat {
  /** Placed by the app, at the bottom of the 3D area */
  element: HTMLElement;
  open(): void;
  /** How tall the panel is now (px): just its bar when closed */
  height(): number;
}

const MODEL_KEY = "cadfly.model";
const PROVIDER_KEY = "cadfly.assistant";
const GEMINI_KEY = "cadfly.geminiKey";
const GEMINI_MODEL_KEY = "cadfly.geminiModel";
const REVIEW_KEY = "cadfly.review";
type Provider = "gemini" | "local";
/** The Google models offered; only the first has been measured (the newest eval/results-*.md) */
const GEMINI_MODELS = [
  { id: GEMINI_DEFAULT_MODEL, label: "Gemini 3.1 Flash-Lite (cheapest; tested)" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
];
/** What a model that enforces the schema as it writes is given (Google's service uses its own copy of it) */
const SCHEMA = replySchema();

const buttonCss = (color: string) => `background:${color};color:#fff;border:0;border-radius:6px;padding:5px 12px;font:13px sans-serif;cursor:pointer`;

/**
 * The assistant: the bar along the bottom of the page, where the person types what they want and the blocks change. A panel opens
 * upward from it for the conversation, or, first, for how to get a model (a download of a gigabyte or more, or a key). The gear in the bar
 * is how to change the model or enter the key again. Each reply that changed something has an Undo.
 */
export function createChat(host: ChatHost): Chat {
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

  let opened = false;
  const setOpen = (open: boolean) => {
    opened = open;
    body.style.display = open ? "flex" : "none";
    chevron.textContent = open ? "▼" : "▲";
    if (open) show();
  };
  title.onclick = chevron.onclick = () => setOpen(!opened);

  let busy = false;
  let abort: AbortController | undefined;
  let history: Turn[] = [];

  // ---- getting a model: from Google, or one that runs on this computer ----
  const inputCss = `background:#0d1322;color:${INK};border:1px solid ${LINE};border-radius:6px;padding:5px;font:13px sans-serif`;
  const setup = el("div", "padding:10px 12px;display:flex;flex-direction:column;gap:8px;overflow:auto;width:min(680px,100%);box-sizing:border-box;align-self:center");
  const provider = el("select", inputCss) as HTMLSelectElement;
  provider.append(new Option("Google Gemini: fast, works on any computer, needs a free key", "gemini"), new Option("A model on this computer: private, needs a good graphics card (WebGPU)", "local"));
  provider.value = readStored(PROVIDER_KEY) === "local" ? "local" : "gemini";
  const problemText = el("div", "color:#f19a9a;line-height:1.4");

  // Google Gemini
  const geminiBox = el("div", "display:flex;flex-direction:column;gap:8px");
  const geminiModel = el("select", inputCss) as HTMLSelectElement;
  for (const m of GEMINI_MODELS) geminiModel.append(new Option(m.label, m.id));
  geminiModel.value = readStored(GEMINI_MODEL_KEY) || GEMINI_DEFAULT_MODEL;
  if (!geminiModel.value) geminiModel.value = GEMINI_DEFAULT_MODEL;
  geminiModel.onchange = () => writeStored(GEMINI_MODEL_KEY, geminiModel.value);
  const keyInput = el("input", inputCss) as HTMLInputElement;
  keyInput.type = "password";
  keyInput.placeholder = "Paste your Google API key";
  keyInput.autocomplete = "off";
  const link = el("a", "color:#7fb2ff", "Get a free key at aistudio.google.com/apikey") as HTMLAnchorElement;
  link.href = "https://aistudio.google.com/apikey";
  link.target = "_blank";
  link.rel = "noopener";
  const connect = el("button", buttonCss("#1f9d55"), "Connect");
  const forgetKey = el("button", buttonCss("#475569"), "Forget my key");
  const keyNote = el("div", `color:#8fd19e;line-height:1.4`);
  const geminiRow = el("div", "display:flex;gap:8px;align-items:center");
  geminiRow.append(connect, forgetKey);
  geminiBox.append(
    el("div", `color:${MUTED};line-height:1.4`, "What you type is sent to Google to be turned into blocks. Your key stays in this browser, is sent only to Google, and is not shared with anyone else. The free tier has limits, and Google may use free-tier requests to improve its products; a paid key avoids that."),
    link,
    keyNote,
    keyInput,
    geminiModel,
    geminiRow,
  );

  // A model on this computer
  const localBox = el("div", "display:flex;flex-direction:column;gap:8px");
  const choice = el("select", inputCss) as HTMLSelectElement;
  for (const m of MODELS) choice.append(new Option(`${m.label}: ${m.note}`, m.id));
  choice.value = readStored(MODEL_KEY) || MODELS[0].id;
  if (!choice.value) choice.value = MODELS[0].id;
  const choiceText = el("div", `color:${MUTED};line-height:1.4`);
  const start = el("button", buttonCss("#1f9d55"));
  const forget = el("button", buttonCss("#475569"), "Remove downloaded model");
  const progress = el("progress", "width:100%;display:none") as HTMLProgressElement;
  progress.max = 1;
  const progressText = el("div", `color:${MUTED};font-size:12px`);
  const cancel = el("button", buttonCss("#b45309"), "Cancel");
  cancel.style.display = "none";
  const row = el("div", "display:flex;gap:8px;align-items:center");
  row.append(start, forget, cancel);
  localBox.append(
    el("div", `color:${MUTED};line-height:1.4`, "The model runs on this computer, so nothing you type is sent anywhere. It is a large download, and some computers and browsers cannot run it."),
    choice,
    choiceText,
    row,
    progress,
    progressText,
  );
  setup.append(el("div", "line-height:1.4", "Describe a shape in your own words and the blocks are built for you."), provider, geminiBox, localBox, problemText);

  let mode: Provider = provider.value as Provider;
  /** The person asked for the settings, so show them even though a key is saved or a model is running */
  let settings = false;
  /** The Google connection, once there is a key */
  let gemini: GeminiBackend | undefined;
  const showProvider = () => {
    mode = provider.value as Provider;
    geminiBox.style.display = mode === "gemini" ? "flex" : "none";
    localBox.style.display = mode === "local" ? "flex" : "none";
    forgetKey.style.display = readStored(GEMINI_KEY) ? "" : "none";
    if (mode === "local") void refreshChoice();
  };
  provider.onchange = () => {
    writeStored(PROVIDER_KEY, provider.value);
    problemText.textContent = "";
    showProvider();
    void show();
  };

  const makeGemini = (key: string) => new GeminiBackend({ apiKey: key, model: geminiModel.value });
  connect.onclick = async () => {
    const key = keyInput.value.trim() || readStored(GEMINI_KEY);
    if (!key) {
      problemText.textContent = "Paste your Google API key first.";
      return;
    }
    problemText.textContent = "";
    connect.disabled = true;
    connect.textContent = "Checking...";
    const candidate = makeGemini(key);
    try {
      await candidate.check();
      writeStored(GEMINI_KEY, key);
      keyInput.value = "";
      gemini = candidate;
      settings = false;
    } catch (e) {
      problemText.textContent = describeFailure(e as Error);
    }
    connect.disabled = false;
    connect.textContent = "Connect";
    void show();
  };
  forgetKey.onclick = () => {
    writeStored(GEMINI_KEY, "");
    gemini = undefined;
    showProvider();
    void show();
  };

  const current = () => MODELS.find((m) => m.id === choice.value) ?? MODELS[0];
  let downloaded = false;
  async function refreshChoice() {
    const m = current();
    try {
      downloaded = await host.model.isDownloaded(m.id);
    } catch {
      downloaded = false;
    }
    choiceText.textContent = `Download: ${m.download} (once). Needs about ${m.memory} of graphics memory.${downloaded ? " Already downloaded." : ""}`;
    start.textContent = downloaded ? "Start" : "Download and start";
    forget.style.display = downloaded ? "" : "none";
  }
  choice.onchange = () => {
    writeStored(MODEL_KEY, choice.value);
    void refreshChoice();
  };

  const loading = (on: boolean) => {
    start.disabled = choice.disabled = forget.disabled = provider.disabled = on;
    cancel.style.display = on ? "" : "none";
    progress.style.display = on ? "" : "none";
    if (!on) progressText.textContent = "";
  };
  start.onclick = async () => {
    problemText.textContent = "";
    loading(true);
    progress.value = 0;
    try {
      await host.model.load(choice.value, (fraction, text) => {
        progress.value = fraction;
        progressText.textContent = text;
      });
      settings = false;
    } catch (e) {
      problemText.textContent = describeFailure(e as Error);
    }
    loading(false);
    show();
  };
  cancel.onclick = () => void host.model.stop();
  forget.onclick = async () => {
    if (!confirm(`Delete the downloaded ${current().label} from this browser? You can download it again later.`)) return;
    await host.model.remove(choice.value);
    await refreshChoice();
    show();
  };

  // ---- the conversation ----
  const log = el("div", "flex:1;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px;min-height:0");
  const input = el("textarea", `flex:1;resize:none;height:34px;box-sizing:border-box;background:#0d1322;color:${INK};border:1px solid ${LINE};border-radius:6px;padding:7px 8px;font:13px sans-serif`) as HTMLTextAreaElement;
  input.placeholder = "e.g. a 40 by 30 plate with four holes (Enter to send)";
  const send = el("button", buttonCss("#2f7fe0"), "Send");
  const menu = el("button", buttonCss("#475569"), "⚙ Model & key");
  menu.title = "Change the model, or enter the key again";
  bar.append(title, input, send, menu, chevron);
  // by default the answer is shown first and the person decides: the point is to see what the AI proposes
  const reviewBox = el("input") as HTMLInputElement;
  reviewBox.type = "checkbox";
  reviewBox.checked = readStored(REVIEW_KEY) !== "off";
  reviewBox.onchange = () => writeStored(REVIEW_KEY, reviewBox.checked ? "" : "off");
  const reviewRow = el("label", `display:flex;gap:6px;align-items:center;padding:0 12px 6px;color:${MUTED};font-size:12px;cursor:pointer`);
  reviewRow.append(reviewBox, document.createTextNode("Review the AI's answer before the blocks change"));
  const chat = el("div", "display:none;flex-direction:column;flex:1;min-height:0;width:min(960px,100%);align-self:center");
  chat.append(log, reviewRow);
  body.append(setup, chat);

  menu.onclick = async () => {
    if (busy) return;
    settings = true; // the saved key stays; Connect uses it
    gemini = undefined;
    if (host.model.state !== "idle") await host.model.stop();
    setOpen(true);
    void show();
  };

  const bubble = (who: "me" | "bot", text: string) => {
    const b = el("div", `align-self:${who === "me" ? "flex-end" : "flex-start"};max-width:88%;padding:6px 10px;border-radius:10px;line-height:1.4;white-space:pre-wrap;background:${who === "me" ? "#2f4f8a" : "#1e2a45"}`, text);
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  async function sendMessage() {
    const text = input.value.trim();
    const checker = host.checker();
    if (!text || busy) return;
    if (!checker) {
      bubble("bot", "The 3D engine is still loading. Try again in a moment.").style.color = MUTED;
      return;
    }
    input.value = "";
    setOpen(true); // the conversation opens above the bar
    bubble("me", text);
    const waiting = bubble("bot", "Thinking...");
    waiting.style.color = MUTED;
    busy = true;
    send.textContent = "Stop";
    abort = new AbortController();
    const before = host.program();
    const state: AssistantState = { program: before, problem: host.problem(), history, files: host.files(), mode: host.uiMode() };
    const backend: ChatBackend = mode === "gemini" && gemini ? gemini : host.model;
    try {
      const out = await ask(backend, checker, state, text, { signal: abort.signal, schema: SCHEMA, ...(backend === gemini ? { budget: GEMINI_BUDGET } : {}) });
      history = out.history;
      waiting.remove();
      const message = bubble("bot", out.reply);
      if (!out.ok) message.style.color = "#f19a9a";
      if (out.changes.length) {
        const list = el("ul", `margin:4px 0 0;padding-left:18px;color:${MUTED}`);
        for (const c of out.changes) list.append(el("li", "", c));
        message.append(list);
        const buttons = el("div", "margin-top:6px;display:flex;gap:6px;align-items:center");
        message.append(buttons);
        const applied = out.program;
        /** Make the change, and offer to take it back (only if nothing has changed since: otherwise Undo here would take back something else) */
        const applyNow = () => {
          host.apply(applied);
          const undo = el("button", buttonCss("#475569") + ";padding:2px 10px", "Undo");
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
        if (!reviewBox.checked) applyNow();
        else {
          // the blocks have not changed yet: this is only what the AI proposes
          const proposal = el("span", `color:#f1c27a;font-size:12px`, "Proposed. The blocks have not changed yet.");
          const apply = el("button", buttonCss("#1f9d55") + ";padding:2px 12px", "Apply");
          const reject = el("button", buttonCss("#475569") + ";padding:2px 12px", "Reject");
          apply.onclick = () => {
            if (host.program() !== before) {
              buttons.replaceChildren(el("span", `color:${MUTED};font-size:12px`, "The blocks changed since this was proposed, so it was not applied. Ask again."));
              return;
            }
            applyNow();
          };
          reject.onclick = () => buttons.replaceChildren(el("span", `color:${MUTED};font-size:12px`, "Rejected. Nothing changed."));
          buttons.replaceChildren(apply, reject, proposal);
        }
      }
      if (out.problem) message.append(el("div", "color:#f1c27a;margin-top:4px", `One block has a problem: ${out.problem.message}`));
      // a look inside, for learning how it works
      message.append(promptSection(out), replySection(out));
      const tries = triesSection(out);
      if (tries) message.append(tries);
    } catch (e) {
      waiting.remove();
      if ((e as Error).name === "AbortError") bubble("bot", "Stopped.").style.color = MUTED;
      else {
        bubble("bot", describeFailure(e as Error)).style.color = "#f19a9a";
        // a key Google will not accept is no use: forget it and go back to the settings
        if (e instanceof GeminiError && ([401, 403].includes(e.status) || /did not accept/.test(e.message))) {
          writeStored(GEMINI_KEY, "");
          gemini = undefined;
          problemText.textContent = describeFailure(e as Error);
          showProvider();
          void show();
        }
      }
    }
    busy = false;
    abort = undefined;
    send.textContent = "Send";
    input.focus();
  }

  send.onclick = () => (busy ? abort?.abort() : void sendMessage());
  input.onfocus = () => {
    if (chat.style.display === "none" && !opened) {
      setOpen(true); // typing here before a model is set up opens the setup
      void show();
    }
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (chat.style.display === "none") {
        setOpen(true); // not connected yet: show how
        void show();
      } else void sendMessage();
    }
  };

  /** Show the conversation if a model is connected, else how to get one */
  async function show() {
    if (!settings && mode === "gemini" && !gemini && readStored(GEMINI_KEY)) gemini = makeGemini(readStored(GEMINI_KEY));
    const ready = !settings && (mode === "gemini" ? !!gemini : host.model.state === "ready");
    chat.style.display = ready ? "flex" : "none";
    setup.style.display = ready ? "none" : "flex";
    const who = mode === "gemini" ? `${GEMINI_MODELS.find((m) => m.id === geminiModel.value)?.label.split(" (")[0] ?? "Gemini"}, via Google` : `${current().label}, running here`;
    input.placeholder = ready ? `Describe a shape or a change (Enter to send) - ${who}` : "Set up the assistant first: open the settings with the gear";
    keyNote.textContent = readStored(GEMINI_KEY) ? "A key is saved in this browser. Paste a new one to replace it, or press Connect to use the saved one." : "";
    if (ready) return;
    showProvider();
    if (mode !== "local") return;
    const why = await webGpuProblem();
    if (why) {
      localBox.replaceChildren(
        el("div", "line-height:1.5", `${why} A model on this computer needs WebGPU. Choose Google Gemini above, or keep building with the blocks.`),
        el("div", `line-height:1.5;color:${MUTED}`, "To check: open https://webgpureport.org in this browser; if it says no adapter, WebGPU is off here. In Chrome or Edge, open chrome://gpu and look for \"WebGPU\" (it should say Hardware accelerated). On Linux, try chrome://flags: turn on \"Unsafe WebGPU Support\" and \"Vulkan\", restart the browser, and check that your graphics driver supports Vulkan. Safari 26 and recent Firefox also work on supported machines."),
      );
    }
  }

  return { element: root, open: () => setOpen(true), height: () => bar.offsetHeight + (opened ? body.offsetHeight : 0) + 1 };
}

/** What to tell the person when the model could not start or answer */
function describeFailure(e: Error): string {
  const text = e.message || String(e);
  if (e instanceof GeminiError) return text.charAt(0).toUpperCase() + text.slice(1) + ".";
  if (/device.?lost/i.test(text)) return "The graphics card stopped responding while running the model, so this browser and driver cannot run it reliably. Reload the page to try again, or use a smaller model. (" + text + ")";
  if (/grammar matcher|invalid token id/i.test(text)) return "The model's output checker failed several times in a row (a known WebLLM bug). Send the request again, or try the 4B model. (" + text + ")";
  if (/compatible GPU|adapter/i.test(text)) return "No usable graphics adapter, so WebGPU cannot run the model here. Open https://webgpureport.org to check, and see the notes in the Assistant panel (on Linux Chrome, chrome://flags: Unsafe WebGPU Support and Vulkan).";
  if (/memory|OOM|device lost|allocate/i.test(text)) return `Not enough graphics memory for this model. Try the smaller one. (${text})`;
  if (/fetch|network|offline|Failed to load/i.test(text)) return `Could not download the model. Check the connection and try again. (${text})`;
  return `Something went wrong: ${text}`;
}
