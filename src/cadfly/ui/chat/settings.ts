import type { ChatBackend } from "../../assistant/backend";
import { GEMINI_DEFAULT_MODEL, GeminiBackend } from "../../assistant/gemini";
import { type LocalModel, MODELS, webGpuProblem } from "../../llm";
import { ERROR_TEXT, GOOD_TEXT, GO_BUTTON, INK, INPUT_BG, LINE, MUTED, QUIET_BUTTON, el } from "../dom";
import { readSession, readStored, writeSession, writeStored } from "../storage";
import { describeFailure } from "./failure";

/**
 * Getting a model: the set-up panel, where the person chooses between Google
 * Gemini (a key to paste) and a model that runs on this computer (a download),
 * and the connection that results. It keeps the person's choices (provider,
 * model) in the browser, and the Google key for as long as the page is open
 * unless the person asks for it to be remembered on this computer.
 */

// Where the choices are kept in the browser: the provider, the local model, the Google key and
// model. The key is kept for the visit, or between visits if the person asks.
const MODEL_KEY = "cadfly.model";
const PROVIDER_KEY = "cadfly.assistant";
const GEMINI_KEY = "cadfly.geminiKey";
const GEMINI_MODEL_KEY = "cadfly.geminiModel";

/** Where the model comes from: Google, or this computer. */
export type Provider = "gemini" | "local";

