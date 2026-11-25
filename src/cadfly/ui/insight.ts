import type { AskResult } from "./assistant/assistant";
import { LINE, MUTED, el } from "./view/dom";

/**
 * Ways of looking inside the assistant, for learning how it works: what it was given, what it wrote, and what
 * went wrong on the way. Each is a collapsed section under the reply.
 */

const pre = (text: string, color = "#cdd6ea") =>
  el("pre", `margin:4px 0 0;padding:6px 8px;background:#0d1322;border:1px solid ${LINE};border-radius:6px;color:${color};font:11px/1.4 monospace;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto`, text);

/** A heading you can open: it starts closed */
function section(title: string, ...content: HTMLElement[]) {
  const d = el("details", "margin-top:6px");
  d.append(el("summary", `cursor:pointer;color:${MUTED};font-size:12px`, title), ...content);
  return d;
}

const label = (text: string) => el("div", `margin-top:6px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.04em`, text);
const grouped = (n: number) => n.toLocaleString("en-US");

/**
 * What the model was given. A model has no memory of its own between requests: everything it knows about the
 * program, the rules and what to do comes in this one block of text, and it has to fit in a fixed window.
 */
export function promptSection(out: AskResult) {
  const { messages, tokens, window, trimmed } = out.prompt;
  const share = Math.min(1, tokens / window);
  const bar = el("div", `height:8px;background:#0d1322;border:1px solid ${LINE};border-radius:4px;overflow:hidden;margin-top:4px`);
  bar.append(el("div", `height:100%;width:${Math.round(share * 100)}%;background:${share > 0.85 ? "#e0a040" : "#4a90d9"}`));
  const system = messages[0].content;
  const last = messages[messages.length - 1].content;
  const shown = out.prompt.examplesOffered - trimmed.examples;
  const turns = Math.max(0, (messages.length - 2) / 2 - shown);

  const parts: HTMLElement[] = [
    el("div", `margin-top:4px;color:${MUTED};font-size:12px;line-height:1.4`, `About ${grouped(tokens)} of ${grouped(window)} tokens (a token is a piece of a word). The reply needs room in the window too, so the rest is kept free.`),
    bar,
    label("1. The rules (the same every time)"),
    pre(system),
    label(`2. ${shown} worked example${shown === 1 ? "" : "s"}${trimmed.examples ? ` (${trimmed.examples} left out to make room)` : ""}: a request, and the answer wanted`),
    pre(messages.slice(1, 1 + shown * 2).map((m) => `${m.role === "user" ? "REQUEST" : "ANSWER"}\n${m.content}`).join("\n\n")),
  ];
  if (turns > 0) parts.push(label(`3. ${turns} earlier turn${turns === 1 ? "" : "s"} of this conversation`), pre(messages.slice(1 + shown * 2, -1).map((m) => `${m.role === "user" ? "YOU" : "AI"}: ${m.content}`).join("\n")));
  parts.push(label(`${turns > 0 ? 4 : 3}. Your program, as the model reads it, and your request`), pre(last));
  return section("What the AI saw", ...parts);
}

/** Exactly what the model wrote back: text, which our code then reads */
export function replySection(out: AskResult) {
  const raw = out.tries[out.tries.length - 1]?.raw ?? "";
  let shown = raw;
  try {
    shown = JSON.stringify(JSON.parse(raw), null, 2).replace(/\\n/g, "\n          "); // show the lines of block text as lines
  } catch {
    // not JSON: show it as it is
  }
  return section("What the AI wrote", el("div", `margin-top:4px;color:${MUTED};font-size:12px;line-height:1.4`, "This is all the model produces: text. Our program reads it, checks it, and only then changes the blocks."), pre(shown));
}

/** The tries, if there was more than one or one went wrong: how the answer was checked, and what the model was told */
export function triesSection(out: AskResult) {
  if (out.tries.length === 0 || (out.tries.length === 1 && !out.tries[0].problem)) return undefined;
  const parts: HTMLElement[] = [el("div", `margin-top:4px;color:${MUTED};font-size:12px;line-height:1.4`, "A model can write something that looks right and is not. So every answer is checked, and if it breaks a rule the model is told what was wrong and tries again.")];
  out.tries.forEach((t, i) => {
    parts.push(label(`Try ${i + 1}${t.problem ? ": it did not work" : ": it worked"}`), pre(t.raw));
    if (t.problem) parts.push(el("div", "margin-top:4px;color:#f1c27a;font-size:12px", `What was wrong (${{ reply: "the answer could not be read", edit: "an edit could not be made", run: "the blocks it made failed to run" }[t.problem.kind]}): ${t.problem.message}`));
    if (t.feedback) parts.push(label("What the model was told, so it could try again"), pre(t.feedback, "#f1c27a"));
  });
  return section(`Its tries (${out.tries.length})`, ...parts);
}
