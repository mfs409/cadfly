# CADFly Agent Evaluation

The purpose of this folder is to provide a way to assess how well a model turns plain-language requests into blocks.

## Overview

CADFly's assistant sends a request to a language model, gets block text back, and applies it to the project.
Whether that works depends on the model.
This folder folder measures it.
It is a benchmark, not a test: it needs a real model, takes a long time, and its answers vary from run to run.
It is not part of `npm test`.

`cases.ts` holds 65 requests ("a 40 by 30 plate with four holes", "make the holes radius 4", "a table with four legs").
Most are in English, and a few are in German, Spanish, French, Hindi and Tamil.
Some start from an existing program, some follow earlier requests in the same conversation, and some come with STL files.
Each request has a `check` that looks at the shapes the result builds, such as their size or how many holes there are, and not at the model's wording.

`run.mts` sends every request through the same `ask()` the chat panel uses, against the model you name.
It builds the resulting program and applies the check.
It allows one repair attempt per request, as the chat panel does.
It records whether the answer was correct, whether it was valid (the reply applied and the program has no problem), how long it took, and how many tokens it used.

The point is to compare models, and to compare changes to the prompt, the schema and the worked examples.
It is how we know which models are worth offering in the app.

## Files

- `cases.ts`: The requests.
  Each `Case` has an `id`, a `lang`, the starting `program`, the request `text`, and `check(outcome)`.
  It may also have earlier requests (`before`) and STL `files`.
- `run.mts`: Runs a model on the cases and writes the raw rows to `out/`.
- `report.mts`: Turns runs in `out/` into a Markdown report named `reports/results-yyyy-mm-dd.md`.
- `out/`: Raw runs, one JSON file each.
  Git-ignored, and created on the first run.
- `reports/`: The reports, one Markdown file per day.
  Git-ignored, and created when a report is written.

## Running

```
npm run eval -- qwen3:4b                          # a local model, through Ollama
npm run eval -- gemini:gemini-3.1-flash-lite      # a Google model
npm run eval -- qwen3:4b --only plate-holes,ring  # just these case ids
npm run eval -- qwen3:4b --out v6-4b              # name the file in out/ (default: the model name)
```

A local model goes to Ollama at `http://localhost:11434`.
Set `OLLAMA_HOST` to change that.
The reply schema becomes a grammar, as WebLLM does in the browser, with the same 4096-token window, temperature 0.1 and thinking off.

Gemini needs a key.
Set `GEMINI_API_KEY`, or put the key in `./key.secret` or in `~/.config/cadfly/gemini-key`, either bare or as `NAME=key`.
A free key works, but it is limited to a few requests a minute, so the runner waits and retries.

Each case prints `ok` or `FAIL`, its time, its number of tries, and its token counts.
A summary at the end gives the number correct, the number valid, and the median time.

## What a run writes

`out/<name>.json` is `{ model, rows }`.
Each row has the case's `id` and `lang`, then `correct`, `valid`, `attempts` and `seconds`.
It also has the `prompt` and `generated` token counts, the `reply` text, and any `problem` or `error`.
`raws` holds everything the model wrote, for finding out why a case failed.

## The report

`npm run report` writes `eval/reports/results-<today>.md`, with a table of the runs and a grid of every request against every run.
By default it reports every run in `out/`.
Name some runs to report just those: `npm run report -- v6-4b gemini`.
It contains only what the runs record, such as how many were correct and valid, the median time and the token counts.
It does not interpret them.

## Adding a case

Append a line to `CASES` in `cases.ts`: `c(id, lang, text, check)`.
The helper `c` builds the `Case`.
For a case that needs a starting program, earlier requests or files, copy one that has them.
A good check tests the result, such as a shape's size or the number of holes.
Run it alone with `--only <id>`.

The folder is type-checked by `npm run check:tests`.
