import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshData, Vec3 } from "../../geometry/kernel";
import { faceTriangles } from "../../geometry/polyhedron";

/**
 * The 3D view: a three.js scene with the shapes a program built, a grid and
 * axes on the ground, orbit/pan/zoom navigation, and the marks that show the
 * corners and faces of a solid being specified.
 *
 * A `Viewer` owns the WebGL renderer, the scene, the camera, the orbit
 * controls, the group of shapes (the model), and the group of marks (the
 * overlays). It draws only what it is given. It knows nothing about programs,
 * blocks or panels.
 *
 * The scene is drawn only when something has changed (the camera moved, or the
 * shapes, marks, size or view were changed), so an idle view costs almost
 * nothing. Code that changes the scene or the camera from outside this class
 * must call `requestRender`.
 */

/** A shape to draw */
export interface ShapeDisplay {
  mesh: MeshData;
  /**
   * A flat shape or a sketch, drawn as a thin slab: its boundary is drawn as a
   * bright line so it can be seen where it ends
   */
  outline?: boolean;
  /**
   * Draw only the boundary, not the shape: one piece of a flat shape put
   * together from several, so that a piece inside another can be seen
   */
  linesOnly?: boolean;
}

/** A corner of a solid, to mark in the world with a dot and its number */
export interface OverlayPoint {
  /** Where the corner is */
  at: Vec3;
  /** Its number, drawn beside the dot */
  label: string;
}

/** A face of a solid, to mark in the world with a translucent polygon */
export interface OverlayFace {
  /** The face's corners, in order */
  ring: Vec3[];
  /** Its name, drawn at its centre */
  label: string;
  /** True if the face has the problem that stopped the program: it is red */
  broken: boolean;
}

/** The standard directions to look from */
export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";

/**
 * Where the camera goes for each view, as a direction from the target to the
 * camera. The axes gizmo uses the same directions for its dots.
 */
export const VIEW_DIRS: Readonly<Record<ViewName, Vec3>> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [1, -1, 0.8],
};

// ---- the scene ----

/** The background of the view, behind the grid */
const BACKGROUND_COLOR = 0xf0f0f0;
/** The colors of the grid's centre lines and of its other lines */
const GRID_CENTER_COLOR = 0x888888;
const GRID_LINE_COLOR = 0xcccccc;
/** The grid is this many mm across, in this many squares */
const GRID_SIZE = 200;
const GRID_DIVISIONS = 20;
/** The axes drawn at the origin are this long, in mm */
const AXES_LENGTH = 30;

/** The camera's field of view (degrees), and the nearest and farthest it draws */
const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 5000;
/** Where the camera starts, looking at the origin (z is up, as in CAD) */
const CAMERA_START: Vec3 = [60, -80, 50];

/**
 * Looking straight down (or up) the z axis, "up" on the screen would be
 * undefined. So the top and bottom views put the camera this far toward the
 * front of the pole instead (in the unit direction), which also keeps the
 * orbit controls turning around z.
 */
const POLE_NUDGE = 0.001;

/**
 * The most the pixel ratio is allowed to be. A tablet may report 3, which
 * would draw more than twice as many pixels for a small gain in sharpness.
 */
const MAX_PIXEL_RATIO = 2;

/** How much room "fit to view" leaves around the model (1.1 = 10% more) */
const FIT_MARGIN = 1.1;

// ---- the shapes ----

/** The colors given to shapes, in turn */
const PALETTE = [0x4a90d9, 0x5fb36b, 0xe0a040, 0xa874d0, 0xdf6a6a, 0x45b5b5];
/**
 * Normals are smoothed across an edge whose faces meet at less than this angle
 * (radians), so curves look round and a pyramid's edges stay sharp
 */
const CREASE_ANGLE = Math.PI / 6;
/**
 * An edge is drawn as a line where its faces meet at more than this angle
 * (degrees)
 */
const EDGE_ANGLE = 30;
/** The colors of the lines drawn at the edges of a shape, a sketch and a piece */
const EDGE_COLOR = 0x103050;
const SKETCH_EDGE_COLOR = 0x050c18;
const PIECE_EDGE_COLOR = 0xffffff;

// ---- the marks ----

