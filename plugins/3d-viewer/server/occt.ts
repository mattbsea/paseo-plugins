import { brotliDecompressSync } from "node:zlib";
import type { BundleMesh, Rgb } from "../shared/mesh-bundle";
import occtImportJs from "./vendor/occt-import-js.js";
import { wasmBrotliBase64, wasmByteLength } from "./vendor/occt-wasm.js";

export type CadFormat = "step" | "iges" | "brep";

interface OcctMesh {
  name?: string;
  color?: Rgb;
  brep_faces?: { first: number; last: number; color: Rgb | null }[];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index?: { array: number[] };
}

interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}

interface OcctModule {
  ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  ReadBrepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
}

interface OcctParams {
  linearUnit: "millimeter";
  linearDeflectionType: "bounding_box_ratio" | "absolute_value";
  linearDeflection: number;
  angularDeflection: number;
}

// Tessellation tolerance: 0.1% of the bounding box diagonal and 0.5 rad keeps curved
// surfaces of small printed parts smooth without exploding triangle counts on large ones.
const PARAMS: OcctParams = {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

let modulePromise: Promise<OcctModule> | null = null;

/** Instantiates OpenCascade once per plugin process (~0.15 s measured; the wasm is 7.3 MiB). */
export function loadOcct(): Promise<OcctModule> {
  modulePromise ??= instantiate().catch((error: unknown) => {
    modulePromise = null;
    throw error;
  });
  return modulePromise;
}

async function instantiate(): Promise<OcctModule> {
  const wasmBinary = brotliDecompressSync(Buffer.from(wasmBrotliBase64, "base64"));
  if (wasmBinary.length !== wasmByteLength) throw new Error("Embedded OpenCascade wasm is corrupt");
  // The Emscripten glue reads __dirname in Node to find its .wasm. Paseo evaluates plugin
  // bundles from a string where __dirname does not exist; with wasmBinary supplied the
  // value is never used, so a placeholder avoids the ReferenceError.
  const global = globalThis as { __dirname?: string };
  const hadDirname = "__dirname" in global;
  if (!hadDirname) global.__dirname = "/";
  try {
    return (await occtImportJs({ wasmBinary })) as OcctModule;
  } finally {
    if (!hadDirname) delete global.__dirname;
  }
}

export async function tessellate(format: CadFormat, bytes: Uint8Array): Promise<BundleMesh[]> {
  const occt = await loadOcct();
  const read = { step: occt.ReadStepFile, iges: occt.ReadIgesFile, brep: occt.ReadBrepFile }[format];
  const result = read.call(occt, bytes, PARAMS);
  if (!result.success) throw new Error(`OpenCascade could not read this ${format.toUpperCase()} file.`);
  const meshes = result.meshes
    .filter((mesh) => mesh.attributes.position.array.length >= 9)
    .map(
      (mesh, index): BundleMesh => ({
        name: mesh.name || `Shape ${index + 1}`,
        color: mesh.color ?? null,
        positions: Float32Array.from(mesh.attributes.position.array),
        normals: mesh.attributes.normal ? Float32Array.from(mesh.attributes.normal.array) : null,
        indices: mesh.index ? Uint32Array.from(mesh.index.array) : null,
        faceColors: (mesh.brep_faces ?? []).flatMap((face) =>
          face.color ? [{ first: face.first, last: face.last, color: face.color }] : [],
        ),
      }),
    );
  if (meshes.length === 0) throw new Error(`This ${format.toUpperCase()} file contains no surfaces to display.`);
  return meshes;
}
