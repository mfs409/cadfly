# CADFly Tests

CADFly's tests are designed to stress the following four areas:

- **The language and its editing rules.**
  Programs are lists of scripts, and every change to one goes through functions that must return a fresh program.
  The tests cover running programs (variables, scopes, `use`, `repeat`, `if`), the expression language, editing operations (insert, take, wrap, move, undo and redo), and saving and loading project files.
- **Geometry, with the real kernel.**
  They build shapes and check volumes, bounding boxes and connectivity against formulas: boxes, sketches, extrusions, lofts, sweeps, finishing (shell, round, chamfer, fillet), polyhedra and hulls, text, STL import and export, and the zip writer.
  Every built-in example is built, and the ones that teach something have their numbers checked.
- **The assistant.**
  They cover how block text is read and written, how the model's operations are applied and refused, how the prompt is put together, retries and failure messages, and the reply schema.
  The model itself is replaced by a script of canned answers.
- **The pieces of the page that are plain logic.**
  They cover when the program is rebuilt, what the engine and worker send and when, the message box, the files kept in the browser, addresses and downloaded projects, and the editor's rules for layout, hit testing, gestures and drops.
  These run against stand-in workers, engines and clocks.

The tests don't really cover anything that needs a browser, a person or a real model.
That includes dragging and tapping in the editor, the 3D view, how the pages look, touch input, real WebGPU and model downloads, and how well a model uses the assistant.

Note that the tests are written by Claude, and only lightly reviewed.
They appear sufficient to ensure that future changes don't accidentally break current behaviors.
They are not a proof that the behaviors are the right ones.
At the last run, the suite exercised about 70 percent of the lines in `src/cadfly`, and nearly all of the rest is browser-only code.

Also note that the tests use the real manifold kernel (WebAssembly) for anything that builds a shape, and never mock geometry.
That is why the whole suite takes about half a minute on a machine with several cores, and longer on one with fewer.
Each test file starts with a comment saying what it checks.

## Running

```sh
npm test                              # everything
npx vitest run tests/edit.test.ts     # one file
npx vitest run -t "wrapping"          # tests whose name contains this
npm run coverage                      # everything, with a coverage report
npm run check:tests                   # type-check src/, tests/, eval/ and scripts/
```

`coverage/index.html` has the line-by-line report.
The coverage command also rewrites `tests/badges/tests.svg`, the picture the README shows.
Commit it after a run.

## Conventions

- Use the real kernel for anything geometric.
- The built-in examples are the shared fixtures.
  When a test needs a realistic program, it takes one from `EXAMPLES` by its id (`exampleById("bracket")`).
  The examples are frozen, so copy one (`structuredClone`) before changing it.
- Do not assert on elapsed time.
  Count the work instead.
- If a test needs a cast that hides a type (`as never`, `as unknown as T`, `unknown[]`, `any`), put a `// cast: why` comment on that line or the line before.
  `hygiene.test.ts` enforces this, so a stale test can't hide behind a cast.

## What is not covered

- Pointer handling in the editor: dragging and tapping.
  The pure parts it uses (gesture states, drop decisions, layout, hit testing) are tested.
- The pieces of the page that need a real browser: the 3D view, the toolbar, the settings and the message box.
  Only their pure rules are tested.
  The overlay of cards is tested in a simulated page (`happy-dom`), which covers what it closes on and what it does with keys and clicks, but not how it looks.
- How well a model uses the assistant.
  That is `eval/`, which needs a model and is not part of `npm test`.

For checking the page by hand, the address ending in `?test=1` puts its parts (the program, the engine, the editor, the files, undo and redo) on `window.__cadfly`.
