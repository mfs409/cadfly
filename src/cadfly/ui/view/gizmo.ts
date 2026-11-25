import * as THREE from "three";
import { el } from "../dom";
import { VIEW_DIRS, type ViewName, type Viewer } from "./viewer";

/**
 * The axis widget in the corner of the 3D view: six dots, one for each end of
 * each axis, that turn with the camera. It only reads the camera and asks the
 * `Viewer` it is given to change view.
 */

/** How each dot looks: the view it looks along, and its letter and color */
const AXES: { view: ViewName; label: string; color: string }[] = [
  { view: "right", label: "X", color: "#d94040" },
  { view: "left", label: "", color: "#d94040" },
  { view: "back", label: "Y", color: "#3fa03f" },
  { view: "front", label: "", color: "#3fa03f" },
  { view: "top", label: "Z", color: "#3d6fdc" },
  { view: "bottom", label: "", color: "#3d6fdc" },
];

/** The widget is this many pixels wide and tall */
const WIDGET_PX = 130;
/** How far the dots' centres are kept from the widget's edge, in pixels */
const EDGE_MARGIN_PX = 24;
/** A dot's diameter in pixels, for a mouse and for a finger */
const DOT_PX = { mouse: 28, touch: 40 };
/** A negative end's dot is this much the size of a positive end's */
const NEGATIVE_DOT_SCALE = 0.65;

/**
 * Add the axis widget to a viewer: a small set of dots that turns with the
 * camera. Tap a dot to look along that axis: X, Y and Z are the positive ends;
 * the plain dots are the negative ends.
 *
 * @param viewer The viewer to add it to and to change the view of.
 * @param options Where the widget sits in the viewer's element: distances from
 *                its top and right edges, as CSS lengths (default 8px each).
 * @returns A function that removes the widget.
 */
export function createGizmo(viewer: Viewer, options: { top?: string; right?: string } = {}): () => void {
  const root = el("div");
  // styled here, not in a stylesheet, so the widget works wherever it is copied
  // to
  root.style.cssText = `position:absolute;top:${options.top ?? "8px"};right:${options.right ?? "8px"};width:${WIDGET_PX}px;height:${WIDGET_PX}px;z-index:6`;
  const dot = matchMedia("(pointer: coarse)").matches ? DOT_PX.touch : DOT_PX.mouse;
  const dots = AXES.map((a) => {
    const b = el("button", "", a.label);
    b.style.cssText =
      "position:absolute;left:0;top:0;padding:0;min-height:0;border-radius:50%;color:#fff;font:bold 13px sans-serif;" +
      "border:1px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;cursor:pointer";
    b.style.background = a.color;
    b.title = `look from the ${a.view}`;
    // Tapping a dot looks along that axis.
    b.onclick = () => viewer.setView(a.view);
    root.appendChild(b);
    return b;
  });
  viewer.element.appendChild(root);

  // where the dots turn around, and how far out they go (fixed: the widget has
  // a fixed size)
  const center = WIDGET_PX / 2;
  const radius = center - EDGE_MARGIN_PX;
  const inverse = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const stop = viewer.addFrameHook(() => {
    inverse.copy(viewer.camera.quaternion).invert();
    AXES.forEach((a, i) => {
      v.set(...VIEW_DIRS[a.view]).applyQuaternion(inverse); // camera space: x right, y up, z toward the viewer
      const d = dots[i];
      const px = (a.label ? dot : dot * NEGATIVE_DOT_SCALE) * (0.85 + 0.15 * v.z);
      d.style.width = d.style.height = `${px}px`;
      d.style.left = `${center + v.x * radius - px / 2}px`;
      d.style.top = `${center - v.y * radius - px / 2}px`;
      d.style.zIndex = String(Math.round(v.z * 10) + 10);
      d.style.opacity = v.z < -0.2 ? "0.6" : "1";
    });
  });
  return () => {
    stop();
    root.remove();
  };
}
