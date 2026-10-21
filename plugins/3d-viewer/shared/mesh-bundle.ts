// A compact binary container for triangle meshes produced on the daemon (STEP/IGES/BREP).
//
//   bytes 0-3   "P3DM"
//   bytes 4-7   version (uint32 LE)
//   bytes 8-11  header length in bytes (uint32 LE)
//   header      ASCII JSON (BundleHeader), space-padded to a multiple of 4
//   data        Float32 / Uint32 arrays, each 4-byte aligned, offsets relative to data start
//
// Plain functions over typed arrays, so the daemon, the client engine and tests share it.

export const MESH_BUNDLE_VERSION = 1;
const MAGIC = [0x50, 0x33, 0x44, 0x4d]; // "P3DM"

export type Rgb = [number, number, number];

export interface BundleMesh {
  name: string;
  /** Linear RGB in 0..1. */
  color: Rgb | null;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array | null;
  /** Triangle ranges (inclusive, in triangles) with their own color. */
  faceColors: { first: number; last: number; color: Rgb }[];
}

interface ArrayRef {
  offset: number;
  length: number;
}

interface HeaderMesh {
  name: string;
  color: Rgb | null;
  positions: ArrayRef;
  normals: ArrayRef | null;
  indices: ArrayRef | null;
  faceColors: { first: number; last: number; color: Rgb }[];
}

interface BundleHeader {
  meshes: HeaderMesh[];
}

export function isMeshBundle(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && MAGIC.every((value, index) => bytes[index] === value);
}

export function encodeMeshBundle(meshes: readonly BundleMesh[]): Uint8Array {
  let dataLength = 0;
  const reserve = (array: Float32Array | Uint32Array | null): ArrayRef | null => {
    if (!array) return null;
    const ref = { offset: dataLength, length: array.length };
    dataLength += array.length * 4;
    return ref;
  };
  const header: BundleHeader = {
    meshes: meshes.map((mesh) => ({
      name: mesh.name,
      color: mesh.color,
      positions: reserve(mesh.positions)!,
      normals: reserve(mesh.normals),
      indices: reserve(mesh.indices),
      faceColors: mesh.faceColors,
    })),
  };
  const headerBytes = asciiBytes(JSON.stringify(header));
  const headerLength = align4(headerBytes.length);
  const dataStart = 12 + headerLength;
  const output = new Uint8Array(dataStart + dataLength);
  output.set(MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint32(4, MESH_BUNDLE_VERSION, true);
  view.setUint32(8, headerLength, true);
  output.set(headerBytes, 12);
  meshes.forEach((mesh, index) => {
    const refs = header.meshes[index];
    writeArray(output, dataStart, refs.positions, mesh.positions);
    if (refs.normals && mesh.normals) writeArray(output, dataStart, refs.normals, mesh.normals);
    if (refs.indices && mesh.indices) writeArray(output, dataStart, refs.indices, mesh.indices);
  });
  return output;
}

export function decodeMeshBundle(bytes: Uint8Array): BundleMesh[] {
  if (!isMeshBundle(bytes)) throw new Error("Not a mesh bundle");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== MESH_BUNDLE_VERSION) throw new Error(`Unsupported mesh bundle version ${version}`);
  const headerLength = view.getUint32(8, true);
  const dataStart = 12 + headerLength;
  if (dataStart > bytes.length) throw new Error("Truncated mesh bundle");
  const header = JSON.parse(asciiString(bytes.subarray(12, 12 + headerLength))) as BundleHeader;
  // Copy into an aligned buffer once so typed array views need no per-array copies.
  const data = bytes.slice(dataStart).buffer;
  const floats = (ref: ArrayRef) => new Float32Array(data, ref.offset, ref.length);
  const uints = (ref: ArrayRef) => new Uint32Array(data, ref.offset, ref.length);
  for (const mesh of header.meshes) {
    for (const ref of [mesh.positions, mesh.normals, mesh.indices]) {
      if (ref && ref.offset + ref.length * 4 > data.byteLength) throw new Error("Truncated mesh bundle");
    }
  }
  return header.meshes.map((mesh) => ({
    name: mesh.name,
    color: mesh.color,
    positions: floats(mesh.positions),
    normals: mesh.normals ? floats(mesh.normals) : null,
    indices: mesh.indices ? uints(mesh.indices) : null,
    faceColors: mesh.faceColors,
  }));
}

function writeArray(output: Uint8Array, dataStart: number, ref: ArrayRef, array: Float32Array | Uint32Array) {
  const source = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  output.set(source, dataStart + ref.offset);
}

function align4(length: number): number {
  return (length + 3) & ~3;
}

// JSON with every non-ASCII character escaped, so the header needs no TextEncoder
// (unavailable in this project's non-DOM type environment and on older Hermes).
function asciiBytes(json: string): Uint8Array {
  const ascii = json.replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const bytes = new Uint8Array(align4(ascii.length));
  for (let index = 0; index < ascii.length; index++) bytes[index] = ascii.charCodeAt(index);
  for (let index = ascii.length; index < bytes.length; index++) bytes[index] = 0x20;
  return bytes;
}

function asciiString(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return text;
}
