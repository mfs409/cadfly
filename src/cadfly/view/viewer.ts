import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshData } from "../geometry/kernel";
import { faceTriangles } from "../geometry/polyhedron";

/** A shape to draw */
export interface ShapeDisplay {
  mesh: MeshData;
  /** A flat shape or a sketch, drawn as a thin slab: its boundary is drawn as a bright line so it can be seen where it ends */
  outline?: boolean;
  /** Draw only the boundary, not the shape: one piece of a flat shape put together from several, so that a piece inside another can be seen */
  linesOnly?: boolean;
}

const PALETTE = [0x4a90d9, 0x5fb36b, 0xe0a040, 0xa874d0, 0xdf6a6a, 0x45b5b5];

export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";

const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [1, -1, 0.8],
};

/** Convert kernel mesh data to a three.js geometry */
function toGeometry(mesh: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  // smooth across gentle curves, but keep the sharp edges of flat faces (a pyramid is not round)
  return toCreasedNormals(g, Math.PI / 6);
}

/** A three.js scene with orbit/pan/zoom navigation, a grid, and axes. */
export class Viewer {
  readonly scene = new THREE.Scene();
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  camera: THREE.PerspectiveCamera;
  controls!: OrbitControls;
  private model = new THREE.Group();
  /** Points to look at in the world (the corners of a solid), each a dot with its number beside it */
  private markers = new THREE.Group();
  private markerTextures = new Map<string, THREE.Texture>();
  private hooks: (() => void)[] = [];

