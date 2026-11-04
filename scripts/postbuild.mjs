// After `jetlag2d build`: put the viewer page next to the app in dist/cadfly/, so one folder holds both
// (index.html is the app, cadfly-viewer.html the viewer) and they share engine.bundle.js, manifold.wasm and the assets.
// Run by `npm run build`. In the built folder the app is the folder itself (index.html), not cadfly.html.
import * as fs from "node:fs";

const from = new URL("../src/cadfly/cadfly-viewer.html", import.meta.url);
const folder = new URL("../dist/cadfly/", import.meta.url);
if (!fs.existsSync(folder)) throw new Error("dist/cadfly/ is not there: run `jetlag2d build` first");
const html = fs.readFileSync(from, "utf8");
if (!html.includes('data-app="cadfly.html"')) throw new Error("cadfly-viewer.html has no data-app=\"cadfly.html\" to change");
fs.writeFileSync(new URL("cadfly-viewer.html", folder), html.replace('data-app="cadfly.html"', 'data-app="./"'));
console.log("  ✓ Added cadfly-viewer.html to dist/cadfly/");