/** The colors of a face mark, and of one that has the problem */
const FACE_COLOR = 0x1aa6a0;
const FACE_OUTLINE_COLOR = 0x0b5f5b;
const BROKEN_FACE_COLOR = 0xe53935;
const BROKEN_FACE_OUTLINE_COLOR = 0xb71c1c;
/** How see-through the two sides of a face mark are */
const FACE_FRONT_OPACITY = 0.5;
const FACE_BACK_OPACITY = 0.85;
/**
 * The stripes on the back of a face repeat this often along the face, in mm
 */
const STRIPE_REPEAT = 6;
/** Below this, the sum of squares of a vector's parts counts as zero */
const TINY = 1e-12;

/** The colors of a corner's dot, its ring, and its number */
const DOT_COLOR = 0xff7a00;
const DOT_RING_COLOR = 0xffffff;
const TAG_INK_COLOR = 0x1f2842;
const WHITE = 0xffffff;

/**
 * The size of each kind of mark on the screen. A mark does not shrink with
 * distance, so its size is a fixed part of the view's height: the number here
 * times 1.07 at this field of view (a dot is about 2.5% of the height).
 */
const DOT_SCALE = 0.024;
const TAG_SCALE = 0.042;
const FACE_LABEL_WIDTH_SCALE = 0.05;
const FACE_LABEL_HEIGHT_SCALE = 0.034;
/** A number's anchor, so that the number sits up and to the right of its dot */
const TAG_ANCHOR = -0.15;

/**
 * The order the marks are drawn in, over the model and over one another: the
 * face and its outline, then the dots, then the labels
 */
const ORDER_FACE = 8;
const ORDER_FACE_OUTLINE = 9;
const ORDER_DOT = 10;
const ORDER_LABEL = 11;
/** The edges of a piece of a flat shape are drawn over the shape they are in */
const ORDER_PIECE_EDGES = 10;

/** The size in pixels of the picture a dot or a number is drawn from */
const MARKER_PX = 64;
/** The size in pixels of the picture a face's name is drawn from */
const FACE_LABEL_PX = { width: 96, height: 64 };
/** The size in pixels of the stripes picture, and how its stripes are drawn */
const STRIPES_PX = 64;
const STRIPE_SPACING_PX = 32;
const STRIPE_WIDTH_PX = 14;

/** A color as CSS text, for drawing on a canvas */
const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/**
 * Release what a three.js object (and what is inside it) holds on the graphics
 * card: its geometry and material. Textures are not released: they are kept
 * and shared.
 */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const holder = o as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    holder.geometry?.dispose();
    const { material } = holder;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
  });
}

/** A three.js geometry for kernel mesh data, with only the triangles */
function plainGeometry(mesh: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return g;
}

/** A three.js geometry for kernel mesh data, with smooth normals */
function shadedGeometry(mesh: MeshData): THREE.BufferGeometry {
  // smooth across gentle curves, but keep the sharp edges of flat faces (a
  // pyramid is not round)
  return toCreasedNormals(plainGeometry(mesh), CREASE_ANGLE);
}

/**
 * A texture drawn on a canvas.
 *
 * @param width The canvas's width in pixels.
 * @param height The canvas's height in pixels.
 * @param draw Draws on the canvas.
 */
function drawnTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  return new THREE.CanvasTexture(canvas);
}

