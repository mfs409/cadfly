import { lockedAssistant, lockedModeName } from "../address";
import type { Program } from "../language/types";
import { modeCards } from "../ui/menus";
import { openCards } from "../ui/overlay";
import { DEFAULT_MODE_NAME, type ModeSpec, UI_MODES, findModeName, hiddenKindsUsed, modeByName } from "../ui/modes";
import { readStored, writeStored } from "../ui/storage";

/**
 * Which interface mode is in force (how much of each block is offered) and
 * whether the assistant is offered. Both are remembered in the browser, and a
 * page address can set either and lock it so that the person cannot change it
 * (a teacher can hand out `...cadfly.html?mode=Starter&ai=off` as a link).
 */

/** The interface mode last chosen */
const MODE_KEY = "cadfly.mode";
/** Whether the assistant is offered ("on" or "off"): a separate switch from the mode, which is only about blocks */
const AI_KEY = "cadfly.ai";

/** What the settings need from the page. */
export interface SettingsHost {
  /** The blocks as they are now */
  program(): Program;
  /** Say something to the person. */
  notify(message: string): void;
  /** Take the notice away without drawing the message box again (the editor is about to be drawn). */
  forgetNotice(): void;
  /** Draw the editor again: a setting changed. */
  redraw(): void;
  /** The assistant was switched on or off: show or hide its bar. */
  assistantChanged(): void;
}

/** What the settings offer. */
export interface Settings {
  /** The name of the mode that the address locked, if it did */
  lockedMode: string | undefined;
  /** Did the address lock the assistant switch, to on or off? Undefined if it did not. */
  lockedAssistant: boolean | undefined;
  /** The name of the mode in force: the locked one, else the last one chosen, else the default */
  modeName(): string;
  /** The mode in force */
  currentMode(): ModeSpec | undefined;
  /** Is the assistant offered? */
  assistantOn(): boolean;
  /**
   * Offer the modes as cards over the page, each tapped to choose it. Tapping
   * the mode in force only closes the cards. A mode that is chosen is
   * remembered, and a message says which blocks already in the program it does
   * not offer.
   */
  chooseMode(): void;
  /** Switch the assistant on or off, and remember the choice. */
  toggleAssistant(): void;
  /** Say which blocks of the program this mode does not offer (they still work, and can be edited). */
  noteHiddenBlocks(): void;
}

/**
 * Make the settings, reading what the address locked and what was chosen last.
 *
 * @param host What they need from the page.
 */
export function createSettings(host: SettingsHost): Settings {
  const lockedMode = lockedModeName(location.search);
  const lockedAi = lockedAssistant(location.search);
  /** The name of the mode in force: the locked one, else the last one chosen, else the default. */
  let modeName = lockedMode ?? findModeName(readStored(MODE_KEY)) ?? DEFAULT_MODE_NAME;
  /** Is the assistant offered? When the address does not lock it, the last choice is used, and the assistant is off to begin with. */
  let assistantOn = lockedAi ?? readStored(AI_KEY) === "on";
  const currentMode = () => modeByName(modeName);

  function noteHiddenBlocks() {
    const hidden = hiddenKindsUsed(host.program(), currentMode());
    if (hidden.length) host.notify(`This program uses blocks that ${modeName} mode does not offer (${hidden.join(", ")}). They still work; choose a mode with more blocks to add them.`);
  }

  return {
    lockedMode,
    lockedAssistant: lockedAi,
    modeName: () => modeName,
    currentMode,
    assistantOn: () => assistantOn,
    chooseMode() {
      const choose = (name: string) => {
        modeName = name;
        writeStored(MODE_KEY, name); // if the browser will not keep it, it lasts until the page closes
        host.forgetNotice();
        host.redraw();
        noteHiddenBlocks();
      };
      openCards(
        "Choose a mode",
        modeCards(UI_MODES, modeName).map((m) => ({
          title: m.name,
          description: m.description,
          tag: m.current ? "current" : undefined,
          marked: m.current,
          // tapping the mode in force just closes the overlay
          pick: () => {
            if (!m.current) choose(m.name);
          },
        })),
      );
    },
    toggleAssistant() {
      assistantOn = !assistantOn;
      writeStored(AI_KEY, assistantOn ? "on" : "off"); // if the browser will not keep it, it lasts until the page closes
      host.assistantChanged();
      host.redraw();
    },
    noteHiddenBlocks,
  };
}
