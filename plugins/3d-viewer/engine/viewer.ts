// WebGL viewport: orbit/zoom/pan, grid, fit-to-view, shaded/wireframe, bounding box.
// Runs only in the browser and desktop app (client/web.ts gates it on Platform.OS).
import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Texture,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ModelFormat } from "../shared/formats";
import { DEFAULT_MATERIAL, measure, parseModel, type ModelStats, type PayloadKind } from "./parse";

export interface ViewerColors {
  background: string;
  grid: string;
  gridMajor: string;
  model: string;
  boundingBox: string;
}

export type ViewDirection = "iso" | "top" | "front" | "right";

export interface Viewer {
  load(format: ModelFormat, payload: PayloadKind, bytes: Uint8Array): Promise<ModelStats>;
  setWireframe(enabled: boolean): void;
  setGrid(enabled: boolean): void;
  setBoundingBox(enabled: boolean): void;
  setColors(colors: ViewerColors): void;
  fit(direction?: ViewDirection): void;
  dispose(): void;
}

const DIRECTIONS: Record<ViewDirection, Vector3> = {
  iso: new Vector3(1, -1.25, 0.9).normalize(),
  top: new Vector3(0, -0.0001, 1).normalize(),
  front: new Vector3(0, -1, 0),
  right: new Vector3(1, 0, 0),
};

export function createViewer(container: HTMLElement, initialColors: ViewerColors): Viewer {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.outline = "none";
  // Let OrbitControls own touch gestures instead of the page scrolling.
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch (error) {
    canvas.remove();
    throw new Error(`WebGL is not available here (${error instanceof Error ? error.message : String(error)}).`);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(100, -125, 90);

  scene.add(new AmbientLight(0xffffff, 0.35));
  const hemisphere = new HemisphereLight(0xffffff, 0x404040, 1.2);
  hemisphere.position.set(0, 0, 1);
  scene.add(hemisphere);
  // A headlight that follows the camera keeps every visible face lit while orbiting.
  const headlight = new DirectionalLight(0xffffff, 1.4);
  headlight.position.set(0.3, 0.4, 1);
  camera.add(headlight);
  scene.add(camera);

  const controls = new OrbitControls(camera, canvas);
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;

  let colors = initialColors;
  let model: Object3D | null = null;
  let grid: GridHelper | null = null;
  let boxHelper: Box3Helper | null = null;
  let gridVisible = true;
  let boxVisible = false;
  let wireframe = false;
  let frame = 0;
  let disposed = false;
  // Each load gets a number; a slower earlier load must not replace a newer model.
  let latestLoad = 0;
  // Until the user moves the camera, a resize re-frames the model (the panel may have
  // had no size when the model loaded).
  let userMoved = false;

  function render() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  }
  controls.addEventListener("change", render);
  controls.addEventListener("start", () => {
    userMoved = true;
  });

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (model && !userMoved) fit();
    render();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  function bounds(): Box3 {
    const box = model ? new Box3().setFromObject(model) : new Box3();
    // No model, or one with no measurable geometry: frame a 100 mm cube.
    return box.isEmpty() ? new Box3(new Vector3(-50, -50, 0), new Vector3(50, 50, 50)) : box;
  }

  function rebuildGrid() {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      grid = null;
    }
    if (!gridVisible) return;
    const box = bounds();
    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 1);
    const cell = niceStep(span / 8);
    // Even cell count so the grid stays centred on the part.
    const cells = Math.max(10, Math.ceil((span * 2) / cell / 2) * 2);
    grid = new GridHelper(cells * cell, cells, new Color(colors.gridMajor), new Color(colors.grid));
    grid.rotation.x = Math.PI / 2;
    const center = box.getCenter(new Vector3());
    // Slightly below the part so its bottom face does not z-fight with the grid.
    grid.position.set(snap(center.x, cell), snap(center.y, cell), box.min.z - span * 1e-3);
    scene.add(grid);
  }

  function rebuildBox() {
    if (boxHelper) {
      scene.remove(boxHelper);
      boxHelper.geometry.dispose();
      (boxHelper.material as Material).dispose();
      boxHelper = null;
    }
    if (!boxVisible || !model) return;
    boxHelper = new Box3Helper(bounds(), new Color(colors.boundingBox));
    scene.add(boxHelper);
  }

  function applyMaterials() {
    model?.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        if ("wireframe" in material) (material as MeshStandardMaterial).wireframe = wireframe;
        if (material.userData[DEFAULT_MATERIAL] && material instanceof MeshStandardMaterial) {
          material.color.set(colors.model);
        }
      }
    });
  }

  function fit(direction: ViewDirection = "iso") {
    const sphere = bounds().getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.5);
    const fov = (camera.fov * Math.PI) / 180;
    const fitFov = camera.aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * camera.aspect) : fov;
    const distance = (radius / Math.sin(fitFov / 2)) * 1.1;
    camera.position.copy(sphere.center).addScaledVector(DIRECTIONS[direction], distance);
    camera.near = distance / 1000;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.maxDistance = distance * 20;
    controls.update();
    render();
  }

  function disposeModel() {
    if (!model) return;
    scene.remove(model);
    disposeObject(model);
    model = null;
  }

  function disposeObject(object: Object3D) {
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        for (const value of Object.values(material)) {
          if (value instanceof Texture) value.dispose();
        }
        material.dispose();
      }
    });
  }

  function setColors(next: ViewerColors) {
    colors = next;
    scene.background = new Color(colors.background);
    applyMaterials();
    rebuildGrid();
    rebuildBox();
    render();
  }

  setColors(colors);
  resize();

  return {
    async load(format, payload, bytes) {
      const load = ++latestLoad;
      const object = await parseModel(format, payload, bytes);
      if (disposed || load !== latestLoad) {
        const stats = measure(object);
        disposeObject(object);
        return stats;
      }
      disposeModel();
      model = object;
      userMoved = false;
      scene.add(object);
      applyMaterials();
      rebuildGrid();
      rebuildBox();
      fit();
      return measure(object);
    },
    setWireframe(enabled) {
      wireframe = enabled;
      applyMaterials();
      render();
    },
    setGrid(enabled) {
      gridVisible = enabled;
      rebuildGrid();
      render();
    },
    setBoundingBox(enabled) {
      boxVisible = enabled;
      rebuildBox();
      render();
    },
    setColors,
    fit,
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeModel();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/** 1, 2 or 5 times a power of ten, at least `value`. */
export function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1e-6)));
  for (const factor of [1, 2, 5, 10]) if (factor * power >= value) return factor * power;
  return 10 * power;
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}