  constructor(private container: HTMLElement) {
    this.scene.background = new THREE.Color(0xf0f0f0);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1); // Z-up, as in CAD and 3D printing
    this.camera.position.set(60, -80, 50);

    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const grid = new THREE.GridHelper(200, 20, 0x888888, 0xcccccc);
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default; lay it on XY
    this.scene.add(grid, new THREE.AxesHelper(30), this.model, this.markers);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, -40, 100);
    this.scene.add(sun);

    window.addEventListener("resize", () => this.resize());
    // the container can change size without the window doing so (a split layout)
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      for (const h of this.hooks) h();
    });
  }

  /**
   * Show the corners and faces of a solid in the world. A corner is a dot with its number beside it; a face is a flat polygon, solid on
   * the side that faces you when its corners go counterclockwise, striped on the other side, with its outline and its name. They are
   * drawn over the model (so what is behind a face can still be seen), and a dot is the same size on screen however far away. A face
   * that is `broken` is red. Empty lists clear them.
   */
  setOverlays(points: { at: [number, number, number]; label: string }[], faces: { ring: [number, number, number][]; label: string; broken: boolean }[]) {
    for (const child of [...this.markers.children]) {
      this.markers.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
        for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
      });
    }
    for (const { at, label } of points) {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTexture("", "dot"), depthTest: false, sizeAttenuation: false }));
      dot.position.set(...at);
      dot.scale.set(0.024, 0.024, 1);
      dot.renderOrder = 10;
      // the number sits up and to the right of its dot
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTexture(label, "tag"), depthTest: false, sizeAttenuation: false }));
      tag.position.set(...at);
      tag.center.set(-0.15, -0.15);
      tag.scale.set(0.042, 0.042, 1);
      tag.renderOrder = 11;
      this.markers.add(dot, tag);
    }
    for (const face of faces) this.markers.add(this.faceObject(face));
  }

  private faceObject({ ring, label, broken }: { ring: [number, number, number][]; label: string; broken: boolean }): THREE.Object3D {
    const group = new THREE.Group();
    if (ring.length < 3) return group;
    const triangles = faceTriangles(ring);
    const positions: number[] = [];
    const uvs: number[] = [];
    // stripes run across the face: map a point to its distance along two directions in the face's plane
    const centre = new THREE.Vector3();
    for (const p of ring) centre.add(new THREE.Vector3(...p));
    centre.multiplyScalar(1 / ring.length);
    const edge = new THREE.Vector3(...ring[1]).sub(new THREE.Vector3(...ring[0]));
    const normal = new THREE.Vector3(...ring[1]).sub(new THREE.Vector3(...ring[0])).cross(new THREE.Vector3(...ring[2]).sub(new THREE.Vector3(...ring[0])));
    if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
    normal.normalize();
    const along = edge.lengthSq() > 1e-12 ? edge.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const across = normal.clone().cross(along);
    for (const [a, b, c] of triangles) {
      for (const i of [a, b, c]) {
        const v = new THREE.Vector3(...ring[i]);
        positions.push(...ring[i]);
        const d = v.clone().sub(centre);
        uvs.push(d.dot(along) / 6, d.dot(across) / 6);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    const colour = broken ? 0xe53935 : 0x1aa6a0;
    // the side that faces you when the corners go counterclockwise: solid; the other side: striped
    const front = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5, side: THREE.FrontSide, depthWrite: false }));
    const back = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.stripes(colour), transparent: true, opacity: 0.85, side: THREE.BackSide, depthWrite: false }));
    front.renderOrder = back.renderOrder = 8;
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: broken ? 0xb71c1c : 0x0b5f5b, depthTest: false }));
    outline.renderOrder = 9;
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTexture(label, "face"), depthTest: false, sizeAttenuation: false }));
    name.position.copy(centre);
    name.scale.set(0.05, 0.034, 1);
    name.renderOrder = 11;
    group.add(front, back, outline, name);
    return group;
  }

  private stripes(colour: number): THREE.Texture {
    const key = `stripes:${colour}`;
    let texture = this.markerTextures.get(key);
    if (texture) return texture;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, size, size);
    g.strokeStyle = `#${colour.toString(16).padStart(6, "0")}`;
    g.lineWidth = 14;
    for (let i = -size; i <= size * 2; i += 32) {
      g.beginPath();
      g.moveTo(i, size);
      g.lineTo(i + size, 0);
      g.stroke();
    }
    texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    this.markerTextures.set(key, texture);
    return texture;
  }

  private markerTexture(label: string, kind: "dot" | "tag" | "face"): THREE.Texture {
    const key = `${kind}:${label}`;
    let texture = this.markerTextures.get(key);
    if (texture) return texture;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = kind === "face" ? 96 : size;
    canvas.height = size;
    const g = canvas.getContext("2d")!;
    if (kind === "face") {
      g.fillStyle = "#0b5f5b";
      g.beginPath();
      g.roundRect(4, 8, 88, 48, 16);
      g.fill();
      g.fillStyle = "#ffffff";
      g.font = "bold 30px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, 48, 33);
    } else {
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
      g.fillStyle = kind === "dot" ? "#ff7a00" : "#ffffff";
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = kind === "dot" ? "#ffffff" : "#ff7a00";
      g.stroke();
      if (kind === "tag") {
        g.fillStyle = "#1f2842";
        g.font = `bold ${label.length > 2 ? 26 : 34}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, size / 2, size / 2 + 2);
      }
    }
    texture = new THREE.CanvasTexture(canvas);
    this.markerTextures.set(key, texture);
    return texture;
  }

  /** The element the view is drawn in; overlays are added to it */
  get element() {
    return this.container;
  }

  /** Run fn after every frame is drawn (to keep overlays in step with the camera) */
  addFrameHook(fn: () => void) {
    this.hooks.push(fn);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.updateProjection();
  }

  private updateProjection() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private clearModel() {
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.model.clear();
  }

  /** Show the shapes, each in its own colour */
  setShapes(shapes: ShapeDisplay[]) {
    this.clearModel();
    let colour = 0;
    shapes.forEach((sh) => {
      const i = sh.linesOnly ? colour : colour++;
      const material = new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
      const geom = toGeometry(sh.mesh);
      const mesh = new THREE.Mesh(geom, material);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom, 30),
        new THREE.LineBasicMaterial({ color: sh.linesOnly ? 0xffffff : sh.outline ? 0x050c18 : 0x103050 }),
      );
      // the edges of a piece are drawn in front of the shape they are in, in the order they were put together
      if (sh.linesOnly) {
        (edges.material as THREE.LineBasicMaterial).depthTest = false;
        edges.renderOrder = 10;
        this.model.add(edges);
        geom.dispose();
        material.dispose();
      } else this.model.add(mesh, edges);
    });
  }

  /** Look at the target from a standard direction, keeping the distance */
  setView(name: ViewName) {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    // looking straight along Z would make "up" degenerate
    this.camera.up.set(0, name === "top" ? 1 : name === "bottom" ? -1 : 0, name === "top" || name === "bottom" ? 0 : 1);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.updateProjection();
  }

  /** Center the orbit target on the model and back off far enough to see it */
  fitToView() {
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    // the view may be taller than wide: fit the narrower of the two angles
    const fov = Math.min(THREE.MathUtils.degToRad(this.camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect));
    const dist = (sphere.radius / Math.sin(fov / 2)) * 1.1;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.update();
    this.updateProjection();
  }
}
