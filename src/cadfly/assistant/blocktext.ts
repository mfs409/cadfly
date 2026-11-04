import { commandById } from "../language/commands";
import type { NewBlock } from "./ops";

/**
 * Blocks as plain indented text: the way the model is shown the program, and the way it writes new blocks.
 *
 *     extrude name=plate height=5
 *       rectangle w=40 h=30
 *       circle u=8 v=8 r=3 hole
 *     transform z=20
 *       box name=cube w=10 d=10 h=10
 *
 * One block per line: its kind, then `field=value` for each field it sets, then a bare flag name (`hole`) for a
 * flag that is on. A value with spaces or commas is in double quotes (`x="i * 12"`). A block inside another is
 * indented under it. Ids are never written for new blocks.
 */

/** Why some block text could not be read, with the line it was on, in words that can be sent back to the model */
export class BlockTextError extends Error {}

const WORD = /^[A-Za-z_][A-Za-z0-9_]*/;

/** The flag fields of a kind of block: the ones written as a bare word */
const flagsOf = (kind: string) => new Set([...(commandById(kind)?.params ?? []).filter((p) => p.type.kind === "flag").map((p) => p.id), ...(commandById(kind)?.make && !commandById(kind)?.observer ? ["hidden"] : []), ...(commandById(kind)?.modifier ? ["disabled"] : [])]);

/** Read one line: `box name=plate w=40`, and optionally an id in front, as the program view shows them (`b3 box ...`) */
function parseLine(text: string, line: number): NewBlock {
  const fail = (why: string): never => {
    throw new BlockTextError(`line ${line} (${text.trim().slice(0, 40)}): ${why}`);
  };
  let rest = text.trim();
  const first = WORD.exec(rest);
  if (!first) return fail("a block starts with its kind, like box or move");
  let kind = first[0];
  rest = rest.slice(kind.length).trimStart();
  // the program view puts an id in front (b3 circle ...); a block that is being added has none, but it is harmless to say one
  if (/^b\d+$/.test(kind)) {
    const next = WORD.exec(rest);
    if (next && commandById(next[0])) {
      kind = next[0];
      rest = rest.slice(kind.length).trimStart();
    }
  }
  const flags = flagsOf(kind);
  const args: Record<string, string | boolean> = {};
  let hidden = false; // the eye: a flag of every block that makes a shape
  let disabled = false; // the power switch: a flag of every block that changes what is inside it
  let last: string | undefined; // the field whose value is being read: a value may run on over spaces (x=i * 12)

  // a field that may be written without its name (face 1 2 3 4): whatever comes before the first name=value is its value
  const positional = commandById(kind)?.params.find((p) => p.positional);
  if (positional && rest.length && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)) {
    const value = /^[^=]*?(?=\s+[A-Za-z_][A-Za-z0-9_]*=|$)/.exec(rest)![0];
    args[positional.id] = value.trim().replace(/^"(.*)"$/, "$1");
    rest = rest.slice(value.length).trimStart();
  }

  while (rest.length) {
    const key = WORD.exec(rest)?.[0];
    if (key && rest[key.length] === "=") {
      rest = rest.slice(key.length + 1);
      let value: string;
      if (rest.startsWith('"')) {
        let end = 1;
        while (end < rest.length && (rest[end] !== '"' || rest[end - 1] === "\\")) end++;
        if (end >= rest.length) return fail(`a quote is not closed after ${key}=`);
        try {
          value = JSON.parse(rest.slice(0, end + 1)) as string;
        } catch {
          value = rest.slice(1, end);
        }
        rest = rest.slice(end + 1);
      } else {
        const m = /^\S*/.exec(rest)![0];
        value = m;
        rest = rest.slice(m.length);
      }
      args[key] = value;
      last = key;
    } else if (key && flags.has(key)) {
      if (key === "hidden") hidden = true;
      else if (key === "disabled") disabled = true;
      else args[key] = true;
      rest = rest.slice(key.length);
      last = undefined;
    } else {
      // not a field: more of the value before it (x=i * 12, x=width / 2, x=max(1, 2)), which runs on over spaces after an operator
      const m = /^\S+/.exec(rest)![0];
      const before = last === undefined ? undefined : String(args[last]);
      const goesOn = before !== undefined && (/^[-+*/%(),]/.test(m) || /[-+*/%(,]$/.test(before));
      if (!goesOn) {
        const fields = (commandById(kind)?.params ?? []).map((p) => p.id);
        const known = commandById(kind) ? `a ${kind} block has the fields ${fields.join(", ")}` : `there is no block called "${kind}"`;
        return fail(`I do not understand "${m}": ${known}. Write fields as name=value, and put a value with spaces in quotes`);
      }
      args[last!] = `${before} ${m}`;
      rest = rest.slice(m.length);
    }
    rest = rest.trimStart();
  }
  return { kind, ...(Object.keys(args).length ? { args } : {}), ...(hidden ? { hidden } : {}), ...(disabled ? { disabled } : {}) };
}

/** Read block text into blocks, with the ones inside others in `inner` */
export function parseBlocks(text: string): NewBlock[] {
  const top: NewBlock[] = [];
  const open: { indent: number; block: NewBlock }[] = [];
  text
    .replace(/\r/g, "")
    .replace(/\t/g, "  ")
    .split("\n")
    .forEach((raw, i) => {
      if (!raw.trim() || raw.trim().startsWith("#")) return;
      const indent = raw.length - raw.trimStart().length;
      const block = parseLine(raw, i + 1);
      while (open.length && open[open.length - 1].indent >= indent) open.pop();
      const parent = open[open.length - 1]?.block;
      if (parent) (parent.inner ??= []).push(block);
      else top.push(block);
      open.push({ indent, block });
    });
  return top;
}

const quote = (v: string) => (/[\s,"]/.test(v) || v === "" ? JSON.stringify(v) : v);

/** Write blocks as block text: the fields each block sets (in the order the block shows them), then what is inside, indented */
export function formatBlocks(blocks: NewBlock[], depth = 0): string {
  return blocks
    .map((b) => {
      const def = commandById(b.kind);
      const ordered = [...(def?.params.map((p) => p.id) ?? []), ...Object.keys(b.args ?? {})];
      // a tick that is off is left out, unless it is on at first (then "show=false" says it is off)
      const onAtFirst = (id: string) => def?.params.find((p) => p.id === id)?.default === true;
      const fields = [...new Set(ordered)]
        .filter((id) => b.args && id in b.args && (b.args[id] !== false || onAtFirst(id)))
        .map((id) => (b.args![id] === true && !onAtFirst(id) ? id : b.args![id] === true ? "" : `${id}=${quote(String(b.args![id]))}`))
        .filter(Boolean);
      const line = `${"  ".repeat(depth)}${[b.kind, ...fields, ...(b.hidden ? ["hidden"] : []), ...(b.disabled ? ["disabled"] : [])].join(" ")}`;
      return b.inner?.length ? `${line}\n${formatBlocks(b.inner, depth + 1)}` : line;
    })
    .join("\n");
}