/** Draw a filled disc with a ring around it, filling a square canvas */
function disc(g: CanvasRenderingContext2D, fill: number, ring: number): void {
  g.beginPath();
  g.arc(MARKER_PX / 2, MARKER_PX / 2, MARKER_PX / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = css(fill);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = css(ring);
  g.stroke();
}

/** The picture a corner's dot is drawn from: an orange disc with a white ring */
function dotTexture(): THREE.Texture {
  return drawnTexture(MARKER_PX, MARKER_PX, (g) => disc(g, DOT_COLOR, DOT_RING_COLOR));
}

/** The picture a corner's number is drawn from: a white disc with the number */
function tagTexture(label: string): THREE.Texture {
  return drawnTexture(MARKER_PX, MARKER_PX, (g) => {
    disc(g, WHITE, DOT_COLOR);
    g.fillStyle = css(TAG_INK_COLOR);
    g.font = `bold ${label.length > 2 ? 26 : 34}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, MARKER_PX / 2, MARKER_PX / 2 + 2);
  });
}

/** The picture a face's name is drawn from: white text on a rounded teal tag */
function faceLabelTexture(label: string): THREE.Texture {
  const { width, height } = FACE_LABEL_PX;
  return drawnTexture(width, height, (g) => {
    g.fillStyle = css(FACE_OUTLINE_COLOR);
    g.beginPath();
    g.roundRect(4, 8, width - 8, height - 16, 16);
    g.fill();
    g.fillStyle = css(WHITE);
    g.font = "bold 30px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, width / 2, height / 2 + 1);
  });
}

/**
 * Where a face is and how it faces, for drawing it: the middle of its corners,
 * the direction it faces (toward you when its corners go counterclockwise), and
 * two directions along the face that are at right angles to one another.
 *
 * The facing is worked out from all of the corners (Newell's method), so a face
 * whose first corners happen to line up still has one. A face with no area
 * faces up.
 *
 * @param ring The face's corners, in order, at least three.
 */
function faceFrame(ring: Vec3[]): { centre: THREE.Vector3; normal: THREE.Vector3; along: THREE.Vector3; across: THREE.Vector3 } {
  const centre = new THREE.Vector3();
  for (const p of ring) centre.add(new THREE.Vector3(...p));
  centre.multiplyScalar(1 / ring.length);

  const normal = new THREE.Vector3();
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    normal.x += (p[1] - q[1]) * (p[2] + q[2]);
    normal.y += (p[2] - q[2]) * (p[0] + q[0]);
    normal.z += (p[0] - q[0]) * (p[1] + q[1]);
  });
  if (normal.lengthSq() < TINY) normal.set(0, 0, 1);
  normal.normalize();

  // the first edge that has some length, kept flat in the face
  let along = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < ring.length; i++) {
    const edge = new THREE.Vector3(...ring[(i + 1) % ring.length]).sub(new THREE.Vector3(...ring[i]));
    edge.addScaledVector(normal, -edge.dot(normal));
    if (edge.lengthSq() > TINY) {
      along = edge.normalize();
      break;
    }
  }
  return { centre, normal, along, across: normal.clone().cross(along) };
}

/**
 * A three.js scene with orbit/pan/zoom navigation, a grid, and axes.
 */
export class Viewer {
  /** What is drawn: the model, the marks, the grid, the axes and the lights */
  readonly scene = new THREE.Scene();
  /** Draws the scene into a canvas that is a child of the container */
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  /**
   * Looks at the scene. Its up is always +z. Anything that moves it from
   * outside must call `requestRender`.
   */
  readonly camera: THREE.PerspectiveCamera;
  /** Turns a mouse or touch into camera moves */
  readonly controls: OrbitControls;
  /** The shapes of the program, as built by `setShapes` */
  private readonly model = new THREE.Group();
  /**
   * Points to look at in the world (the corners and faces of a solid), each a
   * dot with its number beside it
   */
  private readonly markers = new THREE.Group();
  /** The pictures marks are drawn from, kept so each is made once */
  private readonly textures = new Map<string, THREE.Texture>();
  /** Things that must be released with the viewer, besides the above */
  private readonly helpers: { dispose(): void }[] = [];
  /** Run after every frame that is drawn */
  private readonly hooks = new Set<() => void>();
  /** Watches the container's size, which can change without the window's */
  private readonly sizeWatch: ResizeObserver;
  /** True if the scene has changed since it was drawn */
  private dirty = true;

  /**
   * @param container The element to draw in. The viewer adds its canvas to it
   *                  and follows its size.
   */
  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(BACKGROUND_COLOR);
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
    this.camera.up.set(0, 0, 1); // Z-up, as in CAD and 3D printing
    this.camera.position.set(...CAMERA_START);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, GRID_CENTER_COLOR, GRID_LINE_COLOR);
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default; lay it on XY
    const axes = new THREE.AxesHelper(AXES_LENGTH);
    this.helpers.push(grid, axes);
    this.scene.add(grid, axes, this.model, this.markers);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, -40, 100);
    this.scene.add(sun);

    window.addEventListener("resize", this.onResize);
    this.sizeWatch = new ResizeObserver(this.onResize);
    this.sizeWatch.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.frame);
  }

  /**
   * Draw the scene again at the next frame. The viewer does this by itself
   * after its own changes and after the camera moves. Call it after changing
   * the scene or the camera from outside (`scene`, `camera`, `controls`).
   */
  requestRender(): void {
    this.dirty = true;
  }

  /**
   * Stop drawing and release everything the viewer holds, including its canvas.
   * The viewer cannot be used after this. What other code added to `element`
   * (such as the axes gizmo) is that code's to remove.
   */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.onResize);
    this.sizeWatch.disconnect();
    this.hooks.clear();
    this.controls.dispose();
    this.clearModel();
    this.clearMarkers();
    for (const h of this.helpers) h.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /**
   * Show the corners and faces of a solid in the world. A corner is a dot with
   * its number beside it; a face is a flat polygon, solid on the side that
   * faces you when its corners go counterclockwise, striped on the other side,
   * with its outline and its name. They are drawn over the model (so what is
   * behind a face can still be seen), and a dot is the same size on screen
   * however far away. A face that is `broken` is red.
   *
   * @param points The corners to mark. An empty list clears them.
   * @param faces The faces to mark. An empty list clears them.
   */
  setOverlays(points: OverlayPoint[], faces: OverlayFace[]): void {
    this.clearMarkers();
    for (const { at, label } of points) {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture("dot", dotTexture), depthTest: false, sizeAttenuation: false }));
      dot.position.set(...at);
      dot.scale.set(DOT_SCALE, DOT_SCALE, 1);
      dot.renderOrder = ORDER_DOT;
      // the number sits up and to the right of its dot
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(`tag:${label}`, () => tagTexture(label)), depthTest: false, sizeAttenuation: false }));
      tag.position.set(...at);
      tag.center.set(TAG_ANCHOR, TAG_ANCHOR);
      tag.scale.set(TAG_SCALE, TAG_SCALE, 1);
      tag.renderOrder = ORDER_LABEL;
      this.markers.add(dot, tag);
    }
    for (const face of faces) this.markers.add(this.faceObject(face));
    this.requestRender();
  }

  /**
   * The picture of one face: its two sides, its outline and its name.
   *
   * @param face The face to draw. One with fewer than three corners draws
   *             nothing.
   */
  private faceObject({ ring, label, broken }: OverlayFace): THREE.Object3D {
    const group = new THREE.Group();
    if (ring.length < 3) return group;
    const { centre, along, across } = faceFrame(ring);
    // stripes run across the face: each point gets its distance along two
    // directions in the face's plane, so that the stripes picture repeats every
    // STRIPE_REPEAT mm
    const positions: number[] = [];
    const uvs: number[] = [];
    for (const triangle of faceTriangles(ring)) {
      for (const i of triangle) {
        positions.push(...ring[i]);
        const d = new THREE.Vector3(...ring[i]).sub(centre);
        uvs.push(d.dot(along) / STRIPE_REPEAT, d.dot(across) / STRIPE_REPEAT);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    const color = broken ? BROKEN_FACE_COLOR : FACE_COLOR;
    // the side that faces you when the corners go counterclockwise: solid; the
    // other side: striped
    const front = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: FACE_FRONT_OPACITY, side: THREE.FrontSide, depthWrite: false }));
    const back = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.stripes(color), transparent: true, opacity: FACE_BACK_OPACITY, side: THREE.BackSide, depthWrite: false }));
    front.renderOrder = back.renderOrder = ORDER_FACE;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ring.map((p) => new THREE.Vector3(...p))),
      new THREE.LineBasicMaterial({ color: broken ? BROKEN_FACE_OUTLINE_COLOR : FACE_OUTLINE_COLOR, depthTest: false }),
    );
    outline.renderOrder = ORDER_FACE_OUTLINE;
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(`face:${label}`, () => faceLabelTexture(label)), depthTest: false, sizeAttenuation: false }));
    name.position.copy(centre);
    name.scale.set(FACE_LABEL_WIDTH_SCALE, FACE_LABEL_HEIGHT_SCALE, 1);
    name.renderOrder = ORDER_LABEL;
    group.add(front, back, outline, name);
    return group;
  }

  /**
   * The picture for the back of a face: diagonal stripes of one color on white,
   * which repeats seamlessly.
   *
   * @param color The stripes' color.
   */
  private stripes(color: number): THREE.Texture {
    return this.texture(`stripes:${color}`, () => {
      const texture = drawnTexture(STRIPES_PX, STRIPES_PX, (g) => {
        g.fillStyle = css(WHITE);
        g.fillRect(0, 0, STRIPES_PX, STRIPES_PX);
        g.strokeStyle = css(color);
        g.lineWidth = STRIPE_WIDTH_PX;
        for (let i = -STRIPES_PX; i <= STRIPES_PX * 2; i += STRIPE_SPACING_PX) {
          g.beginPath();
          g.moveTo(i, STRIPES_PX);
          g.lineTo(i + STRIPES_PX, 0);
          g.stroke();
        }
      });
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      return texture;
    });
  }

  /**
   * A texture that is made once and then shared by every mark that uses it.
   *
   * @param key What the texture is of, to find it again.
   * @param make Makes it, the first time it is asked for.
   */
  private texture(key: string, make: () => THREE.Texture): THREE.Texture {
    let texture = this.textures.get(key);
    if (!texture) {
      texture = make();
      this.textures.set(key, texture);
    }
    return texture;
  }

  /** Remove every mark from the view, releasing what they hold */
  private clearMarkers(): void {
    for (const child of [...this.markers.children]) {
      this.markers.remove(child);
      disposeObject(child);
    }
  }

  /** The element the view is drawn in; overlays are added to it */
  get element(): HTMLElement {
    return this.container;
  }

  /**
   * Run `fn` after every frame that is drawn (to keep overlays in step with the
   * camera). Frames are drawn only when something changed, so `fn` runs only
   * then. It also runs once soon after it is added.
   *
   * @returns A function that stops it.
   */
  addFrameHook(fn: () => void): () => void {
    this.hooks.add(fn);
    this.requestRender();
    return () => void this.hooks.delete(fn);
  }

  /**
   * One tick of the animation loop: move the camera (the controls ease to a
   * stop), and draw if that moved it or something else changed.
   */
  private readonly frame = (): void => {
    const moved = this.controls.update();
    if (!moved && !this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    for (const hook of [...this.hooks]) hook();
  };

  /** Called when the window or the container may have changed size */
  private readonly onResize = (): void => this.resize();

  /**
   * Make the canvas fill the container. Does nothing while the container has no
   * size (it is hidden): the camera keeps what it had.
   */
  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.updateProjection();
  }

  /**
   * Make the camera's shape match the container's. Does nothing while the
   * container has no size.
   */
  private updateProjection(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Remove every shape from the view, releasing what they hold */
  private clearModel(): void {
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      disposeObject(child);
    }
  }

  /**
   * Show these shapes, and nothing else. Each is given its own color, in turn,
   * except the pieces drawn only as lines.
   *
   * @param shapes What to draw.
   */
  setShapes(shapes: ShapeDisplay[]): void {
    this.clearModel();
    let color = 0;
    for (const shape of shapes) {
      if (shape.linesOnly) {
        // the edges of a piece are drawn in front of the shape it is in, in the
        // order the pieces were put together
        const plain = plainGeometry(shape.mesh);
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(plain, EDGE_ANGLE), new THREE.LineBasicMaterial({ color: PIECE_EDGE_COLOR, depthTest: false }));
        plain.dispose();
        lines.renderOrder = ORDER_PIECE_EDGES;
        this.model.add(lines);
        continue;
      }
      const material = new THREE.MeshStandardMaterial({ color: PALETTE[color++ % PALETTE.length], metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
      const geometry = shadedGeometry(shape.mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, EDGE_ANGLE), new THREE.LineBasicMaterial({ color: shape.outline ? SKETCH_EDGE_COLOR : EDGE_COLOR }));
      this.model.add(new THREE.Mesh(geometry, material), edges);
    }
    this.requestRender();
  }

  /**
   * Look at the target from a standard direction, keeping the distance.
   *
   * The top and bottom views stand a little in front of the pole,
   * so that the camera's up stays +z, the screen shows +y (top)
   * or -y (bottom) upward, and the controls keep turning around z.
   *
   * @param name Which view.
   */
  setView(name: ViewName): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const dir = new THREE.Vector3(...VIEW_DIRS[name]).normalize();
    if (name === "top" || name === "bottom") dir.y -= POLE_NUDGE;
    dir.normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.updateProjection();
    this.requestRender();
  }

  /**
   * Center the orbit target on the model and back off far enough to see all of
   * it, looking from where the camera is now. Does nothing if there is no
   * model.
   */
  fitToView(): void {
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target);
    // the camera is on its target (it cannot say which way it is looking): use
    // the standard view
    if (dir.lengthSq() < TINY) dir.set(...VIEW_DIRS.iso);
    dir.normalize();
    // the view may be taller than wide: fit the narrower of the two angles
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const fov = Math.min(vertical, 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect));
    const dist = (sphere.radius / Math.sin(fov / 2)) * FIT_MARGIN;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.update();
    this.updateProjection();
    this.requestRender();
  }
}
