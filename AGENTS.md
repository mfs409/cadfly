# Instructions for AI coding assistants

CADFly is a visual, block-based 3D modeling environment for teaching.
People build solid shapes by dragging blocks, or by describing a shape to an AI assistant, and export the result as STL.
It is written in TypeScript.
The geometry is manifold-3d (WebAssembly), the 3D view is three.js, and the block editor is drawn with JetLag, a 2D game engine that is a dependency in `node_modules/jetlag2d`.
Do not edit anything in `node_modules`.
For facts about JetLag's API, read its source in `node_modules/jetlag2d/src/`, and do not rely on memory.

## Layout

Everything the app is lives in `src/cadfly/`.

- `language/`: the block language. The program types, running a program, the table of block kinds (`commands/`), variable scopes, the `.cadfly` file format, and the editing operations.
- `geometry/`: shape-making that knows nothing about blocks. The wrapper around manifold-3d, sketches, sweeps and lofts, finishing (shell, round, fillet), polyhedra, text, STL reading and writing, and the zip writer.
- `assistant/`: the AI assistant. Block text, the operations a reply may ask for, the prompt, retries, the reply schema, and the Google backend.
- `ui/`: what is drawn on the page. The block editor and its layout, the 3D view, the chat panel, the overlays and pop-ups, the modes, and the pure rules the editor uses.
- `app/`: the page's pieces and how they fit together. The project (history, files, loading and saving), the toolbar, settings, the build runner, and the message box.
- `examples/`: the built-in example programs, written as block text.
- The top level of `src/cadfly/` holds the entry point, the worker that builds shapes off the page's thread, and small modules for addresses, downloads, and the browser's language-model support.

Outside `src/`:

- `tests/` has the tests, and `tests/README.md` says what they cover.
- `eval/` measures how well a model uses the assistant, and `eval/README.md` says how.
- `scripts/` has the script that makes the tests badge.

## Commands

- `npm start` serves the app and rebuilds as you edit.
- `npm run build` builds the app into `dist/cadfly`.
- `npm run check` type-checks the app, and `npm run check:tests` type-checks everything, including tests and eval.
- `npm test` runs the whole suite, which takes about half a minute on a machine with several cores. While working, run one file: `npx vitest run tests/edit.test.ts`.
- `npm run coverage` runs the suite with a coverage report and refreshes the tests badge.
- `npm run eval -- <model>` and `npm run report` are the evaluation. They need a model, and are not part of `npm test`.

## How programs work

- A program is a list of scripts. Each script has an id, an optional name and inputs, and a list of blocks.
- `build` is a required, named script. It runs by itself, and it is the only source of shapes.
- A script with no name is a global script, and it may hold only `set` blocks.
- A script with a name is like a function. A `use` block runs it with inputs, in a fresh scope that sees the globals.
- Scoping is lexical. A script sees its own variables and the globals, and never its caller's.
- A polygon's points, a solid's vertices and a sweep's path are lists of points.
  A `repeat`, `if` (with its `else`) or `set` inside such a list makes points from a formula, so what may go inside a `repeat` depends on where the `repeat` is: `accepts` takes the kind of point list as its third argument.
- Editing operations never change a program in place. They return a fresh copy, even when nothing changed.
- A mode says which kinds of block the palette offers, whether blocks have the eye and power switches, and whether scripts are available.
  A mode never changes what a program builds, and it never hides what is already there.
- The built-in examples are block text with stable ids, read into frozen programs.
  Tests use them as fixtures, so copy one (`structuredClone`) before changing it.

## Style

- Every function, constant and exported symbol gets a doc comment, in plain full sentences, wrapped at about 80 columns. Do not just restate the name.
- A file's header says what the file is for and how it behaves. It never names another file, folder or module, and never says who uses it.
- Do not write "see `x`" comments. They go stale. Say the thing where it is needed.
- Prefer names that say what happens (`moveIntoNewHolder`) over short or clever ones.
- The words are "script" (not define, part or function) and "example" (not demo).
- In Markdown, put one sentence on each line, and do not wrap a sentence.
- In tests, a cast that hides a type (`as never`, `as unknown as T`, `unknown[]`, `any`) needs a `// cast: why` comment on that line or the line before. `tests/hygiene.test.ts` enforces this.

## Testing

- Add or update tests for every behavior you change, and keep them honest. A test that works out its expected value the way the code does proves nothing.
- Use the real geometry kernel for anything geometric. Never mock it.
- Do not assert on elapsed time, and avoid pinning exact message wording or the number of examples.
- Before saying a change is done, run both type checks and the test files that touch it. Run the whole suite before finishing a larger change.
- After renames in tests, run the tests and do not rely on `tsc` alone, because a narrowed `"x" in y` check can silently become `never`.
- Parts of the page that need a browser are checked by hand.
  Opening the app with `?test=1` puts its parts on `window.__cadfly`.

## Working with the owner

- Explain what you changed and why, in the project's own terms, and keep changes small enough to read.
- Do not invent facts about the code, the engine or the libraries. Say when you are unsure, and check the source.
- Do not commit, push or delete files unless asked.
