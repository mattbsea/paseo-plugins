// Formats the viewer opens, keyed by lowercase file extension.
//
// "mesh" formats travel to the client as the original file bytes and are parsed there by
// three.js loaders. "cad" formats are tessellated on the daemon by OpenCascade
// (occt-import-js) and travel as a mesh bundle (see mesh-bundle.ts).

export type ModelFormat = "stl" | "obj" | "ply" | "3mf" | "gltf" | "glb" | "step" | "iges" | "brep";

export interface FormatInfo {
  format: ModelFormat;
  label: string;
  kind: "mesh" | "cad";
  /** Up axis the file conventionally uses. The viewer shows everything Z-up. */
  up: "z" | "y";
  /** Unit of one model coordinate, as the viewer interprets it. */
  units: "mm" | "m" | "file";
}

const FORMATS: Record<ModelFormat, Omit<FormatInfo, "format">> = {
  stl: { label: "STL", kind: "mesh", up: "z", units: "mm" },
  obj: { label: "Wavefront OBJ", kind: "mesh", up: "z", units: "mm" },
  ply: { label: "PLY", kind: "mesh", up: "z", units: "mm" },
  // 3MF declares its unit in the model XML; the engine reads it.
  "3mf": { label: "3MF", kind: "mesh", up: "z", units: "file" },
  // glTF is Y-up with metres by specification.
  gltf: { label: "glTF", kind: "mesh", up: "y", units: "m" },
  glb: { label: "glTF binary", kind: "mesh", up: "y", units: "m" },
  // OpenCascade converts STEP and IGES to millimetres; BREP has no unit and is read as mm.
  step: { label: "STEP", kind: "cad", up: "z", units: "mm" },
  iges: { label: "IGES", kind: "cad", up: "z", units: "mm" },
  brep: { label: "OpenCascade BREP", kind: "cad", up: "z", units: "mm" },
};

const EXTENSIONS: Record<string, ModelFormat> = {
  stl: "stl",
  obj: "obj",
  ply: "ply",
  "3mf": "3mf",
  gltf: "gltf",
  glb: "glb",
  step: "step",
  stp: "step",
  iges: "iges",
  igs: "iges",
  brep: "brep",
  brp: "brep",
};

/** Extensions without the dot, for file pickers and file panel selectors. */
export const MODEL_EXTENSIONS: readonly string[] = Object.keys(EXTENSIONS);

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function formatForPath(path: string): FormatInfo | null {
  const format = EXTENSIONS[extensionOf(path)];
  return format ? { format, ...FORMATS[format] } : null;
}

export function formatInfo(format: ModelFormat): FormatInfo {
  return { format, ...FORMATS[format] };
}

/**
 * Checks the first bytes against what the extension promises, so a mislabelled file
 * fails with a clear message instead of a parser error deep inside a loader.
 * Returns null when the content is plausible, else a reason.
 */
export function sniffMismatch(format: ModelFormat, head: Uint8Array, size: number): string | null {
  const text = asciiPrefix(head, 512);
  switch (format) {
    case "stl": {
      if (/^\s*solid[\s\r\n]/i.test(text) && /facet|endsolid/i.test(text)) return null;
      // Binary STL: 80-byte header, uint32 triangle count, 50 bytes per triangle.
      if (head.length >= 84) {
        const count = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(80, true);
        if (84 + count * 50 === size) return null;
        // Some exporters pad or truncate; accept anything that is at least close.
        if (count > 0 && Math.abs(84 + count * 50 - size) < 1024) return null;
      }
      return "This file is neither ASCII nor binary STL.";
    }
    case "glb":
      return text.startsWith("glTF") ? null : "This file has no glTF binary header.";
    case "gltf":
      // Allow a UTF-8 byte order mark (EF BB BF) before the JSON.
      return /^(\xEF\xBB\xBF)?\s*\{/.test(text) ? null : "This glTF file is not JSON.";
    case "3mf":
      return head[0] === 0x50 && head[1] === 0x4b ? null : "This 3MF file is not a ZIP package.";
    case "ply":
      return text.startsWith("ply") ? null : "This file has no PLY header.";
    case "step":
      return text.includes("ISO-10303-21") ? null : "This file has no STEP (ISO-10303-21) header.";
    default:
      return null;
  }
}

function asciiPrefix(bytes: Uint8Array, length: number): string {
  let text = "";
  const end = Math.min(bytes.length, length);
  for (let index = 0; index < end; index++) text += String.fromCharCode(bytes[index]);
  return text;
}
