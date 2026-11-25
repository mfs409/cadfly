# CADFly

![tests](tests/badges/tests.svg)

A visual, block-based 3D modeling environment.
Build 3D geometry using intuitive drag-and-drop logic blocks, or by describing your ideas in plain text to an AI assistant.

## Key Features

- **Visual Block Programming:** Construct 3D models using visual blocks for primitives (cubes, spheres, cylinders, etc.), sketches, boolean operations (union, difference, intersection), transformations (scale, translate, rotate, etc.), and loops/variables
- **Scripts:** Write your own reusable scripts with inputs, and use them again and again. A project's `build` script makes the shapes, and other scripts, with their own variables, help it
- **Four Modes:** First steps, Starter, Builder, and Everything offer more and more blocks, so a beginner sees a few and an experienced person sees all of them. A link can lock a mode
- **Examples:** A gallery of built-in examples, from a step stool to joints that print in place. Each can replace your project, or be added to it (its scripts come along)
- **Real-Time 3D Rendering:** View instant, interactive 3D model renders
- **Parametric Control:** Edit block variables and parameters dynamically to modify geometry on the fly
- **Model Export:** Export your generated 3D models to STL, as one file or as a zip with one file for each part
- **Project Files:** Save and load projects as `.cadfly` files, or open one from a link
- **AI Chat-to-3D Integration:** Chat with an integrated AI assistant to build and refine models. It can be turned off, and a link can turn it off for a class

## Tech Stack

- **Visual Programming Engine:** [JetLag](https://github.com/mfs409/jetlag)
- **3D Rendering & Geometry:** [Three.js](https://threejs.org/) / [Manifold](https://github.com/elalish/manifold)
- **AI Assistant:** Google Gemini (free, bring-your-own key; Gemini 3.1 Flash-Lite is the tested model), or a Qwen3 model that runs in your browser through [WebLLM](https://github.com/mlc-ai/web-llm) (needs WebGPU and a large download)

## Using CADFly

Most use cases can run CADFly directly from [GitHub Pages](https://mfs409.github.io/cadfly/).

If your organization wants to modify CADFly (e.g., to implement more powerful LLM support), you probably already know how to install prerequisite software, fork this repository, install the dependencies, and make pull requests.

## Linking To A Project

A web page can open one of your projects in CADFly.
Save the project (Save makes a `.cadfly` file), put the file on the web, and add `?load=` and the file's address to the address of CADFly:

```
https://mfs409.github.io/cadfly/?load=https://example.com/bracket.cadfly
```

- The file's address must be `https`.
  A relative address, such as `?load=bracket.cadfly`, is taken from the page that CADFly is on.
- The site that has the file must let other websites read it (it must allow CORS).
  Files on GitHub (`raw.githubusercontent.com`) and GitHub Pages do, and some file sharing sites do not.
- If the address has `?` or `&` in it, write it with `encodeURIComponent` so that it stays in one piece.
- CADFly asks before it replaces blocks that were not saved.
  Once the project is open, the `load` part is taken out of the address, so reloading the page does not replace later edits.

## Development

You need Node.js 22 or newer.

```
npm install        # get the dependencies
npm start          # serve the app, and rebuild as you edit
npm run build      # build the app into dist/cadfly
npm run check      # type-check the app
npm test           # run the tests (two to three minutes)
```

`npm run check:tests` type-checks the tests and the evaluation as well, and `npm run coverage` runs the tests with a coverage report.
The [tests README](tests/README.md) says what the tests cover and the rules for writing them.
The [eval README](eval/README.md) explains how to measure how well a model works as the assistant.
`AGENTS.md` describes how the code is organized, and the style the project follows.

## Other Projects Of Interest

You might also be interested in the game engine that CADFly uses for its blocks programming environment.
It's called [JetLag](https://github.com/mfs409/jetlag), and it has its own [JetLag Book](https://mfs409.github.io/jetlag-tutorials/) to help you learn about 2d game development.

## Bug Reports

If you encounter any bugs, please report them via the [issues page](https://github.com/mfs409/cadfly/issues).

## Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check the [issues page](https://github.com/mfs409/cadfly/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Before you open the pull request, run `npm run check`, `npm run check:tests` and `npm test`.

## License

CADFly is distributed under the MIT License. See `LICENSE` for details.

## Support

If you enjoy using CADFly, consider [supporting me](https://ko-fi.com/mfs409).
