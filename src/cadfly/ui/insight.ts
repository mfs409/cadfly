import type { AskResult } from "../assistant/assistant";
import { INPUT_BG, LINE, MUTED, WARNING_TEXT, el } from "./dom";
import { withCommas } from "./numbers";

/**
 * The collapsed sections under an assistant reply that show how the answer was
 * made: what the model was given, what it wrote back, and how each try was
 * checked. They are for learning how the assistant works, so they only read the
 * result of a request and change nothing.
 */

/** A box of fixed-width text that scrolls when it is long. */
const pre = (text: string, color = "#cdd6ea") =>
  el("pre", `margin:4px 0 0;padding:6px 8px;background:${INPUT_BG};border:1px solid ${LINE};border-radius:6px;color:${color};font:11px/1.4 monospace;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto`, text);

/** A heading you can open: it starts closed */
function section(title: string, ...content: HTMLElement[]) {
  const d = el("details", "margin-top:6px");
  d.append(el("summary", `cursor:pointer;color:${MUTED};font-size:12px`, title), ...content);
  return d;
}

/** A small heading for what follows it. */
const smallHeading = (text: string) => el("div", `margin-top:6px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.04em`, text);
/**
 * How far the lines of block text that continue in a string are indented when
 * the answer is shown as JSON, so that they sit under the text they continue
 */
const CONTINUATION_INDENT = " ".repeat(10);

/**
 * What the model was given. A model has no memory of its own between requests: everything it knows about the
 * program, the rules and what to do comes in this one block of text, and it has to fit in a fixed window.
 */
export function promptSection(out: AskResult) {
  const { messages, tokens, window, trimmed } = out.prompt;
  const share = Math.min(1, tokens / window);
  const bar = el("div", `height:8px;background:${INPUT_BG};border:1px solid ${LINE};border-radius:4px;overflow:hidden;margin-top:4px`);
  bar.append(el("div", `height:100%;width:${Math.round(share * 100)}%;background:${share > 0.85 ? "#e0a040" : "#4a90d9"}`));
  const system = messages[0].content;
  const last = messages[messages.length - 1].content;
  const shown = out.prompt.examplesOffered - trimmed.examples;
  const turns = Math.max(0, (messages.length - 2) / 2 - shown);

  const parts: HTMLElement[] = [
    el("div", `margin-top:4px;color:${MUTED};font-size:12px;line-height:1.4`, `About ${withCommas(tokens)} of ${withCommas(window)} tokens (a token is a piece of a word). The reply needs room in the window too, so the rest is kept free.`),
    bar,
    smallHeading("1. The rules (the same every time)"),
    pre(system),
    smallHeading(`2. ${shown} worked example${shown === 1 ? "" : "s"}${trimmed.examples ? ` (${trimmed.examples} left out to make room)` : ""}: a request, and the answer wanted`),
    pre(messages.slice(1, 1 + shown * 2).map((m) => `${m.role === "user" ? "REQUEST" : "ANSWER"}\n${m.content}`).join("\n\n")),
  ];
  if (turns > 0) parts.push(smallHeading(`3. ${turns} earlier turn${turns === 1 ? "" : "s"} of this conversation`), pre(messages.slice(1 + shown * 2, -1).map((m) => `${m.role === "user" ? "YOU" : "AI"}: ${m.content}`).join("\n")));
  parts.push(smallHeading(`${turns > 0 ? 4 : 3}. Your program, as the model reads it, and your request`), pre(last));
  return section("What the AI saw", ...parts);
}

/**
 * Exactly what the model wrote back: text, which our code then reads. It is the
 * try that the blocks came from (the last one that could be used), and the
 * section says so when later tries were no use.
 *
 * @param out The result of the request.
 */
export function answerSection(out: AskResult) {
  const index = out.usedTry ?? out.tries.length - 1;
  const raw = out.tries[index]?.raw ?? "";
  let shown = raw;
  try {
    shown = JSON.stringify(JSON.parse(raw), null, 2).replace(/\\n/g, `\n${CONTINUATION_INDENT}`); // show the lines of block text as lines
  } catch {
    // not JSON: show it as it is
  }
  const parts = [el("div", `margin-top:4px;color:${MUTED};font-size:12px;line-height:1.4`, "This is all the model produces: text. Our program reads it, checks it, and only then changes the blocks.")];
  if (out.usedTry !== undefined && out.usedTry < out.tries.length - 1) {
    parts.push(el("div", `margin-top:4px;color:${WARNING_TEXT};font-size:12px;line-height:1.4`, `This is try ${out.usedTry + 1}. A later try could not be used, so this is the one the blocks came from.`));
  }
  return section("What the AI wrote", ...parts, pre(shown));
}

/** The tries, if there was more than one or one went wrong: how the answer was checked, and what the model was told */
export function triesSection(out: AskResult) {
  if (out.tries.length === 0 || (out.tries.length === 1 && !out.tries[0].problem)) return undefined;
  const parts: HTMLElement[] = [el("div", `margin-top:4px;color:${MUTED};font-size:12px;line-height:1.4`, "A model can write something that looks right and is not. So every answer is checked, and if it breaks a rule the model is told what was wrong and tries again.")];
  out.tries.forEach((t, i) => {
    parts.push(smallHeading(`Try ${i + 1}${t.problem ? ": it did not work" : ": it worked"}`), pre(t.raw));
    if (t.problem) parts.push(el("div", `margin-top:4px;color:${WARNING_TEXT};font-size:12px`, `What was wrong (${{ answer: "the answer could not be read", ops: "an edit could not be made", run: "the blocks it made failed to run" }[t.problem.kind]}): ${t.problem.message}`));
    if (t.feedback) parts.push(smallHeading("What the model was told, so it could try again"), pre(t.feedback, WARNING_TEXT));
  });
  return section(`Its tries (${out.tries.length})`, ...parts);
}
