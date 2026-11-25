import * as THREE from "three";
import { el } from "./dom";
import type { Viewer, ViewName } from "./viewer";

const AXES: { view: ViewName; dir: [number, number, number]; label: string; color: string }[] = [
  { view: "right", dir: [1, 0, 0], label: "X", color: "#d94040" },
  { view: "left", dir: [-1, 0, 0], label: "", color: "#d94040" },
  { view: "back", dir: [0, 1, 0], label: "Y", color: "#3fa03f" },
  { view: "front", dir: [0, -1, 0], label: "", color: "#3fa03f" },
  { view: "top", dir: [0, 0, 1], label: "Z", color: "#3d6fdc" },
  { view: "bottom", dir: [0, 0, -1], label: "", color: "#3d6fdc" },
];

/**
 * A small axis widget that turns with the camera. Tap a dot to look along
 * that axis: X, Y and Z are the positive ends; the plain dots are the
 * negative ends.
 */
export function createGizmo(viewer: Viewer, options: { top?: string; right?: string } = {}) {
  const root = el("div");
  // styled here, not in a stylesheet, so the widget works wherever it is copied to
  root.style.cssText = `position:absolute;top:${options.top ?? "8px"};right:${options.right ?? "8px"};width:130px;height:130px;z-index:6`;
  const dot = matchMedia("(pointer: coarse)").matches ? 40 : 28;
  const dots = AXES.map((a) => {
    const b = el("button", "", a.label);
    b.style.cssText =
      "position:absolute;left:0;top:0;padding:0;min-height:0;border-radius:50%;color:#fff;font:bold 13px sans-serif;" +
      "border:1px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;cursor:pointer";
    b.style.background = a.color;
    b.title = `look from the ${a.view}`;
    b.onclick = () => viewer.setView(a.view);
    root.appendChild(b);
    return b;
  });
  viewer.element.appendChild(root);

  const inverse = new THREE.Quaternion();
  const v = new THREE.Vector3();
  viewer.addFrameHook(() => {
    inverse.copy(viewer.camera.quaternion).invert();
    const radius = root.clientWidth / 2 - 24;
    const center = root.clientWidth / 2;
    const size = dot;
    AXES.forEach((a, i) => {
      v.set(...a.dir).applyQuaternion(inverse); // camera space: x right, y up, z toward the viewer
      const d = dots[i];
      const px = (a.label ? size : size * 0.65) * (0.85 + 0.15 * v.z);
      d.style.width = d.style.height = `${px}px`;
      d.style.left = `${center + v.x * radius - px / 2}px`;
      d.style.top = `${center - v.y * radius - px / 2}px`;
      d.style.zIndex = String(Math.round(v.z * 10) + 10);
      d.style.opacity = v.z < -0.2 ? "0.6" : "1";
    });
  });
}