/** The Google models offered; only the first has been measured */
const GEMINI_MODELS = [
  { id: GEMINI_DEFAULT_MODEL, label: "Gemini 3.1 Flash-Lite (cheapest; tested)" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
];

/** The look of a button, in a color. */
export const buttonCss = (color: string) => `background:${color};color:#fff;border:0;border-radius:6px;padding:5px 12px;font:13px sans-serif;cursor:pointer`;

/** The look of a text box or a drop-down in the set-up */
const inputCss = `background:${INPUT_BG};color:${INK};border:1px solid ${LINE};border-radius:6px;padding:5px;font:13px sans-serif`;

/** The Google key that is kept, if there is one: the one for this visit, or the one remembered on this computer */
const readKey = () => readSession(GEMINI_KEY) || readStored(GEMINI_KEY);

/**
 * Keep the Google key: until the page is closed, or, if the person asks, on
 * this computer between visits. The other place is cleared, so a key is only in
 * one.
 *
 * @param key The key.
 * @param remember Keep it on this computer?
 * @returns False if the browser would not keep it.
 */
function keepKey(key: string, remember: boolean): boolean {
  const kept = remember ? writeStored(GEMINI_KEY, key) : writeSession(GEMINI_KEY, key);
  (remember ? writeSession : writeStored)(GEMINI_KEY, "");
  return kept;
}

/** Forget the Google key, wherever it is kept */
function forgetKeyEverywhere() {
  writeSession(GEMINI_KEY, "");
  writeStored(GEMINI_KEY, "");
}

/** What the set-up needs from the chat around it */
export interface SettingsHooks {
  /** Something changed that may change what the chat shows: look again at whether a model is connected */
  changed(): void;
  /** Say something in the conversation, quietly */
  say(message: string): void;
}

/** What the set-up panel gives back */
export interface Settings {
  /** The panel */
  element: HTMLElement;
  /** The provider the panel is showing, which is the one used for requests */
  provider(): Provider;
  /**
   * The model requests are sent to, and whether it is Google's. Before a
   * connection to Google exists, requests go to the local model.
   */
  backend(): { backend: ChatBackend; google: boolean };
  /**
   * Bring the panel up to date and say whether a model is connected. A saved
   * key connects by itself, unless the person asked for the settings.
   *
   * @returns Whether a model is ready, and how to describe it ("Gemini 3.1 Flash-Lite, via Google").
   */
  sync(): { ready: boolean; who: string };
  /** Show how to get a model: the chosen provider's set-up, and for a local model whether this browser can run one */
  showSetup(): Promise<void>;
  /**
   * The person asked for the settings: disconnect, and do not connect again by
   * itself until they press Connect or Start (the saved key stays).
   */
  reopen(): Promise<void>;
  /**
   * Google did not accept the key: forget it and show why.
   *
   * @param why What to tell the person.
   */
  rejectKey(why: string): void;
}

/**
 * The set-up panel and the connection it makes.
 *
 * @param model The model that runs on this computer.
 * @param hooks What to tell the chat around it.
 */
export function createSettings(model: LocalModel, hooks: SettingsHooks): Settings {
  const setup = el("div", "padding:10px 12px;display:flex;flex-direction:column;gap:8px;overflow:auto;width:min(680px,100%);box-sizing:border-box;align-self:center");
  const providerSelect = el("select", inputCss);
  providerSelect.append(new Option("Google Gemini: fast, works on any computer, needs a free key", "gemini"), new Option("A model on this computer: private, needs a good graphics card (WebGPU)", "local"));
  providerSelect.value = readStored(PROVIDER_KEY) === "local" ? "local" : "gemini";
  const problemText = el("div", `color:${ERROR_TEXT};line-height:1.4`);

  // Google Gemini
  const geminiBox = el("div", "display:flex;flex-direction:column;gap:8px");
  const geminiModel = el("select", inputCss);
  for (const m of GEMINI_MODELS) geminiModel.append(new Option(m.label, m.id));
  geminiModel.value = readStored(GEMINI_MODEL_KEY) || GEMINI_DEFAULT_MODEL;
  if (!geminiModel.value) geminiModel.value = GEMINI_DEFAULT_MODEL;
  // Choosing a Google model remembers it.
  geminiModel.onchange = () => writeStored(GEMINI_MODEL_KEY, geminiModel.value);
  const keyInput = el("input", inputCss);
  keyInput.type = "password";
  keyInput.placeholder = "Paste your Google API key";
  keyInput.autocomplete = "off";
  // by default the key is forgotten when the page is closed: only a person who asks has it kept on this computer
  const rememberBox = el("input");
  rememberBox.type = "checkbox";
  rememberBox.checked = readStored(GEMINI_KEY) !== "";
  const rememberRow = el("label", `display:flex;gap:6px;align-items:center;color:${MUTED};font-size:12px;cursor:pointer`);
  rememberRow.append(rememberBox, document.createTextNode("Remember the key on this computer (not on a shared one)"));
  const link = el("a", "color:#7fb2ff", "Get a free key at aistudio.google.com/apikey");
  link.href = "https://aistudio.google.com/apikey";
  link.target = "_blank";
  link.rel = "noopener";
  const connect = el("button", buttonCss(GO_BUTTON), "Connect");
  const forgetKey = el("button", buttonCss(QUIET_BUTTON), "Forget my key");
  const keyNote = el("div", `color:${GOOD_TEXT};line-height:1.4`);
  const geminiRow = el("div", "display:flex;gap:8px;align-items:center");
  geminiRow.append(connect, forgetKey);
  geminiBox.append(
    el("div", `color:${MUTED};line-height:1.4`, "What you type is sent to Google to be turned into blocks. Your key stays in this browser, is sent only to Google, and is not shared with anyone else. The free tier has limits, and Google may use free-tier requests to improve its products; a paid key avoids that."),
    link,
    keyNote,
    keyInput,
    rememberRow,
    geminiModel,
    geminiRow,
  );

  // A model on this computer
  const localBox = el("div", "display:flex;flex-direction:column;gap:8px");
  const choice = el("select", inputCss);
  for (const m of MODELS) choice.append(new Option(`${m.label}: ${m.note}`, m.id));
  choice.value = readStored(MODEL_KEY) || MODELS[0].id;
  if (!choice.value) choice.value = MODELS[0].id;
  const choiceText = el("div", `color:${MUTED};line-height:1.4`);
  const start = el("button", buttonCss(GO_BUTTON));
  const forget = el("button", buttonCss(QUIET_BUTTON), "Remove downloaded model");
  const progress = el("progress", "width:100%;display:none");
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
  setup.append(el("div", "line-height:1.4", "Describe a shape in your own words and the blocks are built for you."), providerSelect, geminiBox, localBox, problemText);

  /** What the set-up knows: which provider is chosen, the Google connection once there is one, and whether a saved key may connect by itself */
  const state: { provider: Provider; gemini: GeminiBackend | undefined; autoConnect: boolean } = { provider: providerSelect.value as Provider, gemini: undefined, autoConnect: true };

  /**
   * Show the set-up for the chosen provider and hide the other. The local
   * model's download state is looked up when it is chosen.
   */
  const showProvider = () => {
    state.provider = providerSelect.value as Provider;
    geminiBox.style.display = state.provider === "gemini" ? "flex" : "none";
    localBox.style.display = state.provider === "local" ? "flex" : "none";
    forgetKey.style.display = readKey() ? "" : "none";
    if (state.provider === "local") void refreshChoice();
  };
  // Choosing a provider remembers the choice and shows its set-up.
  providerSelect.onchange = () => {
    writeStored(PROVIDER_KEY, providerSelect.value);
    problemText.textContent = "";
    showProvider();
    hooks.changed();
  };

  /** A connection to Google with this key and the chosen model. */
  const makeGemini = (key: string) => new GeminiBackend({ apiKey: key, model: geminiModel.value });
  // Connect: check the key with Google (the typed one, or the saved one), and keep it if it works.
  // Nothing is saved if it does not.
  connect.onclick = async () => {
    const key = keyInput.value.trim() || readKey();
    if (!key) {
      problemText.textContent = "Paste your Google API key first.";
      return;
    }
    problemText.textContent = "";
    connect.disabled = true;
    connect.textContent = "Checking...";
    const candidate = makeGemini(key);
    let keptKey = true;
    try {
      await candidate.check();
      keptKey = keepKey(key, rememberBox.checked);
      keyInput.value = "";
      state.gemini = candidate;
      state.autoConnect = true;
    } catch (e) {
      problemText.textContent = describeFailure(e as Error);
    }
    connect.disabled = false;
    connect.textContent = "Connect";
    hooks.changed();
    // say so when the browser would not keep the key: it works, but only until this page is closed
    if (!keptKey) hooks.say("This browser would not keep the key, so it works only until this page is closed.");
  };
  // Forget my key: remove the saved key and go back to asking for one.
  forgetKey.onclick = () => {
    forgetKeyEverywhere();
    state.gemini = undefined;
    showProvider();
    hooks.changed();
  };

  /** The local model chosen in the list. */
  const current = () => MODELS.find((m) => m.id === choice.value) ?? MODELS[0];
  /**
   * Find out whether the chosen local model is downloaded, and say what
   * starting it will cost: the download, the graphics memory, and whether it is
   * already here.
   */
  async function refreshChoice() {
    const m = current();
    let downloaded: boolean;
    try {
      downloaded = await model.isDownloaded(m.id);
    } catch {
      downloaded = false;
    }
    choiceText.textContent = `Download: ${m.download} (once). Needs about ${m.memory} of graphics memory.${downloaded ? " Already downloaded." : ""}`;
    start.textContent = downloaded ? "Start" : "Download and start";
    forget.style.display = downloaded ? "" : "none";
  }
  // Choosing a local model remembers it and updates what is said about it.
  choice.onchange = () => {
    writeStored(MODEL_KEY, choice.value);
    void refreshChoice();
  };

  /**
   * Show or hide the progress of a model that is starting, and lock the
   * controls that would get in its way.
   */
  const loading = (on: boolean) => {
    start.disabled = choice.disabled = forget.disabled = providerSelect.disabled = on;
    cancel.style.display = on ? "" : "none";
    progress.style.display = on ? "" : "none";
    if (!on) progressText.textContent = "";
  };
  // Start: download the chosen local model if it is not here yet, and start it, showing the
  // progress.
  start.onclick = async () => {
    problemText.textContent = "";
    loading(true);
    progress.value = 0;
    try {
      await model.load(choice.value, (fraction, text) => {
        progress.value = fraction;
        progressText.textContent = text;
      });
      state.autoConnect = true;
    } catch (e) {
      // giving up on the download is the doing of the person: it is not an error
      problemText.textContent = (e as Error).name === "AbortError" ? "" : describeFailure(e as Error);
    }
    loading(false);
    hooks.changed();
  };
  // Cancel the download or start that is in progress.
  cancel.onclick = () => void model.stop();
  // Remove the downloaded local model from this browser, after asking.
  forget.onclick = async () => {
    if (!confirm(`Delete the downloaded ${current().label} from this browser? You can download it again later.`)) return;
    await model.remove(choice.value);
    await refreshChoice();
    hooks.changed();
  };

  return {
    element: setup,
    provider: () => state.provider,
    backend: () => (state.provider === "gemini" && state.gemini ? { backend: state.gemini, google: true } : { backend: model, google: false }),
    sync() {
      if (state.autoConnect && state.provider === "gemini" && !state.gemini && readKey()) state.gemini = makeGemini(readKey());
      const ready = state.autoConnect && (state.provider === "gemini" ? !!state.gemini : model.state === "ready");
      const who = state.provider === "gemini" ? `${GEMINI_MODELS.find((m) => m.id === geminiModel.value)?.label.split(" (")[0] ?? "Gemini"}, via Google` : `${current().label}, running here`;
      keyNote.textContent = readStored(GEMINI_KEY) ? "A key is saved on this computer. Paste a new one to replace it, or press Connect to use the saved one." : readSession(GEMINI_KEY) ? "A key is kept until this page is closed. Paste a new one to replace it, or press Connect to use it." : "";
      return { ready, who };
    },
    async showSetup() {
      showProvider();
      if (state.provider !== "local") return;
      const why = await webGpuProblem();
      if (why) {
        localBox.replaceChildren(
          el("div", "line-height:1.5", `${why} A model on this computer needs WebGPU. Choose Google Gemini above, or keep building with the blocks.`),
          el("div", `line-height:1.5;color:${MUTED}`, "To check: open https://webgpureport.org in this browser; if it says no adapter, WebGPU is off here. In Chrome or Edge, open chrome://gpu and look for \"WebGPU\" (it should say Hardware accelerated). On Linux, try chrome://flags: turn on \"Unsafe WebGPU Support\" and \"Vulkan\", restart the browser, and check that your graphics driver supports Vulkan. Safari 26 and recent Firefox also work on supported machines."),
        );
      }
    },
    async reopen() {
      state.autoConnect = false; // the saved key stays; Connect uses it
      state.gemini = undefined;
      if (model.state !== "idle") await model.stop();
    },
    rejectKey(why) {
      forgetKeyEverywhere();
      state.gemini = undefined;
      problemText.textContent = why;
      showProvider();
    },
  };
}
