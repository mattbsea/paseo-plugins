// Turns model bytes into a three.js object in millimetres, Z-up.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from "three";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { formatInfo, type ModelFormat } from "../shared/formats";
import { decodeMeshBundle } from "../shared/mesh-bundle";

export type PayloadKind = "file" | "mesh-bundle";

export interface ModelStats {
  /** Axis-aligned bounding box size in millimetres. */
  dimensions: { x: number; y: number; z: number };
  triangles: number;
  meshes: number;
}

/** Marks materials the viewer created, so it may recolour them with the theme. */
export const DEFAULT_MATERIAL = "viewer3d.default";

/** White, untagged material so per-vertex colours show unchanged. */
export function vertexColorMaterial(): MeshStandardMaterial {
  const material = defaultMaterial(new Color(1, 1, 1));
  material.vertexColors = true;
  return material;
}

export function defaultMaterial(color?: Color): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: color ?? new Color(0.7, 0.7, 0.72),
    metalness: 0.05,
    roughness: 0.65,
    side: DoubleSide,
  });
  if (!color) material.userData[DEFAULT_MATERIAL] = true;
  return material;
}

export async function parseModel(format: ModelFormat, payload: PayloadKind, bytes: Uint8Array): Promise<Object3D> {
  const object = payload === "mesh-bundle" ? fromMeshBundle(bytes) : await parseFile(format, bytes);
  const root = new Group();
  root.name = "model";
  root.add(object);
  const info = formatInfo(format);
  let scale = info.units === "m" ? 1000 : 1;
  if (format === "3mf") scale = threeMfScale(bytes);
  object.scale.multiplyScalar(scale);
  // Y-up formats (glTF) are rotated so +Y becomes +Z, matching slicers and CAD.
  if (info.up === "y") object.rotation.x = Math.PI / 2;
  root.updateMatrixWorld(true);
  return root;
}

async function parseFile(format: ModelFormat, bytes: Uint8Array): Promise<Object3D> {
  switch (format) {
    case "stl": {
      const geometry = new STLLoader().parse(arrayBuffer(bytes));
      // Binary STL may carry per-face colours (VisCAM/SolidView convention).
      const colored = (geometry as BufferGeometry & { hasColors?: boolean }).hasColors;
      return new Mesh(geometry, colored ? vertexColorMaterial() : defaultMaterial());
    }
    case "ply": {
      const geometry = new PLYLoader().parse(arrayBuffer(bytes));
      // PLY faces always arrive indexed; no index means a vertex-only point cloud.
      if (!geometry.index) {
        throw new Error("This PLY file is a point cloud; the viewer shows triangle meshes only.");
      }
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      return new Mesh(geometry, geometry.attributes.color ? vertexColorMaterial() : defaultMaterial());
    }
    case "obj": {
      const object = new OBJLoader().parse(utf8(bytes));
      // Without its .mtl the loader assigns placeholder materials; use the viewer's.
      object.traverse((child) => {
        if (child instanceof Mesh) {
          child.material = child.geometry.attributes.color ? vertexColorMaterial() : defaultMaterial();
          if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
        }
      });
      return object;
    }
    case "3mf":
      return new ThreeMFLoader().parse(arrayBuffer(bytes));
    case "gltf":
    case "glb": {
      const gltf = await new GLTFLoader().parseAsync(format === "gltf" ? utf8(bytes) : arrayBuffer(bytes), "");
      return gltf.scene;
    }
    default:
      throw new Error(`${format.toUpperCase()} must be converted on the daemon.`);
  }
}

function fromMeshBundle(bytes: Uint8Array): Object3D {
  const group = new Group();
  for (const mesh of decodeMeshBundle(bytes)) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    if (mesh.normals) geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    if (mesh.indices) geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    if (!mesh.normals) geometry.computeVertexNormals();
    const base = mesh.color ? new Color(...mesh.color) : undefined;
    let material: Material | Material[] = defaultMaterial(base);
    if (mesh.faceColors.length > 0 && mesh.indices) {
      // One group per coloured face range; uncoloured triangles keep the mesh colour.
      const materials: Material[] = [material];
      const triangleCount = mesh.indices.length / 3;
      let cursor = 0;
      const sorted = [...mesh.faceColors].sort((a, b) => a.first - b.first);
      for (const face of sorted) {
        if (face.first > cursor) geometry.addGroup(cursor * 3, (face.first - cursor) * 3, 0);
        materials.push(defaultMaterial(new Color(...face.color)));
        geometry.addGroup(face.first * 3, (face.last - face.first + 1) * 3, materials.length - 1);
        cursor = face.last + 1;
      }
      if (cursor < triangleCount) geometry.addGroup(cursor * 3, (triangleCount - cursor) * 3, 0);
      material = materials;
    }
    const object = new Mesh(geometry, material);
    object.name = mesh.name;
    group.add(object);
  }
  return group;
}

const THREE_MF_UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/** 3MF declares its unit on the root model element; three's loader ignores it. */
export function threeMfScale(bytes: Uint8Array): number {
  try {
    const files = unzipSync(bytes, { filter: (file) => /\.model$/i.test(file.name) });
    const name = Object.keys(files).find((path) => /^\/?3D\/[^/]+\.model$/i.test(path)) ?? Object.keys(files)[0];
    if (!name) return 1;
    const head = utf8(files[name].subarray(0, 4096));
    const unit = /<model\b[^>]*\bunit\s*=\s*["']([a-z]+)["']/i.exec(head)?.[1]?.toLowerCase();
    return (unit && THREE_MF_UNITS[unit]) || 1;
  } catch {
    return 1;
  }
}

export function measure(object: Object3D): ModelStats {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  let triangles = 0;
  let meshes = 0;
  object.traverse((child) => {
    if (child instanceof Mesh) {
      meshes++;
      const geometry = child.geometry as BufferGeometry;
      triangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    }
  });
  if (box.isEmpty()) return { dimensions: { x: 0, y: 0, z: 0 }, triangles, meshes };
  return {
    dimensions: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
    triangles: Math.round(triangles),
    meshes,
  };
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
