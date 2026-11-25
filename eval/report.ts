/**
 * Turns runs in `out/` into a Markdown report: a table with one row per run,
 * and a grid of every request against every run.
 *
 *     npm run report                  # every run in out/
 *     npm run report -- v6-4b gemini  # just these runs, by file name
 *
 * The report is written to `reports/results-yyyy-mm-dd.md`. It contains only
 * what the runs record: it does not interpret them.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

/** One case's result, as `run.ts` records it. */
interface Row {
  id: string;
  lang: string;
  correct: boolean;
  valid: boolean;
  attempts?: number;
  seconds?: number;
  prompt?: number;
  generated?: number;
}

/** A run: the model that was tried, and its rows. */
interface Run {
  /** The run's file name in `out/`, without `.json`. */
  name: string;
  /** The model's name, as it was given to `run.ts`. */
  model: string;
  rows: Row[];
}

/** Where the runs are. */
const OUT = path.join(__dirname, "out");
/** Where the report goes. */
const REPORTS = path.join(__dirname, "reports");

/** The names of the runs to report: those on the command line, or every file in `out/`. */
const names =
  process.argv.length > 2
    ? process.argv.slice(2)
    : (existsSync(OUT) ? readdirSync(OUT) : []).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();

/** The runs, in the order of `names`. */
const runs: Run[] = names.map((name) => {
  try {
    const { model, rows } = JSON.parse(readFileSync(path.join(OUT, `${name}.json`), "utf8")) as { model: string; rows: Row[] };
    return { name, model, rows };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    console.error(`no run called eval/out/${name}.json: run \`npm run eval -- <model> --out ${name}\` first`);
    process.exit(1);
  }
});
if (!runs.length) {
  console.error("there are no runs in eval/out/: run `npm run eval -- <model>` first");
  process.exit(1);
}

/** The middle of the seconds the cases took (the larger one if there is an even number). */
const median = (rows: Row[]): number => {
  const seconds = rows.map((r) => r.seconds ?? 0).sort((a, b) => a - b);
  return seconds[Math.floor(seconds.length / 2)];
};

/** The sum of one number that each row may have. */
const total = (rows: Row[], key: "prompt" | "generated"): number => rows.reduce((sum, r) => sum + (r[key] ?? 0), 0);

/** How a run did on one request: `ok`, `FAIL`, or `-` if the run did not have that request. */
const mark = (run: Run, id: string): string => {
  const row = run.rows.find((r) => r.id === id);
  return row ? (row.correct ? "ok" : "FAIL") : "-";
};

/** Every request any run has, in the order they first appear, with its language. */
const requests = new Map<string, string>();
for (const run of runs) for (const r of run.rows) if (!requests.has(r.id)) requests.set(r.id, r.lang);

let out = `# Evaluation of the natural-language layer

${requests.size} request${requests.size === 1 ? "" : "s"} with machine-checked results, tried on ${runs.length} run${runs.length === 1 ? "" : "s"}.
A run that has fewer requests than that was made before the others were added.

| run | model | correct | valid | median | prompt tokens | generated tokens |
|---|---|---|---|---|---|---|
`;
for (const run of runs) {
  const n = run.rows.length;
  out += `| ${run.name} | ${run.model} | ${run.rows.filter((r) => r.correct).length}/${n} | ${run.rows.filter((r) => r.valid).length}/${n} | ${median(run.rows)} s | ${total(run.rows, "prompt")} | ${total(run.rows, "generated")} |\n`;
}

out += `
Per request:

| request | lang | ${runs.map((r) => r.name).join(" | ")} |
|---|---|${runs.map(() => "---").join("|")}|
`;
for (const [id, lang] of requests) out += `| ${id} | ${lang} | ${runs.map((run) => mark(run, id)).join(" | ")} |\n`;

/** Today's date, as yyyy-mm-dd. */
const today = new Date().toLocaleDateString("sv");
mkdirSync(REPORTS, { recursive: true });
writeFileSync(path.join(REPORTS, `results-${today}.md`), out);
console.log(`wrote eval/reports/results-${today}.md`);
