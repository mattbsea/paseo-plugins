// Types for viewer-engine.js, generated from engine/ by scripts/build-vendor.mjs.
//
// Self-contained on purpose: Paseo's compiler follows type imports, and a Git install has
// no node_modules/three to resolve them against. test/engine-types.ts checks that
// engine/index.ts still satisfies these declarations.

export type EngineModelFormat = "stl" | "obj" | "ply" | "3mf" | "gltf" | "glb" | "step" | "iges" | "brep";
export type EnginePayloadKind = "file" | "mesh-bundle";
export type ViewDirection = "iso" | "top" | "front" | "right";

export interface ModelStats {
  /** Axis-aligned bounding box size in millimetres. */
  dimensions: { x: number; y: number; z: number };
  triangles: number;
  meshes: number;
}

export interface ViewerColors {
  background: string;
  grid: string;
  gridMajor: string;
  model: string;
  boundingBox: string;
}

export interface Viewer {
  load(format: EngineModelFormat, payload: EnginePayloadKind, bytes: Uint8Array): Promise<ModelStats>;
  setWireframe(enabled: boolean): void;
  setGrid(enabled: boolean): void;
  setBoundingBox(enabled: boolean): void;
  setColors(colors: ViewerColors): void;
  fit(direction?: ViewDirection): void;
  dispose(): void;
}

/** `container` is a DOM element; typed loosely because client code has no DOM types. */
export declare function createViewer(container: object, colors: ViewerColors): Viewer;
export declare function niceStep(value: number): number;
